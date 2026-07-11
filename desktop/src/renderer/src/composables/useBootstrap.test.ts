import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBootstrap } from './useBootstrap'

const g = globalThis as unknown as { window?: unknown; fetch?: unknown }

afterEach(() => {
  delete g.window
  vi.restoreAllMocks()
})

describe('useBootstrap IPC bootstrap (MIG-IPC-004)', () => {
  it('loads bootstrap through Core IPC when the preload bridge is available', async () => {
    const calls: unknown[][] = []
    g.window = {
      emperor: {
        invokeCore: async (...args: unknown[]) => {
          calls.push(args)
          return {
            app: 'Emperor Agent',
            modelConfig: {
              config: { agents: { defaults: { provider: 'fake' } } },
            },
          }
        },
      },
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const boot = useBootstrap(() => {})

    await boot.loadBootstrap(true, 'session-1')

    expect(calls).toEqual([['bootstrap', { sessionId: 'session-1' }]])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(boot.boot.value?.app).toBe('Emperor Agent')
    expect(boot.modelDraftProvider.value).toBe('fake')
  })
})
