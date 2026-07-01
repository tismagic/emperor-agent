import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSession } from './useSession'

const g = globalThis as unknown as { window?: any; fetch?: unknown }

afterEach(() => {
  delete g.window
  vi.restoreAllMocks()
})

describe('useSession IPC session routes (MIG-IPC-010)', () => {
  it('loads sessions through Core IPC when the bridge is available', async () => {
    const calls: unknown[][] = []
    g.window = {
      emperor: {
        invokeCore: async (...args: unknown[]) => {
          calls.push(args)
          return [{ id: 's1', title: 'Main', updated_at: '2026-01-01T00:00:00+08:00' }]
        },
      },
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const session = useSession()

    await session.load()

    expect(calls).toEqual([['sessions.list', { includeArchived: false }]])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(session.sessions.value.map((item) => item.id)).toEqual(['s1'])
    expect(session.activeId.value).toBe('s1')
  })
})
