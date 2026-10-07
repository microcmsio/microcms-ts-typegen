import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, platform, arch, cpus } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { generateTypes } from '../dist/generate.js';
import { compilerBinary } from '../test/helpers/type-compiler.mjs';

const fixture = JSON.parse(await readFile(new URL('../examples/schemas.json', import.meta.url), 'utf8'));
function synthetic(count, fields, cyclic) {
  const apis = Array.from({ length: count }, (_, index) => ({ endpoint: `endpoint_${index}`, type: 'list' }));
  const schemas = new Map(apis.map((api, index) => [api.endpoint, {
    apiFields: [
      ...Array.from({ length: fields }, (_, index) => ({ fieldId: `field_${index}`, kind: index % 3 === 0 ? 'number' : 'text' })),
      { fieldId: 'parent', kind: 'relation', referencedApiEndpoint: apis[(index + 1) % count].endpoint },
      ...(cyclic ? [
        { fieldId: 'children', kind: 'relationList', referencedApiEndpoint: api.endpoint },
        { fieldId: 'custom', kind: 'custom', customFieldId: 'branch' },
        { fieldId: 'blocks', kind: 'repeater', customFieldIds: ['branch'] },
      ] : []),
    ],
    customFields: cyclic ? [{ fieldId: 'branch', fields: [
      { fieldId: 'label', kind: 'text' },
      { fieldId: 'target', kind: 'relation', referencedApiEndpoint: api.endpoint },
    ] }] : [],
  }]));
  return { apis, schemas };
}
const scenarios = [
  { name: 'captured-service', apis: fixture.listing.apis, schemas: new Map(Object.entries(fixture.schemas)) },
  { name: 'wide-service', ...synthetic(50, 100, false) },
  { name: 'cyclic-service', ...synthetic(10, 20, true) },
];
const report = { node: process.version, platform: `${platform()}/${arch()}`, cpu: cpus()[0]?.model, repeats: 3, scenarios: [] };
const temporary = await mkdtemp(join(tmpdir(), 'microcms-type-performance-'));
try {
  for (const scenario of scenarios) {
    const generated = generateTypes(scenario.apis, scenario.schemas, { serviceName: 'benchmark' });
    const calls = [];
    for (const api of scenario.apis) {
      const field = scenario.schemas.get(api.endpoint).apiFields[0].fieldId;
      for (const depth of [0, 1, 2, 3]) {
        calls.push(`type Full_${calls.length} = BenchmarkServiceSchema['${api.endpoint}']['depths'][${depth}];`);
        calls.push(`type Selected_${calls.length} = Pick<BenchmarkServiceSchema['${api.endpoint}']['depths'][${depth}], '${field}'>;`);
      }
      if (scenario.name !== 'captured-service') {
        calls.push(`type Nested_${calls.length} = NonNullable<NonNullable<NonNullable<BenchmarkServiceSchema['${api.endpoint}']['depths'][3]['parent']>['parent']>['parent']>['field_0'];`);
        calls.push(`const path_${calls.length}: BenchmarkServiceSchema['${api.endpoint}']['fieldPaths'] = 'parent.field_1';`);
        calls.push(`const write_${calls.length}: BenchmarkServiceSchema['${api.endpoint}']['create'] = { field_0: 1, parent: 'id' };`);
      }
    }
    await writeFile(join(temporary, 'generated.ts'), generated);
    await writeFile(join(temporary, 'usage.ts'), `import type { BenchmarkServiceSchema } from './generated';\n${calls.join('\n')}\n`);
    const measurements = [];
    const binary = compilerBinary();
    const version = spawnSync(process.execPath, [binary, '--version'], { encoding: 'utf8' }).stdout.trim();
    for (let repeat = 0; repeat < report.repeats; repeat++) {
      const start = performance.now();
      const result = spawnSync(process.execPath, [binary, '--ignoreConfig', '--pretty', 'false', '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--extendedDiagnostics', join(temporary, 'usage.ts')], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
      if (result.status !== 0) throw new Error(result.stdout + result.stderr + (result.error?.message ?? ''));
      const diagnostics = Object.fromEntries(result.stdout.split('\n').flatMap(line => {
        const match = line.match(/^([^:]+):\s*(.+?)\s*$/);
        return match ? [[match[1], match[2]]] : [];
      }));
      measurements.push({ version, repeat: repeat + 1, elapsedMs: Math.round(performance.now() - start), diagnostics });
    }
    const item = { name: scenario.name, apis: scenario.apis.length, fields: [...scenario.schemas.values()].reduce((count, schema) => count + schema.apiFields.length + schema.customFields.reduce((count, custom) => count + custom.fields.length, 0), 0), statements: calls.length, generatedBytes: Buffer.byteLength(generated), measurements };
    report.scenarios.push(item);
    console.log(JSON.stringify(item));
  }
  console.log(JSON.stringify({ environment: { ...report, scenarios: undefined } }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
