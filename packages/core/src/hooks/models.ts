export const HOOK_EVENT_NAMES = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Stop',
  'PreCompact',
  'PostCompact',
  'ConfigChange',
] as const

export type HookEventName = typeof HOOK_EVENT_NAMES[number]

export type HookHandlerType = 'command' | 'http'

export interface HookSource {
  kind: 'global' | 'project' | 'test'
  path: string
  readonly: boolean
}

export interface HookCommandHandler {
  type: 'command'
  command: string
  args: string[]
  timeoutMs: number
  async: boolean
  allowedEnv: string[]
}

export interface HookHttpHandler {
  type: 'http'
  url: string
  timeoutMs: number
  headers: Record<string, string>
  async: boolean
  allowedEnv: string[]
}

export type HookHandler = HookCommandHandler | HookHttpHandler

export interface HookDefinition {
  id: string
  eventName: HookEventName
  enabled: boolean
  matcher: string
  condition: string
  handler: HookHandler
  source: HookSource | null
}

export interface HooksConfig {
  version: 1
  enabled: boolean
  projectHooks: {
    enabled: boolean
  }
  hooks: Partial<Record<HookEventName, HookDefinition[]>>
}

export interface HookDiagnostic {
  code: string
  path: string
  message: string
}

export interface ParseHooksConfigResult {
  config: HooksConfig
  diagnostics: HookDiagnostic[]
}

export type HookDecision = 'deny' | 'ask' | 'allow' | 'passthrough'

export type HookRunStatus = 'completed' | 'failed' | 'timeout' | 'skipped'

export interface HookAuditRecord {
  id: string
  hookId: string
  eventName: HookEventName
  handlerType: HookHandlerType
  source: HookSource
  startedAt: string
  durationMs: number
  status: HookRunStatus
  decision: HookDecision
  reason: string
}

export interface HookExecutionResult {
  hookId: string
  status: HookRunStatus
  decision: HookDecision
  reason: string
  durationMs: number
  additionalContext?: string
  updatedInput?: Record<string, unknown>
  stdout?: string
  stderr?: string
}

export interface HookAggregateDecision {
  decision: HookDecision
  reason: string
  results: HookExecutionResult[]
  additionalContext: string
  updatedInput?: Record<string, unknown>
}

export type HookInput = Record<string, unknown> & {
  hook_event_name: HookEventName
  session_id: string
  cwd: string
  state_root: string
}
