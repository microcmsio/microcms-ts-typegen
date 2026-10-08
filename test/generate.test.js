import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { run } from '../dist/cli.js';
import { collectSchemas, generateTypes } from '../dist/generate.js';
import { createManagementClient } from '../dist/management.js';

const configSource = (config) => `export default ${JSON.stringify(config)};\n`;

async function configArgs(folder, output, options = {}) {
  const configPath = join(folder, 'config.ts');
  await writeFile(
    configPath,
    configSource({
      services: {
        main: {
          serviceDomain: 'sample',
          apiKey: 'secret-key',
          output,
          ...options,
        },
      },
    }),
  );
  return ['--config', configPath];
}

const apis = [
  { endpoint: 'blogs', type: 'list' },
  { endpoint: 'categories', type: 'list' },
];
const schemas = {
  blogs: {
    apiFields: [
      { fieldId: 'title', kind: 'text' },
      {
        fieldId: 'tags',
        kind: 'select',
        selectItems: [{ value: 'News' }, { value: 'Guide' }],
      },
      {
        fieldId: 'category',
        kind: 'relation',
        referencedApiEndpoint: 'categories',
      },
      { fieldId: 'hero-image', kind: 'media' },
      {
        fieldId: 'blocks',
        kind: 'repeater',
        customFieldIds: ['text-block', 'image-block'],
      },
    ],
    customFields: [
      {
        fieldId: 'text-block',
        fields: [{ fieldId: 'body', kind: 'richEditorV2' }],
      },
      { fieldId: 'image-block', fields: [{ fieldId: 'image', kind: 'media' }] },
    ],
  },
  categories: {
    apiFields: [{ fieldId: 'name', kind: 'text' }],
    customFields: [],
  },
};

test('CLI help shows value formats and usable examples', () => {
  const help = execFileSync(process.execPath, ['dist/cli.js', '--help'], {
    encoding: 'utf8',
  });
  assert.match(help, /<init\|generate\|check>/);
  assert.doesNotMatch(help, /--service-domain|--api-key|--output|--endpoints/);
  assert.match(help, /--config <file.ts>/);
  assert.match(help, /--service <config-name>.*corporate/);
});

test('check detects missing and stale generated files without writing', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'microcms-typegen-check-test-'));
  const output = join(folder, 'types.ts');
  let fieldId = 'title';
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'blogs', type: 'list' }] }
        : { apiFields: [{ fieldId, kind: 'text' }], customFields: [] },
  });
  const options = await configArgs(folder, output);
  const dependencies = { fetchImpl, requestIntervalMs: 0 };

  await assert.rejects(
    run(['check', ...options], dependencies),
    /Generated types are out of date/,
  );
  await assert.rejects(stat(output), { code: 'ENOENT' });
  await assert.rejects(
    run(['check', ...options, '--force'], dependencies),
    /--force can only be used with generate/,
  );

  await run(['generate', ...options], dependencies);
  const original = await readFile(output, 'utf8');
  const before = await stat(output);
  await run(['check', ...options], dependencies);
  assert.equal((await stat(output)).mtimeMs, before.mtimeMs);

  fieldId = 'body';
  await assert.rejects(
    run(['check', ...options], dependencies),
    /Generated types are out of date/,
  );
  assert.equal(await readFile(output, 'utf8'), original);
});

test('check compares every configured service without writing files', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-check-multi-test-'),
  );
  const configPath = join(folder, 'config.ts');
  const first = join(folder, 'first.ts');
  const second = join(folder, 'second.ts');
  await writeFile(
    configPath,
    configSource({
      services: {
        first: { serviceDomain: 'first', apiKey: 'first-key', output: first },
        second: {
          serviceDomain: 'second',
          apiKey: 'second-key',
          output: second,
        },
      },
    }),
  );
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'blogs', type: 'list' }] }
        : { apiFields: [{ fieldId: 'title', kind: 'text' }], customFields: [] },
  });
  const dependencies = { fetchImpl, requestIntervalMs: 0 };
  await run(['generate', '--config', configPath], dependencies);
  const original = await readFile(first, 'utf8');
  await writeFile(second, '// stale\n');

  await assert.rejects(
    run(['check', '--config', configPath], dependencies),
    /Generated types are out of date/,
  );
  assert.equal(await readFile(first, 'utf8'), original);
  assert.equal(await readFile(second, 'utf8'), '// stale\n');
});

