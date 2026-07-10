import { createHash } from 'node:crypto'
import { HookAuditStore } from './audit'
import { HookSnapshotStore, HookSourceResolver } from './config'
import {
  CommandHookExecutor,
  HookExecutorRegistry,
  HttpHookExecutor,
} from './executor'
import { buildHookInput, compileHookPlan } from './matcher'
import {
  AgentHookExecutor,
  PromptHookExecutor,
  RoutedHookModelGateway,
  type HookModelRouter,
} from './model-executor'
import type {
  HookAggregateDecision,
  HookDecision,
  HookEventName,
  HookExecutionResult,
  HookDiagnostic,
  HookSnapshot,
  HooksConfigV2,
} from './models'
import {
  AsyncHookRegistry,
  HookOnceRegistry,
  HookOrchestrator,
  type HookOrchestratorEmitter,
} from './orchestrator'
import type { HookRuntimeRunOptions } from './runtime'
import type { TokenTrackerLike } from '../agent/runner'
import { writeJsonAtomic } from '../store/atomic-json'
import { parseHooksConfigV2, serializeHooksConfigV2 } from './schema'

interface ActiveTurnSnapshot {
  turnId: string
  sessionId: string
  projectRoot: string | null
  snapshot: HookSnapshot
}

export interface HookAgentScope {
  agentId: string
  agentType: string
  sessionId: string
  cwd: string
  projectRoot: string | null
  snapshot: HookSnapshot
}

export class HookService {
  readonly stateRoot: string
  readonly resolver: HookSourceResolver
  readonly snapshots: HookSnapshotStore
  readonly executors: HookExecutorRegistry
  readonly audit: HookAuditStore
  readonly once = new HookOnceRegistry()
  readonly background = new AsyncHookRegistry()
  private readonly turns = new Map<string, ActiveTurnSnapshot>()
  private readonly activeTurnBySession = new Map<string, string>()
  private readonly agentScopes = new Map<string, HookAgentScope>()

  constructor(opts: {
    stateRoot: string
    executors?: HookExecutorRegistry
    modelRouter?: HookModelRouter | null
    tokenTracker?: Pick<TokenTrackerLike, 'record'> | null
  }) {
    this.stateRoot = opts.stateRoot
    this.resolver = new HookSourceResolver({ stateRoot: opts.stateRoot })
    this.snapshots = new HookSnapshotStore({
      resolver: this.resolver,
      reviewCandidate: async (previous, candidate, scope) =>
        await this.reviewSnapshotCandidate(previous, candidate, scope),
    })
    this.audit = new HookAuditStore(opts.stateRoot)
    this.executors =
      opts.executors ??
      defaultExecutors(opts.modelRouter ?? null, opts.tokenTracker ?? null)
  }

  async beginTurn(opts: {
    turnId: string
    sessionId: string
    projectRoot?: string | null
  }): Promise<HookSnapshot> {
    const snapshot = await this.snapshots.get({
      projectRoot: opts.projectRoot ?? null,
      sessionId: opts.sessionId,
    })
    const active = {
      turnId: opts.turnId,
      sessionId: opts.sessionId,
      projectRoot: opts.projectRoot ?? null,
      snapshot,
    }
    this.turns.set(opts.turnId, active)
    this.activeTurnBySession.set(opts.sessionId, opts.turnId)
    return snapshot
  }

  endTurn(turnId: string): void {
    const active = this.turns.get(turnId)
    if (!active) return
    this.turns.delete(turnId)
    if (this.activeTurnBySession.get(active.sessionId) === turnId)
      this.activeTurnBySession.delete(active.sessionId)
  }

  activeSnapshot(sessionId: string): HookSnapshot | null {
    const turnId = this.activeTurnBySession.get(sessionId)
    return turnId ? (this.turns.get(turnId)?.snapshot ?? null) : null
  }

  async beginAgentScope(opts: {
    agentId: string
    agentType: string
    sessionId: string
    cwd: string
    projectRoot?: string | null
  }): Promise<HookAgentScope> {
    if (this.agentScopes.has(opts.agentId))
      throw new Error(`hook agent scope already exists: ${opts.agentId}`)
    const snapshot =
      this.activeSnapshot(opts.sessionId) ??
      (await this.snapshots.get({
        sessionId: opts.sessionId,
        projectRoot: opts.projectRoot ?? null,
      }))
    const scope: HookAgentScope = {
      agentId: opts.agentId,
      agentType: opts.agentType,
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      projectRoot: opts.projectRoot ?? null,
      snapshot,
    }
    this.agentScopes.set(opts.agentId, scope)
    return scope
  }

  agentScope(agentId: string): HookAgentScope | null {
    return this.agentScopes.get(agentId) ?? null
  }

  get agentScopeCount(): number {
    return this.agentScopes.size
  }

  endAgentScope(agentId: string): void {
    this.agentScopes.delete(agentId)
  }

