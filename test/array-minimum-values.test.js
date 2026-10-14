import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTypes } from '../dist/generate.js';
import { checkTypes } from './helpers/type-compiler.mjs';

// Actual schema and responses from the dedicated minimum-count API.
// UI observations are recorded separately; these tests make no API requests.
const fixture = JSON.parse(
  await readFile(
    new URL('./fixtures/array-minimum-values.json', import.meta.url),
  ),
);
const captured = (id) => {
  const entry = fixture.cases.find((item) => item.id === id);
  assert.ok(entry, `Missing captured case ${id}`);
  return entry;
};

test('minimum one is active with required OFF and rejects omitted or empty creation values', () => {
  assert.equal(fixture.cases.length, 22);
  for (const fieldId of ['optionalRefs', 'optionalBlocks']) {
    const field = fixture.schema.apiFields.find(
      (item) => item.fieldId === fieldId,
    );
    assert.equal(field.required, false);
    const validation =
      field.kind === 'relationList'
        ? field.relationListCountLimitValidation.relationListCount
        : field.repeaterCountLimitValidation.repeatCount;
    assert.equal(validation.min, 1);
    for (const method of ['put', 'post']) {
      for (const mode of ['omit', 'empty', 'null']) {
        const item = captured(`${method}-${mode}-${fieldId}`);
        assert.equal(item.status, 400);
        assert.ok(item.result.message.includes(fieldId), item.id);
        if (mode === 'omit')
          assert.equal(Object.hasOwn(item.input, fieldId), false);
        else
          assert.deepEqual(item.input[fieldId], mode === 'empty' ? [] : null);
        // Other fields are populated so another error cannot mask this check.
        for (const other of [
          'optionalRefs',
          'requiredRefs',
          'optionalBlocks',
          'requiredBlocks',
        ])
          if (other !== fieldId) assert.equal(item.input[other].length, 1);
      }
    }
  }
  assert.equal(captured('put-filled-optionals').status, 201);
});

test('PATCH omission retains existing values but minimum one rejects explicit clearing', () => {
  const filled = captured('put-filled-optionals');
  const omitted = captured('patch-omit-optionals');
  assert.equal(omitted.status, 200);
  assert.deepEqual(omitted.input, {
    title: 'PATCH leaves optionals unchanged',
  });
  for (const field of [
    'optionalRefs',
    'requiredRefs',
    'optionalBlocks',
    'requiredBlocks',
  ])
    assert.deepEqual(omitted.response[field], filled.response[field]);
  for (const field of ['refs', 'blocks'])
    for (const mode of ['empty', 'null']) {
      const item = captured(`patch-${mode}-optional-${field}`);
      assert.equal(item.status, 400);
      const key = field === 'refs' ? 'optionalRefs' : 'optionalBlocks';
      assert.ok(item.result.message.includes(key));
      assert.deepEqual(item.response[key], filled.response[key]);
    }
  for (const field of ['refs', 'blocks'])
    assert.equal(captured(`patch-empty-required-${field}`).status, 400);
  for (const action of ['add-draft', 'publish'])
    assert.equal(
      fixture.uiChecks.find(
        (item) => item.field === 'optionalRefs' && item.action === action,
      ).outcome,
      'rejected',
    );
});

test('generated create and update types agree with captured minimum-count inputs', async (t) => {
  const baseline = JSON.parse(
    await readFile(
      new URL('./fixtures/live-type-matrix.json', import.meta.url),
    ),
  );
  const schemas = new Map(
    Object.entries({ ...baseline.schemas, [fixture.endpoint]: fixture.schema }),
  );
  const apis = [...baseline.apis, { endpoint: fixture.endpoint, type: 'list' }];
  const directory = await mkdtemp(join(tmpdir(), 'microcms-array-minimum-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, 'generated.ts'),
    generateTypes(apis, schemas),
  );
  const cases = fixture.cases.filter(
    (item) =>
      item.id === 'put-filled-optionals' ||
      /^(put|post)-(omit|empty|null)-optional/.test(item.id) ||
      item.method === 'PATCH',
  );
  await writeFile(
    join(directory, 'strict.ts'),
    generateTypes(apis, schemas, {
      typeRules: {
        trustReadFieldConstraints: { trustReferenceAvailability: true },
      },
    }),
  );
  await writeFile(
    join(directory, 'usage.ts'),
    `
import type { MainServiceSchema } from './generated';
import type { MainServiceSchema as Strict } from './strict';
type Create = MainServiceSchema['${fixture.endpoint}']['create'];
type Update = MainServiceSchema['${fixture.endpoint}']['update'];
const omittedUpdate: Update = {};
${cases.map((item, index) => `${item.status === 400 ? '// @ts-expect-error captured API validation requires the minimum-count fields\n' : ''}const input${index} = ${JSON.stringify(item.input)} satisfies ${item.method === 'PATCH' ? 'Update' : 'Create'};`).join('\n')}
${fixture.cases
  .filter((item) => item.response)
  .map(
    (item, index) =>
      `const read${index} = ${JSON.stringify(item.response)} satisfies Strict['${fixture.endpoint}']['depths'][1];`,
  )
  .join('\n')}
`,
  );
  for (const options of [[], ['--exactOptionalPropertyTypes']])
    checkTypes([join(directory, 'usage.ts')], options);
});
