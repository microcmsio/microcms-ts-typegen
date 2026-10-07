import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSchemas, generateTypes, pascalCase } from '../dist/generate.js';

const apis = [{ endpoint: 'blog', type: 'list' }];
const empty = { apiFields: [], customFields: [] };
const withSchema = (schema) => new Map([['blog', schema]]);

test('generated names handle separators and leading digits, rejecting unusable names', () => {
  assert.equal(pascalCase('news_items-2026'), 'NewsItems2026');
  assert.equal(pascalCase('123-blog'), '_123Blog');
  for (const name of ['', '___', '--']) {
    assert.throws(() => pascalCase(name), /Cannot make a type name/);
  }
  assert.throws(
    () => generateTypes([{ endpoint: '日本語', type: 'list' }], new Map()),
    /Invalid TypeScript type name/,
  );
});

test('missing schemas, duplicate fields and unsupported API formats fail explicitly', () => {
  assert.throws(
    () => generateTypes(apis, new Map()),
    /Missing schema for blog/,
  );
  assert.throws(
    () =>
      generateTypes(
        apis,
        withSchema({
          ...empty,
          customFields: [
            { fieldId: 'part', fields: [] },
            { fieldId: 'part', fields: [] },
          ],
        }),
      ),
    /Duplicate custom field in blog/,
  );
  assert.throws(
    () =>
      generateTypes(
        apis,
        withSchema({
          ...empty,
          apiFields: [
            { fieldId: 'title', kind: 'text' },
            { fieldId: 'title', kind: 'number' },
          ],
        }),
      ),
    /Duplicate field title in blog/,
  );
  assert.throws(
    () =>
      generateTypes(
        apis,
        withSchema({
          ...empty,
          customFields: [{ fieldId: 'part', fields: null }],
        }),
      ),
    /Invalid field list for blog/,
  );
  for (const fieldId of ['', undefined, 123]) {
    assert.throws(
      () =>
        generateTypes(
          apis,
          withSchema({ ...empty, apiFields: [{ fieldId, kind: 'text' }] }),
        ),
      /A schema field is missing fieldId/,
    );
  }
  assert.throws(
    () =>
      generateTypes([{ endpoint: 'blog', type: 'future' }], withSchema(empty)),
    /Unsupported API type "future" for blog/,
  );
});

test('missing custom and repeater definitions fail with field context', () => {
  for (const field of [
    { fieldId: 'panel', kind: 'custom' },
    { fieldId: 'panel', kind: 'custom', customFieldId: 'missing' },
    { fieldId: 'blocks', kind: 'repeater', customFieldIds: ['missing'] },
  ]) {
    assert.throws(
      () => generateTypes(apis, withSchema({ ...empty, apiFields: [field] })),
      /Unknown (custom|repeat) field.*in blog\.(panel|blocks)/,
    );
  }
});

test('direct generation rejects missing relation targets before emitting incorrect references', () => {
  for (const referencedApiEndpoint of [undefined, 'missing']) {
    const schema = {
      ...empty,
      apiFields: [
        { fieldId: 'reference', kind: 'relation', referencedApiEndpoint },
      ],
    };
    assert.throws(
      () => generateTypes(apis, withSchema(schema)),
      /Relation target.*in blog.reference was not found/,
    );
  }
});

test('extension overrides reject invalid object shapes, ambiguous paths and type names', () => {
  const schema = {
    apiFields: [{ fieldId: 'panel.embed', kind: 'iframe' }],
    customFields: [
      { fieldId: 'panel', fields: [{ fieldId: 'embed', kind: 'iframe' }] },
    ],
  };
  for (const extensionFieldTypes of [null, [], 'invalid']) {
    assert.throws(
      () => generateTypes(apis, withSchema(schema), { extensionFieldTypes }),
      /extensionFieldTypes must be an object/,
    );
  }
  for (const override of [null, [], 'invalid']) {
    assert.throws(
      () =>
        generateTypes(apis, withSchema(schema), {
          extensionFieldTypes: { blog: override },
        }),
      /extensionFieldTypes.blog must be an object/,
    );
    assert.throws(
      () =>
        generateTypes(
          apis,
          withSchema({
            ...empty,
            apiFields: [{ fieldId: 'embed', kind: 'iframe' }],
          }),
          { extensionFieldTypes: { blog: { embed: override } } },
        ),
      /extensionFieldTypes.blog.embed must be an object/,
    );
  }
  assert.throws(
    () =>
      generateTypes(apis, withSchema(schema), {
        extensionFieldTypes: {
          blog: { 'panel.embed': { from: './data', data: 'Data' } },
        },
      }),
    /Ambiguous extension field path blog.panel.embed/,
  );
  for (const data of ['class', 'A.B', 'Bad-Type']) {
    assert.throws(
      () =>
        generateTypes(
          apis,
          withSchema({
            ...empty,
            apiFields: [{ fieldId: 'embed', kind: 'iframe' }],
          }),
          {
            extensionFieldTypes: { blog: { embed: { from: './data', data } } },
          },
        ),
      /Invalid TypeScript type name/,
    );
  }
});

test('endpoint selection avoids unrelated invalid APIs and fetches each reference once', async () => {
  const calls = [];
  const client = {
    listApis: async () => [
      { endpoint: 'blog', type: 'list' },
      { endpoint: 'category', type: 'list' },
      { endpoint: 'unrelated', type: 'list' },
    ],
    getSchema: async (endpoint) => {
      calls.push(endpoint);
      if (endpoint === 'unrelated')
        assert.fail('Unselected and unrelated API must not be requested');
      return endpoint === 'blog'
        ? {
            ...empty,
            apiFields: [
              {
                fieldId: 'category',
                kind: 'relation',
                referencedApiEndpoint: 'category',
              },
            ],
          }
        : empty;
    },
  };
  const output = await collectSchemas(client, ['blog', 'blog', 'category']);
  assert.deepEqual(calls, ['blog', 'category']);
  assert.match(output, /export type Blog =/);
  assert.match(output, /export type Category =/);
  assert.doesNotMatch(output, /Unrelated/);
  await assert.rejects(
    collectSchemas(client, ['missing']),
    /Endpoint missing was not found in this service/,
  );
});

test('missing references inside custom fields report their complete location', async () => {
  const client = {
    listApis: async () => apis,
    getSchema: async () => ({
      ...empty,
      customFields: [
        {
          fieldId: 'panel',
          fields: [
            {
              fieldId: 'reference',
              kind: 'relation',
              referencedApiEndpoint: 'missing',
            },
          ],
        },
      ],
    }),
  };
  await assert.rejects(collectSchemas(client, ['blog']), (error) => {
    assert.match(error.message, /blog.panel.reference/);
    assert.doesNotMatch(error.message, /config endpoints array/);
    return true;
  });
});
