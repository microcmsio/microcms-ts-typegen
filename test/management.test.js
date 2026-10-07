import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManagementClient,
  validateEndpoint,
} from '../dist/management.js';

const defaults = {
  serviceDomain: 'sample-site',
  apiKey: 'TEST_ONLY',
  requestIntervalMs: 0,
  retryDelayMs: 0,
};
const json = (value) => new Response(JSON.stringify(value));

test('Management API validates credentials and timeouts before sending requests', () => {
  for (const serviceDomain of [
    undefined,
    null,
    '',
    '-site',
    'site-',
    'Site',
    'https://site.microcms.io',
    'site/path',
  ]) {
    assert.throws(
      () => createManagementClient({ ...defaults, serviceDomain }),
      /serviceDomain must be a microCMS service ID/,
    );
  }
  for (const apiKey of [undefined, null, '', '  ', 123]) {
    assert.throws(
      () => createManagementClient({ ...defaults, apiKey }),
      /API key with API information permission is required/,
    );
  }
  for (const timeoutMs of [0, -1, NaN, Infinity]) {
    assert.throws(
      () => createManagementClient({ ...defaults, timeoutMs }),
      /timeoutMs must be a positive number/,
    );
  }
});

test('endpoints accept API identifiers and reject paths or query injection', async () => {
  for (const endpoint of ['blogs', 'all_fields', 'news-2026', 'API']) {
    assert.equal(validateEndpoint(endpoint), endpoint);
  }
  for (const endpoint of [
    undefined,
    null,
    '',
    123,
    'a/b',
    '../blogs',
    'blogs?key=x',
    'blogs#x',
    'blogs x',
  ]) {
    assert.throws(() => validateEndpoint(endpoint), /Invalid endpoint/);
    const client = createManagementClient({
      ...defaults,
      fetchImpl: async () =>
        assert.fail('Invalid endpoints must not be requested'),
    });
    await assert.rejects(client.getSchema(endpoint), /Invalid endpoint/);
  }
});

test('Management API sends the service URL, authentication header and abort signal', async () => {
  const calls = [];
  const schema = { apiFields: [], customFields: [] };
  const client = createManagementClient({
    ...defaults,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return json(
        url.endsWith('/apis')
          ? { apis: [{ endpoint: 'news-2026', type: 'object' }] }
          : schema,
      );
    },
  });
  assert.deepEqual(await client.listApis(), [
    { endpoint: 'news-2026', type: 'object' },
  ]);
  assert.deepEqual(await client.getSchema('news-2026'), schema);
  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      'https://sample-site.microcms-management.io/api/v1/apis',
      'https://sample-site.microcms-management.io/api/v1/apis/news-2026',
    ],
  );
  for (const { options } of calls) {
    assert.deepEqual(options.headers, { 'X-MICROCMS-API-KEY': 'TEST_ONLY' });
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
  }
});

test('Management API rejects malformed list and schema envelopes', async () => {
  for (const payload of [null, [], {}, { apis: null }, { apis: {} }]) {
    const client = createManagementClient({
      ...defaults,
      fetchImpl: async () => json(payload),
    });
    await assert.rejects(
      client.listApis(),
      /Management API returned an invalid API list/,
    );
  }
  const invalidEndpoint = createManagementClient({
    ...defaults,
    fetchImpl: async () =>
      json({ apis: [{ endpoint: '../bad', type: 'list' }] }),
  });
  await assert.rejects(invalidEndpoint.listApis(), /Invalid endpoint/);
  for (const payload of [
    null,
    [],
    {},
    { apiFields: [] },
    { apiFields: null, customFields: [] },
    { apiFields: [], customFields: {} },
  ]) {
    const client = createManagementClient({
      ...defaults,
      fetchImpl: async () => json(payload),
    });
    await assert.rejects(
      client.getSchema('blogs'),
      /Management API returned an invalid schema for blogs/,
    );
  }
});

test('HTTP failures stop after the appropriate attempt count and provide actionable hints', async (t) => {
  for (const [status, attempts, hint] of [
    [400, 1, 'API IP restrictions'],
    [403, 1, 'API information permission'],
    [404, 1, 'service ID and API endpoint'],
    [418, 1, 'HTTP 418.'],
    [429, 5, 'Rate limit exceeded after retries'],
    [500, 5, 'Server error after retries'],
  ]) {
    await t.test(`HTTP ${status}`, async () => {
      let calls = 0;
      const client = createManagementClient({
        ...defaults,
        fetchImpl: async () => {
          calls++;
          return new Response('TEST_ONLY must never appear in the error', {
            status,
          });
        },
      });
      await assert.rejects(client.listApis(), (error) => {
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.ok(error.message.includes(hint));
        assert.ok(!error.message.includes(defaults.apiKey));
        return true;
      });
      assert.equal(calls, attempts);
    });
  }
});

test('Retry-After and exponential backoff use bounded delays without waiting in tests', async (t) => {
  const delays = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    delays.push(delay);
    queueMicrotask(callback);
  });
  for (const [retryAfter, expected] of [
    [null, 1000],
    ['invalid', 1000],
    ['0', 0],
    ['-1', 0],
    ['0.25', 250],
    ['9999', 30000],
  ]) {
    delays.length = 0;
    let calls = 0;
    const client = createManagementClient({
      ...defaults,
      retryDelayMs: 1000,
      fetchImpl: async () => {
        if (++calls === 2) return json({ apis: [] });
        return new Response('', {
          status: 429,
          headers: retryAfter === null ? {} : { 'Retry-After': retryAfter },
        });
      },
    });
    assert.deepEqual(await client.listApis(), []);
    assert.deepEqual(delays, expected ? [expected] : []);
    assert.equal(calls, 2);
  }
  delays.length = 0;
  const client = createManagementClient({
    ...defaults,
    retryDelayMs: 10000,
    fetchImpl: async () => new Response('', { status: 503 }),
  });
  await assert.rejects(client.listApis(), /Server error after retries/);
  assert.deepEqual(delays, [10000, 20000, 30000, 30000]);
});

test('consecutive requests respect the default request interval', async (t) => {
  let now = 100000;
  const delays = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    delays.push(delay);
    now += delay;
    queueMicrotask(callback);
  });
  const client = createManagementClient({
    serviceDomain: defaults.serviceDomain,
    apiKey: defaults.apiKey,
    fetchImpl: async () => json({ apis: [] }),
  });
  await client.listApis();
  await client.listApis();
  assert.deepEqual(delays, [1100]);
});

test('network failures without Error objects remain masked and bounded', async () => {
  let calls = 0;
  const client = createManagementClient({
    ...defaults,
    fetchImpl: async () => {
      calls++;
      throw 'TEST_ONLY private transport error';
    },
  });
  await assert.rejects(
    client.listApis(),
    (error) =>
      error.message ===
      'Management API apis failed due to a network error after 5 attempts. Check the network and try again.',
  );
  assert.equal(calls, 5);
});
