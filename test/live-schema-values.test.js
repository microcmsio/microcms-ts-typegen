import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSchemas } from '../dist/generate.js';
import { createManagementClient } from '../dist/management.js';
import { checkTypes } from './helpers/type-compiler.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/live-type-matrix.json', import.meta.url)),
);
const values = 'typegen_matrix_values';
const nested = 'typegen_matrix_nested';
const object = 'typegen_matrix_object';
const uiExtension = 'typegen_matrix_ui_extension';
function response(id) {
  const captured = fixture.reads.find((item) => item.id === id);
  assert.ok(captured, `Missing captured response ${id}`);
  return captured.response;
}
function leaves(content) {
  const section = content.blocks.find((item) => item.fieldId === 'section');
  const group = section.children.find((item) => item.fieldId === 'group');
  return group.items;
}

test('captured scalar values distinguish omission, empty values and update resets', () => {
  const omitted = response(`${values}-omitted-depth-1`);
  const empty = response(`${values}-empty-depth-1`);
  const reset = response('scalar-reset-depth-1');
  const filled = response(`${values}-filled-depth-1`);
  for (const key of [
    'text',
    'textArea',
    'legacyHtml',
    'html',
    'number',
    'date',
    'image',
    'file',
    'extension',
  ]) {
    assert.equal(Object.hasOwn(omitted, key), false, `${key} is omitted`);
  }
  for (const key of ['text', 'textArea', 'html']) {
    assert.equal(empty[key], null, `${key}: empty input becomes null`);
    assert.equal(reset[key], null, `${key}: reset becomes null`);
  }
  assert.equal(empty.legacyHtml, '');
  assert.equal(reset.legacyHtml, '');
  assert.equal(filled.number, 0);
  assert.equal(empty.number, 0);
  assert.equal(reset.number, null);
  for (const content of [filled, omitted, empty, reset])
    assert.equal(content.boolean, false);
  for (const key of ['images', 'singleSelect', 'multiSelect', 'relatedMany']) {
    assert.deepEqual(omitted[key], []);
    assert.deepEqual(empty[key], []);
    assert.deepEqual(reset[key], []);
  }
  assert.deepEqual(filled.singleSelect, ['One']);
  assert.deepEqual(filled.multiSelect, ['One', 'Two']);
  assert.equal(filled.image.width, 600);
  assert.equal(filled.file.fileSize, 20247);
  assert.deepEqual(filled.extension, {
    count: 0,
    location: { label: 'top' },
    enabled: false,
    labels: ['one', 'two'],
  });
  for (const key of ['date', 'image', 'file', 'extension']) {
    assert.equal(
      Object.hasOwn(reset, key),
      false,
      `${key} is omitted after reset`,
    );
  }
  assert.equal(reset.related, null);
});

test('three repeater levels preserve reference depth, union variants and nested empty values', () => {
  for (const depth of [0, 1, 2, 3]) {
    const content = response(`${nested}-filled-depth-${depth}`);
    const items = leaves(content);
    assert.deepEqual(
      items.map((item) => item.fieldId),
      ['textBlock', 'linkBlock', 'textBlock', 'linkBlock'],
    );
    assert.deepEqual(items[1].target, content.related);
    assert.deepEqual(items[1].targets, content.relatedMany);
    assert.deepEqual(content.details.children[0].items, items);
    assert.deepEqual(items[2], { fieldId: 'textBlock', boolean: false });
    assert.deepEqual(items[3], {
      fieldId: 'linkBlock',
      target: null,
      targets: [],
      choices: [],
    });
    assert.deepEqual(content.blocks[0].children[2].items, []);
    assert.deepEqual(content.blocks[2].children, []);
    const target = items[1].target;
    if (depth === 0) assert.deepEqual(target, { id: 'typegen-matrix-filled' });
    if (depth === 1)
      assert.deepEqual(target.related, { id: 'typegen-matrix-blog' });
    if (depth === 2)
      assert.deepEqual(target.related.category, {
        id: 'typegen-matrix-category',
      });
    if (depth === 3)
      assert.equal(target.related.category.name, 'Typegen matrix category');
  }
  const omitted = response(`${nested}-omitted-depth-1`);
  const empty = response(`${nested}-empty-depth-1`);
  assert.equal(omitted.details, null);
  assert.equal(omitted.blocks, null);
  assert.deepEqual(empty.details, { fieldId: 'section', children: [] });
  assert.deepEqual(empty.blocks, []);
});