  async runAgent(
    eventName: HookEventName,
    agentId: string,
    opts: Omit<HookRuntimeRunOptions, 'sessionId' | 'cwd'> &
      Partial<Pick<HookRuntimeRunOptions, 'sessionId' | 'cwd'>>,
    runOpts: { emit?: HookOrchestratorEmitter | null } = {},
  ): Promise<HookAggregateDecision> {
    const scope = this.agentScopes.get(agentId)
    if (!scope) throw new Error(`unknown hook agent scope: ${agentId}`)
    return await this.run(
      eventName,
      {
        ...opts,
        sessionId: scope.sessionId,
        cwd: opts.cwd || scope.cwd,
        projectRoot: scope.projectRoot,
        agentId: scope.agentId,
        agentType: scope.agentType,
      },
      { snapshot: scope.snapshot, emit: runOpts.emit ?? null },
    )
  }

  mayMatchAgent(
    eventName: HookEventName,
    agentId: string,
    opts: HookRuntimeRunOptions,
  ): boolean {
    const scope = this.agentScopes.get(agentId)
    if (!scope) return true
    const input = this.input(eventName, {
      ...opts,
      sessionId: scope.sessionId,
      cwd: opts.cwd || scope.cwd,
      projectRoot: scope.projectRoot,
      agentId: scope.agentId,
      agentType: scope.agentType,
    })
    return compileHookPlan(scope.snapshot, input).items.length > 0
  }

  async snapshot(opts: {
    sessionId: string
    projectRoot?: string | null
  }): Promise<HookSnapshot> {
    return await this.snapshots.get({
      sessionId: opts.sessionId,
      projectRoot: opts.projectRoot ?? null,
    })
  }

  async authorizeConfigChange(opts: {
    source: string
    candidateRevision: string
    sessionId: string
    cwd: string
    projectRoot?: string | null
    snapshot?: HookSnapshot | null
  }): Promise<HookAggregateDecision> {
    const snapshot =
      opts.snapshot ??
      this.activeSnapshot(opts.sessionId) ??
      (await this.snapshots.get({
        sessionId: opts.sessionId,
        projectRoot: opts.projectRoot ?? null,
      }))
    return await this.run(
      'ConfigChange',
      {
        sessionId: opts.sessionId,
        cwd: opts.cwd,
        projectRoot: opts.projectRoot ?? null,
        source: opts.source,
        candidateRevision: opts.candidateRevision,
      },
      { snapshot },
    )
  }

  async saveGlobalConfig(
    raw: unknown,
    opts: {
      expectedRevision?: string | null
      sessionId?: string
      cwd?: string
      projectRoot?: string | null
    } = {},
  ): Promise<{
    saved: boolean
    config: HooksConfigV2
    snapshot: HookSnapshot
    diagnostics: HookDiagnostic[]
    decision: HookAggregateDecision
  }> {
    const parsed = parseHooksConfigV2(raw, { sourceKind: 'global' })
    const scope = {
      sessionId: opts.sessionId ?? '',
      projectRoot: opts.projectRoot ?? null,
    }
    const previous = await this.snapshots.get(scope)
    if (opts.expectedRevision && previous.revision !== opts.expectedRevision) {
      throw new Error(
        `stale hooks revision: expected ${opts.expectedRevision}, current ${previous.revision}`,
      )
    }
    const candidateRevision = hashValue(serializeHooksConfigV2(parsed.config))
    const decision = parsed.diagnostics.length
      ? emptyDecision('invalid hooks configuration')
      : await this.authorizeConfigChange({
          source: 'hooks.saveConfig',
          candidateRevision,
          sessionId: scope.sessionId,
          cwd: opts.cwd ?? process.cwd(),
          projectRoot: scope.projectRoot,
          snapshot: previous,
        })
    if (
      parsed.diagnostics.length ||
      decision.decision === 'deny' ||
      decision.decision === 'ask'
    ) {
      return {
        saved: false,
        config: parsed.config,
        snapshot: previous,
        diagnostics: parsed.diagnostics,
        decision,
      }
    }
    await writeJsonAtomic(
      this.resolver.globalConfigPath,
      serializeHooksConfigV2(parsed.config),
    )
    const candidate = await this.resolver.resolve(scope)
    this.snapshots.accept(candidate, scope)
    return {
      saved: true,
      config: parsed.config,
      snapshot: candidate,
      diagnostics: parsed.diagnostics,
      decision,
    }
  }

  mayMatch(eventName: HookEventName, opts: HookRuntimeRunOptions): boolean {
    const snapshot = this.snapshotFromActiveTurn(opts)
    if (!snapshot) return true
    const input = this.input(eventName, opts)
    return compileHookPlan(snapshot, input).items.length > 0
  }

  async run(
    eventName: HookEventName,
    opts: HookRuntimeRunOptions,
    runOpts: {
      snapshot?: HookSnapshot | null
      emit?: HookOrchestratorEmitter | null
    } = {},
  ): Promise<HookAggregateDecision> {
    const snapshot =
      runOpts.snapshot ??
      this.snapshotFromActiveTurn(opts) ??
      (await this.snapshots.get({
        sessionId: opts.sessionId,
        projectRoot: opts.projectRoot ?? null,
      }))
    const input = this.input(eventName, opts)
    const plan = compileHookPlan(snapshot, input)
    const orchestrator = new HookOrchestrator({
      executor: this.executors,
      audit: this.audit,
      emit: runOpts.emit ?? null,
      once: this.once,
      background: this.background,
    })
    const result = await orchestrator.run(plan, input, {
      eventName,
      cwd: opts.cwd || process.cwd(),
      policy: snapshot.config.policy,
      signal: opts.signal ?? null,
    })
    return legacyAggregate(result)
  }