test('generate and check accept CRLF and mixed line endings without rewriting unchanged types', async (t) => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-line-endings-'),
  );
  t.after(() => rm(folder, { recursive: true, force: true }));
  const output = join(folder, 'types.ts');
  const options = await configArgs(folder, output);
  let fieldId = 'title';
  const dependencies = {
    requestIntervalMs: 0,
    fetchImpl: async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith('/apis')
          ? { apis: [{ endpoint: 'blogs', type: 'list' }] }
          : { apiFields: [{ fieldId, kind: 'text' }], customFields: [] },
    }),
  };
  await run(['generate', ...options], dependencies);
  const original = await readFile(output, 'utf8');
  let line = 0;
  for (const existing of [
    original.replace(/\n/g, '\r\n'),
    original.replace(/\n/g, () => (line++ % 2 === 0 ? '\r\n' : '\n')),
  ]) {
    fieldId = 'title';
    await writeFile(output, existing);
    const before = await stat(output);
    for (const command of ['check', 'generate']) {
      await run([command, ...options], dependencies);
      assert.equal(await readFile(output, 'utf8'), existing);
      assert.equal((await stat(output)).mtimeMs, before.mtimeMs);
    }
    fieldId = 'body';
    await assert.rejects(
      run(['check', ...options], dependencies),
      /Generated types are out of date/,
    );
    assert.equal(await readFile(output, 'utf8'), existing);
    await run(['generate', ...options], dependencies);
    const updated = await readFile(output, 'utf8');
    assert.notEqual(updated, original);
    assert.match(updated, /body\?: string/);
    assert.equal(updated.includes('\r\n'), false);
    await run(['check', ...options], dependencies);
  }
});

test('line ending handling keeps handwritten files and header lookalikes protected', async (t) => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-header-protection-'),
  );
  t.after(() => rm(folder, { recursive: true, force: true }));
  const output = join(folder, 'types.ts');
  const options = await configArgs(folder, output);
  const dependencies = {
    requestIntervalMs: 0,
    fetchImpl: async () => ({ ok: true, json: async () => ({ apis: [] }) }),
  };
  const header =
    '// This file is generated by microcms-typegen. Do not edit by hand.';
  for (const existing of [
    '// handwritten types\r\nexport type Blog = string;\r\n',
    `${header} extra text\r\n`,
    `${header}\r`,
  ]) {
    await writeFile(output, existing);
    await assert.rejects(
      run(['generate', ...options], dependencies),
      /Refusing to overwrite/,
    );
    assert.equal(await readFile(output, 'utf8'), existing);
  }
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