test('partial updates preserve siblings and resetting nested fields follows API behavior', () => {
  const partial = response('scalar-partial-depth-1');
  assert.equal(partial.text, 'Updated independently');
  assert.equal(partial.textArea, 'First\nSecond');
  assert.equal(partial.related.id, 'typegen-matrix-blog');
  const custom = response('custom-partial-depth-1');
  assert.equal(custom.details.heading, 'Changed section heading');
  assert.equal(custom.details.children[0].items[0].text, 'Nested text');
  assert.equal(custom.blocks[0].heading, 'Section');
  const cleared = leaves(response('nested-empty-values-depth-1'));
  assert.deepEqual(cleared, [
    { fieldId: 'linkBlock', target: null, targets: [], choices: [] },
    { fieldId: 'textBlock', number: null, boolean: false },
  ]);
  const reset = response('nested-reset-depth-1');
  // Clearing a previously populated custom field preserves its discriminator.
  assert.deepEqual(reset.details, { fieldId: 'section', children: null });
  assert.deepEqual(reset.blocks, []);
  assert.equal(reset.related, null);
  assert.deepEqual(reset.relatedMany, []);
});

test('object-format responses have timestamps without a content ID, including nested reads and resets', () => {
  for (const depth of [0, 1, 2, 3]) {
    const content = response(`object-filled-depth-${depth}`);
    assert.equal(Object.hasOwn(content, 'id'), false);
    assert.equal(typeof content.createdAt, 'string');
    assert.deepEqual(leaves(content)[1].target, content.related);
    const reset = response(`object-reset-depth-${depth}`);
    assert.equal(Object.hasOwn(reset, 'id'), false);
    assert.deepEqual(reset.blocks, []);
    assert.equal(reset.related, null);
  }
});

test('management UI clearing omits scalar keys while preserving empty arrays and references', () => {
  const filled = response('ui-values-filled-depth-1');
  assert.equal(filled.text, 'UI text');
  assert.equal(filled.textArea, 'UI first\nUI second');
  assert.equal(filled.legacyHtml, '<p>UI legacy rich text</p>');
  assert.equal(filled.html, '<p>UI rich text</p>');
  assert.equal(filled.number, 42);
  assert.equal(filled.boolean, true);
  assert.equal(filled.date, '2026-10-08T00:00:00.000Z');
  assert.deepEqual(filled.singleSelect, ['One']);
  assert.deepEqual(filled.multiSelect, ['One', 'Two']);
  assert.equal(filled.image.width, 600);
  assert.equal(filled.images.length, 1);
  assert.equal(filled.file.fileSize, 20247);
  assert.equal(filled.related.id, 'typegen-matrix-blog');
  assert.deepEqual(filled.relatedMany, [filled.related]);
  for (const phase of ['initially-empty', 'cleared']) {
    for (const depth of [0, 1, 2, 3]) {
      const content = response(`ui-values-${phase}-depth-${depth}`);
      for (const key of [
        'text',
        'textArea',
        'legacyHtml',
        'html',
        'number',
        'date',
        'image',
        'file',
        'extension',
      ]) {
        assert.equal(
          Object.hasOwn(content, key),
          false,
          `${phase}: ${key} is omitted`,
        );
      }
      assert.equal(content.boolean, false);
      assert.equal(content.related, null);
      for (const key of [
        'images',
        'singleSelect',
        'multiSelect',
        'relatedMany',
      ])
        assert.deepEqual(content[key], []);
    }
  }
  // PATCH resets return null (or an empty legacy HTML string), unlike UI clearing.
  assert.equal(response('scalar-reset-depth-1').text, null);
  assert.equal(response('scalar-reset-depth-1').legacyHtml, '');
});

