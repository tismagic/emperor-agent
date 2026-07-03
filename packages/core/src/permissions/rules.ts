import type { ToolPermissionProfile } from './models'

export type PermissionRuleAction = 'allow' | 'ask' | 'deny'

export interface PermissionRuleInput {
  id?: unknown
  action?: unknown
  tool?: unknown
  commandPrefix?: unknown
  command_prefix?: unknown
  pathGlob?: unknown
  path_glob?: unknown
  access?: unknown
  reason?: unknown
}

export interface PermissionRule {
  id: string
  action: PermissionRuleAction
  tool: string
  commandPrefix: string
  pathGlob: string
  access: string
  reason: string
}

export interface PermissionRuleDiagnostics {
  loaded: number
  invalid: number
  invalidRules: Array<{ index: number; reason: string }>
}

export interface PermissionRuleSet {
  rules: PermissionRule[]
  diagnostics: PermissionRuleDiagnostics
}

export function parsePermissionRules(rawRules: unknown): PermissionRuleSet {
  const inputs = Array.isArray(rawRules) ? rawRules : []
  const rules: PermissionRule[] = []
  const invalidRules: Array<{ index: number; reason: string }> = []
  inputs.forEach((raw, index) => {
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as PermissionRuleInput : null
    if (!data) {
      invalidRules.push({ index, reason: 'rule must be an object' })
      return
    }
    const id = safeRuleId(data.id)
    const action = safeAction(data.action)
    if (!id) {
      invalidRules.push({ index, reason: 'rule id is required' })
      return
    }
    if (!action) {
      invalidRules.push({ index, reason: 'rule action must be allow, ask, or deny' })
      return
    }
    const tool = String(data.tool ?? '').trim()
    const commandPrefix = String(data.commandPrefix ?? data.command_prefix ?? '').trim()
    const pathGlob = String(data.pathGlob ?? data.path_glob ?? '').trim()
    const access = String(data.access ?? '').trim().toLowerCase()
    const reason = String(data.reason ?? '').trim() || `matched permission rule ${id}`
    if (!tool && !commandPrefix && !pathGlob && !access) {
      invalidRules.push({ index, reason: 'rule must define at least one matcher' })
      return
    }
    rules.push({ id, action, tool, commandPrefix, pathGlob, access, reason })
  })
  return {
    rules,
    diagnostics: {
      loaded: rules.length,
      invalid: invalidRules.length,
      invalidRules,
    },
  }
}

export function matchPermissionRule(rules: PermissionRule[], profile: ToolPermissionProfile): PermissionRule | null {
  for (const rule of rules) {
    if (rule.tool && rule.tool !== profile.name) continue
    if (rule.commandPrefix && !profile.command.trim().startsWith(rule.commandPrefix)) continue
    if (rule.pathGlob && !matchesPathGlob(profile.path ?? '', rule.pathGlob)) continue
    if (rule.access && rule.access !== accessForProfile(profile)) continue
    return rule
  }
  return null
}

function safeRuleId(value: unknown): string {
  const id = String(value ?? '').trim()
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(id) ? id : ''
}

function safeAction(value: unknown): PermissionRuleAction | null {
  const action = String(value ?? '').trim().toLowerCase()
  return action === 'allow' || action === 'ask' || action === 'deny' ? action : null
}

function accessForProfile(profile: ToolPermissionProfile): string {
  if (profile.readOnly) return 'read'
  if (profile.name === 'run_command') return 'execute'
  if (profile.name === 'write_file' || profile.name === 'edit_file') return 'write'
  return profile.destructive ? 'mutate' : 'read'
}

function matchesPathGlob(path: string, glob: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.?\//, '')
  const pattern = glob.replace(/\\/g, '/').replace(/^\.?\//, '')
  if (!pattern) return false
  if (pattern === normalized) return true
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return normalized === prefix || normalized.startsWith(`${prefix}/`)
  }
  if (pattern.includes('*')) return globRegex(pattern).test(normalized)
  return false
}

function globRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('')
    .map((ch) => {
      if (ch === '*') return '[^/]*'
      return /[\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch
    })
    .join('')
  return new RegExp(`^${escaped}$`)
}
