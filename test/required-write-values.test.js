import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTypes } from '../dist/generate.js';
import { checkTypes } from './helpers/type-compiler.mjs';

// Saved Management API schema and Content API PUT/POST/PATCH results.
// These tests run offline. They describe API behavior, independently of the
// generator's policy for narrowing required read/write fields.
const fixture = JSON.parse(
  await readFile(
    new URL('./fixtures/required-write-values.json', import.meta.url),
  ),
);
function captured(id, status) {
  const item = fixture.cases.find((entry) => entry.id === id);
  assert.ok(item, `Missing captured case ${id}`);
  assert.equal(item.status, status, id);
  if (status === 400) {
    assert.equal(Object.hasOwn(item, 'response'), false, id);
    assert.equal(typeof item.result.message, 'string', id);
  }
  return item;
}

test('saved required flags and repeater bounds match the verification schema', () => {
  assert.equal(fixture.cases.length, 50);
  const fields = fixture.schema.apiFields;
  for (const id of ['title', 'count', 'enabled', 'details', 'blocks'])
    assert.equal(
      fields.find((field) => field.fieldId === id).required,
      true,
      id,
    );
  assert.equal(
    fields.find((field) => field.fieldId === 'optionalDetails').required,
    false,
  );
  assert.equal(
    fields.find((field) => field.fieldId === 'title').initialValue,
    'initial title',
  );
  assert.deepEqual(
    fields.find((field) => field.fieldId === 'blocks')
      .repeaterCountLimitValidation,
    {
      repeatCount: { min: 2, max: 3 },
    },
  );
  const row = fixture.schema.customFields.find(
    (field) => field.fieldId === 'row',
  );
  for (const id of ['label', 'amount', 'children'])
    assert.equal(
      row.fields.find((field) => field.fieldId === id).required,
      true,
      id,
    );
  assert.deepEqual(
    row.fields.find((field) => field.fieldId === 'children')
      .repeaterCountLimitValidation,
    {
      repeatCount: { min: 1, max: 2 },
    },
  );
});

test('required scalar omission and clearing are rejected, but unrelated PATCH fields may be omitted', () => {
  for (const name of ['title', 'count', 'details', 'blocks'])
    captured(`create-omit-${name}`, 400);
  captured('post-omit-title', 400);
  for (const operation of ['create', 'update'])
    for (const name of ['title', 'count', 'enabled', 'blocks'])
      captured(`${operation}-clear-${name}`, 400);
  const updated = captured('update-only-title', 200);
  assert.deepEqual(updated.content, { title: 'updated title' });
  assert.equal(updated.response.title, 'updated title');
  assert.equal(updated.response.count, 0);
  assert.equal(updated.response.details.label, 'details');
  assert.equal(updated.response.blocks.length, 2);
});

test('required booleans can be omitted and default to false; zero and false remain valid values', () => {
  for (const id of ['create-valid-zero-false', 'post-valid-zero-false']) {
    const item = captured(id, 201);
    assert.equal(item.content.count, 0);
    assert.equal(item.content.enabled, false);
    assert.equal(item.response.count, 0);
    assert.equal(item.response.enabled, false);
  }
  for (const id of ['create-omit-enabled', 'post-omit-enabled']) {
    const item = captured(id, 201);
    assert.equal(Object.hasOwn(item.content, 'enabled'), false);
    assert.equal(item.response.enabled, false);
  }
});

test('an empty custom object bypasses required child validation for PUT, POST and PATCH', () => {
  for (const [id, status] of [
    ['create-clear-details', 201],
    ['post-clear-details', 201],
    ['update-clear-details', 200],
  ]) {
    const item = captured(id, status);
    assert.deepEqual(item.content.details, {});
    assert.deepEqual(item.response.details, { fieldId: 'row', children: null });
  }
});

test('custom fields require their mandatory children when supplied, including during PATCH', () => {
  for (const id of [
    'create-custom-omit-required-label',
    'create-optional-custom-omit-required-label',
    'update-custom-label-only',
    'update-custom-note-only',
    'update-custom-omit-field-id',
    'update-custom-required-without-children',
    'update-optional-custom-on-null',
  ])
    captured(id, 400);
  assert.equal(
    captured('create-valid-zero-false', 201).response.optionalDetails,
    null,
  );
  const added = captured('update-optional-custom-required-only', 200).response
    .optionalDetails;
  assert.equal(added.label, 'optional');
  assert.equal(added.amount, 0);
  assert.equal(added.children[0].text, 'leaf optional');
});

