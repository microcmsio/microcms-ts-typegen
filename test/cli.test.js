import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../dist/cli.js';

const configSource = (config) => `export default ${JSON.stringify(config)};\n`;

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'microcms-typegen-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('CLI rejects missing or unknown commands and handles both help aliases', async () => {
  for (const args of [[], ['unknown']]) {
    await assert.rejects(
      run(args),
      /Expected "init", "generate", or "check" command/,
    );
  }
  for (const args of [
    ['--help'],
    ['-h'],
    ['generate', '-h'],
    ['check', '--help'],
    ['init', '-h'],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: microcms-typegen/);
  }
  for (const flag of ['--config', '--service']) {
    for (const next of ['', '--help', '--force']) {
      await assert.rejects(
        run(['generate', flag, next]),
        new RegExp(`Missing value for ${flag}`),
      );
    }
  }
});

test('invalid config and service shapes fail before network requests or output changes', async (t) => {
  const directory = await workspace(t);
  const output = join(directory, 'types.ts');
  const config = join(directory, 'config.ts');
  await writeFile(output, '// Existing user file\n');
  const service = { serviceDomain: 'sample', apiKey: 'TEST_ONLY', output };
  const cases = [
    [null, /Config must export an object/],
    [[], /Config must export an object/],
    ['invalid', /Config must export an object/],
    [{}, /Config must define services/],
    [{ services: null }, /services must be a nonempty object/],
    [{ services: [] }, /services must be a nonempty object/],
    [{ services: {} }, /services must be a nonempty object/],
    [{ services: { main: null } }, /Invalid config for service: main/],
    [{ services: { main: [] } }, /Invalid config for service: main/],
    [{ services: { main: service }, output }, /inside each service/],
    ...[null, 123, '', 'types.js'].map((output) => [
      { services: { main: { ...service, output } } },
      /output must be a .ts file path/,
    ]),
    ...[null, [], ['../bad'], [123]].map((endpoints) => [
      { services: { main: { ...service, endpoints } } },
      /endpoints must be a nonempty array|Invalid endpoint/,
    ]),
    ...['serviceDomain', 'apiKey'].flatMap((field) =>
      [null, '', '  ', 123].map((value) => [
        { services: { main: { ...service, [field]: value } } },
        new RegExp(`services.main.${field} is required`),
      ]),
    ),
  ];
  for (const [value, error] of cases) {
    await writeFile(config, `export default ${JSON.stringify(value)};\n`);
    await assert.rejects(
      run(['generate', '--config', config], {
        fetchImpl: async () =>
          assert.fail('Invalid config must not make requests'),
      }),
      error,
    );
    assert.equal(await readFile(output, 'utf8'), '// Existing user file\n');
  }
  await writeFile(
    config,
    `export default ${JSON.stringify({ services: { main: service } })};\n`,
  );
  for (const name of ['constructor', 'toString', '__proto__']) {
    await assert.rejects(
      run(['generate', '--config', config, '--service', name]),
      new RegExp(`Unknown service: ${name}`),
    );
  }
});

test('syntax errors and filesystem errors are surfaced without being mistaken for missing config', async (t) => {
  const directory = await workspace(t);
  const config = join(directory, 'config.ts');
  await writeFile(config, 'export default {;');
  await assert.rejects(run(['generate', '--config', config]), SyntaxError);
  const unreadable = join(directory, 'directory.ts');
  await mkdir(unreadable);
  await assert.rejects(run(['generate', '--config', unreadable]), {
    code: 'EISDIR',
  });
});