test('resolves relation targets and generates null, optional, union, and nested types', async () => {
  const client = {
    listApis: async () => apis,
    getSchema: async (endpoint) => schemas[endpoint],
  };
  const output = await collectSchemas(client, ['blogs']);
  assert.match(
    output,
    /type __MicroCMSTypegenReadOptions = \{ depth\?: __MicroCMSTypegenDepth \};/,
  );
  assert.match(output, /export type Blogs = __MicroCMSTypegenBlogsRead<\{\}>;/);
  assert.match(
    output,
    /export type Categories = __MicroCMSTypegenCategoriesRead<\{\}>;/,
  );
  assert.match(
    output,
    /"blogs": \{ kind: "list"; content: Blogs; depths: \{ 0: __MicroCMSTypegenBlogsRead<\{ depth: 0 \}>; 1: __MicroCMSTypegenBlogsRead<\{ depth: 1 \}>; 2: __MicroCMSTypegenBlogsRead<\{ depth: 2 \}>; 3: __MicroCMSTypegenBlogsRead<\{ depth: 3 \}> \}; fieldPaths: /,
  );
  assert.match(output, /title\?: string \| null;/);
  assert.match(output, /tags: \("News" \| "Guide"\)\[\];/);
  assert.match(
    output,
    /category: \(__MicroCMSTypegenResolveDepth<Options> extends 0 \? \{ id: string \} : __MicroCMSTypegenCategoriesRead<__MicroCMSTypegenReferenceOptions<Options>>\) \| null;/,
  );
  assert.match(output, /"hero-image"\?: MicroCMSImage;/);
  assert.match(
    output,
    /blocks: \(__MicroCMSTypegenBlogsCustomFieldTextBlockRead<Options> \| __MicroCMSTypegenBlogsCustomFieldImageBlockRead<Options>\)\[\] \| null;/,
  );
  assert.match(output, /fieldId: "text-block";/);
  assert.match(output, /body\?: string \| null;/);
  assert.match(
    output,
    /type __MicroCMSTypegenBlogsCreate = \{\n {2}publishedAt\?: string;/,
  );
  assert.match(output, /category\?: string;/);
  assert.match(output, /"hero-image"\?: string;/);
  assert.match(
    output,
    /blocks\?: \(__MicroCMSTypegenBlogsCustomFieldTextBlockCreate \| __MicroCMSTypegenBlogsCustomFieldImageBlockCreate\)\[\];/,
  );
  assert.match(output, /type __MicroCMSTypegenBlogsUpdate = \{/);
  assert.match(output, /category\?: string \| Record<string, never>;/);
  assert.match(
    output,
    /create: __MicroCMSTypegenExpand<__MicroCMSTypegenBlogsCreate>; update: __MicroCMSTypegenExpand<__MicroCMSTypegenBlogsUpdate>/,
  );
  const blogPaths = output.match(/"blogs": \{[^\n]+fieldPaths: ([^;]+);/)?.[1];
  assert.ok(blogPaths);
  for (const path of [
    'title',
    'category',
    'category.name',
    'category.id',
    'hero-image',
    'blocks',
    'createdAt',
  ]) {
    assert.ok(
      blogPaths.includes(JSON.stringify(path)),
      `missing field path ${path}`,
    );
  }
  for (const invalid of ['blocks.body', 'hero-image.url']) {
    assert.equal(
      blogPaths.includes(JSON.stringify(invalid)),
      false,
      `unexpected field path ${invalid}`,
    );
  }
  assert.doesNotMatch(output, /export type BlogsFieldPath/);
});

test('rejects unknown fields instead of producing an inaccurate type', () => {
  const invalid = new Map([
    [
      'blogs',
      { apiFields: [{ fieldId: 'x', kind: 'futureKind' }], customFields: [] },
    ],
  ]);
  assert.throws(
    () => generateTypes([apis[0]], invalid),
    /Unsupported field kind/,
  );
});

test('rejects missing or malformed select and repeater definitions', () => {
  const generateField = (field) =>
    generateTypes(
      [{ endpoint: 'news', type: 'list' }],
      new Map([['news', { apiFields: [field], customFields: [] }]]),
    );
  for (const selectItems of [
    undefined,
    null,
    'invalid',
    [{}],
    [{ value: 123 }],
  ]) {
    assert.throws(
      () => generateField({ fieldId: 'category', kind: 'select', selectItems }),
      /Invalid selectItems in news.category/,
    );
  }
  for (const customFieldIds of [undefined, null, 'invalid', [null], ['']]) {
    assert.throws(
      () =>
        generateField({ fieldId: 'blocks', kind: 'repeater', customFieldIds }),
      /Invalid customFieldIds in news.blocks/,
    );
  }
  const output = generateField({
    fieldId: 'category',
    kind: 'select',
    selectItems: [],
  });
  assert.match(output, /category: \(never\)\[\];/);
  assert.match(output, /category\?: \(never\)\[\];/);
  assert.doesNotMatch(output, /type __MicroCMSTypegenExtensionFieldWrite/);
  assert.match(
    generateField({ fieldId: 'blocks', kind: 'repeater', customFieldIds: [] }),
    /blocks: \(never\)\[\] \| null;/,
  );
});

test('object APIs have timestamps but no content ID', () => {
  const output = generateTypes(
    [{ endpoint: 'banner', type: 'object' }],
    new Map([
      [
        'banner',
        { apiFields: [{ fieldId: 'label', kind: 'text' }], customFields: [] },
      ],
    ]),
  );
  assert.match(
    output,
    /type __MicroCMSTypegenBannerRead<Options extends __MicroCMSTypegenReadOptions = \{\}> = \{\n {2}createdAt: string;/,
  );
  assert.doesNotMatch(output, / {2}id: string;/);
  assert.match(output, /"banner": \{[^\n]+fieldPaths: "createdAt"/);
  assert.doesNotMatch(output, /"banner": \{[^\n]+fieldPaths: [^;]*"id"/);
  assert.match(
    output,
    /"banner": \{[^\n]+update: __MicroCMSTypegenExpand<__MicroCMSTypegenBannerUpdate>/,
  );
  assert.doesNotMatch(output, /"banner": \{[^\n]+create: /);
});

test('rejects a service schema collision instead of renaming it', () => {
  assert.throws(
    () =>
      generateTypes(
        [{ endpoint: 'main-service-schema', type: 'list' }],
        new Map([['main-service-schema', { apiFields: [], customFields: [] }]]),
      ),
    /Type name collision: "MainServiceSchema".*endpoint "main-service-schema".*service schema "main"/,
  );
});

test('keeps built-in image and file names reserved', () => {
  for (const endpoint of ['microCMSImage', 'microCMSFile']) {
    assert.throws(
      () =>
        generateTypes(
          [{ endpoint, type: 'list' }],
          new Map([[endpoint, { apiFields: [], customFields: [] }]]),
        ),
      /Type name collision: "MicroCMS(Image|File)".*built-in.*endpoint/,
    );
  }
});

test('CustomField distinguishes a custom type from an endpoint with the old combined name', () => {
  const output = generateTypes(
    [
      { endpoint: 'news', type: 'list' },
      { endpoint: 'news_category', type: 'list' },
    ],
    new Map([
      [
        'news',
        {
          apiFields: [
            { fieldId: 'category', kind: 'custom', customFieldId: 'category' },
          ],
          customFields: [
            {
              fieldId: 'category',
              fields: [{ fieldId: 'name', kind: 'text' }],
            },
          ],
        },
      ],
      ['news_category', { apiFields: [], customFields: [] }],
    ]),
  );
  assert.match(
    output,
    /export type NewsCategory = __MicroCMSTypegenNewsCategoryRead<\{\}>;/,
  );
  assert.match(
    output,
    /export type NewsCustomFieldCategory = __MicroCMSTypegenNewsCustomFieldCategoryRead<\{\}>;/,
  );
  assert.match(
    output,
    /category: __MicroCMSTypegenNewsCustomFieldCategoryRead<Options> \| null;/,
  );
  assert.match(output, /type __MicroCMSTypegenNewsCustomFieldCategoryCreate =/);
  assert.match(output, /type __MicroCMSTypegenNewsCustomFieldCategoryUpdate =/);
});

test('rejects endpoint and custom field collisions even with the CustomField prefix', () => {
  assert.throws(
    () =>
      generateTypes(
        [
          { endpoint: 'news', type: 'list' },
          { endpoint: 'news_custom_field_category', type: 'list' },
        ],
        new Map([
          [
            'news',
            {
              apiFields: [],
              customFields: [{ fieldId: 'category', fields: [] }],
            },
          ],
          ['news_custom_field_category', { apiFields: [], customFields: [] }],
        ]),
      ),
    /Type name collision: "NewsCustomFieldCategory".*endpoint "news_custom_field_category".*custom field "news.category"/,
  );
});

test('rejects public names that become identical after PascalCase conversion', () => {
  assert.throws(
    () =>
      generateTypes(
        [
          { endpoint: 'news-category', type: 'list' },
          { endpoint: 'news_category', type: 'list' },
        ],
        new Map(),
      ),
    /Type name collision: "NewsCategory".*news-category.*news_category/,
  );
  assert.throws(
    () =>
      generateTypes(
        [{ endpoint: 'news', type: 'list' }],
        new Map([
          [
            'news',
            {
              apiFields: [],
              customFields: [
                { fieldId: 'category-name', fields: [] },
                { fieldId: 'category_name', fields: [] },
              ],
            },
          ],
        ]),
      ),
    /Type name collision: "NewsCustomFieldCategoryName".*news.category-name.*news.category_name/,
  );
});

test('rejects named service collisions with endpoint and custom types', () => {
  assert.throws(
    () =>
      generateTypes(
        [{ endpoint: 'blog-service-schema', type: 'list' }],
        new Map([['blog-service-schema', { apiFields: [], customFields: [] }]]),
        { serviceName: 'blog' },
      ),
    /Type name collision: "BlogServiceSchema".*service schema "blog"/,
  );
  assert.throws(
    () =>
      generateTypes(
        [{ endpoint: 'news', type: 'list' }],
        new Map([
          [
            'news',
            {
              apiFields: [],
              customFields: [{ fieldId: 'serviceSchema', fields: [] }],
            },
          ],
        ]),
        { serviceName: 'newsCustomField' },
      ),
    /Type name collision: "NewsCustomFieldServiceSchema".*custom field.*service schema/,
  );
});

test('field paths follow nested relations and stop after three levels', () => {
  const output = generateTypes(
    [
      { endpoint: 'a', type: 'list' },
      { endpoint: 'b', type: 'list' },
    ],
    new Map([
      [
        'a',
        {
          apiFields: [
            { fieldId: 'b', kind: 'relation', referencedApiEndpoint: 'b' },
          ],
          customFields: [],
        },
      ],
      [
        'b',
        {
          apiFields: [
            { fieldId: 'title', kind: 'text' },
            { fieldId: 'a', kind: 'relation', referencedApiEndpoint: 'a' },
          ],
          customFields: [],
        },
      ],
    ]),
  );
  const paths = output.match(/"a": \{[^\n]+fieldPaths: ([^;]+);/)?.[1];
  assert.ok(paths?.includes('"b.a.b.title"'));
  assert.ok(paths.includes('"b.a.b.a.id"'));
  assert.equal(paths.includes('"b.a.b.a.title"'), false);
});

test('schema fields that share names with content metadata are emitted once', () => {
  const output = generateTypes(
    [{ endpoint: 'blog', type: 'list' }],
    new Map([
      [
        'blog',
        {
          apiFields: [
            { fieldId: 'publishedAt', kind: 'date' },
            { fieldId: 'title', kind: 'text' },
          ],
          customFields: [],
        },
      ],
    ]),
  );
  assert.equal((output.match(/ {2}publishedAt\?: string;/g) ?? []).length, 3);
  assert.doesNotMatch(
    output,
    /type __MicroCMSTypegenBlogCreate = \{[^}]* {2}id\??:/,
  );
  assert.match(output, / {2}title\?: string \| null;/);
});

test('empty-value types cover every documented field kind', () => {
  const fields = [
    'text',
    'textArea',
    'richEditorV2',
    'richEditor',
    'media',
    'mediaList',
    'date',
    'boolean',
    'select',
    'relation',
    'relationList',
    'number',
    'custom',
    'repeater',
    'file',
    'iframe',
  ].map((kind) => ({
    fieldId: kind,
    kind,
    ...(kind === 'select' ? { selectItems: [{ value: 'A' }] } : {}),
    ...(kind === 'relation' || kind === 'relationList'
      ? { referencedApiEndpoint: 'related' }
      : {}),
    ...(kind === 'custom' ? { customFieldId: 'part' } : {}),
    ...(kind === 'repeater' ? { customFieldIds: ['part'] } : {}),
  }));
  const output = generateTypes(
    [
      { endpoint: 'source', type: 'list' },
      { endpoint: 'related', type: 'list' },
    ],
    new Map([
      [
        'source',
        {
          apiFields: fields,
          customFields: [
            {
              fieldId: 'part',
              fields: [
                { fieldId: 'text', kind: 'text' },
                { fieldId: 'boolean', kind: 'boolean' },
                {
                  fieldId: 'select',
                  kind: 'select',
                  selectItems: [{ value: 'A' }],
                },
              ],
            },
          ],
        },
      ],
      ['related', { apiFields: [], customFields: [] }],
    ]),
  );
  for (const declaration of [
    'text?: string | null;',
    'textArea?: string | null;',
    'richEditorV2?: string | null;',
    'richEditor?: string;',
    'media?: MicroCMSImage;',
    'mediaList: MicroCMSImage[];',
    'date?: string;',
    'boolean: boolean;',
    'select: ("A")[];',
    'relation: (__MicroCMSTypegenResolveDepth<Options> extends 0 ? { id: string } : __MicroCMSTypegenRelatedRead<__MicroCMSTypegenReferenceOptions<Options>>) | null;',
    'relationList: (__MicroCMSTypegenResolveDepth<Options> extends 0 ? { id: string } : __MicroCMSTypegenRelatedRead<__MicroCMSTypegenReferenceOptions<Options>>)[];',
    'number?: number | null;',
    'custom: __MicroCMSTypegenSourceCustomFieldPartRead<Options> | null;',
    'repeater: (__MicroCMSTypegenSourceCustomFieldPartRead<Options>)[] | null;',
    'file?: MicroCMSFile;',
    'iframe?: unknown;',
    'fieldId: "part";',
    'boolean?: boolean;',
    'select?: ("A")[];',
  ]) {
    assert.ok(output.includes(`  ${declaration}`), `missing ${declaration}`);
  }
  for (const declaration of [
    'media?: string;',
    'mediaList?: string[];',
    'relation?: string | Record<string, never>;',
    'relationList?: string[];',
    'number?: number | null;',
    'boolean?: boolean | null;',
    'custom?: __MicroCMSTypegenSourceCustomFieldPartUpdate | Record<string, never>;',
    'repeater?: (__MicroCMSTypegenSourceCustomFieldPartUpdate)[];',
    'file?: string;',
    'iframe?: Record<string, unknown>;',
  ]) {
    assert.ok(
      output.includes(`  ${declaration}`),
      `missing write field ${declaration}`,
    );
  }
});

test('imports extension data types for reads and derives write types, including custom fields', () => {
  const apiList = [{ endpoint: 'blog', type: 'list' }];
  const schemaMap = new Map([
    [
      'blog',
      {
        apiFields: [
          { fieldId: 'extension', kind: 'iframe' },
          { fieldId: 'panel', kind: 'custom', customFieldId: 'panel' },
        ],
        customFields: [
          { fieldId: 'panel', fields: [{ fieldId: 'embed', kind: 'iframe' }] },
        ],
      },
    ],
  ]);
  const output = generateTypes(apiList, schemaMap, {
    extensionFieldTypes: {
      blog: {
        extension: { from: './extension-types', data: 'ExtensionData' },
        'panel.embed': { from: './extension-types', data: 'EmbedData' },
      },
    },
  });
  assert.match(
    output,
    /import type \{ ExtensionData as __MicroCMSTypegenBlogExtensionData \} from "\.\/extension-types";/,
  );
  assert.match(
    output,
    /import type \{ EmbedData as __MicroCMSTypegenBlogPanelEmbedData \} from "\.\/extension-types";/,
  );
  assert.match(output, /extension\?: __MicroCMSTypegenBlogExtensionData;/);
  assert.match(
    output,
    /extension\?: __MicroCMSTypegenExtensionFieldWrite<__MicroCMSTypegenBlogExtensionData>;/,
  );
  assert.match(output, /embed\?: __MicroCMSTypegenBlogPanelEmbedData;/);
  assert.match(
    output,
    /embed\?: __MicroCMSTypegenExtensionFieldWrite<__MicroCMSTypegenBlogPanelEmbedData>;/,
  );
  assert.equal(
    generateTypes(apiList, schemaMap),
    generateTypes(apiList, schemaMap, { extensionFieldTypes: {} }),
  );
  assert.throws(
    () =>
      generateTypes(apiList, schemaMap, {
        extensionFieldTypes: { missing: {} },
      }),
    /Unknown extensionFieldTypes endpoint missing/,
  );
  assert.throws(
    () =>
      generateTypes(apiList, schemaMap, {
        extensionFieldTypes: { blog: { panel: { from: './x', data: 'T' } } },
      }),
    /must name an extension field/,
  );
  assert.throws(
    () =>
      generateTypes(apiList, schemaMap, {
        extensionFieldTypes: {
          blog: { extension: { from: './x', data: 'A.B' } },
        },
      }),
    /Invalid TypeScript type name/,
  );
  assert.throws(
    () =>
      generateTypes(apiList, schemaMap, {
        extensionFieldTypes: { blog: { extension: { from: './x' } } },
      }),
    /needs nonempty from and data strings/,
  );
  assert.throws(
    () =>
      generateTypes(apiList, schemaMap, {
        extensionFieldTypes: { blog: { extension: { data: 'T' } } },
      }),
    /needs nonempty from and data strings/,
  );
  assert.throws(
    () =>
      generateTypes(apiList, schemaMap, {
        extensionFieldTypes: { blog: { extension: { from: './x', data: '' } } },
      }),
    /needs nonempty from and data strings/,
  );
  assert.throws(
    () =>
      generateTypes(apiList, schemaMap, {
        extensionFieldTypes: {
          blog: { extension: { from: './x', data: 'T', read: 'T' } },
        },
      }),
    /Unknown extensionFieldTypes.*option read/,
  );
  assert.throws(
    () =>
      generateTypes(apiList, schemaMap, {
        extensionFieldTypes: {
          blog: { extension: { from: './x', data: 'T', write: 'T' } },
        },
      }),
    /Unknown extensionFieldTypes.*option write/,
  );
});

test('unconfigured and nonexistent relation targets fail with field context', async () => {
  for (const target of [null, 'missing']) {
    const client = {
      listApis: async () => [{ endpoint: 'draft', type: 'list' }],
      getSchema: async () => ({
        apiFields: [
          {
            fieldId: 'related',
            kind: 'relation',
            referencedApiEndpoint: target,
          },
        ],
        customFields: [],
      }),
    };
    await assert.rejects(
      collectSchemas(client),
      (error) =>
        /Relation target .* in draft\.related was not found/.test(
          error.message,
        ) &&
        error.message.includes('management screen') &&
        error.message.includes('config endpoints array'),
    );
  }
});

test('CLI protects an existing non-generated file and --force replaces it', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'microcms-typegen-force-test-'));
  const output = join(folder, 'types.ts');
  await writeFile(output, '// handwritten types\nexport type Blog = string;\n');
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'blog', type: 'list' }] }
        : { apiFields: [], customFields: [] },
  });
  const args = ['generate', ...(await configArgs(folder, output))];
  await assert.rejects(
    run([...args], { fetchImpl, requestIntervalMs: 0 }),
    /Refusing to overwrite .*--force/,
  );
  assert.equal(
    await readFile(output, 'utf8'),
    '// handwritten types\nexport type Blog = string;\n',
  );
  await run([...args, '--force'], { fetchImpl, requestIntervalMs: 0 });
  assert.match(
    await readFile(output, 'utf8'),
    /^\/\/ This file is generated by microcms-typegen/,
  );
  await run([...args], { fetchImpl, requestIntervalMs: 0 });
});

test('multi-service output protection checks all files before writing any', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-force-multi-test-'),
  );
  const configPath = join(folder, 'config.ts');
  const first = join(folder, 'first.ts');
  const second = join(folder, 'second.ts');
  await writeFile(second, '// handwritten\n');
  await writeFile(
    configPath,
    configSource({
      services: {
        first: { serviceDomain: 'first', apiKey: 'key', output: first },
        second: { serviceDomain: 'second', apiKey: 'key', output: second },
      },
    }),
  );
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'blog', type: 'list' }] }
        : { apiFields: [], customFields: [] },
  });
  await assert.rejects(
    run(['generate', '--config', configPath], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /Refusing to overwrite/,
  );
  await assert.rejects(stat(first), { code: 'ENOENT' });
  assert.equal(await readFile(second, 'utf8'), '// handwritten\n');
});

