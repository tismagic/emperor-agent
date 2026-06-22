const BOOTSTRAP_PATH = "/api/bootstrap";

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Single readiness check: GET <baseUrl>/api/bootstrap. Returns true only on a
// 2xx response. Connection refusals, timeouts and non-2xx are all normalized to
// false so callers can simply retry without try/catch noise.
async function probeBackend(baseUrl, { fetchFn = fetch, timeoutMs = 1500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${baseUrl}${BOOTSTRAP_PATH}`, { signal: controller.signal });
    return Boolean(res && res.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Poll until the backend is ready or the retry budget is exhausted. Rejects with
// a human-readable Error (surfaced by main.js in a dialog) on total failure.
async function waitForBackend(
  baseUrl,
  {
    fetchFn = fetch,
    retries = 40,
    intervalMs = 250,
    sleep = defaultSleep,
    probe = probeBackend,
  } = {},
) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    // probeBackend ignores the extra timeoutMs default; fetchFn is forwarded so
    // tests can inject a stub probe or a stub fetch interchangeably.
    if (await probe(baseUrl, { fetchFn })) return;
    if (attempt < retries) await sleep(intervalMs);
  }
  throw new Error(
    `Backend did not become ready at ${baseUrl} after ${retries} attempts (${retries * intervalMs}ms).`,
  );
}

module.exports = { probeBackend, waitForBackend };
