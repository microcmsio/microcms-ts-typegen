import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compilerBinary } from './helpers/type-compiler.mjs';


test('public Config supports environment inputs and catches configuration mistakes', async () => {
  const directory = await mkdtemp(new URL('../.config-type-test-', import.meta.url));
  try {
    const usage = join(directory, 'usage.ts');
    await writeFile(usage, `
import type { Config, ServiceConfig } from 'microcms-typegen';
const config = {
  services: {
    main: {
      serviceDomain: process.env.MICROCMS_SERVICE_DOMAIN,
      apiKey: process.env.MICROCMS_API_INFO_API_KEY,
      output: './types.ts',
      endpoints: ['blogs'],
      extensionFieldTypes: {
        blogs: {
          'panel.embed': { from: './extensions', data: 'EmbedData' },
        },
      },
    },
  },
} satisfies Config;
const main = config.services.main;
// @ts-expect-error satisfies retains the actual service keys
config.services.missing;
// @ts-expect-error credentials must be explicitly specified, even if undefined
const missingKey: ServiceConfig = { serviceDomain: 'sample', output: './types.ts' };
const wrongOutput: ServiceConfig = {
  ...main,
  // @ts-expect-error only credentials accept undefined
  output: undefined,
};
const wrongOption = {
  services: { main },
  // @ts-expect-error unknown config options are rejected
  serviceDomain: 'sample',
} satisfies Config;
const wrongEndpoints: ServiceConfig = {
  ...main,
  // @ts-expect-error endpoints must be an array of strings
  endpoints: 'blogs',
};
const incompleteExtension: ServiceConfig = {
  ...main,
  extensionFieldTypes: { blogs: {
    // @ts-expect-error extension fields require both from and data
    extension: { from: './extensions' },
  } },
};
void [config, missingKey, wrongOutput, wrongOption, wrongEndpoints, incompleteExtension];
`);
    const result = spawnSync(process.execPath, [
      compilerBinary(), '--ignoreConfig',
      '--noEmit', '--strict', '--exactOptionalPropertyTypes',
      '--types', 'node',
      '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler',
      usage,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, [result.stdout, result.stderr].join('\n'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