test('CLI does not overwrite an existing output when a relation target is missing', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'microcms-typegen-error-test-'));
  const output = join(folder, 'types.ts');
  const original = '// existing generated types\n';
  await writeFile(output, original);
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'draft', type: 'list' }] }
        : {
            apiFields: [
              {
                fieldId: 'related',
                kind: 'relation',
                referencedApiEndpoint: null,
              },
            ],
            customFields: [],
          },
  });
  await assert.rejects(
    run(['generate', ...(await configArgs(folder, output))], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /Relation target null in draft\.related was not found/,
  );
  assert.equal(await readFile(output, 'utf8'), original);
});

test('CLI fetches schemas, keeps API key out of output, and leaves identical files untouched', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'microcms-typegen-test-'));
  const output = join(folder, 'types.ts');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const body = url.endsWith('/apis')
      ? { apis }
      : schemas[url.split('/').at(-1)];
    return { ok: true, json: async () => body };
  };
  const args = [
    'generate',
    ...(await configArgs(folder, output, {
      serviceDomain: 'sample-service',
      endpoints: ['blogs'],
    })),
  ];
  await run([...args], { fetchImpl, requestIntervalMs: 0 });
  const first = await readFile(output, 'utf8');
  const firstStat = await stat(output);
  await run([...args], { fetchImpl, requestIntervalMs: 0 });
  const secondStat = await stat(output);
  assert.equal(firstStat.mtimeMs, secondStat.mtimeMs);
  assert.equal(first.includes('secret-key'), false);
  assert.equal(calls.length, 6);
  assert.ok(
    calls.every(
      ({ options }) => options.headers['X-MICROCMS-API-KEY'] === 'secret-key',
    ),
  );
  assert.ok(
    calls.every(({ url }) =>
      url.startsWith('https://sample-service.microcms-management.io/api/v1/'),
    ),
  );
});

