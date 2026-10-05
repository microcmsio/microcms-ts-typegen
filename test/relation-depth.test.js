import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTypes } from '../src/generate.js';
import { checkTypes } from './helpers/type-compiler.mjs';

test('generated multi-level and cyclic references preserve depth boundaries and field paths', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/tree-schema.json', import.meta.url), 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'microcms-depth-matrix-'));
  try {
    await writeFile(join(directory, 'generated.ts'), generateTypes(fixture.apis, new Map(Object.entries(fixture.schemas)), { serviceName: 'tree' }));
    await writeFile(join(directory, 'usage.ts'), `import type { TreeServiceSchema } from './generated';
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
`);
    checkTypes([join(directory, 'usage.ts')], ['--exactOptionalPropertyTypes']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
