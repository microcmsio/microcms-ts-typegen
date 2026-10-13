import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTypes } from '../dist/generate.js';
import { checkTypes } from './helpers/type-compiler.mjs';

const fixture = JSON.parse(
  await readFile(
    new URL('./fixtures/required-write-values.json', import.meta.url),
  ),
);
const api = [{ endpoint: 'items', type: 'list' }];
const schemas = (fields) =>
  new Map([['items', { apiFields: fields, customFields: [] }]]);
const generate = (fields = [], options) =>
  generateTypes(api, schemas(fields), options);

async function compile(t, generated, usage) {
  const directory = await mkdtemp(join(tmpdir(), 'microcms-required-rules-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'generated.ts'), generated);
  await writeFile(join(directory, 'usage.ts'), usage);
  checkTypes([join(directory, 'usage.ts')], ['--exactOptionalPropertyTypes']);
}

test('read rule defaults and malformed options are validated explicitly', () => {
  const field = [{ fieldId: 'title', kind: 'text', required: true }];
  const defaultTypes = generate(field);
  for (const typeRules of [
    {},
    { trustReadFieldConstraints: false },
    { trustReadFieldConstraints: undefined },
  ])
    assert.equal(generate(field, { typeRules }), defaultTypes);
  assert.notEqual(
    generate(field, { typeRules: { trustReadFieldConstraints: true } }),
    defaultTypes,
  );
  const enabled = generate(field, {
    typeRules: { trustReadFieldConstraints: true },
  });
  for (const rule of [
    {},
    { trustReferenceAvailability: false },
    { trustReferenceAvailability: undefined },
  ])
    assert.equal(
      generate(field, { typeRules: { trustReadFieldConstraints: rule } }),
      enabled,
    );
  for (const typeRules of [null, [], 'invalid', true])
    assert.throws(
      () => generate(field, { typeRules }),
      /typeRules must be an object/,
    );
  for (const typeRules of [
    { write: {} },
    { read: { trustRequiredFields: true } },
    { trustRequiredFields: true },
    { trustRequiredReadFields: true },
    { trustReadReferenceAvailability: true },
    { trustReadReferenceAvailability: false },
    { trustReferenceAvailability: true },
    { unknown: true },
  ]) {
    assert.throws(
      () => generate(field, { typeRules }),
      /Unknown typeRules option/,
    );
  }
  for (const value of [null, [], 'true', 1])
    assert.throws(
      () =>
        generate(field, { typeRules: { trustReadFieldConstraints: value } }),
      /typeRules.trustReadFieldConstraints must be a boolean or an object/,
    );
  for (const value of [null, [], 'true', 1])
    assert.throws(
      () =>
        generate(field, {
          typeRules: {
            trustReadFieldConstraints: { trustReferenceAvailability: value },
          },
        }),
      /typeRules.trustReadFieldConstraints.trustReferenceAvailability must be a boolean/,
    );
  for (const key of ['enabled', 'unknown', 'trustReadReferenceAvailability'])
    assert.throws(
      () =>
        generate(field, {
          typeRules: { trustReadFieldConstraints: { [key]: true } },
        }),
      /Unknown typeRules.trustReadFieldConstraints option/,
    );
  assert.throws(
    () => generate([{ fieldId: 'title', kind: 'text', required: 'true' }]),
    /Invalid required in items.title/,
  );
});

test('repeater and relation-list minimum settings reject malformed metadata', () => {
  for (const [kind, key, countKey] of [
    ['repeater', 'repeaterCountLimitValidation', 'repeatCount'],
    ['relationList', 'relationListCountLimitValidation', 'relationListCount'],
  ]) {
    const schema = new Map([
      [
        'items',
        {
          apiFields: [
            {
              fieldId: 'entries',
              kind,
              customFieldIds: [],
              referencedApiEndpoint: 'target',
            },
          ],
          customFields: [],
        },
      ],
      ['target', { apiFields: [], customFields: [] }],
    ]);
    const apis = [...api, { endpoint: 'target', type: 'list' }];
    const field = schema.get('items').apiFields[0];
    for (const value of [false, 'invalid', [], {}, { [countKey]: null }]) {
      field[key] = value;
      assert.throws(
        () => generateTypes(apis, schema),
        /Invalid .*CountLimitValidation in items.entries/,
      );
    }
    for (const min of [-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      field[key] = { [countKey]: { min } };
      assert.throws(
        () => generateTypes(apis, schema),
        /Invalid minimum count in items.entries/,
      );
    }
    for (const value of [
      undefined,
      null,
      { [countKey]: {} },
      { [countKey]: { min: null } },
      { [countKey]: { min: 0, max: 5 } },
    ]) {
      field[key] = value;
      assert.doesNotThrow(() => generateTypes(apis, schema));
    }
  }
});

test('saved API inputs obey the stricter write policy, including nested required fields', async (t) => {
  const generated = generateTypes(
    [{ endpoint: fixture.endpoint, type: 'list' }],
    new Map([[fixture.endpoint, fixture.schema]]),
  );
  const validIds = [
    'create-valid-zero-false',
    'post-valid-zero-false',
    'create-repeater-count-3',
    'update-only-title',
    'update-custom-required-only',
    'update-optional-custom-required-only',
    'update-repeater-required-only',
  ];
  const invalidIds = [
    'create-omit-title',
    'create-omit-count',
    'create-omit-details',
    'create-omit-blocks',
    'create-omit-enabled',
    'post-omit-enabled',
    'create-clear-details',
    'post-clear-details',
    'update-clear-details',
    'create-optional-custom-omit-required-label',
    'update-custom-label-only',
    'update-custom-note-only',
    'update-custom-required-without-children',
    'update-repeater-element-label-only',
    'create-nested-repeater-count-0',
    'update-nested-repeater-count-0',
  ];
  const declarations = [...validIds, ...invalidIds].map((id, index) => {
    const item = fixture.cases.find((entry) => entry.id === id);
    assert.ok(item, id);
    const mode = item.operation === 'create' ? 'create' : 'update';
    return `${invalidIds.includes(id) ? '// @ts-expect-error required write policy rejects this input\n' : ''}const input${index} = ${JSON.stringify(item.content)} satisfies MainServiceSchema['${fixture.endpoint}']['${mode}'];`;
  });
  await compile(
    t,
    generated,
    `
import type { MainServiceSchema } from './generated';
${declarations.join('\n')}
type Create = MainServiceSchema['${fixture.endpoint}']['create'];
type Update = MainServiceSchema['${fixture.endpoint}']['update'];
const untouched: Update = {};
const clearedOptional: Update = { optionalDetails: {} };
// @ts-expect-error required booleans cannot be cleared
const nullBoolean: Update = { enabled: null };
// @ts-expect-error required numbers cannot be cleared
const nullNumber: Update = { count: null };
// @ts-expect-error required repeaters must not be empty
const emptyBlocks: Update = { blocks: [] };
declare const arbitraryBlocks: NonNullable<Update['blocks']>[number][];
// @ts-expect-error an ordinary array does not prove that it contains an element
const uncertainBlocks: Update = { blocks: arbitraryBlocks };
// Exact minimum 2 and maximum 3 are left to the API; only nonempty is checked.
const oneBlock: Update = { blocks: [{ fieldId: 'row', label: 'one', amount: 0, children: [{ fieldId: 'leaf', text: 'child' }] }] };
// Empty strings cannot be excluded from the string type.
const emptyText: Update = { title: '' };
`,
  );
});

test('required reads narrow custom children but retain optional parents and unpublished references at every depth', async (t) => {
  const schema = {
    apiFields: [
      { fieldId: 'title', kind: 'text', required: true },
      { fieldId: 'details', kind: 'custom', customFieldId: 'part' },
      {
        fieldId: 'ref',
        kind: 'relation',
        referencedApiEndpoint: 'items',
        required: true,
      },
      {
        fieldId: 'refs',
        kind: 'relationList',
        referencedApiEndpoint: 'items',
        required: true,
      },
    ],
    customFields: [
      {
        fieldId: 'part',
        fields: [
          { fieldId: 'text', kind: 'text', required: true },
          { fieldId: 'optional', kind: 'text' },
          { fieldId: 'flag', kind: 'boolean', required: true },
        ],
      },
    ],
  };
  const generated = generateTypes(api, new Map([['items', schema]]), {
    typeRules: { trustReadFieldConstraints: true },
  });
  await compile(
    t,
    generated,
    `
import type { MainServiceSchema, Items } from './generated';
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Parent = Assert<Equal<Items['details'], { fieldId: 'part'; text: string; optional?: string | null; flag: boolean } | null>>;
type RequiredTitle = Assert<Equal<Pick<Items, 'title'>, { title: string }>>;
type Depths = MainServiceSchema['items']['depths'];
${Array.from(
  { length: 4 },
  (_, depth) => `
const unpublished${depth}: Pick<Depths[${depth}], 'ref' | 'refs'> = { ref: null, refs: [] };
const parentNull${depth}: Pick<Depths[${depth}], 'details'> = { details: null };
// @ts-expect-error the required child remains mandatory when the parent exists
const missingChild${depth}: Pick<Depths[${depth}], 'details'> = { details: { fieldId: 'part', flag: false } };
`,
).join('\n')}
// @ts-expect-error a required reference cannot be cleared in an update
const clearedRef: MainServiceSchema['items']['update'] = { ref: {} };
// @ts-expect-error a required list cannot be empty in an update
const clearedRefs: MainServiceSchema['items']['update'] = { refs: [] };
`,
  );
});

test('trusted repeater reads enforce nonempty arrays while preserving optional empties and reference lists', async (t) => {
  const cases = [
    { fieldId: 'requiredBlocks', required: true, nonempty: true },
    { fieldId: 'requiredZero', required: true, min: 0, nonempty: true },
    { fieldId: 'minimumOne', min: 1, nonempty: true },
    { fieldId: 'minimumTwo', min: 2, nonempty: true },
    { fieldId: 'zeroMinimum', min: 0, nonempty: false },
    { fieldId: 'optionalBlocks', nonempty: false },
  ];
  const fields = cases.map(({ fieldId, required, min }) => ({
    fieldId,
    kind: 'repeater',
    customFieldIds: ['part', 'note'],
    ...(required === undefined ? {} : { required }),
    ...(min === undefined
      ? {}
      : { repeaterCountLimitValidation: { repeatCount: { min } } }),
  }));
  const schema = {
    apiFields: [
      ...fields,
      { fieldId: 'details', kind: 'custom', customFieldId: 'container' },
      {
        fieldId: 'refs',
        kind: 'relationList',
        referencedApiEndpoint: 'items',
        required: true,
        relationListCountLimitValidation: { relationListCount: { min: 1 } },
      },
    ],
    customFields: [
      { fieldId: 'container', fields },
      {
        fieldId: 'part',
        fields: [{ fieldId: 'text', kind: 'text', required: true }],
      },
      {
        fieldId: 'note',
        fields: [{ fieldId: 'text', kind: 'text', required: true }],
      },
    ],
  };
  const directory = await mkdtemp(join(tmpdir(), 'microcms-repeater-reads-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [file, trustReadFieldConstraints] of [
    ['default', false],
    ['strict', true],
  ])
    await writeFile(
      join(directory, `${file}.ts`),
      generateTypes(api, new Map([['items', schema]]), {
        typeRules: { trustReadFieldConstraints },
      }),
    );
  const source = `
import type { MainServiceSchema as Default } from './default';
import type { MainServiceSchema as Strict } from './strict';
type Assert<T extends true> = T;
type SameShape<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
${Array.from(
  { length: 4 },
  (_, depth) => `
type Read${depth} = Strict['items']['depths'][${depth}];
type Parent${depth} = NonNullable<Read${depth}['details']>;
const emptyRefs${depth}: Pick<Read${depth}, 'refs'> = { refs: [] };
const emptyParent${depth}: Pick<Read${depth}, 'details'> = { details: null };
${cases
  .map(
    ({ fieldId, nonempty }) => `
type Element${depth}${fieldId} = NonNullable<Read${depth}['${fieldId}']>[number];
type Array${depth}${fieldId} = ${nonempty ? `[Element${depth}${fieldId}, ...Element${depth}${fieldId}[]]` : `Element${depth}${fieldId}[]`};
type Shape${depth}${fieldId} = Assert<SameShape<Read${depth}['${fieldId}'], Array${depth}${fieldId}${nonempty ? '' : ' | null'}>>;
type Nested${depth}${fieldId} = Assert<SameShape<Parent${depth}['${fieldId}'], Array${depth}${fieldId}${nonempty ? '' : ' | null | undefined'}>>;
const defaultEmpty${depth}${fieldId}: Pick<Default['items']['depths'][${depth}], '${fieldId}'> = { ${fieldId}: [] };
const defaultNull${depth}${fieldId}: Pick<Default['items']['depths'][${depth}], '${fieldId}'> = { ${fieldId}: null };
${nonempty ? '// @ts-expect-error trusted nonempty arrays cannot be empty\n' : ''}const empty${depth}${fieldId}: Pick<Read${depth}, '${fieldId}'> = { ${fieldId}: [] };
${nonempty ? '// @ts-expect-error trusted required or minimum-count repeaters cannot be null\n' : ''}const null${depth}${fieldId}: Pick<Read${depth}, '${fieldId}'> = { ${fieldId}: null };
${nonempty ? '// @ts-expect-error nested trusted nonempty arrays cannot be empty\n' : ''}const nestedEmpty${depth}${fieldId}: Pick<Parent${depth}, '${fieldId}'> = { ${fieldId}: [] };
${nonempty ? '// @ts-expect-error required or minimum-count children cannot be omitted\n' : ''}const nestedOmitted${depth}${fieldId}: Pick<Parent${depth}, '${fieldId}'> = {};
const one${depth}${fieldId}: Pick<Read${depth}, '${fieldId}'> = { ${fieldId}: [{ fieldId: 'part', text: 'text' }] };
const union${depth}${fieldId}: Pick<Read${depth}, '${fieldId}'> = { ${fieldId}: [{ fieldId: 'part', text: 'text' }, { fieldId: 'note', text: 'note' }] };
`,
  )
  .join('\n')}
`,
).join('\n')}
`;
  await writeFile(join(directory, 'usage.ts'), source);
  for (const options of [[], ['--exactOptionalPropertyTypes']])
    checkTypes([join(directory, 'usage.ts')], options);
});

test('positive minimum counts require keys on create and nonempty supplied updates even with required OFF', async (t) => {
  const schema = {
    apiFields: [
      {
        fieldId: 'blocks',
        kind: 'repeater',
        customFieldIds: ['part'],
        repeaterCountLimitValidation: { repeatCount: { min: 1, max: 4 } },
      },
      {
        fieldId: 'refs',
        kind: 'relationList',
        referencedApiEndpoint: 'items',
        relationListCountLimitValidation: {
          relationListCount: { min: 2, max: 3 },
        },
      },
    ],
    customFields: [
      {
        fieldId: 'part',
        fields: [{ fieldId: 'value', kind: 'number', required: true }],
      },
    ],
  };
  await compile(
    t,
    generateTypes(api, new Map([['items', schema]])),
    `
import type { MainServiceSchema } from './generated';
type Create = MainServiceSchema['items']['create'];
type Update = MainServiceSchema['items']['update'];
// @ts-expect-error a positive minimum also requires the keys on creation
const omitted: Create = {};
const omittedUpdate: Update = {};
const valid: Create = { blocks: [{ fieldId: 'part', value: 0 }], refs: ['id'] };
// @ts-expect-error a minimum count forbids empty arrays when supplied
const emptyCreate: Create = { blocks: [] };
// @ts-expect-error a minimum count also applies during update
const emptyUpdate: Update = { refs: [] };
// @ts-expect-error required children must be supplied in replacement elements
const missingChild: Update = { blocks: [{ fieldId: 'part' }] };
`,
  );
});
