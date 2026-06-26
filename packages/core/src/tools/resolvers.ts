/**
 * 命令安全判定纯函数 (MIG-TOOL-005)。
 * 对齐 Python `agent/permissions/resolvers.py`。Shell/权限管线共用。
 */

const HIGH_RISK_COMMAND = /(\bgit\s+push\b|\bgh\s+(pr\s+merge|release|workflow|run)\b|\brm\s+(-[^\s]*r|-[^\s]*f|--recursive|--force)\b|\bsudo\b|\bchmod\b|\bchown\b|\bdeploy\b|\bpublish\b|\brelease\b|\bnpm\s+(install|publish)\b|\bpip\s+install\b|\bbrew\s+install\b|\bdocker\s+(push|compose\s+up|run)\b|\bkubectl\b|\bterraform\s+(apply|destroy)\b)/i

const SHELL_META = /[;&|`$><(){}\n\\]/

// Low-risk: may execute project code (pytest, npm test) in user's own coding workflow.
// NOT strictly read-only. Intentionally excludes cat/head/tail/grep/find (exfil sensitive paths).
const LOW_RISK_SINGLE = new Set(['ls', 'pwd', 'pytest'])
const LOW_RISK_GIT_SUB = new Set(['status', 'diff', 'log', 'show', 'branch'])

// Strictly inspection-only, no code execution. Used by plan guard to pass probes.
const READONLY_SINGLE = new Set(['ls', 'pwd'])
const READONLY_GIT_SUB = new Set(['status', 'diff', 'log', 'show', 'branch'])

const SENSITIVE_PATH_PARTS = new Set(['.git', '.team', 'memory', 'node_modules'])
const SENSITIVE_PATH_PREFIXES = ['desktop/out', 'desktop/dist']
const SENSITIVE_FILENAMES = new Set(['.env', 'model_config.json'])

function safeCommandParts(command: string): string[] | null {
  const cmd = (command || '').trim()
  if (!cmd || SHELL_META.test(cmd)) return null
  // Simple split (approximates shlex — no quoted args needed for allowlisted commands)
  const parts = cmd.split(/\s+/).filter((p) => p)
  return parts.length ? parts : null
}

export function isHighRiskCommand(command: string): boolean {
  return HIGH_RISK_COMMAND.test(command || '')
}

export function isLowRiskCommand(command: string): boolean {
  const parts = safeCommandParts(command)
  if (!parts) return false
  const head = (parts[0] ?? '').split('/').pop()!
  if (LOW_RISK_SINGLE.has(head)) return true
  if (head === 'git' && parts.length >= 2 && LOW_RISK_GIT_SUB.has(parts[1]!)) return true
  if ((head === 'python' || head === 'python3') && parts.length >= 3 && parts[1] === '-m' && parts[2] === 'pytest') return true
  if (head === 'npm' && parts.slice(1).some((p) => p === 'test')) return true
  return false
}

export function isReadonlyCommand(command: string): boolean {
  const parts = safeCommandParts(command)
  if (!parts) return false
  const head = (parts[0] ?? '').split('/').pop()!
  if (READONLY_SINGLE.has(head)) return true
  return head === 'git' && parts.length >= 2 && READONLY_GIT_SUB.has(parts[1]!)
}

export function isSensitivePath(path: string | null | undefined): boolean {
  if (!path) return false
  const normalized = path.replace(/\\/g, '/').trim()
  const parts = normalized.split('/')
  if (parts.some((p) => SENSITIVE_PATH_PARTS.has(p))) return true
  if (SENSITIVE_PATH_PREFIXES.some((p) => normalized === p || normalized.startsWith(`${p}/`))) return true
  if (normalized.startsWith('../') || normalized.includes('/../')) return true
  const name = parts[parts.length - 1] ?? ''
  return SENSITIVE_FILENAMES.has(name) || name.endsWith('.local.md')
}

export function schedulerAction(args: Record<string, unknown>): string {
  return String(args.action ?? '').trim().toLowerCase()
}
