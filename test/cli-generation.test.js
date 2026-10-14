import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../dist/cli.js';
import { apis, schemas } from './helpers/sample-schemas.mjs';

const configSource = (config) => `export default ${JSON.stringify(config)};\n`;

async function configArgs(folder, output, options = {}) {
  const configPath = join(folder, 'config.ts');
  await writeFile(
    configPath,
    configSource({
      services: {
        main: {
          serviceDomain: 'sample',
          apiKey: 'secret-key',
          output,
          ...options,
        },
      },
    }),
  );
  return ['--config', configPath];
}

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'microcms-typegen-output-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('service read rules reach generated output and invalid rules fail before fetching', async (t) => {
  const folder = await workspace(t);
  const output = join(folder, 'types.ts');
  let requests = 0;
  const dependencies = {
    requestIntervalMs: 0,
    fetchImpl: async (url) => {
      requests++;
      return {
        ok: true,
        json: async () =>
          url.endsWith('/apis')
            ? { apis: [{ endpoint: 'blogs', type: 'list' }] }
            : {
                apiFields: [{ fieldId: 'title', kind: 'text', required: true }],
                customFields: [],
              },
      };
    },
  };
  let options = await configArgs(folder, output);
  await run(['generate', ...options], dependencies);
  assert.match(await readFile(output, 'utf8'), /title\?: string \| null/);
  options = await configArgs(folder, output, {
    typeRules: { trustReadFieldConstraints: true },
  });
  await assert.rejects(run(['check', ...options], dependencies), /out of date/);
  await run(['generate', ...options], dependencies);
  assert.match(await readFile(output, 'utf8'), /title: string/);
  assert.doesNotMatch(
    await readFile(output, 'utf8'),
    /title\?: string \| null/,
  );
  await run(['check', ...options], dependencies);
  const before = requests;
  options = await configArgs(folder, output, {
    typeRules: { trustReadFieldConstraints: 'true' },
  });
  await assert.rejects(
    run(['generate', ...options], dependencies),
    /must be a boolean/,
  );
  assert.equal(requests, before);
  for (const typeRules of [
    { trustReadReferenceAvailability: 'true' },
    { trustRequiredReadFields: true },
    { trustReadFieldConstraints: { enabled: true } },
    { trustReadFieldConstraints: { trustReferenceAvailability: 'true' } },
  ]) {
    options = await configArgs(folder, output, { typeRules });
    await assert.rejects(
      run(['generate', ...options], dependencies),
      /must be a boolean|Unknown .*option/,
    );
    assert.equal(requests, before);
  }
});

test('read rule defaults remain independent across services and processing order', async (t) => {
  const folder = await workspace(t);
  const config = join(folder, 'config.ts');
  const services = Object.fromEntries(
    ['trusted', 'omitted', 'explicitFalse'].map((name) => [
      name,
      {
        serviceDomain: 'sample',
        apiKey: 'TEST_ONLY',
        output: join(folder, `${name}.ts`),
        ...(name === 'omitted'
          ? {}
          : {
              typeRules: {
                trustReadFieldConstraints:
                  name === 'trusted'
                    ? { trustReferenceAvailability: true }
                    : false,
              },
            }),
      },
    ]),
  );
  const dependencies = {
    requestIntervalMs: 0,
    fetchImpl: async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith('/apis')
          ? { apis: [{ endpoint: 'items', type: 'list' }] }
          : {
              apiFields: [
                { fieldId: 'title', kind: 'text', required: true },
                {
                  fieldId: 'ref',
                  kind: 'relation',
                  referencedApiEndpoint: 'items',
                  required: true,
                },
              ],
              customFields: [],
            },
    }),
  };
  for (const order of [
    ['trusted', 'omitted', 'explicitFalse'],
    ['omitted', 'explicitFalse', 'trusted'],
  ]) {
    await writeFile(
      config,
      configSource({
        services: Object.fromEntries(
          order.map((name) => [name, services[name]]),
        ),
      }),
    );
    await run(['generate', '--config', config], dependencies);
    for (const name of order) {
      const output = await readFile(services[name].output, 'utf8');
      if (name === 'trusted') {
        assert.doesNotMatch(output, /title\?: string \| null/);
        assert.doesNotMatch(output, /ref: .*\| null;/);
      } else {
        assert.match(output, /title\?: string \| null/);
        assert.match(output, /ref: .*\| null;/);
      }
    }
    await run(['check', '--config', config], dependencies);
  }
});

