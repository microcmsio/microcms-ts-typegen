import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTypes } from '../dist/generate.js';
import { checkTypes } from './helpers/type-compiler.mjs';

// 公式の16種類。セレクトは単一選択・複数選択の両設定を確認する。
// readOptionalはトップレベルのキー省略。カスタムフィールド内では全項目が省略可能。
// create/updateの項目も全て省略可能。ここには指定した場合の値の型を記載する。
// https://document.microcms.io/content-api/get-api-field-responses
const fieldCases = [
  {
    label: 'テキスト',
    id: 'text',
    schema: { kind: 'text' },
    read: 'string | null',
    readOptional: true,
    create: 'string',
    update: 'string',
  },
  {
    label: 'テキストエリア',
    id: 'textArea',
    schema: { kind: 'textArea' },
    read: 'string | null',
    readOptional: true,
    create: 'string',
    update: 'string',
  },
  {
    label: 'リッチエディタ',
    id: 'html',
    schema: { kind: 'richEditorV2' },
    read: 'string | null',
    readOptional: true,
    create: 'string',
    update: 'string',
  },
  {
    label: '旧リッチエディタ',
    id: 'legacyHtml',
    schema: { kind: 'richEditor' },
    read: 'string',
    readOptional: true,
    create: 'string',
    update: 'string',
  },
  {
    label: '画像',
    id: 'image',
    schema: { kind: 'media' },
    read: 'MicroCMSImage',
    readOptional: true,
    create: 'string',
    update: 'string',
  },
  {
    label: '複数画像',
    id: 'images',
    schema: { kind: 'mediaList' },
    read: 'MicroCMSImage[]',
    readOptional: false,
    create: 'string[]',
    update: 'string[]',
  },
  {
    label: '日時',
    id: 'date',
    schema: { kind: 'date' },
    read: 'string',
    readOptional: true,
    create: 'string',
    update: 'string',
  },
  {
    label: '真偽値',
    id: 'boolean',
    schema: { kind: 'boolean' },
    read: 'boolean',
    readOptional: false,
    create: 'boolean',
    update: 'boolean | null',
  },
  {
    label: 'セレクト（単一選択）',
    id: 'singleSelect',
    schema: {
      kind: 'select',
      selectItems: [{ value: 'One' }, { value: 'Two' }],
      multipleSelect: false,
    },
    read: '("One" | "Two")[]',
    readOptional: false,
    create: '("One" | "Two")[]',
    update: '("One" | "Two")[]',
  },
  {
    label: 'セレクト（複数選択）',
    id: 'multiSelect',
    schema: {
      kind: 'select',
      selectItems: [{ value: 'One' }, { value: 'Two' }],
      multipleSelect: true,
    },
    read: '("One" | "Two")[]',
    readOptional: false,
    create: '("One" | "Two")[]',
    update: '("One" | "Two")[]',
  },
  {
    label: 'コンテンツ参照',
    id: 'related',
    schema: { kind: 'relation', referencedApiEndpoint: 'related' },
    read: 'Related | null',
    readOptional: false,
    create: 'string',
    update: 'string | Record<string, never>',
  },
  {
    label: '複数コンテンツ参照',
    id: 'relatedMany',
    schema: { kind: 'relationList', referencedApiEndpoint: 'related' },
    read: 'Related[]',
    readOptional: false,
    create: 'string[]',
    update: 'string[]',
  },
  {
    label: '数字',
    id: 'number',
    schema: { kind: 'number' },
    read: 'number | null',
    readOptional: true,
    create: 'number',
    update: 'number | null',
  },
  {
    label: 'カスタムフィールド',
    id: 'details',
    schema: { kind: 'custom', customFieldId: 'leaf' },
    read: 'LeafRead | null',
    readOptional: false,
    create: 'LeafCreate',
    update: 'LeafUpdate | Record<string, never>',
  },
  {
    label: '繰り返し',
    id: 'blocks',
    schema: { kind: 'repeater', customFieldIds: ['leaf'] },
    read: 'LeafRead[] | null',
    readOptional: false,
    create: 'LeafCreate[]',
    update: 'LeafUpdate[]',
  },
  {
    label: 'ファイル',
    id: 'file',
    schema: { kind: 'file' },
    read: 'MicroCMSFile',
    readOptional: true,
    create: 'string',
    update: 'string',
  },
  {
    label: '拡張フィールド（data型未指定）',
    id: 'extension',
    schema: { kind: 'iframe' },
    read: 'unknown',
    readOptional: true,
    create: 'Record<string, unknown>',
    update: 'Record<string, unknown>',
  },
];