test('services config with one service generates one output', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-single-config-test-'),
  );
  const configPath = join(folder, 'config.ts');
  const output = join(folder, 'types.ts');
  await writeFile(
    configPath,
    configSource({
      services: {
        main: {
          serviceDomain: 'single-service',
          apiKey: 'single-key',
          output,
          endpoints: ['news'],
        },
      },
    }),
  );
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'news', type: 'list' }] }
        : { apiFields: [{ fieldId: 'title', kind: 'text' }], customFields: [] },
  });
  await run(['generate', '--config', configPath], {
    fetchImpl,
    requestIntervalMs: 0,
  });
  const generated = await readFile(output, 'utf8');
  assert.match(
    generated,
    /export type News = __MicroCMSTypegenNewsRead<\{\}>;/,
  );
  assert.match(generated, /export type MainServiceSchema = \{/);
  assert.doesNotMatch(generated, /export type MicroCMSSchema/);
  await assert.rejects(
    run(['generate', '--config', configPath, '--service', 'missing'], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /Unknown service/,
  );

  await writeFile(
    configPath,
    configSource({
      services: {
        main: {
          serviceDomain: 'single-service',
          apiKey: 'single-key',
          output,
          endpoints: { news: { typeName: 'CustomNews' } },
        },
      },
    }),
  );
  await assert.rejects(
    run(['generate', '--config', configPath], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /endpoints must be a nonempty array/,
  );
});

test('service config passes extension field types to generate and check', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-extension-config-test-'),
  );
  const configPath = join(folder, 'config.ts');
  const output = join(folder, 'types.ts');
  await writeFile(
    configPath,
    configSource({
      services: {
        main: {
          serviceDomain: 'sample',
          apiKey: 'key',
          output,
          endpoints: ['blog'],
          extensionFieldTypes: {
            blog: {
              extension: { from: './extension-types', data: 'BlogExtension' },
            },
          },
        },
      },
    }),
  );
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'blog', type: 'list' }] }
        : {
            apiFields: [{ fieldId: 'extension', kind: 'iframe' }],
            customFields: [],
          },
  });
  const dependencies = { fetchImpl, requestIntervalMs: 0 };
  await run(['generate', '--config', configPath], dependencies);
  const generated = await readFile(output, 'utf8');
  assert.match(
    generated,
    /import type \{ BlogExtension as __MicroCMSTypegenBlogExtensionData \}/,
  );
  assert.match(generated, /extension\?: __MicroCMSTypegenBlogExtensionData;/);
  assert.match(
    generated,
    /extension\?: __MicroCMSTypegenExtensionFieldWrite<__MicroCMSTypegenBlogExtensionData>;/,
  );
  await run(['check', '--config', configPath], dependencies);
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

