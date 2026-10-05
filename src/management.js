const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const ENDPOINT = /^[a-zA-Z0-9_-]+$/;

export function validateEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !ENDPOINT.test(endpoint)) {
    throw new Error(`Invalid endpoint: ${JSON.stringify(endpoint)}`);
  }
  return endpoint;
}

export function createManagementClient({ serviceDomain, apiKey, fetchImpl = fetch, requestIntervalMs = 1100, timeoutMs = 30000, retryDelayMs = 1000 }) {
  if (typeof serviceDomain !== 'string' || !DOMAIN.test(serviceDomain)) {
    throw new Error('serviceDomain must be a microCMS service ID such as demo-site, without https:// or .microcms.io');
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('An API key with API information permission is required');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive number');

  let lastRequestAt = 0;
  async function wait(milliseconds) {
    if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function get(path) {
    const url = `https://${serviceDomain}.microcms-management.io/api/v1/${path}`;
    let response;
    for (let attempt = 0; attempt < 5; attempt++) {
      await wait(Math.max(0, lastRequestAt + requestIntervalMs - Date.now()));
      lastRequestAt = Date.now();
      let readingBody = false;
      try {
        response = await fetchImpl(url, {
          headers: { 'X-MICROCMS-API-KEY': apiKey },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) {
          readingBody = true;
          return await response.json();
        }
      } catch (error) {
        if (readingBody && error?.name === 'SyntaxError') {
          throw new Error(`Management API ${path} returned invalid JSON`);
        }
        if (attempt < 4) {
          await wait(Math.min(30000, retryDelayMs * 2 ** attempt));
          continue;
        }
        const cause = error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `timed out after ${timeoutMs} ms`
          : 'failed due to a network error';
        throw new Error(`Management API ${path} ${cause} after 5 attempts. Check the network and try again.`);
      }
      // No error body is used. Release it before another request or a terminal error.
      await response.body?.cancel().catch(() => {});
      if (response.status !== 429 && response.status < 500) break;
      if (attempt === 4) break;
      const retryAfter = response.headers?.get?.('retry-after');
      const seconds = Number(retryAfter);
      await wait(retryAfter != null && Number.isFinite(seconds)
        ? Math.min(30000, Math.max(0, seconds * 1000))
        : Math.min(30000, retryDelayMs * 2 ** attempt));
    }
    if (!response.ok) {
      const hint = response.status === 400
        ? ' Check the request and API IP restrictions.'
        : response.status === 403
          ? ' Check the Management API key and its API information permission.'
          : response.status === 404
            ? ' Check the service ID and API endpoint.'
            : response.status === 429
              ? ' Rate limit exceeded after retries; try again later.'
              : response.status >= 500
                ? ' Server error after retries; try again later.'
                : '';
      throw new Error(`Management API ${path} returned HTTP ${response.status}.${hint}`);
    }
  }

  return {
    async listApis() {
      const result = await get('apis');
      if (!Array.isArray(result?.apis)) throw new Error('Management API returned an invalid API list');
      return result.apis.map((api) => ({
        endpoint: validateEndpoint(api.endpoint),
        type: api.type,
      }));
    },
    async getSchema(endpoint) {
      const result = await get(`apis/${encodeURIComponent(validateEndpoint(endpoint))}`);
      if (!Array.isArray(result?.apiFields) || !Array.isArray(result?.customFields)) {
        throw new Error(`Management API returned an invalid schema for ${endpoint}`);
      }
      return result;
    },
  };
}
