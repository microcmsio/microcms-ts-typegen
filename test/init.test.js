import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('init creates only a usable config and preserves existing project files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'microcms-typegen-init-'));
  try {
    const invoke = (...args) => spawnSync(process.execPath, [cli, 'init', ...args], {
      cwd: directory, encoding: 'utf8',
    });
    const help = invoke('--help');
    assert.equal(help.status, 0);
    assert.deepEqual(await readdir(directory), []);

    const invalid = invoke('--force');
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /init does not accept options/);
    assert.deepEqual(await readdir(directory), []);

    await writeFile(join(directory, '.env'), 'EXISTING=value\n');
    await writeFile(join(directory, '.gitignore'), '.env\n');
    const created = invoke();
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, /Created microcms-typegen.config.ts/);
    assert.match(created.stdout, /MICROCMS_SERVICE_DOMAIN/);
    assert.match(created.stdout, /MICROCMS_API_INFO_API_KEY/);
    assert.doesNotMatch(created.stdout, /automatically|\.env/);
    const path = join(directory, 'microcms-typegen.config.ts');
    const config = await readFile(path, 'utf8');
    assert.match(config, /import type \{ Config \} from 'microcms-typegen'/);
    assert.match(config, /satisfies Config/);
    assert.match(config, /serviceDomain: process.env.MICROCMS_SERVICE_DOMAIN/);
    assert.match(config, /apiKey: process.env.MICROCMS_API_INFO_API_KEY/);
    assert.doesNotMatch(config, /endpoints|extensionFieldTypes/);
    assert.deepEqual((await readdir(directory)).sort(), ['.env', '.gitignore', 'microcms-typegen.config.ts']);
    assert.equal(await readFile(join(directory, '.env'), 'utf8'), 'EXISTING=value\n');
    assert.equal(await readFile(join(directory, '.gitignore'), 'utf8'), '.env\n');

    // Even an empty existing config must be preserved.
    await writeFile(path, '');
    const skipped = invoke();
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.match(skipped.stdout, /Skipped microcms-typegen.config.ts: already exists/);
    assert.equal(await readFile(path, 'utf8'), '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
