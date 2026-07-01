import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

export const PROJECT_MEMORY_START = '<!-- emperor-agent:project-memory:start -->'
export const PROJECT_MEMORY_END = '<!-- emperor-agent:project-memory:end -->'
const DEFAULT_BLOCK = '## Emperor Agent Project Memory\n\n- 尚未记录项目情况。'
const VERSION = 1

export interface ProjectEntry {
  project_id: string
  project_path: string
  project_name: string
  summary: string
  created_at: string
  updated_at: string
  agents_path: string
  version: number
}

export class ProjectStore {
  readonly root: string
  readonly projectsDir: string
  readonly indexPath: string

  constructor(root: string) {
    this.root = resolve(root)
    this.projectsDir = join(this.root, 'memory', 'projects')
    this.indexPath = join(this.projectsDir, 'index.json')
  }

  resolve(path: string): ProjectEntry {
    const projectPath = resolve(path)
    if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
      throw new Error('project path must be an existing directory')
    }
    this.ensureAgents(projectPath)
    const entry = this.entryForPath(projectPath)
    const loaded = this.load()
    const existing = loaded.find((item) => item.project_id === entry.project_id)
    const next: ProjectEntry = {
      ...entry,
      summary: existing?.summary ?? '',
      created_at: existing?.created_at ?? entry.created_at,
    }
    this.saveSorted([...loaded.filter((item) => item.project_id !== entry.project_id), next])
    return { ...next }
  }

  get(projectId: string): ProjectEntry | null {
    return this.load().find((item) => item.project_id === projectId) ?? null
  }

  list(): ProjectEntry[] {
    return this.load().sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }

  readAgents(projectId: string): string {
    const entry = this.get(projectId)
    if (!entry) return ''
    const path = join(entry.project_path, 'AGENTS.md')
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  }

  readManagedMemory(projectId: string): string {
    return extractBlock(this.readAgents(projectId)) ?? ''
  }

  updateMemory(projectId: string, content: string): ProjectEntry {
    const entry = this.get(projectId)
    if (!entry) throw new Error(`unknown project: ${projectId}`)
    this.ensureAgents(entry.project_path)
    const agentsPath = join(entry.project_path, 'AGENTS.md')
    const current = readFileSync(agentsPath, 'utf8')
    const text = replaceBlock(current, content.trim() || DEFAULT_BLOCK)
    writeFileSync(agentsPath, text.trimEnd() + '\n', 'utf8')

    const updated: ProjectEntry = {
      ...entry,
      summary: summarize(content),
      updated_at: stamp(),
    }
    this.saveSorted([...this.load().filter((item) => item.project_id !== projectId), updated])
    return { ...updated }
  }

  summaryForChat(opts: { limit?: number } = {}): string {
    const limit = opts.limit ?? 8
    const lines: string[] = []
    for (const item of this.list().slice(0, limit)) {
      const name = item.project_name || item.project_path || 'project'
      const summary = item.summary.trim()
      const label = item.project_path ? `${name} (${item.project_path})` : name
      lines.push(`- ${label}: ${summary || '已绑定为 Build 项目'}`)
    }
    return lines.join('\n')
  }

  private entryForPath(projectPath: string): ProjectEntry {
    const projectId = createHash('sha256').update(projectPath, 'utf8').digest('hex').slice(0, 16)
    const now = stamp()
    return {
      project_id: projectId,
      project_path: projectPath,
      project_name: basename(projectPath) || projectPath,
      summary: '',
      created_at: now,
      updated_at: now,
      agents_path: join(projectPath, 'AGENTS.md'),
      version: VERSION,
    }
  }

  private ensureAgents(projectPath: string): void {
    const agentsPath = join(projectPath, 'AGENTS.md')
    if (!existsSync(agentsPath)) {
      writeFileSync(
        agentsPath,
        '# AGENTS.md\n\n' +
          '本文件记录该项目给 Agent 的协作规则和项目记忆。\n\n' +
          `${PROJECT_MEMORY_START}\n${DEFAULT_BLOCK}\n${PROJECT_MEMORY_END}\n`,
        'utf8',
      )
      return
    }
    const text = readFileSync(agentsPath, 'utf8')
    if (text.includes(PROJECT_MEMORY_START) && text.includes(PROJECT_MEMORY_END)) return
    writeFileSync(
      agentsPath,
      text.trimEnd() + '\n\n' + `${PROJECT_MEMORY_START}\n${DEFAULT_BLOCK}\n${PROJECT_MEMORY_END}\n`,
      'utf8',
    )
  }

  private load(): ProjectEntry[] {
    if (!existsSync(this.indexPath)) return []
    try {
      const data = JSON.parse(readFileSync(this.indexPath, 'utf8') || '[]')
      return Array.isArray(data) ? data.filter(isObject).map(normalizeProject) : []
    } catch {
      return []
    }
  }

  private saveSorted(items: ProjectEntry[]): void {
    items.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    mkdirSync(this.projectsDir, { recursive: true })
    const tmp = this.indexPath.replace(/\.json$/, '.json.tmp')
    writeFileSync(tmp, JSON.stringify(items, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.indexPath)
  }
}

function extractBlock(text: string): string | null {
  const start = text.indexOf(PROJECT_MEMORY_START)
  const end = text.indexOf(PROJECT_MEMORY_END)
  if (start < 0 || end < 0 || end < start) return null
  return text.slice(start + PROJECT_MEMORY_START.length, end).trim()
}

function replaceBlock(text: string, content: string): string {
  const start = text.indexOf(PROJECT_MEMORY_START)
  const end = text.indexOf(PROJECT_MEMORY_END)
  if (start < 0 || end < 0 || end < start) {
    return `${text.trimEnd()}\n\n${PROJECT_MEMORY_START}\n${content.trim()}\n${PROJECT_MEMORY_END}`
  }
  const bodyStart = start + PROJECT_MEMORY_START.length
  return `${text.slice(0, bodyStart).trimEnd()}\n${content.trim()}\n${text.slice(end).trimStart()}`
}

function summarize(content: string): string {
  const lines: string[] = []
  for (const line of String(content || '').split('\n')) {
    let stripped = line.trim()
    if (!stripped || stripped.startsWith('#')) continue
    stripped = stripped.replace(/^[-*+\d.)\s]+/, '').trim()
    if (stripped) lines.push(stripped)
  }
  return lines
    .join('\n')
    .split(/[\n。；;]+/)
    .map((part) => part.trim().replace(/[ \t\r\n。；;]+$/g, ''))
    .filter(Boolean)
    .join('；')
    .slice(0, 120)
}

function normalizeProject(raw: Record<string, unknown>): ProjectEntry {
  return {
    project_id: String(raw.project_id ?? ''),
    project_path: String(raw.project_path ?? ''),
    project_name: String(raw.project_name ?? ''),
    summary: String(raw.summary ?? ''),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
    agents_path: String(raw.agents_path ?? ''),
    version: Number(raw.version ?? VERSION) || VERSION,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stamp(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0800`
}
