import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTypes } from '../dist/generate.js';
import { requiredCombinations } from './helpers/required-combinations.mjs';
import { checkTypes } from './helpers/type-compiler.mjs';

const assertions = `
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type SameShape<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
`;

test('mixed required rules preserve union repeaters, object metadata and every reference depth', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'microcms-required-combinations-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { apis, schemas } = requiredCombinations();
  for (const [file, trustReadFieldConstraints] of [
    ['default.ts', false],
    ['strict.ts', true],
  ])
    await writeFile(
      join(directory, file),
      generateTypes(apis, schemas, {
        typeRules: { trustReadFieldConstraints },
      }),
    );
  const source = `
import type { MainServiceSchema as Default } from './default';
import type { MainServiceSchema as Strict } from './strict';
${assertions}
type Create = Default['pages']['create'];
type Update = Default['pages']['update'];
type ObjectUpdate = Strict['settings']['update'];
type SameCreate = Assert<Equal<Create, Strict['pages']['create']>>;
type SameUpdate = Assert<Equal<Update, Strict['pages']['update']>>;
type SameObjectUpdate = Assert<Equal<Default['settings']['update'], ObjectUpdate>>;
type OptionalSummary = Assert<Equal<Strict['pages']['content']['summary'], string | null | undefined>>;
type RequiredObjectTitle = Assert<Equal<Strict['settings']['content']['title'], string>>;
type DefaultObjectTitle = Assert<Equal<Default['settings']['content']['title'], string | null | undefined>>;
type ObjectId = Assert<Equal<'id' extends keyof Strict['settings']['content'] ? true : false, false>>;
type ObjectCreate = Assert<Equal<'create' extends keyof Strict['settings'] ? true : false, false>>;

type Section = Extract<Create['blocks'][number], { fieldId: 'section' }>;
type Group = Extract<Section['groups'][number], { fieldId: 'group' }>;
type Leaf = Group['items'][number];
type UpdateSection = Extract<NonNullable<Update['blocks']>[number], { fieldId: 'section' }>;
type UpdateGroup = Extract<UpdateSection['groups'][number], { fieldId: 'group' }>;
type UpdateLeaf = UpdateGroup['items'][number];
const group: Group = { fieldId: 'group', enabled: false, items: [
  { fieldId: 'text', body: 'text' },
  { fieldId: 'link', label: 'link', target: 'id', targets: ['id'], tags: ['one', 'two'] },
] };
const section: Section = { fieldId: 'section', heading: 'heading', groups: [group, { fieldId: 'text', body: 'sibling' }] };
const create: Create = { title: 'title', blocks: [section, { fieldId: 'text', body: 'top sibling' }] };
const objectUpdate: ObjectUpdate = { details: section, blocks: [section] };
const unchanged: ObjectUpdate = {};
const clearedOptional: ObjectUpdate = { details: {} };
// @ts-expect-error the optional parent still requires mandatory children when supplied
const incompleteParent: ObjectUpdate = { details: { fieldId: 'section', heading: 'heading' } };
// @ts-expect-error object updates must retain nonempty required arrays
const emptyObjectBlocks: ObjectUpdate = { blocks: [] };
// @ts-expect-error the third repeater level still requires a text body
const missingBody: Leaf = { fieldId: 'text' };
// @ts-expect-error required reference updates cannot use the clear object
const clearedTarget: UpdateLeaf = { fieldId: 'link', label: 'link', target: {}, targets: ['id'], tags: ['one'] };
// @ts-expect-error required select updates cannot be empty
const emptyTags: UpdateLeaf = { fieldId: 'link', label: 'link', target: 'id', targets: ['id'], tags: [] };
// @ts-expect-error properties from different variants cannot be combined
const mixed: Leaf = { fieldId: 'text', body: 'text', target: 'id' };
// @ts-expect-error nested replacement groups need a required boolean
const missingBoolean: ObjectUpdate = { blocks: [{ fieldId: 'section', heading: 'heading', groups: [{ fieldId: 'group', items: [{ fieldId: 'text', body: 'text' }] }] }] };

type SectionAt<D extends 0 | 1 | 2 | 3> = Extract<Strict['pages']['depths'][D]['blocks'][number], { fieldId: 'section' }>;
type NestedGroupAt<D extends 0 | 1 | 2 | 3> = Extract<SectionAt<D>['groups'][number], { fieldId: 'group' }>;
type LinkAt<D extends 0 | 1 | 2 | 3> = Extract<NestedGroupAt<D>['items'][number], { fieldId: 'link' }>;
${Array.from(
  { length: 4 },
  (_, depth) => `
type LinkLabel${depth} = Assert<Equal<LinkAt<${depth}>['label'], string>>;
type Blocks${depth} = Assert<SameShape<Strict['pages']['depths'][${depth}]['blocks'], [Strict['pages']['depths'][${depth}]['blocks'][number], ...Strict['pages']['depths'][${depth}]['blocks'][number][]]>>;
type Groups${depth} = Assert<SameShape<SectionAt<${depth}>['groups'], [SectionAt<${depth}>['groups'][number], ...SectionAt<${depth}>['groups'][number][]]>>;
type Items${depth} = Assert<SameShape<NestedGroupAt<${depth}>['items'], [NestedGroupAt<${depth}>['items'][number], ...NestedGroupAt<${depth}>['items'][number][]]>>;
// @ts-expect-error trusted object reads preserve required nonempty repeaters
const emptyObjectRead${depth}: Pick<Strict['settings']['depths'][${depth}], 'blocks'> = { blocks: [] };
// @ts-expect-error trusted reads preserve the third repeater level's nonempty constraint
const emptyNestedRead${depth}: Pick<NestedGroupAt<${depth}>, 'items'> = { items: [] };
type Target${depth} = Assert<SameShape<LinkAt<${depth}>['target'], ${depth === 0 ? '{ id: string }' : `Strict['pages']['depths'][${depth - 1}]`} | null>>;
const closed${depth}: Pick<LinkAt<${depth}>, 'target' | 'targets'> = { target: null, targets: [] };
// @ts-expect-error required nested read labels are checked when the object exists
const missingReadLabel${depth}: LinkAt<${depth}> = { fieldId: 'link', target: null, targets: [], tags: [] };
`,
).join('\n')}
`;
  // Union excess-key checks and mandatory/nonempty constraints must work with
  // both common optional-property compiler settings.
  await writeFile(join(directory, 'usage.ts'), source);
  for (const options of [[], ['--exactOptionalPropertyTypes']])
    checkTypes([join(directory, 'usage.ts')], options);
});

