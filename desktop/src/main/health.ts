const BOOTSTRAP_PATH = '/api/bootstrap'

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean }>

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface ProbeOptions {
  fetchFn?: FetchLike
  timeoutMs?: number
}

// Single readiness check: GET <baseUrl>/api/bootstrap. Returns true only on a
// 2xx response. Connection refusals, timeouts and non-2xx are all normalized to
// false so callers can simply retry without try/catch noise.
export async function probeBackend(
  baseUrl: string,
  { fetchFn = fetch as unknown as FetchLike, timeoutMs = 1500 }: ProbeOptions = {},
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(`${baseUrl}${BOOTSTRAP_PATH}`, { signal: controller.signal })
    return Boolean(res && res.ok)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export interface WaitOptions {
  fetchFn?: FetchLike
  retries?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  probe?: (baseUrl: string, opts: ProbeOptions) => Promise<boolean>
}

// Poll until the backend is ready or the retry budget is exhausted. Rejects with
// a human-readable Error (surfaced by main.ts in a dialog) on total failure.
export async function waitForBackend(
  baseUrl: string,
  {
    fetchFn = fetch as unknown as FetchLike,
    retries = 40,
    intervalMs = 250,
    sleep = defaultSleep,
    probe = probeBackend,
  }: WaitOptions = {},
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    if (await probe(baseUrl, { fetchFn })) return
    if (attempt < retries) await sleep(intervalMs)
  }
  throw new Error(
    `Backend did not become ready at ${baseUrl} after ${retries} attempts (${retries * intervalMs}ms).`,
  )
}
