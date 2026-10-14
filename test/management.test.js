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

test('Management API errors do not include the API key', async () => {
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(
    client.listApis(),
    (error) =>
      error.message.includes('403') && !error.message.includes('secret-key'),
  );
});

test('Management API retries HTTP 429', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    fetchImpl: async () => {
      requests++;
      return requests === 1
        ? { ok: false, status: 429, headers: { get: () => '0' } }
        : { ok: true, status: 200, json: async () => ({ apis: [] }) };
    },
  });
  assert.deepEqual(await client.listApis(), []);
  assert.equal(requests, 2);
});

test('Management API retries temporary server and network errors', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      if (requests === 1)
        throw new TypeError('secret-key should not be exposed');
      if (requests === 2) return { ok: false, status: 503 };
      return { ok: true, status: 200, json: async () => ({ apis: [] }) };
    },
  });
  assert.deepEqual(await client.listApis(), []);
  assert.equal(requests, 3);
});

test('Management API does not retry permission errors and gives a useful hint', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      return { ok: false, status: 403 };
    },
  });
  await assert.rejects(
    client.listApis(),
    (error) =>
      error.message.includes('HTTP 403') &&
      error.message.includes('API information permission') &&
      !error.message.includes('secret-key'),
  );
  assert.equal(requests, 1);
});

test('Management API times out and reports the failure without exposing the key', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => {
      requests++;
      await new Promise((_, reject) => {
        const keepAlive = setTimeout(
          () => reject(new Error('Abort signal did not fire')),
          100,
        );
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(keepAlive);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
  });
  await assert.rejects(
    client.listApis(),
    (error) =>
      error.message.includes('timed out after 5 ms') &&
      !error.message.includes('secret-key'),
  );
  assert.equal(requests, 5);
});

test('Management API retries a connection failure while reading a successful response body', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      return requests === 1
        ? new Response(
            new ReadableStream({
              start(controller) {
                controller.error(
                  new TypeError('secret-key connection terminated'),
                );
              },
            }),
          )
        : new Response(JSON.stringify({ apis: [] }));
    },
  });
  assert.deepEqual(await client.listApis(), []);
  assert.equal(requests, 2);
});

test('Management API limits response body network retries and masks error details', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('secret-key connection terminated'));
          },
        }),
      );
    },
  });
  await assert.rejects(
    client.getSchema('blogs'),
    (error) =>
      error.message.includes(
        'apis/blogs failed due to a network error after 5 attempts',
      ) && !error.message.includes('secret-key'),
  );
  assert.equal(requests, 5);
});

test('Management API reports response body timeouts and retries within the same limit', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => {
      requests++;
      return new Response(
        new ReadableStream({
          start(controller) {
            const keepAlive = setTimeout(
              () => controller.error(new Error('Abort signal did not fire')),
              100,
            );
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(keepAlive);
                controller.error(signal.reason);
              },
              { once: true },
            );
          },
        }),
      );
    },
  });
  await assert.rejects(
    client.listApis(),
    (error) =>
      error.message.includes('timed out after 5 ms') &&
      !error.message.includes('secret-key'),
  );
  assert.equal(requests, 5);
});

test('Management API distinguishes invalid JSON from transient response body failures', async () => {
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      return new Response('{"secret-key":');
    },
  });
  await assert.rejects(
    client.listApis(),
    (error) => error.message === 'Management API apis returned invalid JSON',
  );
  assert.equal(requests, 1);
});

test('Management API releases unused HTTP error bodies before retrying or failing', async () => {
  const canceled = [];
  const statuses = [429, 503, 403];
  let requests = 0;
  const client = createManagementClient({
    serviceDomain: 'sample',
    apiKey: 'secret-key',
    requestIntervalMs: 0,
    retryDelayMs: 0,
    fetchImpl: async () => {
      const status = statuses[requests++];
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('Unused error body'));
          },
          cancel() {
            canceled.push(status);
          },
        }),
        { status, headers: { 'Retry-After': '0' } },
      );
    },
  });
  await assert.rejects(client.listApis(), /HTTP 403/);
  assert.equal(requests, 3);
  assert.deepEqual(canceled, statuses);
});