test('output read failures are surfaced by generate and check without replacing the target', async (t) => {
  const directory = await workspace(t);
  const output = join(directory, 'directory.ts');
  const config = join(directory, 'config.ts');
  await mkdir(output);
  await writeFile(
    config,
    `export default ${JSON.stringify({ services: { main: { serviceDomain: 'sample', apiKey: 'TEST_ONLY', output } } })};`,
  );
  const fetchImpl = async () => new Response(JSON.stringify({ apis: [] }));
  for (const command of ['generate', 'check']) {
    await assert.rejects(
      run([command, '--config', config], { fetchImpl, requestIntervalMs: 0 }),
      { code: 'EISDIR' },
    );
    assert.deepEqual(await readdir(output), []);
  }
});

test('check detects missing and stale generated files without writing', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'microcms-typegen-check-test-'));
  const output = join(folder, 'types.ts');
  let fieldId = 'title';
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'blogs', type: 'list' }] }
        : { apiFields: [{ fieldId, kind: 'text' }], customFields: [] },
  });
  const options = await configArgs(folder, output);
  const dependencies = { fetchImpl, requestIntervalMs: 0 };

  await assert.rejects(
    run(['check', ...options], dependencies),
    /Generated types are out of date/,
  );
  await assert.rejects(stat(output), { code: 'ENOENT' });
  await assert.rejects(
    run(['check', ...options, '--force'], dependencies),
    /--force can only be used with generate/,
  );

  await run(['generate', ...options], dependencies);
  const original = await readFile(output, 'utf8');
  const before = await stat(output);
  await run(['check', ...options], dependencies);
  assert.equal((await stat(output)).mtimeMs, before.mtimeMs);

  fieldId = 'body';
  await assert.rejects(
    run(['check', ...options], dependencies),
    /Generated types are out of date/,
  );
  assert.equal(await readFile(output, 'utf8'), original);
});

test('check compares every configured service without writing files', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-check-multi-test-'),
  );
  const configPath = join(folder, 'config.ts');
  const first = join(folder, 'first.ts');
  const second = join(folder, 'second.ts');
  await writeFile(
    configPath,
    configSource({
      services: {
        first: { serviceDomain: 'first', apiKey: 'first-key', output: first },
        second: {
          serviceDomain: 'second',
          apiKey: 'second-key',
          output: second,
        },
      },
    }),
  );
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'blogs', type: 'list' }] }
        : { apiFields: [{ fieldId: 'title', kind: 'text' }], customFields: [] },
  });
  const dependencies = { fetchImpl, requestIntervalMs: 0 };
  await run(['generate', '--config', configPath], dependencies);
  const original = await readFile(first, 'utf8');
  await writeFile(second, '// stale\n');

  await assert.rejects(
    run(['check', '--config', configPath], dependencies),
    /Generated types are out of date/,
  );
  assert.equal(await readFile(first, 'utf8'), original);
  assert.equal(await readFile(second, 'utf8'), '// stale\n');
});

test('generate and check accept CRLF and mixed line endings without rewriting unchanged types', async (t) => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-line-endings-'),
  );
  t.after(() => rm(folder, { recursive: true, force: true }));
  const output = join(folder, 'types.ts');
  const options = await configArgs(folder, output);
  let fieldId = 'title';
  const dependencies = {
    requestIntervalMs: 0,
    fetchImpl: async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith('/apis')
          ? { apis: [{ endpoint: 'blogs', type: 'list' }] }
          : { apiFields: [{ fieldId, kind: 'text' }], customFields: [] },
    }),
  };
  await run(['generate', ...options], dependencies);
  const original = await readFile(output, 'utf8');
  let line = 0;
  for (const existing of [
    original.replace(/\n/g, '\r\n'),
    original.replace(/\n/g, () => (line++ % 2 === 0 ? '\r\n' : '\n')),
  ]) {
    fieldId = 'title';
    await writeFile(output, existing);
    const before = await stat(output);
    for (const command of ['check', 'generate']) {
      await run([command, ...options], dependencies);
      assert.equal(await readFile(output, 'utf8'), existing);
      assert.equal((await stat(output)).mtimeMs, before.mtimeMs);
    }
    fieldId = 'body';
    await assert.rejects(
      run(['check', ...options], dependencies),
      /Generated types are out of date/,
    );
    assert.equal(await readFile(output, 'utf8'), existing);
    await run(['generate', ...options], dependencies);
    const updated = await readFile(output, 'utf8');
    assert.notEqual(updated, original);
    assert.match(updated, /body\?: string/);
    assert.equal(updated.includes('\r\n'), false);
    await run(['check', ...options], dependencies);
  }
});