test('custom PATCH merges omitted optional children, while nested repeater elements are replaced', () => {
  const item = captured('update-custom-required-only', 200);
  assert.equal(Object.hasOwn(item.content.details, 'note'), false);
  assert.equal(item.response.details.note, 'note details');
  assert.equal(item.response.details.label, 'updated details');
  assert.deepEqual(item.response.details.children, [
    { fieldId: 'leaf', text: 'leaf updated details' },
  ]);
  const optional = captured('update-optional-custom-heading-only', 200);
  assert.deepEqual(optional.content.details, {
    fieldId: 'section',
    heading: 'updated heading',
  });
  assert.deepEqual(optional.response.details.children, [
    { fieldId: 'textBlock', text: 'previous text', number: 3, boolean: true },
  ]);
});

test('repeater count limits reject values below and above bounds during creation and update', () => {
  for (const id of [
    'create-repeater-count-1',
    'create-repeater-count-4',
    'update-repeater-one-element-only',
    'update-repeater-count-4',
  ])
    captured(id, 400);
  for (const [id, status, length] of [
    ['create-valid-zero-false', 201, 2],
    ['create-repeater-count-3', 201, 3],
    ['update-repeater-fully-specified', 200, 2],
    ['update-repeater-count-3', 200, 3],
  ]) {
    const item = captured(id, status);
    assert.equal(item.content.blocks.length, length);
    assert.equal(item.response.blocks.length, length);
  }
});

test('nested repeaters enforce required elements and their own count limits', () => {
  for (const id of [
    'create-nested-repeater-omitted',
    'create-nested-repeater-count-0',
    'create-nested-repeater-count-3',
    'update-nested-repeater-count-0',
    'update-nested-repeater-count-3',
    'update-nested-repeater-label-only',
  ])
    captured(id, 400);
  assert.equal(
    captured('create-nested-repeater-count-2', 201).response.details.children
      .length,
    2,
  );
  captured('create-repeater-omit-required-label', 400);
  captured('update-repeater-element-label-only', 400);
  captured('update-repeater-clear-nested-label', 400);
});

test('repeater PATCH replaces the supplied array and does not preserve omitted optional element values', () => {
  const item = captured('update-repeater-required-only', 200);
  assert.equal(item.response.blocks.length, 2);
  for (const [index, block] of item.response.blocks.entries()) {
    assert.equal(block.label, `updated ${index === 0 ? 'A' : 'B'}`);
    assert.equal(Object.hasOwn(block, 'note'), false);
    assert.equal(Object.hasOwn(block.children[0], 'note'), false);
    assert.equal(block.amount, 0);
  }
  const optional = captured('update-optional-repeater-text-only', 200);
  assert.deepEqual(optional.content.blocks, [
    { fieldId: 'textBlock', text: 'updated block' },
  ]);
  assert.deepEqual(optional.response.blocks, [
    { fieldId: 'textBlock', text: 'updated block', boolean: false },
  ]);
});

test('generated conservative read types accept successful required-field responses, including custom clearing', async () => {
  const baseline = JSON.parse(
    await readFile(
      new URL('./fixtures/live-type-matrix.json', import.meta.url),
    ),
  );
  const schemas = new Map(
    Object.entries({
      ...baseline.schemas,
      ...fixture.additionalSchemas,
      [fixture.endpoint]: fixture.schema,
    }),
  );
  const generated = generateTypes(
    [...baseline.apis, { endpoint: fixture.endpoint, type: 'list' }],
    schemas,
    { serviceName: 'verification' },
  );
  const directory = await mkdtemp(join(tmpdir(), 'microcms-required-values-'));
  try {
    await writeFile(join(directory, 'generated.ts'), generated);
    const reads = fixture.cases
      .filter((item) => item.response)
      .map((item, index) => {
        const response = {
          id: item.id,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          ...item.response,
        };
        return `const read${index} = ${JSON.stringify(response)} satisfies VerificationServiceSchema[${JSON.stringify(item.endpoint)}]['depths'][1];`;
      });
    await writeFile(
      join(directory, 'usage.ts'),
      `import type { VerificationServiceSchema } from './generated';\n${reads.join('\n')}\n`,
    );
    checkTypes([join(directory, 'usage.ts')], ['--exactOptionalPropertyTypes']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
