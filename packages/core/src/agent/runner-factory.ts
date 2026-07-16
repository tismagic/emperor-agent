/**
 * runner_factory (MIG-CORE-010)。对齐 Python `agent/runner_factory.py:build_routed_runner`。
 * 按单一激活模型构造 AgentRunner，供主 Agent、子代理和 Team 复用。
 */
import type { LLMProvider } from '../providers/base'
import type { ModelRoute } from '../model/router'
import type { PromptContextPlan, PromptSectionInput } from '../prompts/manifest'
import type { ToolRegistry } from '../tools/registry'
import {
  AgentRunner,
  type CompactorLike,
  type ControlManagerRunnerHost,
  type AgentRunnerHookHost,
  type MemoryStoreLike,
  type TodoStoreLike,
  type TokenTrackerLike,
} from './runner'
import type { RunnerGoalRecordingHost } from './runner-goal-recording'
import type { GoalContextProvider } from '../context/pipeline'
import type { GoalToolHost } from '../goals/tools'

export function buildRoutedRunner(opts: {
  route: ModelRoute
  registry: ToolRegistry
  systemPrompt: string
  tokenTracker: TokenTrackerLike | null
  usageType: string
  maxTokensCap?: number | null
  memoryStore?: MemoryStoreLike | null
  compactor?: CompactorLike | null
  todoStore?: TodoStoreLike | null
  controlManager?: ControlManagerRunnerHost | null
  maxContext?: number | null
  maxTurns?: number
  workspaceRoot?: string | null
  promptSections?: PromptSectionInput[] | null
  promptContextPlan?: PromptContextPlan | null
  promptSnapshotDir?: string | null
  sessionId?: string | null
  streamingToolExecution?: boolean
  hooks?: AgentRunnerHookHost | null
  goalObservationRecorder?: RunnerGoalRecordingHost | null
  goalToolHost?: Pick<GoalToolHost, 'visibleToolNames'> | null
  goalContextProvider?: GoalContextProvider | null
  goalContextHint?:
    | (() => Promise<{
        readonly goalId: string
        readonly lastEventSeq: number
      } | null>)
    | null
  onGoalCompacted?: (() => void) | null
}): AgentRunner {
  const snapshot = opts.route.snapshot
  let maxTokens = snapshot.generation.maxTokens
  if (opts.maxTokensCap !== null && opts.maxTokensCap !== undefined) {
    maxTokens = Math.min(opts.maxTokensCap, maxTokens)
  }
  return new AgentRunner({
    provider: snapshot.provider as unknown as LLMProvider,
    model: snapshot.model,
    registry: opts.registry,
    systemPrompt: opts.systemPrompt,
    maxTokens,
    temperature: snapshot.generation.temperature,
    reasoningEffort: snapshot.generation.reasoningEffort,
    providerName: snapshot.providerName,
    modelEntryId: snapshot.modelEntryId ?? snapshot.entryName,
    supportsToolCall: snapshot.profile?.toolCall ?? true,
    routeReason: opts.route.reason,
    routeEstimatedTokens: opts.route.estimatedTokens,
    usageType: opts.usageType,
    memoryStore: opts.memoryStore ?? null,
    tokenTracker: opts.tokenTracker,
    compactor: opts.compactor ?? null,
    todoStore: opts.todoStore ?? null,
    controlManager: opts.controlManager ?? null,
    maxContext:
      opts.maxContext ??
      snapshot.profile?.contextWindowTokens ??
      snapshot.contextWindowTokens,
    maxTurns: opts.maxTurns ?? 12,
    workspaceRoot: opts.workspaceRoot ?? null,
    promptSections: opts.promptSections ?? null,
    promptContextPlan: opts.promptContextPlan ?? null,
    promptSnapshotDir: opts.promptSnapshotDir ?? null,
    sessionId: opts.sessionId ?? null,
    streamingToolExecution: opts.streamingToolExecution ?? false,
    hooks: opts.hooks ?? null,
    goalObservationRecorder: opts.goalObservationRecorder ?? null,
    goalToolHost: opts.goalToolHost ?? null,
    goalContextProvider: opts.goalContextProvider ?? null,
    goalContextHint: opts.goalContextHint ?? null,
    onGoalCompacted: opts.onGoalCompacted ?? null,
  })
}