test('line ending handling keeps handwritten files and header lookalikes protected', async (t) => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-header-protection-'),
  );
  t.after(() => rm(folder, { recursive: true, force: true }));
  const output = join(folder, 'types.ts');
  const options = await configArgs(folder, output);
  const dependencies = {
    requestIntervalMs: 0,
    fetchImpl: async () => ({ ok: true, json: async () => ({ apis: [] }) }),
  };
  const header =
    '// This file is generated by microcms-typegen. Do not edit by hand.';
  for (const existing of [
    '// handwritten types\r\nexport type Blog = string;\r\n',
    `${header} extra text\r\n`,
    `${header}\r`,
  ]) {
    await writeFile(output, existing);
    await assert.rejects(
      run(['generate', ...options], dependencies),
      /Refusing to overwrite/,
    );
    assert.equal(await readFile(output, 'utf8'), existing);
  }
});

test('CLI protects an existing non-generated file and --force replaces it', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'microcms-typegen-force-test-'));
  const output = join(folder, 'types.ts');
  await writeFile(output, '// handwritten types\nexport type Blog = string;\n');
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'blog', type: 'list' }] }
        : { apiFields: [], customFields: [] },
  });
  const args = ['generate', ...(await configArgs(folder, output))];
  await assert.rejects(
    run([...args], { fetchImpl, requestIntervalMs: 0 }),
    /Refusing to overwrite .*--force/,
  );
  assert.equal(
    await readFile(output, 'utf8'),
    '// handwritten types\nexport type Blog = string;\n',
  );
  await run([...args, '--force'], { fetchImpl, requestIntervalMs: 0 });
  assert.match(
    await readFile(output, 'utf8'),
    /^\/\/ This file is generated by microcms-typegen/,
  );
  await run([...args], { fetchImpl, requestIntervalMs: 0 });
});

test('multi-service output protection checks all files before writing any', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-force-multi-test-'),
  );
  const configPath = join(folder, 'config.ts');
  const first = join(folder, 'first.ts');
  const second = join(folder, 'second.ts');
  await writeFile(second, '// handwritten\n');
  await writeFile(
    configPath,
    configSource({
      services: {
        first: { serviceDomain: 'first', apiKey: 'key', output: first },
        second: { serviceDomain: 'second', apiKey: 'key', output: second },
      },
    }),
  );
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'blog', type: 'list' }] }
        : { apiFields: [], customFields: [] },
  });
  await assert.rejects(
    run(['generate', '--config', configPath], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /Refusing to overwrite/,
  );
  await assert.rejects(stat(first), { code: 'ENOENT' });
  assert.equal(await readFile(second, 'utf8'), '// handwritten\n');
});

test('CLI does not overwrite an existing output when a relation target is missing', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'microcms-typegen-error-test-'));
  const output = join(folder, 'types.ts');
  const original = '// existing generated types\n';
  await writeFile(output, original);
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'draft', type: 'list' }] }
        : {
            apiFields: [
              {
                fieldId: 'related',
                kind: 'relation',
                referencedApiEndpoint: null,
              },
            ],
            customFields: [],
          },
  });
  await assert.rejects(
    run(['generate', ...(await configArgs(folder, output))], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /Relation target null in draft\.related was not found/,
  );
  assert.equal(await readFile(output, 'utf8'), original);
});

