import { spawnSync } from 'node:child_process';
import { compilerBinary } from '../test/helpers/type-compiler.mjs';

const tests = [
  'config-types',
  'generated-types',
  'field-types',
  'relation-depth',
  'captured-schemas',
  'live-schema-values',
].map((name) => `test/${name}.test.js`);
const binary = compilerBinary();
const version = spawnSync(process.execPath, [binary, '--version'], {
  encoding: 'utf8',
});
if (version.error || version.status !== 0)
  throw new Error(version.stderr || version.error?.message);
console.log(`Checking consumers with ${version.stdout.trim()}`);
const project = spawnSync(
  process.execPath,
  [binary, '--project', 'tsconfig.json', '--pretty', 'false'],
  {
    stdio: 'inherit',
  },
);
if (project.error) throw project.error;
if (project.status !== 0) process.exit(project.status ?? 1);
const result = spawnSync(process.execPath, ['--test', ...tests], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