test('management UI preserves three repeater levels and clears their leaf values', () => {
  for (const depth of [0, 1, 2, 3]) {
    const filled = response(`ui-nested-filled-depth-${depth}`);
    const items = leaves(filled);
    assert.deepEqual(items[0], {
      fieldId: 'textBlock',
      text: 'UI nested text',
      number: 0,
      boolean: true,
    });
    assert.equal(items[1].label, 'UI nested reference');
    assert.deepEqual(items[1].choices, ['One', 'Two']);
    assert.deepEqual(items[1].targets, [items[1].target]);
    const target = items[1].target;
    if (depth === 0) assert.deepEqual(target, { id: 'typegen-matrix-filled' });
    if (depth === 1)
      assert.deepEqual(target.related, { id: 'typegen-matrix-blog' });
    if (depth === 2)
      assert.deepEqual(target.related.category, {
        id: 'typegen-matrix-category',
      });
    if (depth === 3)
      assert.equal(target.related.category.name, 'Typegen matrix category');
    assert.deepEqual(
      leaves(response(`ui-nested-leaves-cleared-depth-${depth}`)),
      [
        { fieldId: 'textBlock', boolean: false },
        { fieldId: 'linkBlock', target: null, targets: [], choices: [] },
      ],
    );
    for (const phase of ['initially-empty', 'cleared']) {
      const content = response(`ui-nested-${phase}-depth-${depth}`);
      assert.deepEqual(content.details, { fieldId: 'section', children: [] });
      assert.deepEqual(content.blocks, []);
    }
    assert.equal(
      Object.hasOwn(
        response(`ui-extension-initially-empty-depth-${depth}`),
        'extension',
      ),
      false,
    );
  }
});

