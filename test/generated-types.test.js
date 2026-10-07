import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTypes } from '../dist/generate.js';
import { checkTypes, compilerBinary } from './helpers/type-compiler.mjs';

const tsc = compilerBinary();

test('generated types compile and model relation depth and object metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'microcms-typegen-types-'));
  try {
    const generated = generateTypes(
      [
        { endpoint: 'blogs', type: 'list' },
        { endpoint: 'categories', type: 'list' },
        { endpoint: 'settings', type: 'object' },
      ],
      new Map([
        [
          'blogs',
          {
            apiFields: [
              { fieldId: 'title', kind: 'text' },
              {
                fieldId: 'category',
                kind: 'relation',
                referencedApiEndpoint: 'categories',
              },
              {
                fieldId: 'blocks',
                kind: 'repeater',
                customFieldIds: ['text-block'],
              },
              { fieldId: 'coverImage', kind: 'media' },
              { fieldId: 'extension', kind: 'iframe' },
              { fieldId: 'views', kind: 'number' },
              { fieldId: 'active', kind: 'boolean' },
            ],
            customFields: [
              {
                fieldId: 'text-block',
                fields: [{ fieldId: 'body', kind: 'richEditorV2' }],
              },
            ],
          },
        ],
        [
          'categories',
          {
            apiFields: [{ fieldId: 'name', kind: 'text' }],
            customFields: [],
          },
        ],
        [
          'settings',
          {
            apiFields: [{ fieldId: 'siteName', kind: 'text' }],
            customFields: [],
          },
        ],
      ]),
      { serviceName: 'main' },
    );
    await writeFile(join(directory, 'generated.ts'), generated);
    await writeFile(
      join(directory, 'usage.ts'),
      `
import type { Blogs, BlogsCustomFieldTextBlock, Categories, Settings, MainServiceSchema } from './generated';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// @ts-expect-error the legacy service schema alias is not generated
import type { MicroCMSSchema } from './generated';
// @ts-expect-error custom field types include CustomField in their names
import type { BlogsTextBlock } from './generated';
type _CustomField = Assert<Equal<NonNullable<Blogs['blocks']>[number], BlogsCustomFieldTextBlock>>;
type CategoryAtDepth0 = NonNullable<MainServiceSchema['blogs']['depths'][0]['category']>;
type CategoryAtDepth1 = NonNullable<MainServiceSchema['blogs']['depths'][1]['category']>;
type _Depth0 = Assert<Equal<CategoryAtDepth0, { id: string }>>;
type _Depth1 = Assert<Equal<CategoryAtDepth1, MainServiceSchema['categories']['depths'][0]>>;
type _ObjectHasNoId = Assert<Equal<'id' extends keyof Settings ? true : false, false>>;
type _BlogSchema = Assert<Equal<MainServiceSchema['blogs']['content'], Blogs>>;
type _CategorySchema = Assert<Equal<MainServiceSchema['categories']['content'], Categories>>;
type _BlogDepth2 = Assert<Equal<NonNullable<MainServiceSchema['blogs']['depths'][2]['category']>['name'], string | null | undefined>>;
type _BlogPaths = Assert<Equal<'category.name' extends MainServiceSchema['blogs']['fieldPaths'] ? true : false, true>>;
type _SettingSchema = Assert<Equal<MainServiceSchema['settings']['content'], Settings>>;
type BlogCreate = MainServiceSchema['blogs']['create'];
type BlogUpdate = MainServiceSchema['blogs']['update'];
type _CreateRelation = Assert<Equal<BlogCreate['category'], string | undefined>>;
type _UpdateRelation = Assert<Equal<BlogUpdate['category'], string | Record<string, never> | undefined>>;
type _CreateMedia = Assert<Equal<BlogCreate['coverImage'], string | undefined>>;
type _UpdateNumber = Assert<Equal<BlogUpdate['views'], number | null | undefined>>;
type _UpdateBoolean = Assert<Equal<BlogUpdate['active'], boolean | null | undefined>>;
type _CreateExtension = Assert<Equal<BlogCreate['extension'], Record<string, unknown> | undefined>>;
type _CreateBlock = Assert<Equal<NonNullable<BlogCreate['blocks']>[number]['fieldId'], 'text-block'>>;
type _UpdateBlock = Assert<Equal<NonNullable<BlogUpdate['blocks']>[number]['fieldId'], 'text-block'>>;
type _ObjectUpdate = Assert<Equal<MainServiceSchema['settings']['update']['siteName'], string | undefined>>;
type _NoObjectCreate = Assert<Equal<'create' extends keyof MainServiceSchema['settings'] ? true : false, false>>;
type _NoCreateId = Assert<Equal<'id' extends keyof BlogCreate ? true : false, false>>;

const nestedField: MainServiceSchema['blogs']['fieldPaths'] = 'category.name';
void nestedField;
`,
    );
    const result = spawnSync(
      process.execPath,
      [
        tsc,
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        join(directory, 'generated.ts'),
        join(directory, 'usage.ts'),
      ],
      { encoding: 'utf8' },
    );
    assert.equal(
      result.status,
      0,
      [result.stdout, result.stderr, result.error?.message]
        .filter(Boolean)
        .join('\n'),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('extension data types derive reads and write inputs for top-level and custom fields', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-extension-types-'),
  );
  try {
    const generated = generateTypes(
      [{ endpoint: 'blog', type: 'list' }],
      new Map([
        [
          'blog',
          {
            apiFields: [
              { fieldId: 'extension', kind: 'iframe' },
              {
                fieldId: 'featuredPanel',
                kind: 'custom',
                customFieldId: 'panel',
              },
            ],
            customFields: [
              {
                fieldId: 'panel',
                fields: [{ fieldId: 'embed', kind: 'iframe' }],
              },
            ],
          },
        ],
      ]),
      {
        extensionFieldTypes: {
          blog: {
            extension: { from: './config', data: 'ReadExtension' },
            'panel.embed': { from: './config', data: 'ReadEmbed' },
          },
        },
      },
    );
    await writeFile(join(directory, 'generated.ts'), generated);
    await writeFile(
      join(directory, 'config.ts'),
      `
export type ReadExtension = { id: string };
export type ReadEmbed = { html: string };
export default { services: { main: { extensionFieldTypes: {} } } };
`,
    );
    await writeFile(
      join(directory, 'usage.ts'),
      `
import type { MainServiceSchema, Blog } from './generated';
import type { ReadExtension, ReadEmbed } from './config';
type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Entry = MainServiceSchema['blog'];
type _Blog = Assert<Equal<Blog['extension'], ReadExtension | undefined>>;
type _Content = Assert<Equal<Entry['content']['extension'], ReadExtension | undefined>>;
type _Depth0 = Assert<Equal<Entry['depths'][0]['extension'], ReadExtension | undefined>>;
type _Depth3 = Assert<Equal<Entry['depths'][3]['extension'], ReadExtension | undefined>>;
type ExtensionWrite = {
  id?: string; title?: string; description?: string; imageUrl?: string; updatedAt?: string;
  data?: ReadExtension;
};
type _Create = Assert<Equal<Entry['create']['extension'], ExtensionWrite | undefined>>;
type _Update = Assert<Equal<Entry['update']['extension'], ExtensionWrite | undefined>>;
type _NestedRead = Assert<Equal<NonNullable<Entry['content']['featuredPanel']>['embed'], ReadEmbed | undefined>>;
type _NestedWrite = Assert<Equal<NonNullable<Entry['create']['featuredPanel']>['embed'], {
  id?: string; title?: string; description?: string; imageUrl?: string; updatedAt?: string;
  data?: ReadEmbed;
} | undefined>>;
const valid: NonNullable<Entry['create']['extension']> = { title: 'Title', data: { id: '123' } };
// @ts-expect-error data follows the configured extension type
const invalidData: NonNullable<Entry['create']['extension']> = { data: { id: 123 } };
// @ts-expect-error metadata keys are checked
const invalidMetadata: NonNullable<Entry['create']['extension']> = { title: 123 };
void [valid, invalidData, invalidMetadata];
`,
    );
    const result = spawnSync(
      process.execPath,
      [
        tsc,
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        join(directory, 'generated.ts'),
        join(directory, 'usage.ts'),
      ],
      { encoding: 'utf8' },
    );
    assert.equal(
      result.status,
      0,
      [result.stdout, result.stderr, result.error?.message]
        .filter(Boolean)
        .join('\n'),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('escaped property names and select values produce compilable TypeScript', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'microcms-typegen-escaping-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = generateTypes(
    [{ endpoint: '123-blog', type: 'list' }],
    new Map([
      [
        '123-blog',
        {
          customFields: [],
          apiFields: [
            { fieldId: 'quote"field', kind: 'text' },
            {
              fieldId: 'select-values',
              kind: 'select',
              selectItems: [
                { value: 'A"B' },
                { value: 'line\nbreak' },
                { value: 'A"B' },
              ],
            },
          ],
        },
      ],
    ]),
  );
  const generated = join(directory, 'types.ts');
  await writeFile(generated, output);
  const consumer = join(directory, 'consumer.ts');
  await writeFile(
    consumer,
    `import type { _123Blog } from './types';\nconst item: _123Blog = { id: 'id', createdAt: '', updatedAt: '', 'quote"field': null, 'select-values': ['A"B', 'line\\nbreak'] };\n// @ts-expect-error Undeclared select value\nconst invalid: _123Blog['select-values'] = ['Other'];\n`,
  );
  checkTypes([generated, consumer], ['--exactOptionalPropertyTypes']);
});
