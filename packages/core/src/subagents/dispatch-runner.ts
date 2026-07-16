import { buildRoutedRunner } from '../agent/runner-factory'
import type {
  AgentRunnerHookHost,
  CompactorLike,
  ControlManagerRunnerHost,
  MemoryStoreLike,
  TodoStoreLike,
  TokenTrackerLike,
} from '../agent/runner'
import type { ModelRouter } from '../model/router'
import type { ToolRegistry } from '../tools/registry'
import type {
  DispatchRunner,
  DispatchRunnerFactoryArgs,
} from '../tools/dispatch'
import {
  bindRunnerGoalRecordingContext,
  type RunnerGoalRecordingHost,
} from '../agent/runner-goal-recording'

export interface RoutedDispatchRunnerFactoryOptions {
  modelRouter: Pick<ModelRouter, 'route'>
  tokenTracker?: TokenTrackerLike | null
  memoryStore?: MemoryStoreLike | null
  compactor?: CompactorLike | null
  todoStore?: TodoStoreLike | null
  controlManager?: ControlManagerRunnerHost | null
  maxTokensCap?: number | null
  maxContext?: number | null
  hooks?:
    ((args: DispatchRunnerFactoryArgs) => AgentRunnerHookHost | null) | null
  goalObservationRecorder?: RunnerGoalRecordingHost | null
}

export function buildDispatchRunnerFactory(
  opts: RoutedDispatchRunnerFactoryOptions,
): (args: DispatchRunnerFactoryArgs) => DispatchRunner {
  return (args) => buildDispatchRunner(args, opts)
}

export function buildDispatchRunner(
  args: DispatchRunnerFactoryArgs,
  opts: RoutedDispatchRunnerFactoryOptions,
): DispatchRunner {
  const goalObservationRecorder =
    args.goalObservationRecorder ?? opts.goalObservationRecorder ?? null
  const route = opts.modelRouter.route('subagent', args.spec.name, args.task)
  const runner = buildRoutedRunner({
    route,
    registry: args.subRegistry as ToolRegistry,
    systemPrompt: args.spec.systemPrompt,
    tokenTracker: opts.tokenTracker ?? null,
    usageType: `subagent:${args.spec.name}`,
    maxTokensCap: opts.maxTokensCap ?? null,
    memoryStore: opts.memoryStore ?? null,
    compactor: opts.compactor ?? null,
    todoStore: opts.todoStore ?? null,
    controlManager: opts.controlManager ?? null,
    maxContext: opts.maxContext ?? route.snapshot.contextWindowTokens ?? null,
    maxTurns: args.spec.maxTurns,
    workspaceRoot: args.workspaceRoot ?? null,
    sessionId: args.sessionId,
    hooks: opts.hooks?.(args) ?? null,
    goalObservationRecorder:
      goalObservationRecorder && args.taskId && args.agentId && args.turnId
        ? bindRunnerGoalRecordingContext(goalObservationRecorder, {
            expectedGoalId: args.expectedGoalId,
            taskId: args.taskId,
            agentId: args.agentId,
            turnId: args.turnId,
          })
        : null,
  })
  return {
    step: (history) =>
      runner.stepAsync(history, {
        turnId: args.turnId ?? null,
        executionEnvironment: args.executionEnvironment ?? null,
      }),
  }
}
