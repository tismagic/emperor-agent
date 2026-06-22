const PREFIX = '--backend-url='

// Pull the backend base url that main.ts injects via webPreferences
// additionalArguments. Returns '' when absent (renderer then falls back to
// same-origin, used by the dev server).
export function parseBackendArg(argv: string[]): string {
  const hit = argv.find((a) => a.startsWith(PREFIX))
  return hit ? hit.slice(PREFIX.length) : ''
}
