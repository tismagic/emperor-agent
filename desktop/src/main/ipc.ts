import { randomUUID } from 'node:crypto'
import { channelForCoreOperation } from '../shared/ipc-contract'

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void
}

export type CoreApiLike = Record<string, unknown>

export function registerCoreIpc(
  ipcMain: IpcMainLike,
  coreApi: CoreApiLike,
  operationKeys: string[],
): void {
  for (const key of [...operationKeys].sort()) {
    ipcMain.handle(channelForCoreOperation(key), async (_event, ...args) => {
      try {
        return await invokeOperation(coreApi, key, args)
      } catch (error) {
        return safeIpcError(error, key)
      }
    })
  }
}

export async function invokeOperation(
  coreApi: CoreApiLike,
  operationKey: string,
  args: unknown[],
): Promise<unknown> {
  const { fn, receiver } = resolveOperation(coreApi, operationKey)
  if (typeof fn !== 'function')
    throw new Error(`CoreApi operation not found: ${operationKey}`)
  return await Reflect.apply(fn, receiver, args)
}

function resolveOperation(
  coreApi: CoreApiLike,
  operationKey: string,
): { fn: unknown; receiver: unknown } {
  let current: unknown = coreApi
  let receiver: unknown = coreApi
  for (const part of operationKey.split('.')) {
    receiver = current
    current =
      current && typeof current === 'object'
        ? (current as Record<string, unknown>)[part]
        : undefined
  }
  return { fn: current, receiver }
}

function safeIpcError(
  error: unknown,
  operationKey: string,
): Record<string, unknown> {
  const interruption = benignTurnInterruption(error)
  if (interruption) return { ok: false, error: interruption }

  const domain = safeDomainError(error)
  if (domain) return { ok: false, error: domain }

  const errorId = `ipc_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[core-ipc] ${operationKey} failed (${errorId})`, error)
  }
  return {
    ok: false,
    error: {
      message: 'Internal error',
      errorId,
    },
  }
}

function safeDomainError(
  error: unknown,
): { message: string; code: string; action?: string } | null {
  if (!error || typeof error !== 'object') return null
  const toSafe = (error as { toSafe?: unknown }).toSafe
  if (typeof toSafe !== 'function') return null
  const payload = toSafe.call(error)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null
  const record = payload as Record<string, unknown>
  const message =
    typeof record.message === 'string' && record.message ? record.message : ''
  const code = typeof record.code === 'string' && record.code ? record.code : ''
  if (!message || !code) return null
  return {
    message,
    code,
    ...(typeof record.action === 'string' && record.action
      ? { action: record.action }
      : {}),
  }
}

function benignTurnInterruption(
  error: unknown,
): { message: string; code: string } | null {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name || '')
      : ''
  if (name === 'TurnPaused')
    return { message: 'Turn paused', code: 'turn_paused' }
  if (name === 'CancelledTaskError')
    return { message: 'Task cancelled', code: 'cancelled' }
  if (name === 'TurnBusyError')
    return {
      message: 'Another agent turn is already running',
      code: 'turn_busy',
    }
  return null
}
