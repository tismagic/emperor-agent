import { describe, it, expect, afterEach } from 'vitest'
import { backendBase, apiUrl, wsUrl, getBackendToken, invokeCore, onCoreEvent } from './backend'

const g = globalThis as unknown as { window?: unknown }

afterEach(() => {
  delete g.window
})

describe('same-origin fallback urls', () => {
  it('keeps api paths relative and derives ws from location', () => {
    g.window = { location: { protocol: 'http:', host: 'localhost:5173' } }
    expect(backendBase()).toBe('')
    expect(apiUrl('/api/bootstrap')).toBe('/api/bootstrap')
    expect(wsUrl('/ws?x=1')).toBe('ws://localhost:5173/ws?x=1')
  })
})

describe('backend token', () => {
  it('is empty because desktop no longer injects backend auth', () => {
    g.window = { location: { protocol: 'http:', host: 'localhost:5173' } }
    expect(getBackendToken()).toBe('')
    expect(wsUrl('/ws?x=1')).toBe('ws://localhost:5173/ws?x=1')
  })
})

describe('with an injected Core IPC bridge', () => {
  it('delegates invokeCore to the preload bridge', async () => {
    const calls: unknown[][] = []
    g.window = {
      emperor: {
        invokeCore: async (...args: unknown[]) => {
          calls.push(args)
          return { ok: true }
        },
      },
    }

    await expect(invokeCore('bootstrap', { sessionId: 's1' })).resolves.toEqual({ ok: true })
    expect(calls).toEqual([['bootstrap', { sessionId: 's1' }]])
  })

  it('throws safe Core IPC errors instead of returning them as successful payloads', async () => {
    g.window = {
      emperor: {
        invokeCore: async () => ({
          ok: false,
          error: { message: 'Internal error', errorId: 'ipc_abc123' },
        }),
      },
    }

    await expect(invokeCore('model.test')).rejects.toMatchObject({
      message: 'Internal error',
      errorId: 'ipc_abc123',
    })
  })

  it('delegates onCoreEvent to the preload bridge', () => {
    const events: unknown[] = []
    const unsubscribe = () => { events.push('off') }
    g.window = {
      emperor: {
        onCoreEvent: (listener: (event: unknown) => void) => {
          listener({ event: 'ready' })
          return unsubscribe
        },
      },
    }

    expect(onCoreEvent((event) => { events.push(event) })).toBe(unsubscribe)
    expect(events).toEqual([{ event: 'ready' }])
  })
})