test('multi-service config generates separate modules with independent names and keys', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'microcms-typegen-multi-test-'));
  const configPath = join(folder, 'config.ts');
  const corporateOutput = join(folder, 'corporate.ts');
  const blogOutput = join(folder, 'blog.ts');
  await writeFile(
    configPath,
    configSource({
      services: {
        corporate: {
          serviceDomain: 'corporate',
          apiKey: 'corporate-key',
          output: corporateOutput,
          endpoints: ['news'],
        },
        blog: {
          serviceDomain: 'blog',
          apiKey: 'blog-key',
          output: blogOutput,
          endpoints: ['posts'],
        },
      },
    }),
  );
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, key: options.headers['X-MICROCMS-API-KEY'] });
    const corporate = url.includes('corporate.microcms-management.io');
    return {
      ok: true,
      json: async () =>
        url.endsWith('/apis')
          ? { apis: [{ endpoint: corporate ? 'news' : 'posts', type: 'list' }] }
          : {
              apiFields: [
                {
                  fieldId: corporate ? 'corporateTitle' : 'blogTitle',
                  kind: 'text',
                },
              ],
              customFields: [],
            },
    };
  };
  await run(['generate', '--config', configPath], {
    fetchImpl,
    requestIntervalMs: 0,
  });
  const corporateTypes = await readFile(corporateOutput, 'utf8');
  const blogTypes = await readFile(blogOutput, 'utf8');
  assert.match(
    corporateTypes,
    /export type News = __MicroCMSTypegenNewsRead<\{\}>;/,
  );
  assert.match(
    blogTypes,
    /export type Posts = __MicroCMSTypegenPostsRead<\{\}>;/,
  );
  assert.match(corporateTypes, /export type CorporateServiceSchema = \{/);
  assert.match(blogTypes, /export type BlogServiceSchema = \{/);
  assert.match(corporateTypes, /corporateTitle\?: string \| null;/);
  assert.match(blogTypes, /blogTitle\?: string \| null;/);
  assert.doesNotMatch(corporateTypes, /blogTitle/);
  assert.doesNotMatch(blogTypes, /corporateTitle/);
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every(({ url, key }) =>
      url.includes('corporate.microcms-management.io')
        ? key === 'corporate-key'
        : key === 'blog-key',
    ),
  );
  assert.ok(
    !corporateTypes.includes('corporate-key') &&
      !blogTypes.includes('blog-key'),
  );

  calls.length = 0;
  await run(['generate', '--config', configPath, '--service', 'blog'], {
    fetchImpl,
    requestIntervalMs: 0,
  });
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(({ url }) => url.includes('blog.microcms-management.io')),
  );
});

