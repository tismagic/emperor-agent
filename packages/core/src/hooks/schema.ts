import {
  HOOK_EVENT_NAMES,
  type HookDefinition,
  type HookDiagnostic,
  type HookEventName,
  type HookHandler,
  type HookSource,
  type HooksConfig,
  type ParseHooksConfigResult,
} from './models'

const EVENT_NAME_SET = new Set<string>(HOOK_EVENT_NAMES)
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000
const DEFAULT_HTTP_TIMEOUT_MS = 10_000

export function defaultHooksConfig(): HooksConfig {
  return {
    version: 1,
    enabled: true,
    projectHooks: { enabled: false },
    hooks: {},
  }
}
export function parseHooksConfig(raw: unknown, opts: { source?: HookSource | null } = {}): ParseHooksConfigResult {
  const diagnostics: HookDiagnostic[] = []
  const data = objectOrNull(raw)
  if (!data) return { config: defaultHooksConfig(), diagnostics }

  const config: HooksConfig = {
    version: 1,
    enabled: data.enabled === undefined ? true : Boolean(data.enabled),
    projectHooks: {
      enabled: Boolean(objectOrNull(data.projectHooks)?.enabled ?? objectOrNull(data.project_hooks)?.enabled ?? false),
    },
    hooks: {},
  }

  const hooks = objectOrNull(data.hooks)
  if (!hooks) return { config, diagnostics }
  for (const [eventName, entries] of Object.entries(hooks)) {
    if (!isHookEventName(eventName)) {
      diagnostics.push({ code: 'invalid_event', path: `hooks.${eventName}`, message: `Unsupported hook event: ${eventName}` })
      continue
    }
    if (!Array.isArray(entries)) {
      diagnostics.push({ code: 'invalid_hooks_list', path: `hooks.${eventName}`, message: 'Hook event value must be an array' })
      continue
    }
    const normalized: HookDefinition[] = []
    for (let index = 0; index < entries.length; index++) {
      const entry = objectOrNull(entries[index])
      if (!entry) {
        diagnostics.push({ code: 'invalid_hook', path: `hooks.${eventName}.${index}`, message: 'Hook entry must be an object' })
        continue
      }
      const handler = parseHandler(entry.handler)
      if (!handler) {
        diagnostics.push({ code: 'invalid_handler', path: `hooks.${eventName}.${index}.handler`, message: 'Hook handler must be command or http' })
        continue
      }
      normalized.push({
        id: nonEmptyString(entry.id) ?? `${eventName}-${index + 1}`,
        eventName,
        enabled: entry.enabled === undefined ? true : Boolean(entry.enabled),
        matcher: nonEmptyString(entry.matcher) ?? '*',
        condition: nonEmptyString(entry.if) ?? nonEmptyString(entry.condition) ?? '',
        handler,
        source: opts.source ?? null,
      })
    }
    if (normalized.length > 0) config.hooks[eventName] = normalized
  }
  return { config, diagnostics }
}

export function isHookEventName(value: string): value is HookEventName {
  return EVENT_NAME_SET.has(value)
}

function parseHandler(raw: unknown): HookHandler | null {
  const data = objectOrNull(raw)
  if (!data) return null
  const type = nonEmptyString(data.type)
  if (type === 'command') {
    const command = nonEmptyString(data.command)
    if (!command) return null
    return {
      type: 'command',
      command,
      args: stringArray(data.args),
      timeoutMs: positiveInt(data.timeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
      async: Boolean(data.async ?? false),
      allowedEnv: stringArray(data.allowedEnv ?? data.allowed_env),
    }
  }
  if (type === 'http') {
    const url = nonEmptyString(data.url)
    if (!url) return null
    return {
      type: 'http',
      url,
      timeoutMs: positiveInt(data.timeoutMs, DEFAULT_HTTP_TIMEOUT_MS),
      headers: stringRecord(data.headers),
      async: Boolean(data.async ?? false),
      allowedEnv: stringArray(data.allowedEnv ?? data.allowed_env),
    }
  }
  return null
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function positiveInt(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(String(value), 10)
  return Number.isFinite(num) && num > 0 ? num : fallback
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
}

function stringRecord(value: unknown): Record<string, string> {
  const data = objectOrNull(value)
  if (!data) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(data)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}
