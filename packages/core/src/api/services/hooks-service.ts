import { HookAuditStore, HookConfigLoader, HookRuntime, isHookEventName, type HookEventName, type HookRuntimeRunOptions } from '../../hooks'

type Dict = Record<string, unknown>

export interface CoreHooksServiceDeps {
  activeSessionId?: () => string | null
  activeWorkspaceRoot?: () => string
  activeProjectRoot?: () => string | null
  assertMutation?: (area: string, action: string) => void
}

export class CoreHooksService {
  readonly stateRoot: string
  readonly loader: HookConfigLoader
  readonly audit: HookAuditStore
  private readonly deps: CoreHooksServiceDeps

  constructor(stateRoot: string, deps: CoreHooksServiceDeps = {}) {
    this.stateRoot = stateRoot
    this.loader = new HookConfigLoader({ stateRoot })
    this.audit = new HookAuditStore(stateRoot)
    this.deps = deps
  }

  async getConfig(_opts: Dict = {}): Promise<Dict> {
    const loaded = await this.loader.load({ projectRoot: this.deps.activeProjectRoot?.() ?? null })
    const globalOnly = await this.loader.load({ projectRoot: null })
    return {
      ...loaded,
      globalConfig: globalOnly.config,
      summary: hooksSummary(loaded.config),
    } as unknown as Dict
  }

  async saveConfig(raw: unknown): Promise<Dict> {
    this.deps.assertMutation?.('hooks', 'saveConfig')
    const result = await this.loader.saveGlobalConfig(raw)
    if (result.diagnostics.length === 0) {
      await this.runConfigChange('hooks.saveConfig')
    }
    return {
      ...result,
      globalConfig: result.config,
      summary: hooksSummary(result.config),
    } as unknown as Dict
  }

  async notifyConfigChange(source: string): Promise<void> {
    await this.runConfigChange(source)
  }

  async getAudit(opts: { limit?: number | string | null } = {}): Promise<Dict> {
    return await this.audit.replay({ limit: normalizeLimit(opts.limit) }) as unknown as Dict
  }

  async testRun(input: Dict): Promise<Dict> {
    const eventName = String(input.eventName ?? input.event_name ?? '')
    if (!isHookEventName(eventName)) throw new Error(`invalid hook event: ${eventName}`)
    const runtime = new HookRuntime({ stateRoot: this.stateRoot })
    const opts: HookRuntimeRunOptions = {
      sessionId: String(input.sessionId ?? input.session_id ?? this.deps.activeSessionId?.() ?? ''),
      cwd: String(input.cwd ?? this.deps.activeWorkspaceRoot?.() ?? process.cwd()),
      projectRoot: null,
      source: typeof input.source === 'string' ? input.source : 'test',
      toolName: typeof input.toolName === 'string' ? input.toolName : typeof input.tool_name === 'string' ? input.tool_name : null,
      toolInput: isRecord(input.toolInput) ? input.toolInput : isRecord(input.tool_input) ? input.tool_input : null,
      prompt: typeof input.prompt === 'string' ? input.prompt : null,
    }
    return await runtime.run(eventName, opts) as unknown as Dict
  }

  private async runConfigChange(source: string): Promise<void> {
    const runtime = new HookRuntime({ stateRoot: this.stateRoot })
    await runtime.run('ConfigChange', {
      sessionId: this.deps.activeSessionId?.() ?? '',
      cwd: this.deps.activeWorkspaceRoot?.() ?? process.cwd(),
      projectRoot: null,
      source,
    })
  }
}

function hooksSummary(config: { hooks: Partial<Record<HookEventName, unknown[]>> }): Dict {
  const events = Object.entries(config.hooks).map(([eventName, hooks]) => ({
    eventName,
    count: Array.isArray(hooks) ? hooks.length : 0,
  }))
  return {
    total: events.reduce((sum, event) => sum + event.count, 0),
    events,
  }
}

function normalizeLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? 100), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