test('captured schemas generate types that accept real reads and writes and reject invalid nested inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'microcms-live-type-matrix-'));
  try {
    const client = createManagementClient({
      serviceDomain: 'offline',
      apiKey: 'FIXTURE_ONLY',
      requestIntervalMs: 0,
      fetchImpl: async (url) => {
        const path = new URL(url).pathname;
        const payload =
          path === '/api/v1/apis'
            ? { apis: fixture.apis }
            : fixture.schemas[path.split('/').at(-1)];
        assert.ok(payload, `Unexpected fixture request ${path}`);
        return { ok: true, json: async () => structuredClone(payload) };
      },
    });
    const generated = await collectSchemas(
      client,
      [nested, object, uiExtension],
      {
        serviceName: 'verification',
        extensionFieldTypes: {
          [uiExtension]: {
            extension: { from: './extension', data: 'ExtensionData' },
          },
          [values]: {
            extension: { from: './extension', data: 'ExtensionData' },
          },
          [nested]: {
            'textBlock.extension': {
              from: './extension',
              data: 'ExtensionData',
            },
            'linkBlock.extension': {
              from: './extension',
              data: 'ExtensionData',
            },
          },
          [object]: {
            'textBlock.extension': {
              from: './extension',
              data: 'ExtensionData',
            },
            'linkBlock.extension': {
              from: './extension',
              data: 'ExtensionData',
            },
          },
        },
      },
    );
    await writeFile(join(directory, 'generated.ts'), generated);
    await writeFile(
      join(directory, 'extension.ts'),
      `export type ExtensionData = {
      location?: { label: string }; labels?: string[]; enabled?: boolean; count?: number;
    };`,
    );
    const reads = fixture.reads.map(
      (item, index) =>
        `const read${index} = ${JSON.stringify(item.response)} satisfies VerificationServiceSchema[${JSON.stringify(item.endpoint)}]['depths'][${item.queries.depth}];`,
    );
    const writes = fixture.writes.map(
      (item, index) =>
        `const write${index} = ${JSON.stringify(item.content)} satisfies VerificationServiceSchema[${JSON.stringify(item.endpoint)}][${JSON.stringify(item.operation)}];`,
    );
    const invalid = fixture.rejected.map((item, index) => {
      assert.equal(item.status, 400);
      return `// @ts-expect-error ${item.id} was rejected by the real API\nconst invalid${index} = ${JSON.stringify(item.content)} satisfies VerificationServiceSchema[${JSON.stringify(item.endpoint)}]['update'];`;
    });
    await writeFile(
      join(directory, 'usage.ts'),
      `
import type { VerificationServiceSchema } from './generated';
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Depth = 0 | 1 | 2 | 3;
type Nodes<D extends Depth> = VerificationServiceSchema['typegen_matrix_nested']['depths'][D];
type Section<D extends Depth> = Extract<NonNullable<Nodes<D>['blocks']>[number], { fieldId: 'section' }>;
type Group<D extends Depth> = Extract<NonNullable<Section<D>['children']>[number], { fieldId: 'group' }>;
type Leaf<D extends Depth> = NonNullable<Group<D>['items']>[number];
type Link<D extends Depth> = Extract<Leaf<D>, { fieldId: 'linkBlock' }>;
type Reference<D extends Depth> = NonNullable<Link<D>['target']>;
type Ref0 = Assert<Equal<Reference<0>, { id: string }>>;
type Ref1 = Assert<Equal<Reference<1>, VerificationServiceSchema['typegen_matrix_values']['depths'][0]>>;
type Ref2 = Assert<Equal<Reference<2>, VerificationServiceSchema['typegen_matrix_values']['depths'][1]>>;
type Ref3 = Assert<Equal<Reference<3>, VerificationServiceSchema['typegen_matrix_values']['depths'][2]>>;
type MultiRef = Assert<Equal<NonNullable<Link<3>['targets']>[number], Reference<3>>>;
type ObjectHasNoId = Assert<Equal<'id' extends keyof VerificationServiceSchema['typegen_matrix_object']['content'] ? true : false, false>>;
type ObjectHasNoCreate = Assert<Equal<'create' extends keyof VerificationServiceSchema['typegen_matrix_object'] ? true : false, false>>;
declare const leaf: Leaf<1>;
if (leaf.fieldId === 'textBlock') {
  const count: number | null | undefined = leaf.number;
  // @ts-expect-error properties of a different variant are unavailable
  leaf.target;
  void count;
} else {
  const target: Reference<1> | null | undefined = leaf.target;
  // @ts-expect-error properties of a different variant are unavailable
  leaf.number;
  void target;
}
type CreateSection = Extract<NonNullable<VerificationServiceSchema['typegen_matrix_nested']['create']['blocks']>[number], { fieldId: 'section' }>;
type CreateGroup = Extract<NonNullable<CreateSection['children']>[number], { fieldId: 'group' }>;
type CreateLeaf = NonNullable<CreateGroup['items']>[number];
// @ts-expect-error reject properties mixed from another variant
const mixed: CreateLeaf = { fieldId: 'textBlock', target: 'content-id' };
// @ts-expect-error a nested repeater element still requires fieldId
const missingDiscriminator: CreateLeaf = { text: 'text' };
// @ts-expect-error generated extension data also checks nested scalar types
const wrongExtension: CreateLeaf = { fieldId: 'linkBlock', extension: { data: { count: 'zero' } } };
${reads.join('\n')}
${writes.join('\n')}
${invalid.join('\n')}
`,
    );
    checkTypes([join(directory, 'usage.ts')], ['--exactOptionalPropertyTypes']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
