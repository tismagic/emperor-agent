const PREFIX = '--backend-url='
const TOKEN_PREFIX = '--backend-token='

// Pull the backend base url that main.ts injects via webPreferences
// additionalArguments. Returns '' when absent (renderer then falls back to
// same-origin, used by the dev server).
export function parseBackendArg(argv: string[]): string {
  const hit = argv.find((a) => a.startsWith(PREFIX))
  return hit ? hit.slice(PREFIX.length) : ''
}

// Pull the per-launch auth token main.ts injects (packaged app only). Returns ''
// when absent (dev / standalone), in which case the backend runs token-free.
export function parseBackendToken(argv: string[]): string {
  const hit = argv.find((a) => a.startsWith(TOKEN_PREFIX))
  return hit ? hit.slice(TOKEN_PREFIX.length) : ''
}