function generateFieldTypes(required = false) {
  const fields = fieldCases.map(({ id, schema }) => ({
    fieldId: id,
    ...schema,
    required,
  }));
  return generateTypes(
    [
      { endpoint: 'fields', type: 'list' },
      { endpoint: 'related', type: 'list' },
    ],
    new Map([
      [
        'fields',
        {
          apiFields: [
            ...fields,
            { fieldId: 'group', kind: 'custom', customFieldId: 'allKinds' },
          ],
          customFields: [
            { fieldId: 'allKinds', fields },
            {
              fieldId: 'leaf',
              fields: [
                { fieldId: 'text', kind: 'text' },
                { fieldId: 'number', kind: 'number' },
                { fieldId: 'boolean', kind: 'boolean' },
              ],
            },
          ],
        },
      ],
      ['related', { apiFields: [], customFields: [] }],
    ]),
    { serviceName: 'verification' },
  );
}

const consumerTypes = `
import type { VerificationServiceSchema, Fields, FieldsCustomFieldAllKinds, Related, MicroCMSImage, MicroCMSFile } from './generated';
type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Create = VerificationServiceSchema['fields']['create'];
type Update = VerificationServiceSchema['fields']['update'];
type CustomCreate = NonNullable<Create['group']>;
type CustomUpdate = Exclude<NonNullable<Update['group']>, Record<string, never>>;
type LeafRead = { fieldId: 'leaf'; text?: string | null; number?: number | null; boolean?: boolean };
type LeafCreate = { fieldId: 'leaf'; text?: string; number?: number; boolean?: boolean };
type LeafUpdate = { fieldId: 'leaf'; text?: string; number?: number | null; boolean?: boolean | null };
`;

function fieldAssertions({ id, read, readOptional, create, update }) {
  // Pickで値の型と「キー自体を省略できるか」を別々に保証する。
  // 出力全体の文字列検索では、別フィールド・別モードの宣言と一致してしまう。
  return `
${consumerTypes}
type ReadField = Assert<Equal<Pick<Fields, '${id}'>, { ${id}${readOptional ? '?' : ''}: ${read} }>>;
type CreateField = Assert<Equal<Pick<Create, '${id}'>, { ${id}?: ${create} }>>;
type UpdateField = Assert<Equal<Pick<Update, '${id}'>, { ${id}?: ${update} }>>;
type CustomReadField = Assert<Equal<Pick<FieldsCustomFieldAllKinds, '${id}'>, { ${id}?: ${read} }>>;
type CustomCreateField = Assert<Equal<Pick<CustomCreate, '${id}'>, { ${id}?: ${create} }>>;
type CustomUpdateField = Assert<Equal<Pick<CustomUpdate, '${id}'>, { ${id}?: ${update} }>>;
`;
}

test('all 16 field kinds match their read/create/update contracts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'microcms-field-types-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const generated = join(directory, 'generated.ts');
  await writeFile(generated, generateFieldTypes());
  for (const field of fieldCases) {
    await t.test(`${field.label}（${field.schema.kind}）`, async () => {
      const consumer = join(directory, `${field.id}.ts`);
      await writeFile(consumer, fieldAssertions(field));
      checkTypes([generated, consumer], ['--exactOptionalPropertyTypes']);
    });
  }
});

test('required settings do not discard omission or empty values for any field kind', () => {
  assert.equal(generateFieldTypes(true), generateFieldTypes(false));
});

test('captured API fixtures contain every field kind and both select settings', async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL('./fixtures/live-type-matrix.json', import.meta.url),
    ),
  );
  const capturedFields = Object.values(fixture.schemas).flatMap((schema) => [
    ...schema.apiFields,
    ...schema.customFields.flatMap((custom) => custom.fields),
  ]);
  assert.deepEqual(
    new Set(capturedFields.map((field) => field.kind)),
    new Set(fieldCases.map((field) => field.schema.kind)),
  );
  assert.deepEqual(
    new Set(
      capturedFields
        .filter((field) => field.kind === 'select')
        .map((field) => field.multipleSelect),
    ),
    new Set([false, true]),
  );
  // 保存済みの値ありレスポンスにも全項目があることを確認する。
  // 省略可能な項目がfixtureから抜けても、型への代入だけなら成功するため。
  for (const { id, schema } of fieldCases) {
    const endpoint = ['custom', 'repeater'].includes(schema.kind)
      ? 'typegen_matrix_nested'
      : 'typegen_matrix_values';
    const captured = fixture.reads.find(
      (item) => item.id === `${endpoint}-filled-depth-1`,
    );
    assert.ok(captured, `Missing captured response for ${endpoint}`);
    assert.equal(Object.hasOwn(captured.response, id), true, id);
  }
});