test('CLI fetches schemas, keeps API key out of output, and leaves identical files untouched', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'microcms-typegen-test-'));
  const output = join(folder, 'types.ts');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const body = url.endsWith('/apis')
      ? { apis }
      : schemas[url.split('/').at(-1)];
    return { ok: true, json: async () => body };
  };
  const args = [
    'generate',
    ...(await configArgs(folder, output, {
      serviceDomain: 'sample-service',
      endpoints: ['blogs'],
    })),
  ];
  await run([...args], { fetchImpl, requestIntervalMs: 0 });
  const first = await readFile(output, 'utf8');
  const firstStat = await stat(output);
  await run([...args], { fetchImpl, requestIntervalMs: 0 });
  const secondStat = await stat(output);
  assert.equal(firstStat.mtimeMs, secondStat.mtimeMs);
  assert.equal(first.includes('secret-key'), false);
  assert.equal(calls.length, 6);
  assert.ok(
    calls.every(
      ({ options }) => options.headers['X-MICROCMS-API-KEY'] === 'secret-key',
    ),
  );
  assert.ok(
    calls.every(({ url }) =>
      url.startsWith('https://sample-service.microcms-management.io/api/v1/'),
    ),
  );
});

test('services config with one service generates one output', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-single-config-test-'),
  );
  const configPath = join(folder, 'config.ts');
  const output = join(folder, 'types.ts');
  await writeFile(
    configPath,
    configSource({
      services: {
        main: {
          serviceDomain: 'single-service',
          apiKey: 'single-key',
          output,
          endpoints: ['news'],
        },
      },
    }),
  );
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'news', type: 'list' }] }
        : { apiFields: [{ fieldId: 'title', kind: 'text' }], customFields: [] },
  });
  await run(['generate', '--config', configPath], {
    fetchImpl,
    requestIntervalMs: 0,
  });
  const generated = await readFile(output, 'utf8');
  assert.match(
    generated,
    /export type News = __MicroCMSTypegenNewsRead<\{\}>;/,
  );
  assert.match(generated, /export type MainServiceSchema = \{/);
  assert.doesNotMatch(generated, /export type MicroCMSSchema/);
  await assert.rejects(
    run(['generate', '--config', configPath, '--service', 'missing'], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /Unknown service/,
  );

  await writeFile(
    configPath,
    configSource({
      services: {
        main: {
          serviceDomain: 'single-service',
          apiKey: 'single-key',
          output,
          endpoints: { news: { typeName: 'CustomNews' } },
        },
      },
    }),
  );
  await assert.rejects(
    run(['generate', '--config', configPath], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /endpoints must be a nonempty array/,
  );
});

test('service config passes extension field types to generate and check', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-extension-config-test-'),
  );
  const configPath = join(folder, 'config.ts');
  const output = join(folder, 'types.ts');
  await writeFile(
    configPath,
    configSource({
      services: {
        main: {
          serviceDomain: 'sample',
          apiKey: 'key',
          output,
          endpoints: ['blog'],
          extensionFieldTypes: {
            blog: {
              extension: { from: './extension-types', data: 'BlogExtension' },
            },
          },
        },
      },
    }),
  );
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith('/apis')
        ? { apis: [{ endpoint: 'blog', type: 'list' }] }
        : {
            apiFields: [{ fieldId: 'extension', kind: 'iframe' }],
            customFields: [],
          },
  });
  const dependencies = { fetchImpl, requestIntervalMs: 0 };
  await run(['generate', '--config', configPath], dependencies);
  const generated = await readFile(output, 'utf8');
  assert.match(
    generated,
    /import type \{ BlogExtension as __MicroCMSTypegenBlogExtensionData \}/,
  );
  assert.match(generated, /extension\?: __MicroCMSTypegenBlogExtensionData;/);
  assert.match(
    generated,
    /extension\?: __MicroCMSTypegenExtensionFieldWrite<__MicroCMSTypegenBlogExtensionData>;/,
  );
  await run(['check', '--config', configPath], dependencies);
});

