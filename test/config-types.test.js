import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compilerBinary } from './helpers/type-compiler.mjs';

test('public Config supports environment inputs and catches configuration mistakes', async () => {
  const directory = await mkdtemp(
    new URL('../.config-type-test-', import.meta.url),
  );
  try {
    const usage = join(directory, 'usage.ts');
    await writeFile(
      usage,
      `
import type { Config, ServiceConfig } from 'microcms-typegen';
const config = {
  services: {
    main: {
      serviceDomain: process.env.MICROCMS_SERVICE_DOMAIN,
      apiKey: process.env.MICROCMS_API_INFO_API_KEY,
      output: './types.ts',
      endpoints: ['blogs'],
      typeRules: { trustReadFieldConstraints: { trustReferenceAvailability: true } },
      extensionFieldTypes: {
        blogs: {
          'panel.embed': { from: './extensions', data: 'EmbedData' },
        },
      },
    },
  },
} satisfies Config;
const main = config.services.main;
const disabled: ServiceConfig = { ...main, typeRules: { trustReadFieldConstraints: false } };
const enabled: ServiceConfig = { ...main, typeRules: { trustReadFieldConstraints: true } };
const emptyObject: ServiceConfig = { ...main, typeRules: { trustReadFieldConstraints: {} } };
const nullableReferences: ServiceConfig = { ...main, typeRules: { trustReadFieldConstraints: { trustReferenceAvailability: false } } };
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
const wrongRequiredOption: ServiceConfig = {
  ...main,
  typeRules: {
    // @ts-expect-error narrowing accepts only a boolean or an options object
    trustReadFieldConstraints: 'true',
  },
};
const wrongWriteOption: ServiceConfig = {
  ...main,
  typeRules: {
    // @ts-expect-error write rules are enforced without an option
    write: { trustRequiredFields: false },
  },
};
const wrongReferenceOption: ServiceConfig = {
  ...main,
  typeRules: {
    trustReadFieldConstraints: {
      // @ts-expect-error reference availability must be explicitly boolean
      trustReferenceAvailability: 'true',
    },
  },
};
const parallelReferenceOption: ServiceConfig = {
  ...main,
  typeRules: {
    // @ts-expect-error references cannot be configured outside the enabled parent
    trustReadReferenceAvailability: true,
  },
};
const wrongNestedOption: ServiceConfig = {
  ...main,
  typeRules: {
    trustReadFieldConstraints: {
      // @ts-expect-error an object itself enables this rule; no enabled property exists
      enabled: true,
    },
  },
};
const oldRequiredOption: ServiceConfig = {
  ...main,
  typeRules: {
    // @ts-expect-error the unreleased old name has no compatibility alias
    trustRequiredReadFields: true,
  },
};
const unknownRule: ServiceConfig = {
  ...main,
  typeRules: {
    // @ts-expect-error unknown generation rules are rejected
    unknownRule: true,
  },
};
const nestedReadRule: ServiceConfig = {
  ...main,
  typeRules: {
    // @ts-expect-error read/write groups are not config options
    read: { trustRequiredFields: true },
  },
};
const oldFlatRule: ServiceConfig = {
  ...main,
  typeRules: {
    // @ts-expect-error the name must specify that only read types are narrowed
    trustRequiredFields: true,
  },
};
void [disabled, enabled, emptyObject, nullableReferences, parallelReferenceOption, wrongNestedOption];
void [wrongRequiredOption, wrongReferenceOption, oldRequiredOption, wrongWriteOption, unknownRule, nestedReadRule, oldFlatRule];
void [config, missingKey, wrongOutput, wrongOption, wrongEndpoints, incompleteExtension];
`,
    );
    const result = spawnSync(
      process.execPath,
      [
        compilerBinary(),
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--exactOptionalPropertyTypes',
        '--types',
        'node',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        usage,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, [result.stdout, result.stderr].join('\n'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
