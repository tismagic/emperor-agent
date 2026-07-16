import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { slashCommands } from '../commands'
import type {
  BootstrapPayload,
  GoalOperationResult,
  RuntimeGoalSummary,
} from '../types'
import { useSlashCommands, type SlashCommandDeps } from './useSlashCommands'

function summary(): RuntimeGoalSummary {
  return {
    id: 'goal_1',
    status: 'active',
    phase: 'executing',
    outcome: '完成升级',
    sessionId: 'session_1',
    currentPlanId: null,
    cyclesUsed: 1,
    acceptance: { passed: 0, failed: 0, missing: 1, total: 1 },
    updatedAt: '2026-07-16T10:00:00.000Z',
    lastEventSeq: 1,
  }
}

function setup(active: RuntimeGoalSummary | null = null) {
  const local = vi.fn()
  const startGoal = vi.fn(async (): Promise<GoalOperationResult> => ({
    accepted: true,
    goal: summary(),
    activeTask: null,
  }))
  const runGoalAction = vi.fn(async (): Promise<GoalOperationResult> => ({
    accepted: true,
    goal: summary(),
    activeTask: null,
  }))
  const deps: SlashCommandDeps = {
    boot: ref(null as BootstrapPayload | null),
    configContent: ref(''),
    busy: ref(false),
    pending: { label: '', detail: '' },
    routeName: () => 'chat',
    runtimeText: () => 'ready',
    eventTransportText: () => 'ipc',
    sendMessage: vi.fn(() => true),
    addLocalCommand: local,
    clearChat: vi.fn(),
    stopActive: vi.fn(async () => true),
    compactMemory: vi.fn(),
    restoreMemoryVersion: vi.fn(),
    refreshAll: vi.fn(),
    showToast: vi.fn(),
    currentGoal: () => active,
    startGoal,
    listGoals: vi.fn(async () => (active ? [active] : [])),
    getGoal: vi.fn(async () => active || summary()),
    runGoalAction,
  } as unknown as SlashCommandDeps
  return { ...useSlashCommands(deps), deps, local, startGoal, runGoalAction }
}

function command(name: '/goal' | '/goals') {
  return slashCommands.find((item) => item.name === name)!
}

describe('Goal slash command orchestration', () => {
  it('starts a Goal through the typed operation instead of chat.submit', async () => {
    const ctx = setup()
    await ctx.executeSlashCommand('/goal 完成升级', '/goal', command('/goal'))
    expect(ctx.startGoal).toHaveBeenCalledWith('完成升级')
    expect(ctx.deps.sendMessage).not.toHaveBeenCalled()
    expect(ctx.local.mock.calls.at(-1)?.[1]).toContain('完成升级')
  })

  it('routes list and lifecycle controls to their typed operations', async () => {
    const active = summary()
    const ctx = setup(active)
    await ctx.executeSlashCommand('/goals', '/goals', command('/goals'))
    expect(ctx.deps.listGoals).toHaveBeenCalledOnce()
    await ctx.executeSlashCommand('/goal status', '/goal', command('/goal'))
    expect(ctx.deps.getGoal).toHaveBeenCalledWith('goal_1')
    await ctx.executeSlashCommand('/goal pause', '/goal', command('/goal'))
    await ctx.executeSlashCommand('/goal resume', '/goal', command('/goal'))
    await ctx.executeSlashCommand('/goal cancel', '/goal', command('/goal'))
    expect(ctx.runGoalAction.mock.calls).toEqual([
      ['goal_1', 'pause'],
      ['goal_1', 'resume'],
      ['goal_1', 'cancel'],
    ])
  })

  it('keeps missing and duplicate starts local and actionable', async () => {
    const missing = setup()
    await missing.executeSlashCommand('/goal', '/goal', command('/goal'))
    expect(missing.startGoal).not.toHaveBeenCalled()
    expect(missing.local.mock.calls.at(-1)?.[1]).toContain('请提供 Outcome')

    const duplicate = setup(summary())
    await duplicate.executeSlashCommand(
      '/goal 新目标',
      '/goal',
      command('/goal'),
    )
    expect(duplicate.startGoal).not.toHaveBeenCalled()
    expect(duplicate.local.mock.calls.at(-1)?.[1]).toContain('已有 active Goal')
  })
})
