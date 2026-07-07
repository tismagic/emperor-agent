import type { HookDefinition, HookEventName, HookInput, HooksConfig } from './models'

export interface BuildHookInputOptions {
  sessionId: string
  cwd: string
  stateRoot: string
  source?: string | null
  toolName?: string | null
  toolInput?: Record<string, unknown> | null
  toolResult?: unknown
  permission?: Record<string, unknown> | null
  prompt?: string | null
  [key: string]: unknown
}
export function buildHookInput(eventName: HookEventName, opts: BuildHookInputOptions): HookInput {
  const input: HookInput = {
    hook_event_name: eventName,
    session_id: opts.sessionId,
    cwd: opts.cwd,
    state_root: opts.stateRoot,
  }
  if (opts.source !== undefined) input.source = opts.source
  if (opts.toolName) input.tool_name = opts.toolName
  if (opts.toolInput) input.tool_input = opts.toolInput
  if (opts.toolResult !== undefined) input.tool_result = opts.toolResult
  if (opts.permission) input.permission = opts.permission
  if (opts.prompt !== undefined) input.prompt = opts.prompt
  for (const [key, value] of Object.entries(opts)) {
    if (['sessionId', 'cwd', 'stateRoot', 'source', 'toolName', 'toolInput', 'toolResult', 'permission', 'prompt'].includes(key)) continue
    if (value !== undefined) input[toSnakeCase(key)] = value
  }
  return input
}

export function findMatchingHooks(config: HooksConfig, input: HookInput): HookDefinition[] {
  if (!config.enabled) return []
  const hooks = config.hooks[input.hook_event_name] ?? []
  return hooks.filter((hook) => hook.enabled && matcherMatches(hook.matcher, input) && conditionMatches(hook.condition, input))
}

export function matcherMatches(matcher: string, input: HookInput): boolean {
  const text = matcher.trim()
  if (!text || text === '*') return true
  const target = matchTarget(input)
  if (!target) return false
  if (text.includes('|')) return text.split('|').map((part) => part.trim()).some((part) => matcherMatches(part, input))
  const regex = parseRegexMatcher(text)
  if (regex) return regex.test(target)
  return text === target
}

export function conditionMatches(condition: string, input: HookInput): boolean {
  const text = condition.trim()
  if (!text) return true
  const tool = /^Tool\(([^)]+)\)$/.exec(text)
  if (tool) return matchPattern(String(input.tool_name ?? ''), tool[1] ?? '')
  if (text.startsWith('path:')) {
    const path = pathFromInput(input)
    return path ? matchGlob(path, text.slice('path:'.length).trim()) : false
  }
  return false
}

function matchTarget(input: HookInput): string {
  if (input.hook_event_name === 'PreToolUse' || input.hook_event_name === 'PostToolUse' || input.hook_event_name === 'PostToolUseFailure') {
    return String(input.tool_name ?? '')
  }
  if (input.hook_event_name === 'SessionStart' || input.hook_event_name === 'ConfigChange') return String(input.source ?? '')
  return '*'
}

function parseRegexMatcher(text: string): RegExp | null {
  if (!text.startsWith('/') || text.length < 2) return null
  const lastSlash = text.lastIndexOf('/')
  if (lastSlash <= 0) return null
  try {
    return new RegExp(text.slice(1, lastSlash), text.slice(lastSlash + 1))
  } catch {
    return null
  }
}

function matchPattern(value: string, pattern: string): boolean {
  if (!pattern || pattern === '*') return true
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1))
  return value === pattern
}

function pathFromInput(input: HookInput): string {
  const toolInput = input.tool_input
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return ''
  const data = toolInput as Record<string, unknown>
  const value = data.path ?? data.file_path
  return typeof value === 'string' ? value : ''
}

function matchGlob(value: string, glob: string): boolean {
  if (!glob || glob === '*') return true
  return globToRegExp(glob).test(value)
}

function globToRegExp(glob: string): RegExp {
  let pattern = '^'
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? ''
    const next = glob[i + 1] ?? ''
    if (char === '*' && next === '*') {
      const after = glob[i + 2] ?? ''
      if (after === '/') {
        pattern += '(?:.*\\/)?'
        i += 2
      } else {
        pattern += '.*'
        i += 1
      }
      continue
    }
    if (char === '*') {
      pattern += '[^/]*'
      continue
    }
    if (char === '?') {
      pattern += '[^/]'
      continue
    }
    pattern += escapeRegExp(char)
  }
  return new RegExp(`${pattern}$`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}
