// Resolve the backend base url. When the desktop preload injected
// window.emperor.backendBaseUrl (app:// production load), we use it to build
// absolute /api and /ws urls. Otherwise (Vite dev server, same-origin) we keep
// paths relative and derive the websocket origin from window.location.

interface EmperorBridge {
  backendBaseUrl?: string
  backendToken?: string
  selectDirectory?: () => Promise<string | null>
}

function bridge(): EmperorBridge | undefined {
  return (globalThis as unknown as { window?: { emperor?: EmperorBridge } }).window?.emperor
}

function loc(): { protocol: string; host: string } {
  return (globalThis as unknown as { window: { location: { protocol: string; host: string } } }).window
    .location
}

export function backendBase(): string {
  const injected = bridge()?.backendBaseUrl
  return typeof injected === 'string' ? injected : ''
}

// Per-launch token injected by the packaged Electron app (empty in dev). Sent as a
// header on fetch and as a query param on the WebSocket (browsers cannot set ws headers).
export function getBackendToken(): string {
  const injected = bridge()?.backendToken
  return typeof injected === 'string' ? injected : ''
}

export function apiUrl(path: string): string {
  return backendBase() + path
}

export function wsUrl(path: string): string {
  const base = backendBase()
  const { protocol, host } = base ? { protocol: '', host: '' } : loc()
  const raw = base
    ? base.replace(/^http/, 'ws') + path
    : `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}${path}`
  const token = getBackendToken()
  if (!token) return raw
  return `${raw}${raw.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

export async function selectDirectory(): Promise<string | null> {
  const picker = bridge()?.selectDirectory
  return typeof picker === 'function' ? picker() : null
}
