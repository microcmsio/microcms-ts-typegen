import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTypes } from '../test/helpers/type-compiler.mjs';
import { generateTypes } from '../src/generate.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'microcms package check-'));
const run = (command, args, cwd = temporary, env = process.env) =>
  execFileSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  // Use a temporary npm cache so this check does not depend on a user's cache.
  const npmEnv = { ...process.env, npm_config_cache: join(temporary, 'npm-cache') };
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary, '--ignore-scripts'], root, npmEnv));
  const files = packed.files.map(file => file.path);
  for (const required of ['LICENSE', 'src/cli.js', 'src/config.d.ts', 'src/generate.js', 'src/management.js', 'microcms-typegen.config.example.ts']) {
    assert.ok(files.includes(required), `Package is missing ${required}`);
  }
  for (const file of files) {
    assert.ok(/^(src\/|microcms-typegen\.config\.example\.ts$|package\.json$|README\.md$|LICENSE$)/.test(file), `Unexpected package file: ${file}`);
  }
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', join(temporary, packed.filename), '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], temporary, npmEnv);
  const cli = join(temporary, 'node_modules/microcms-typegen/src/cli.js');
  assert.match(run('npm', ['exec', '--offline', '--', 'microcms-typegen', '--help'], temporary, npmEnv), /Usage: microcms-typegen/);
  assert.match(run('npm', ['exec', '--offline', '--', 'microcms-typegen', 'init'], temporary, npmEnv), /Created microcms-typegen.config.ts/);
  const configPath = join(temporary, 'microcms-typegen.config.ts');
  const initialized = await readFile(configPath, 'utf8');
  assert.match(initialized, /satisfies Config/);
  assert.match(run(process.execPath, [cli, 'init']), /Skipped/);
  assert.equal(await readFile(configPath, 'utf8'), initialized);

  // Check the public type export through the installed package, not the source tree.
  await writeFile(join(temporary, 'config-check.ts'), `
import type { Config } from 'microcms-typegen';
declare global { const process: { env: Record<string, string | undefined> }; }
const valid: Config = { services: { main: { serviceDomain: undefined, apiKey: undefined, output: './types.ts' } } };
// @ts-expect-error output must be a string
const invalid: Config['services'][string]['output'] = 123;
`);
  checkTypes([configPath, join(temporary, 'config-check.ts')], [
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
  ]);

  // Run the installed CLI with saved API responses; no credentials or network.
  const fixture = JSON.parse(await readFile(new URL('../examples/schemas.json', import.meta.url), 'utf8'));
  const preload = join(temporary, 'mock-api.mjs');
  await writeFile(preload, `
const fixture = ${JSON.stringify(fixture)};
globalThis.fetch = async (input) => {
  const url = new URL(input);
  if (url.origin !== 'https://package-fixture.microcms-management.io') throw new Error('Unexpected API host');
  const payload = url.pathname === '/api/v1/apis' ? fixture.listing
    : fixture.schemas[url.pathname.replace('/api/v1/apis/', '')];
  if (!payload) throw new Error('Unexpected API path: ' + url.pathname);
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
`);
  const cliEnv = { ...process.env, MICROCMS_SERVICE_DOMAIN: 'package-fixture', MICROCMS_API_INFO_API_KEY: 'FIXTURE_ONLY' };
  assert.match(run(process.execPath, ['--import', preload, cli, 'generate'], temporary, cliEnv), /Generated/);
  const outputPath = join(temporary, 'src/microcms-types.ts');
  const generated = await readFile(outputPath, 'utf8');
  assert.equal(generated, generateTypes(fixture.listing.apis, new Map(Object.entries(fixture.schemas)), { serviceName: 'main' }));
  assert.match(run(process.execPath, ['--import', preload, cli, 'check'], temporary, cliEnv), /Up to date/);
  // --config changes the config location; relative output still uses the working directory.
  const configFolder = join(temporary, 'config');
  await mkdir(configFolder);
  const nestedConfigPath = join(configFolder, 'microcms-typegen.config.ts');
  await writeFile(nestedConfigPath, initialized);
  assert.match(run(process.execPath, ['--import', preload, cli, 'check', '--config', nestedConfigPath], temporary, cliEnv), /Up to date/);
  await writeFile(outputPath, generated + '// stale file\n');
  assert.throws(() => run(process.execPath, ['--import', preload, cli, 'check'], temporary, cliEnv), error => error.status === 1);
  console.log('Package contents, local installation, CLI init/generate/check and public Config types with the selected TypeScript compiler passed. Nothing was published.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