test('env loading reports unreadable files with a nonzero exit code', async (t) => {
  const directory = await workspace(t);
  await mkdir(join(directory, '.env'));
  const generated = spawnSync(process.execPath, [cli, 'generate'], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.equal(generated.status, 1);
  assert.match(generated.stderr, /microcms-typegen:/);
  assert.doesNotMatch(generated.stderr, /Config file not found/);
  assert.match(generated.stderr, /EISDIR|should be a valid string/);
});

test(
  'init reports permission failures without creating project files',
  {
    skip: process.platform === 'win32' || process.getuid?.() === 0,
  },
  async (t) => {
    const directory = await workspace(t);
    await chmod(directory, 0o500);
    try {
      const result = spawnSync(process.execPath, [cli, 'init'], {
        cwd: directory,
        encoding: 'utf8',
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /microcms-typegen:.*EACCES/);
      assert.deepEqual(await readdir(directory), []);
    } finally {
      await chmod(directory, 0o700);
    }
  },
);

test('ESM TypeScript configs work with unspecified or module package types', async (t) => {
  const directory = await workspace(t);
  for (const packageType of [undefined, 'module']) {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify(packageType ? { type: packageType } : {}),
    );
    await writeFile(
      join(directory, 'config.ts'),
      `type Config = { services: Record<string, never> }; export default { services: {} } satisfies Config;`,
    );
    // Reaching config validation proves that loading and native type stripping succeeded.
    const result = spawnSync(
      process.execPath,
      [cli, 'generate', '--config', './config.ts'],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /services must be a nonempty object/);
    assert.doesNotMatch(result.stderr, /SyntaxError|ERR_REQUIRE_ESM/);
  }
});

test('CLI help shows value formats and usable examples', () => {
  const help = execFileSync(process.execPath, ['dist/cli.js', '--help'], {
    encoding: 'utf8',
  });
  assert.match(help, /<init\|generate\|check>/);
  assert.doesNotMatch(help, /--service-domain|--api-key|--output|--endpoints/);
  assert.match(help, /--config <file.ts>/);
  assert.match(help, /--service <config-name>.*corporate/);
});

test('CLI reports missing values and rejects removed config overrides', async () => {
  await assert.rejects(
    run(['generate', '--config']),
    /Missing value for --config: expected a \.ts file path/,
  );
  await assert.rejects(
    run(['generate', '--service']),
    /Missing value for --service/,
  );
  for (const flag of [
    '--service-domain',
    '--api-key',
    '--output',
    '--endpoints',
  ]) {
    await assert.rejects(
      run(['generate', flag, 'value']),
      (error) => error.message === `Unknown option: ${flag}`,
    );
  }
});

test('CLI rejects unknown arguments that match inherited object properties before loading config', async () => {
  for (const command of ['init', 'generate', 'check']) {
    for (const argument of ['constructor', 'toString', '__proto__']) {
      await assert.rejects(
        run([command, argument, 'value', '--config', '/nonexistent/config.ts']),
        (error) => error.message === `Unknown option: ${argument}`,
      );
    }
  }
});

test('CLI requires config even when environment credentials exist', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-no-env-fallback-test-'),
  );
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const env = {
    ...process.env,
    MICROCMS_SERVICE_DOMAIN: 'sample',
    MICROCMS_API_INFO_API_KEY: 'secret-key',
  };
  for (const command of ['generate', 'check']) {
    const result = spawnSync(process.execPath, [cli, command], {
      cwd: folder,
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Config file not found.*microcms-typegen init/);
  }
  const configPath = join(folder, 'config.ts');
  await writeFile(configPath, 'export default {};');
  await assert.rejects(
    run(['generate', '--config', configPath]),
    /Config must define services/,
  );
});

test('CLI loads a TypeScript config file on the minimum Node version', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-ts-config-test-'),
  );
  const configPath = join(folder, 'config.ts');
  const output = join(folder, 'types.ts');
  await writeFile(
    configPath,
    `export default { services: { main: { serviceDomain: 'sample', apiKey: 'key', output: ${JSON.stringify(output)}, endpoints: ['simple'] } } };\n`,
  );
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'simple', type: 'list' }] }
        : { apiFields: [{ fieldId: 'title', kind: 'text' }], customFields: [] },
  });
  await run(['generate', '--config', configPath], {
    fetchImpl,
    requestIntervalMs: 0,
  });
  assert.match(
    await readFile(output, 'utf8'),
    /"simple": \{[^\n]+fieldPaths: /,
  );
});

test('CLI rejects non-TypeScript configs before making requests', async () => {
  for (const extension of ['json', 'js', 'mjs']) {
    await assert.rejects(
      run(['generate', '--config', `config.${extension}`]),
      /Config must be a .ts file/,
    );
  }
});

test('missing environment credentials fail before any API request', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-required-env-test-'),
  );
  const variable = `MICROCMS_TYPEGEN_MISSING_${folder.split('-').at(-1)}`;
  for (const field of ['serviceDomain', 'apiKey']) {
    const configPath = join(folder, `${field}.ts`);
    await writeFile(
      configPath,
      `export default { services: { main: {
      serviceDomain: 'sample', apiKey: 'key', output: './types.ts',
      ${field}: process.env[${JSON.stringify(variable)}],
    } } };`,
    );
    let requested = false;
    await assert.rejects(
      run(['generate', '--config', configPath], {
        fetchImpl: async () => {
          requested = true;
          throw new Error('Unexpected request');
        },
      }),
      (error) => error.message.startsWith(`services.main.${field} is required`),
    );
    assert.equal(requested, false);
  }
});

test('legacy top-level service config reports the migration path', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-legacy-config-test-'),
  );
  const configPath = join(folder, 'config.ts');
  await writeFile(
    configPath,
    configSource({
      serviceDomain: 'old',
      apiKey: 'key',
      output: join(folder, 'types.ts'),
    }),
  );
  await assert.rejects(
    run(['generate', '--config', configPath]),
    /Config must define services/,
  );
});
