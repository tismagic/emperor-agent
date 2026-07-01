// Electron desktop talks to CoreApi over IPC. URL helpers remain for browser-only
// development and tests, where requests are same-origin.

interface EmperorBridge {
  selectDirectory?: () => Promise<string | null>
  invokeCore?: (operationKey: string, ...args: unknown[]) => Promise<unknown>
  onCoreEvent?: (listener: (event: unknown) => void) => () => void
}

function bridge(): EmperorBridge | undefined {
  return (globalThis as unknown as { window?: { emperor?: EmperorBridge } }).window?.emperor
}

function loc(): { protocol: string; host: string } {
  return (globalThis as unknown as { window: { location: { protocol: string; host: string } } }).window
    .location
}

export function backendBase(): string {
  return ''
}

export function getBackendToken(): string {
  return ''
}

export function apiUrl(path: string): string {
  return backendBase() + path
}

export function wsUrl(path: string): string {
  const { protocol, host } = loc()
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}${path}`
}

export async function selectDirectory(): Promise<string | null> {
  const picker = bridge()?.selectDirectory
  return typeof picker === 'function' ? picker() : null
}

export async function invokeCore(operationKey: string, ...args: unknown[]): Promise<unknown> {
  const invoke = bridge()?.invokeCore
  if (typeof invoke !== 'function') throw new Error('Core IPC bridge is unavailable')
  const result = await invoke(operationKey, ...args)
  const safeError = safeCoreIpcError(result)
  if (safeError) {
    const error = new Error(safeError.message) as Error & { errorId?: string; code?: string }
    if (safeError.errorId) error.errorId = safeError.errorId
    if (safeError.code) error.code = safeError.code
    throw error
  }
  return result
}

export function hasCoreBridge(): boolean {
  return typeof bridge()?.invokeCore === 'function'
}

export function onCoreEvent(listener: (event: unknown) => void): () => void {
  const subscribe = bridge()?.onCoreEvent
  if (typeof subscribe !== 'function') return () => {}
  return subscribe(listener)
}

function safeCoreIpcError(value: unknown): { message: string; errorId?: string; code?: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  if (payload.ok !== false) return null
  const rawError = payload.error
  if (!rawError || typeof rawError !== 'object' || Array.isArray(rawError)) return null
  const error = rawError as Record<string, unknown>
  const message = typeof error.message === 'string' && error.message ? error.message : 'Internal error'
  return {
    message,
    errorId: typeof error.errorId === 'string' ? error.errorId : undefined,
    code: typeof error.code === 'string' ? error.code : undefined,
  }
}
