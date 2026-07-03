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

  it('creates a hidden local draft without POSTing to Core (P1-6)', async () => {
    const calls: unknown[][] = []
    g.window = {
      emperor: {
        invokeCore: async (...args: unknown[]) => {
          calls.push(args)
          return { ok: true }
        },
      },
    }
    const session = useSession()

    const created = await session.create({ mode: 'chat', title: '新会话' })

    expect(calls).toEqual([])
    expect(created.draft).toBe(true)
    expect(created.id.startsWith('draft:')).toBe(true)
    expect(session.activeId.value).toBe(created.id)
    expect(session.getSession(created.id)).toMatchObject({ draft: true, mode: 'chat' })
  })

  it('creates a local draft when loading an empty session list (P1-6)', async () => {
    const calls: unknown[][] = []
    g.window = {
      emperor: {
        invokeCore: async (...args: unknown[]) => {
          calls.push(args)
          if (args[0] === 'sessions.list') return []
          return { ok: true }
        },
      },
    }
    const session = useSession()

    await session.load()

    expect(calls).toEqual([['sessions.list', { includeArchived: false }]])
    expect(session.activeId.value.startsWith('draft:')).toBe(true)
  })

  it('keeps build project metadata on the draft for the first submit (P1-6)', async () => {
    const calls: unknown[][] = []
    g.window = {
      emperor: {
        invokeCore: async (...args: unknown[]) => {
          calls.push(args)
          return { ok: true }
        },
      },
    }
    const session = useSession()

    const created = await session.create({
      mode: 'build',
      title: '构建 demo',
      project: {
        project_id: 'project_1',
        project_path: '/tmp/demo',
        project_name: 'demo',
      },
    })

    expect(calls).toEqual([])
    expect(created).toMatchObject({
      draft: true,
      mode: 'build',
      project_id: 'project_1',
      project_path: '/tmp/demo',
      project_name: 'demo',
    })
  })

  it('updates local session control pending tags from runtime control events', async () => {
    g.window = {
      emperor: {
        invokeCore: async () => [
          { id: 's1', title: 'Main', updated_at: '2026-01-01T00:00:00+08:00', preview: '', version: 1 },
        ],
      },
    }
    const session = useSession()
    await session.load()

    session.applySessionControlPending('s1', {
      id: 'ask_1',
      kind: 'ask',
      status: 'waiting',
    })
    expect(session.sessions.value[0]?.control_pending).toEqual({
      kind: 'ask',
      label: '需要用户输入',
      tone: 'blue',
      interaction_id: 'ask_1',
      updated_at: expect.any(Number),
    })

    session.applySessionControlPending('s1', {
      id: 'ask_1',
      kind: 'ask',
      status: 'answered',
    })
    expect(session.sessions.value[0]?.control_pending).toBeNull()
  })
})
