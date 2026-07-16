import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActiveTaskRegistry } from '../../runtime/active'
import { GoalCoordinator } from '../../goals/coordinator'
import { GoalStore } from '../../goals/store'
import { GoalService } from './goal-service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'goal-service-'))
  roots.push(root)
  const goalStore = new GoalStore(root)
  const activeTasks = new ActiveTaskRegistry()
  const runTurn = vi.fn(async () => {})
  const coordinator = new GoalCoordinator({ goalStore, activeTasks, runTurn })
  const sessions = new Map([
    [
      'session-1',
      { id: 'session-1', mode: 'build' as const, project_id: 'project-1' },
    ],
    ['session-2', { id: 'session-2', mode: 'chat' as const, project_id: null }],
  ])
  const service = new GoalService({
    goalStore,
    coordinator,
    activeTasks,
    materializeSession: async ({ sessionId }) => {
      const session = sessions.get(sessionId)
      if (!session) throw new Error('session not found')
      return session
    },
    requireReadableSession: (sessionId) => {
      const session = sessions.get(sessionId)
      if (!session) throw new Error('session not found')
      return session
    },
    scopeForSession: (session) => ({
      sessionId: session.id,
      mode: session.mode,
      projectId: session.project_id,
      workspaceRoot: root,
    }),
  })
  return { service, coordinator, runTurn }
}

describe('GoalService', () => {
  it('creates and launches a Goal without waiting for its lifecycle', async () => {
    const f = fixture()
    const result = await f.service.start({
      outcome: 'Ship the typed Goal API',
      sessionId: 'session-1',
    })

    expect(result).toMatchObject({
      accepted: true,
      goal: { outcome: 'Ship the typed Goal API', sessionId: 'session-1' },
      activeTask: { kind: 'goal', session_id: 'session-1' },
    })
    await f.coordinator.pause(result.goal.id, 'test_cleanup')
  })

  it('fences list/get and mutations to the owner session', async () => {
    const f = fixture()
    const started = await f.service.start({
      outcome: 'Private goal',
      sessionId: 'session-1',
    })
    await f.coordinator.pause(started.goal.id, 'test_pause')

    expect(await f.service.list({ sessionId: 'session-1' })).toHaveLength(1)
    await expect(
      f.service.get(started.goal.id, 'session-2'),
    ).rejects.toMatchObject({
      code: 'goal_session_mismatch',
    })
    await expect(
      f.service.resume(started.goal.id, 'session-2'),
    ).rejects.toMatchObject({
      code: 'goal_session_mismatch',
    })
  })

  it('caps recent summaries at fifty with stable newest-first ordering', async () => {
    const f = fixture()
    const list = vi.spyOn((f.service as any).options.goalStore, 'list')
    await f.service.list({ sessionId: 'session-1' })
    expect(list).toHaveBeenCalledOnce()
  })

  it('atomically reserves the single running Goal across concurrent sessions', async () => {
    const f = fixture()
    const results = await Promise.allSettled([
      f.service.start({ outcome: 'First Goal', sessionId: 'session-1' }),
      f.service.start({ outcome: 'Second Goal', sessionId: 'session-2' }),
    ])
    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof f.service.start>>
      > => result.status === 'fulfilled',
    )
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({ code: 'goal_mutation_busy' })
    await f.coordinator.pause(fulfilled[0]!.value.goal.id, 'test_cleanup')
  })
})
