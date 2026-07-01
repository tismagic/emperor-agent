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
            modelConfig: { config: { agents: { defaults: { provider: 'fake' } } } },
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

  it('imports skill archives through Core IPC when the preload bridge is available', async () => {
    const calls: unknown[][] = []
    g.window = {
      emperor: {
        invokeCore: async (...args: unknown[]) => {
          calls.push(args)
          if (args[0] === 'skills.importArchive') return { imported: 'demo-skill' }
          return { app: 'Emperor Agent' }
        },
      },
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const boot = useBootstrap(() => {})
    const data = new FormData()
    data.append('file', new File(['zip-bytes'], 'demo.zip', { type: 'application/zip' }))

    await expect(boot.importSkill(data)).resolves.toBe('demo-skill')

    expect(calls[0]?.[0]).toBe('skills.importArchive')
    expect(calls[0]?.[1]).toMatchObject({ name: 'demo.zip' })
    expect(calls[0]?.[1]).toHaveProperty('raw')
    expect(calls.at(-1)).toEqual(['bootstrap', { sessionId: null }])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
