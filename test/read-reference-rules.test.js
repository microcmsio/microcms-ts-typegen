import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTypes } from '../dist/generate.js';
import { checkTypes } from './helpers/type-compiler.mjs';
import { readReferenceSchemas } from './helpers/read-reference-schemas.mjs';

test('nested read rules preserve boolean shorthand, defaults and references at every depth and nested level', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'microcms-read-references-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { apis, schemas } = readReferenceSchemas();
  const modes = [
    { name: 'Default', rule: false, constraints: false, availability: false },
    { name: 'Constrained', rule: true, constraints: true, availability: false },
    { name: 'EmptyObject', rule: {}, constraints: true, availability: false },
    {
      name: 'Nullable',
      rule: { trustReferenceAvailability: false },
      constraints: true,
      availability: false,
    },
    {
      name: 'Both',
      rule: { trustReferenceAvailability: true },
      constraints: true,
      availability: true,
    },
  ];
  const generated = new Map();
  for (const { name, rule } of modes) {
    const source = generateTypes(apis, schemas, {
      typeRules: {
        trustReadFieldConstraints: rule,
      },
    });
    generated.set(name, source);
    await writeFile(join(directory, `${name}.ts`), source);
  }
  // Supplying an object enables the parent rule, even when it is empty.
  assert.equal(generated.get('Constrained'), generated.get('EmptyObject'));
  assert.equal(generated.get('Constrained'), generated.get('Nullable'));
  const source = `
${modes.map(({ name }) => `import type { MainServiceSchema as ${name} } from './${name}';`).join('\n')}
type Assert<T extends true> = T;
type SameShape<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
${modes
  .map(
    ({ name, constraints, availability }) => `
type SameCreate${name} = Assert<SameShape<${name}['pages']['create'], Default['pages']['create']>>;
type SameUpdate${name} = Assert<SameShape<${name}['pages']['update'], Default['pages']['update']>>;
type SameObjectUpdate${name} = Assert<SameShape<${name}['settings']['update'], Default['settings']['update']>>;
${Array.from({ length: 4 }, (_, depth) => {
  const narrowed = constraints && availability;
  const child =
    depth === 0 ? '{ id: string }' : `${name}['pages']['depths'][${depth - 1}]`;
  const suffix = `${name}${depth}`;
  return `
type Read${suffix} = ${name}['pages']['depths'][${depth}];
type Child${suffix} = ${child};
type Single${suffix} = Assert<SameShape<Read${suffix}['mustRef'], Child${suffix}${narrowed ? '' : ' | null'}>>;
type OptionalSingle${suffix} = Assert<SameShape<Read${suffix}['mayRef'], Child${suffix} | null>>;
type Many${suffix} = Assert<SameShape<Read${suffix}['mustRefs'], ${narrowed ? `[Child${suffix}, ...Child${suffix}[]]` : `Child${suffix}[]`}>>;
type Minimum${suffix} = Assert<SameShape<Read${suffix}['minimumRefs'], ${narrowed ? `[Child${suffix}, ...Child${suffix}[]]` : `Child${suffix}[]`}>>;
type OptionalMany${suffix} = Assert<SameShape<Read${suffix}['mayRefs'], Child${suffix}[]>>;
type ZeroMany${suffix} = Assert<SameShape<Read${suffix}['zeroRefs'], Child${suffix}[]>>;
type Title${suffix} = Assert<SameShape<Read${suffix}['title'], ${constraints ? 'string' : 'string | null | undefined'}>>;
${narrowed ? '// @ts-expect-error both guarantees exclude null from required references\n' : ''}const missing${suffix}: Pick<Read${suffix}, 'mustRef'> = { mustRef: null };
${narrowed ? '// @ts-expect-error both guarantees exclude empty required arrays\n' : ''}const emptyRequired${suffix}: Pick<Read${suffix}, 'mustRefs'> = { mustRefs: [] };
${narrowed ? '// @ts-expect-error a positive minimum also excludes empty arrays\n' : ''}const emptyMinimum${suffix}: Pick<Read${suffix}, 'minimumRefs'> = { minimumRefs: [] };
const optional${suffix}: Pick<Read${suffix}, 'mayRef' | 'mayRefs' | 'zeroRefs' | 'details'> = { mayRef: null, mayRefs: [], zeroRefs: [], details: null };
type Section${suffix} = Extract<NonNullable<Read${suffix}['blocks']>[number], { fieldId: 'section' }>;
type Group${suffix} = Extract<NonNullable<Section${suffix}['groups']>[number], { fieldId: 'group' }>;
type Link${suffix} = Extract<NonNullable<Group${suffix}['items']>[number], { fieldId: 'link' }>;
type NestedSingle${suffix} = Assert<SameShape<Link${suffix}['target'], Child${suffix}${narrowed ? '' : ' | null'}${constraints ? '' : ' | undefined'}>>;
type NestedMany${suffix} = Assert<SameShape<Link${suffix}['targets'], ${narrowed ? `[Child${suffix}, ...Child${suffix}[]]` : `Child${suffix}[]`}${constraints ? '' : ' | undefined'}>>;
type ObjectSingle${suffix} = Assert<SameShape<${name}['settings']['depths'][${depth}]['mustRef'], Child${suffix}${narrowed ? '' : ' | null'}>>;
type ObjectMany${suffix} = Assert<SameShape<${name}['settings']['depths'][${depth}]['minimumRefs'], ${narrowed ? `[Child${suffix}, ...Child${suffix}[]]` : `Child${suffix}[]`}>>;
declare const child${suffix}: Child${suffix};
const valid${suffix}: Pick<Read${suffix}, 'mustRef' | 'mustRefs' | 'minimumRefs'> = { mustRef: child${suffix}, mustRefs: [child${suffix}], minimumRefs: [child${suffix}] };
`;
}).join('\n')}
`,
  )
  .join('\n')}
`;
  await writeFile(join(directory, 'usage.ts'), source);
  for (const options of [[], ['--exactOptionalPropertyTypes']])
    checkTypes([join(directory, 'usage.ts')], options);
});