test('multi-service generation leaves files untouched when a later service fails', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-multi-error-test-'),
  );
  const output = join(folder, 'corporate.ts');
  const sharedOutput = join(folder, 'blog.ts');
  const configPath = join(folder, 'config.ts');
  await writeFile(output, '// previous output\n');
  await writeFile(
    configPath,
    configSource({
      services: {
        corporate: {
          serviceDomain: 'corporate',
          apiKey: 'corporate-key',
          output,
        },
        blog: {
          serviceDomain: 'blog',
          apiKey: 'blog-key',
          output: sharedOutput,
        },
      },
    }),
  );
  const fetchImpl = async (url) =>
    url.includes('blog.microcms-management.io')
      ? { ok: false, status: 403 }
      : {
          ok: true,
          json: async () =>
            url.endsWith('/apis')
              ? { apis: [{ endpoint: 'news', type: 'list' }] }
              : {
                  apiFields: [{ fieldId: 'title', kind: 'text' }],
                  customFields: [],
                },
        };
  await assert.rejects(
    run(['generate', '--config', configPath], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /HTTP 403/,
  );
  assert.equal(await readFile(output, 'utf8'), '// previous output\n');
  await assert.rejects(stat(sharedOutput), { code: 'ENOENT' });

  await writeFile(
    configPath,
    configSource({
      services: {
        corporate: {
          serviceDomain: 'corporate',
          apiKey: 'corporate-key',
          output,
        },
        blog: { serviceDomain: 'blog', apiKey: 'blog-key', output },
      },
    }),
  );
  await assert.rejects(
    run(['generate', '--config', configPath], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /Multiple services use output/,
  );
});

