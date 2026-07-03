import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import type { RuntimePaths } from './paths'

export interface LegacyStateMigrationEntry {
  ts: string
  action: 'copied' | 'skipped_corrupt_json'
  legacy: 'memory' | 'sessions' | '.team' | 'projects-index'
  rel_path: string
  source: string
  dest: string | null
  reason?: string
}

export interface LegacyStateMigrationResult {
  copied: number
  skipped: number
  logPath: string
  entries: LegacyStateMigrationEntry[]
}

export function migrateLegacyStateRoot(paths: RuntimePaths): LegacyStateMigrationResult {
  mkdirSync(paths.stateRoot, { recursive: true })
  const logPath = join(paths.stateRoot, 'migration-log.jsonl')
  const logged = readLoggedKeys(logPath)
  const result: LegacyStateMigrationResult = { copied: 0, skipped: 0, logPath, entries: [] }

  copyTree({ legacy: 'memory', from: join(paths.runtimeRoot, 'memory'), to: paths.memoryRoot, logPath, logged, result })
  copyTree({ legacy: 'sessions', from: join(paths.runtimeRoot, 'sessions'), to: paths.sessionsRoot, logPath, logged, result })
  copyTree({ legacy: '.team', from: join(paths.runtimeRoot, '.team'), to: paths.teamRoot, logPath, logged, result })
  migrateLegacyProjectIndex(paths, logPath, logged, result)
  return result
}

function copyTree(opts: {
  legacy: LegacyStateMigrationEntry['legacy']
  from: string
  to: string
  logPath: string
  logged: Set<string>
  result: LegacyStateMigrationResult
}): void {
  if (!existsSync(opts.from)) return
  for (const path of walkFiles(opts.from)) {
    const relPath = slash(relative(opts.from, path))
    const dest = join(opts.to, relPath)
    if (existsSync(dest)) continue
    if (shouldValidateJson(relPath) && !isValidJson(path)) {
      appendLog(opts, {
        action: 'skipped_corrupt_json',
        rel_path: `${opts.legacy}/${relPath}`,
        source: path,
        dest: null,
        reason: 'invalid json',
      })
      opts.result.skipped += 1
      continue
    }
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(path, dest)
    appendLog(opts, {
      action: 'copied',
      rel_path: `${opts.legacy}/${relPath}`,
      source: path,
      dest,
    })
    opts.result.copied += 1
  }
}

function migrateLegacyProjectIndex(
  paths: RuntimePaths,
  logPath: string,
  logged: Set<string>,
  result: LegacyStateMigrationResult,
): void {
  const source = join(paths.runtimeRoot, 'memory', 'projects', 'index.json')
  const dest = join(paths.projectsRoot, 'index.json')
  if (!existsSync(source) || existsSync(dest)) return
  if (!isValidJson(source)) {
    appendLog({ legacy: 'projects-index', logPath, logged, result }, {
      action: 'skipped_corrupt_json',
      rel_path: 'memory/projects/index.json',
      source,
      dest: null,
      reason: 'invalid json',
    })
    result.skipped += 1
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  const raw = JSON.parse(readFileSync(source, 'utf8') || '[]')
  const items = Array.isArray(raw) ? raw.map((item) => normalizeLegacyProject(item, paths.projectsRoot)).filter(Boolean) : []
  writeFileSync(dest, JSON.stringify(items, null, 2) + '\n', 'utf8')
  appendLog({ legacy: 'projects-index', logPath, logged, result }, {
    action: 'copied',
    rel_path: 'memory/projects/index.json',
    source,
    dest,
  })
  result.copied += 1
}

function normalizeLegacyProject(raw: unknown, projectsRoot: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as Record<string, unknown>
  const projectId = String(item.project_id ?? '')
  if (!projectId) return null
  return {
    ...item,
    agents_path: join(projectsRoot, projectId, 'AGENTS.local.md'),
  }
}

function appendLog(
  opts: {
    legacy: LegacyStateMigrationEntry['legacy']
    logPath: string
    logged: Set<string>
    result: LegacyStateMigrationResult
  },
  entry: Omit<LegacyStateMigrationEntry, 'ts' | 'legacy'>,
): void {
  const key = `${entry.action}:${entry.rel_path}`
  if (opts.logged.has(key)) return
  opts.logged.add(key)
  const full: LegacyStateMigrationEntry = {
    ts: new Date().toISOString(),
    legacy: opts.legacy,
    ...entry,
  }
  appendFileSync(opts.logPath, JSON.stringify(full) + '\n', 'utf8')
  opts.result.entries.push(full)
}

function readLoggedKeys(logPath: string): Set<string> {
  const keys = new Set<string>()
  if (!existsSync(logPath)) return keys
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const item = JSON.parse(trimmed)
      if (item?.action && item?.rel_path) keys.add(`${item.action}:${item.rel_path}`)
    } catch {
      // Ignore corrupt log rows; future migrations can still append valid rows.
    }
  }
  return keys
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const stat = statSync(path)
      if (stat.isDirectory()) stack.push(path)
      else if (stat.isFile()) out.push(path)
    }
  }
  return out.sort()
}

function shouldValidateJson(relPath: string): boolean {
  return extname(relPath) === '.json'
}

function isValidJson(path: string): boolean {
  try {
    JSON.parse(readFileSync(path, 'utf8') || 'null')
    return true
  } catch {
    return false
  }
}

function slash(path: string): string {
  return path.split(sep).join('/')
}
