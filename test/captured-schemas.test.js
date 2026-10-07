import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createManagementClient } from '../dist/management.js';
import { collectSchemas } from '../dist/generate.js';
import { checkTypes } from './helpers/type-compiler.mjs';

test('captured Management API schemas generate the checked-in sample types', async () => {
  const fixture = JSON.parse(await readFile(new URL('../examples/schemas.json', import.meta.url), 'utf8'));
  const client = createManagementClient({
    serviceDomain: 'offline', apiKey: 'FIXTURE_ONLY', requestIntervalMs: 0,
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      const payload = path === '/api/v1/apis' ? fixture.listing : fixture.schemas[path.split('/').at(-1)];
      assert.ok(payload, `Unexpected mock request ${path}`);
      return { ok: true, json: async () => structuredClone(payload) };
    },
  });
  const endpoints = fixture.listing.apis.map(api => api.endpoint);
  const generated = await collectSchemas(client, endpoints, { serviceName: 'example' });
  const path = new URL('../examples/microcms-types.ts', import.meta.url);
  assert.equal(generated, await readFile(path, 'utf8'));
  checkTypes([fileURLToPath(path)], ['--exactOptionalPropertyTypes']);
});