test('multi-service config generates separate modules with independent names and keys', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'microcms-typegen-multi-test-'));
  const configPath = join(folder, 'config.ts');
  const corporateOutput = join(folder, 'corporate.ts');
  const blogOutput = join(folder, 'blog.ts');
  await writeFile(
    configPath,
    configSource({
      services: {
        corporate: {
          serviceDomain: 'corporate',
          apiKey: 'corporate-key',
          output: corporateOutput,
          endpoints: ['news'],
        },
        blog: {
          serviceDomain: 'blog',
          apiKey: 'blog-key',
          output: blogOutput,
          endpoints: ['posts'],
        },
      },
    }),
  );
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, key: options.headers['X-MICROCMS-API-KEY'] });
    const corporate = url.includes('corporate.microcms-management.io');
    return {
      ok: true,
      json: async () =>
        url.endsWith('/apis')
          ? { apis: [{ endpoint: corporate ? 'news' : 'posts', type: 'list' }] }
          : {
              apiFields: [
                {
                  fieldId: corporate ? 'corporateTitle' : 'blogTitle',
                  kind: 'text',
                },
              ],
              customFields: [],
            },
    };
  };
  await run(['generate', '--config', configPath], {
    fetchImpl,
    requestIntervalMs: 0,
  });
  const corporateTypes = await readFile(corporateOutput, 'utf8');
  const blogTypes = await readFile(blogOutput, 'utf8');
  assert.match(
    corporateTypes,
    /export type News = __MicroCMSTypegenNewsRead<\{\}>;/,
  );
  assert.match(
    blogTypes,
    /export type Posts = __MicroCMSTypegenPostsRead<\{\}>;/,
  );
  assert.match(corporateTypes, /export type CorporateServiceSchema = \{/);
  assert.match(blogTypes, /export type BlogServiceSchema = \{/);
  assert.match(corporateTypes, /corporateTitle\?: string \| null;/);
  assert.match(blogTypes, /blogTitle\?: string \| null;/);
  assert.doesNotMatch(corporateTypes, /blogTitle/);
  assert.doesNotMatch(blogTypes, /corporateTitle/);
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every(({ url, key }) =>
      url.includes('corporate.microcms-management.io')
        ? key === 'corporate-key'
        : key === 'blog-key',
    ),
  );
  assert.ok(
    !corporateTypes.includes('corporate-key') &&
      !blogTypes.includes('blog-key'),
  );

  calls.length = 0;
  await run(['generate', '--config', configPath, '--service', 'blog'], {
    fetchImpl,
    requestIntervalMs: 0,
  });
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(({ url }) => url.includes('blog.microcms-management.io')),
  );
});

test('multi-service generation leaves files untouched when a later service fails', async () => {
  const folder = await mkdtemp(
    join(tmpdir(), 'microcms-typegen-multi-error-test-'),
  );
  const output = join(folder, 'corporate.ts');
  const sharedOutput = join(folder, 'blog.ts');
  const configPath = join(folder, 'config.ts');
  await writeFile(output, '// previous output\n');
  await writeFile(
    configPath,
    configSource({
      services: {
        corporate: {
          serviceDomain: 'corporate',
          apiKey: 'corporate-key',
          output,
        },
        blog: {
          serviceDomain: 'blog',
          apiKey: 'blog-key',
          output: sharedOutput,
        },
      },
    }),
  );
  const fetchImpl = async (url) =>
    url.includes('blog.microcms-management.io')
      ? { ok: false, status: 403 }
      : {
          ok: true,
          json: async () =>
            url.endsWith('/apis')
              ? { apis: [{ endpoint: 'news', type: 'list' }] }
              : {
                  apiFields: [{ fieldId: 'title', kind: 'text' }],
                  customFields: [],
                },
        };
  await assert.rejects(
    run(['generate', '--config', configPath], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /HTTP 403/,
  );
  assert.equal(await readFile(output, 'utf8'), '// previous output\n');
  await assert.rejects(stat(sharedOutput), { code: 'ENOENT' });

  await writeFile(
    configPath,
    configSource({
      services: {
        corporate: {
          serviceDomain: 'corporate',
          apiKey: 'corporate-key',
          output,
        },
        blog: { serviceDomain: 'blog', apiKey: 'blog-key', output },
      },
    }),
  );
  await assert.rejects(
    run(['generate', '--config', configPath], {
      fetchImpl,
      requestIntervalMs: 0,
    }),
    /Multiple services use output/,
  );
});
