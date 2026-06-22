// Resolve the backend base url. When the desktop preload injected
// window.emperor.backendBaseUrl (app:// production load), we use it to build
// absolute /api and /ws urls. Otherwise (Vite dev server, same-origin) we keep
// paths relative and derive the websocket origin from window.location.

interface EmperorBridge {
  backendBaseUrl?: string
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

export function apiUrl(path: string): string {
  return backendBase() + path
}

export function wsUrl(path: string): string {
  const base = backendBase()
  if (base) return base.replace(/^http/, 'ws') + path
  const { protocol, host } = loc()
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProto}//${host}${path}`
}