test('Management API errors do not include the API key', async () => {
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(
    client.listApis(),
    (error) =>
      error.message.includes('403') && !error.message.includes('secret-key'),
  );
});

test('Management API retries HTTP 429', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    fetchImpl: async () => {
      requests++;
      return requests === 1
        ? { ok: false, status: 429, headers: { get: () => '0' } }
        : { ok: true, status: 200, json: async () => ({ apis: [] }) };
    },
  });
  assert.deepEqual(await client.listApis(), []);
  assert.equal(requests, 2);
});

test('Management API retries temporary server and network errors', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      if (requests === 1)
        throw new TypeError('secret-key should not be exposed');
      if (requests === 2) return { ok: false, status: 503 };
      return { ok: true, status: 200, json: async () => ({ apis: [] }) };
    },
  });
  assert.deepEqual(await client.listApis(), []);
  assert.equal(requests, 3);
});

test('Management API does not retry permission errors and gives a useful hint', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      return { ok: false, status: 403 };
    },
  });
  await assert.rejects(
    client.listApis(),
    (error) =>
      error.message.includes('HTTP 403') &&
      error.message.includes('API information permission') &&
      !error.message.includes('secret-key'),
  );
  assert.equal(requests, 1);
});

test('Management API times out and reports the failure without exposing the key', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => {
      requests++;
      await new Promise((_, reject) => {
        const keepAlive = setTimeout(
          () => reject(new Error('Abort signal did not fire')),
          100,
        );
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(keepAlive);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
  });
  await assert.rejects(
    client.listApis(),
    (error) =>
      error.message.includes('timed out after 5 ms') &&
      !error.message.includes('secret-key'),
  );
  assert.equal(requests, 5);
});

test('Management API retries a connection failure while reading a successful response body', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      return requests === 1
        ? new Response(
            new ReadableStream({
              start(controller) {
                controller.error(
                  new TypeError('secret-key connection terminated'),
                );
              },
            }),
          )
        : new Response(JSON.stringify({ apis: [] }));
    },
  });
  assert.deepEqual(await client.listApis(), []);
  assert.equal(requests, 2);
});

test('Management API limits response body network retries and masks error details', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('secret-key connection terminated'));
          },
        }),
      );
    },
  });
  await assert.rejects(
    client.getSchema('blogs'),
    (error) =>
      error.message.includes(
        'apis/blogs failed due to a network error after 5 attempts',
      ) && !error.message.includes('secret-key'),
  );
  assert.equal(requests, 5);
});

test('Management API reports response body timeouts and retries within the same limit', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => {
      requests++;
      return new Response(
        new ReadableStream({
          start(controller) {
            const keepAlive = setTimeout(
              () => controller.error(new Error('Abort signal did not fire')),
              100,
            );
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(keepAlive);
                controller.error(signal.reason);
              },
              { once: true },
            );
          },
        }),
      );
    },
  });
  await assert.rejects(
    client.listApis(),
    (error) =>
      error.message.includes('timed out after 5 ms') &&
      !error.message.includes('secret-key'),
  );
  assert.equal(requests, 5);
});

test('Management API distinguishes invalid JSON from transient response body failures', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      return new Response('{"secret-key":');
    },
  });
  await assert.rejects(
    client.listApis(),
    (error) => error.message === 'Management API apis returned invalid JSON',
  );
  assert.equal(requests, 1);
});

test('Management API releases unused HTTP error bodies before retrying or failing', async () => {
  const canceled = [];
  const statuses = [429, 503, 403];
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      const status = statuses[requests++];
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('Unused error body'));
          },
          cancel() {
            canceled.push(status);
          },
        }),
        { status, headers: { 'Retry-After': '0' } },
      );
    },
  });
  await assert.rejects(client.listApis(), /HTTP 403/);
  assert.equal(requests, 3);
  assert.deepEqual(canceled, statuses);
});