  clearSession(sessionId: string): void {
    const turnId = this.activeTurnBySession.get(sessionId)
    if (turnId) this.endTurn(turnId)
    this.resolver.sessionRegistry.clear(sessionId)
    this.once.clearSession(sessionId)
    for (const [agentId, scope] of this.agentScopes) {
      if (scope.sessionId === sessionId) this.agentScopes.delete(agentId)
    }
  }

  async shutdown(): Promise<void> {
    await this.background.shutdown()
    this.turns.clear()
    this.activeTurnBySession.clear()
    this.agentScopes.clear()
    this.once.clear()
  }

  private snapshotFromActiveTurn(
    opts: HookRuntimeRunOptions,
  ): HookSnapshot | null {
    const turnId =
      typeof opts.turnId === 'string'
        ? opts.turnId
        : this.activeTurnBySession.get(opts.sessionId)
    return turnId ? (this.turns.get(turnId)?.snapshot ?? null) : null
  }

  private input(
    eventName: HookEventName,
    opts: HookRuntimeRunOptions,
  ): Record<string, unknown> {
    return buildHookInput(eventName, {
      ...opts,
      stateRoot: opts.stateRoot ?? this.stateRoot,
    })
  }

  private async reviewSnapshotCandidate(
    previous: HookSnapshot | null,
    candidate: HookSnapshot,
    scope: { projectRoot?: string | null; sessionId?: string | null },
  ): Promise<boolean> {
    if (!previous) return true
    const decision = await this.authorizeConfigChange({
      source: 'external_config_change',
      candidateRevision: candidate.revision,
      sessionId: String(scope.sessionId ?? ''),
      cwd: scope.projectRoot ?? process.cwd(),
      projectRoot: scope.projectRoot ?? null,
      snapshot: previous,
    })
    return decision.decision !== 'deny' && decision.decision !== 'ask'
  }
}

function defaultExecutors(
  modelRouter: HookModelRouter | null,
  tokenTracker: Pick<TokenTrackerLike, 'record'> | null,
): HookExecutorRegistry {
  const registry = new HookExecutorRegistry()
  registry.register(new CommandHookExecutor())
  registry.register(new HttpHookExecutor())
  if (modelRouter) {
    const gateway = new RoutedHookModelGateway(modelRouter, tokenTracker)
    registry.register(new PromptHookExecutor(gateway))
    registry.register(new AgentHookExecutor(gateway))
  }
  return registry
}

function legacyAggregate(
  result: Awaited<ReturnType<HookOrchestrator['run']>>,
): HookAggregateDecision {
  const results: HookExecutionResult[] = result.results.map((entry) => ({
    hookId: entry.handlerId,
    hookRunId: entry.hookRunId,
    groupId: entry.groupId,
    handlerId: entry.handlerId,
    handlerType: entry.handlerType,
    source: entry.source,
    status: legacyStatus(entry.status),
    decision: outputDecision(entry.output),
    reason: entry.reason,
    durationMs: entry.durationMs,
    asyncRewakeEligible: entry.asyncRewakeEligible,
    ...(typeof entry.output?.additionalContext === 'string'
      ? { additionalContext: entry.output.additionalContext }
      : {}),
    ...(isRecord(entry.output?.updatedInput)
      ? { updatedInput: entry.output.updatedInput }
      : {}),
  }))
  return {
    decision: result.decision,
    reason: result.reason,
    results,
    additionalContext: result.additionalContext,
    ...(result.updatedInput ? { updatedInput: result.updatedInput } : {}),
    ...(result.updatedToolOutput !== undefined
      ? { updatedToolOutput: result.updatedToolOutput }
      : {}),
    ...(result.continue !== undefined ? { continue: result.continue } : {}),
    ...(result.stopReason !== undefined
      ? { stopReason: result.stopReason }
      : {}),
    ...(result.compactInstructions !== undefined
      ? { compactInstructions: result.compactInstructions }
      : {}),
    ...(result.suppressOutput !== undefined
      ? { suppressOutput: result.suppressOutput }
      : {}),
    ...(result.systemMessage !== undefined
      ? { systemMessage: result.systemMessage }
      : {}),
  }
}

function legacyStatus(status: string): HookExecutionResult['status'] {
  if (status === 'completed' || status === 'timeout' || status === 'skipped')
    return status
  if (status === 'accepted') return 'skipped'
  return 'failed'
}

function outputDecision(output: Record<string, unknown> | null): HookDecision {
  const decision = output?.decision
  return decision === 'deny' ||
    decision === 'ask' ||
    decision === 'allow' ||
    decision === 'passthrough'
    ? decision
    : 'passthrough'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function emptyDecision(reason: string): HookAggregateDecision {
  return { decision: 'passthrough', reason, results: [], additionalContext: '' }
}
