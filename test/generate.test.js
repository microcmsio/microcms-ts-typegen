import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSchemas, generateTypes } from '../dist/generate.js';
import { apis, schemas } from './helpers/sample-schemas.mjs';

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