test('trusted reads accept populated API responses and reject captured custom clears', async (t) => {
  const fixture = JSON.parse(
    await readFile(
      new URL('./fixtures/required-write-values.json', import.meta.url),
    ),
  );
  const directory = await mkdtemp(
    join(tmpdir(), 'microcms-required-assumptions-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, 'generated.ts'),
    generateTypes(
      [{ endpoint: fixture.endpoint, type: 'list' }],
      new Map([[fixture.endpoint, fixture.schema]]),
      { typeRules: { trustReadFieldConstraints: true } },
    ),
  );
  const validIds = [
    'create-valid-zero-false',
    'post-omit-enabled',
    'update-custom-required-only',
  ];
  const clearIds = [
    'create-clear-details',
    'post-clear-details',
    'update-clear-details',
  ];
  const cases = [...validIds, ...clearIds].map((id, index) => {
    const item = fixture.cases.find((entry) => entry.id === id);
    if (!item?.response) throw new Error(`Missing response ${id}`);
    const value = {
      id: item.id,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      ...item.response,
    };
    return `${clearIds.includes(id) ? '// @ts-expect-error a trusted required shape cannot accept the API custom-clear exception\n' : ''}const response${index} = ${JSON.stringify(value)} satisfies MainServiceSchema['${fixture.endpoint}']['content'];`;
  });
  await writeFile(
    join(directory, 'usage.ts'),
    `import type { MainServiceSchema } from './generated';\n${cases.join('\n')}\n`,
  );
  checkTypes([join(directory, 'usage.ts')], ['--exactOptionalPropertyTypes']);
});
