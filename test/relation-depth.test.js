import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTypes } from '../dist/generate.js';
import { checkTypes } from './helpers/type-compiler.mjs';

test('generated multi-level and cyclic references preserve depth boundaries and field paths', async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL('./fixtures/tree-schema.json', import.meta.url),
      'utf8',
    ),
  );
  const directory = await mkdtemp(join(tmpdir(), 'microcms-depth-matrix-'));
  try {
    await writeFile(
      join(directory, 'generated.ts'),
      generateTypes(fixture.apis, new Map(Object.entries(fixture.schemas)), {
        serviceName: 'tree',
      }),
    );
    await writeFile(
      join(directory, 'usage.ts'),
      `import type { TreeServiceSchema } from './generated';
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Parent<Value> = Value extends { parent: infer P } ? NonNullable<P> : never;
type Nodes<Depth extends 0 | 1 | 2 | 3> = TreeServiceSchema['nodes']['depths'][Depth];
type Depth0 = Assert<Equal<Parent<Nodes<0>>, { id: string }>>;
type Depth1 = Assert<Equal<Parent<Nodes<1>>, Nodes<0>>>;
type Depth2 = Assert<Equal<Parent<Parent<Nodes<2>>>, Nodes<0>>>;
type Depth3 = Assert<Equal<Parent<Parent<Parent<Nodes<3>>>>, Nodes<0>>>;
type Cutoff3 = Assert<Equal<Parent<Parent<Parent<Parent<Nodes<3>>>>>, { id: string }>>;
type MultiReference = Assert<Equal<Nodes<0>['children'][number], { id: string }>>;
type MultiReference3 = Assert<Equal<Nodes<3>['children'][number], Nodes<2>>>;
type Custom0 = Assert<Equal<NonNullable<NonNullable<Nodes<0>['custom']>['target']>, { id: string }>>;
type Custom2 = Assert<Equal<NonNullable<NonNullable<Nodes<2>['custom']>['target']>, Nodes<1>>>;
type Repeat2 = Assert<Equal<NonNullable<NonNullable<Nodes<2>['blocks']>[number]['target']>, Nodes<1>>>;

type ReferencePath = Assert<Equal<'parent.id' extends TreeServiceSchema['nodes']['fieldPaths'] ? true : false, true>>;
type NestedPath = Assert<Equal<'parent.parent.parent.title' extends TreeServiceSchema['nodes']['fieldPaths'] ? true : false, true>>;
type CutoffPath = Assert<Equal<'parent.parent.parent.parent.id' extends TreeServiceSchema['nodes']['fieldPaths'] ? true : false, true>>;
type InvalidPath = Assert<Equal<'parent.parent.parent.parent.title' extends TreeServiceSchema['nodes']['fieldPaths'] ? true : false, false>>;
type ObjectMetadata = Assert<Equal<'id' extends keyof TreeServiceSchema['settings']['content'] ? true : false, false>>;

// Three repeater levels do not consume reference depth.
type Group<Depth extends 0 | 1 | 2 | 3> = Extract<NonNullable<NonNullable<Nodes<Depth>['sections']>[number]['groups']>[number], { fieldId: 'group' }>;
type Leaf<Depth extends 0 | 1 | 2 | 3> = NonNullable<Group<Depth>['items']>[number];
type Branch<Depth extends 0 | 1 | 2 | 3> = Extract<Leaf<Depth>, { fieldId: 'branch' }>;
type Nested0 = Assert<Equal<NonNullable<Branch<0>['target']>, { id: string }>>;
type Nested1 = Assert<Equal<NonNullable<Branch<1>['target']>, Nodes<0>>>;
type Nested2 = Assert<Equal<NonNullable<Branch<2>['target']>, Nodes<1>>>;
type Nested3 = Assert<Equal<NonNullable<Branch<3>['target']>, Nodes<2>>>;
type LeafKinds = Assert<Equal<Leaf<1>['fieldId'], 'branch' | 'caption'>>;
type Caption = Extract<Leaf<1>, { fieldId: 'caption' }>;
type EmptyText = Assert<Equal<Caption['text'], string | null | undefined>>;
type EmptyCount = Assert<Equal<Caption['count'], number | null | undefined>>;
type EmptyBoolean = Assert<Equal<Caption['visible'], boolean | undefined>>;
type EmptyRepeat = Assert<Equal<Group<1>['items'], Leaf<1>[] | null | undefined>>;

declare const leaf: Leaf<1>;
if (leaf.fieldId === 'branch') {
  const target: Nodes<0> | null | undefined = leaf.target;
  // @ts-expect-error caption properties are unavailable on a branch
  leaf.text;
  void target;
} else {
  const text: string | null | undefined = leaf.text;
  // @ts-expect-error branch properties are unavailable on a caption
  leaf.target;
  void text;
}

type WriteGroup<Mode extends 'create' | 'update'> = Extract<NonNullable<NonNullable<TreeServiceSchema['nodes'][Mode]['sections']>[number]['groups']>[number], { fieldId: 'group' }>;
type WriteLeaf<Mode extends 'create' | 'update'> = NonNullable<WriteGroup<Mode>['items']>[number];
const create: TreeServiceSchema['nodes']['create'] = {
  sections: [{ fieldId: 'section', groups: [
    { fieldId: 'group', items: [
      { fieldId: 'branch', target: 'content-id' },
      { fieldId: 'caption', text: '', count: 0, visible: false },
    ] },
    { fieldId: 'caption' },
  ] }],
};
const empty: TreeServiceSchema['nodes']['create'] = {
  sections: [{ fieldId: 'section', groups: [{ fieldId: 'group', items: [] }] }],
};
const update: TreeServiceSchema['nodes']['update'] = {
  sections: [{ fieldId: 'section', groups: [{ fieldId: 'group', items: [
    { fieldId: 'branch', target: {} },
    { fieldId: 'caption', count: null, visible: null },
  ] }] }],
};

// @ts-expect-error repeater elements require their discriminator
const noDiscriminator: WriteLeaf<'create'> = { target: 'content-id' };
// @ts-expect-error unknown variants are rejected at the deepest level
const unknownVariant: WriteLeaf<'create'> = { fieldId: 'other' };
// @ts-expect-error properties from another variant cannot be mixed
const mixedVariants: WriteLeaf<'create'> = { fieldId: 'branch', text: 'caption' };
// @ts-expect-error reads return references as objects; writes require content IDs
const expandedReference: WriteLeaf<'create'> = { fieldId: 'branch', target: { id: 'content-id' } };
// @ts-expect-error wrong scalar types are rejected at the deepest level
const wrongScalar: WriteLeaf<'create'> = { fieldId: 'caption', count: 'zero' };
// @ts-expect-error null is available only when updating number fields
const nullOnCreate: WriteLeaf<'create'> = { fieldId: 'caption', count: null };
// @ts-expect-error a discriminator for a different hierarchy is rejected
const wrongHierarchy: WriteGroup<'create'> = { fieldId: 'branch' };
void [create, empty, update, noDiscriminator, unknownVariant, mixedVariants, expandedReference, wrongScalar, nullOnCreate, wrongHierarchy];
`,
    );
    checkTypes([join(directory, 'usage.ts')], ['--exactOptionalPropertyTypes']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
