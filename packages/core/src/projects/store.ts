import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  ProjectStateStore,
  type ProjectStateMetadata,
} from './state-store'
import type { MemoryVersionStore } from '../memory/versions'

export { PROJECT_MEMORY_END, PROJECT_MEMORY_START } from './state-store'

const VERSION = 1

export interface ProjectEntry extends ProjectStateMetadata {
  project_id: string
  project_path: string
  workspace_path: string
  project_name: string
  summary: string
  created_at: string
  updated_at: string
  agents_path: string
  state_path: string
  memory_path: string
  project_json_path: string
  prompt_overlay_path: string
  legacy_agents_path: string | null
  legacy_imported_at: string | null
  version: number
}

export class ProjectStore {
  readonly root: string
  readonly projectsDir: string
  readonly indexPath: string
  readonly stateStore: ProjectStateStore
  private readonly versions: Pick<MemoryVersionStore, 'snapshotPath'> | null

  constructor(root: string, opts: { versions?: Pick<MemoryVersionStore, 'snapshotPath'> | null } = {}) {
    this.root = resolve(root)
    this.projectsDir = join(this.root, 'projects')
    this.indexPath = join(this.projectsDir, 'index.json')
    this.stateStore = new ProjectStateStore(this.projectsDir)
    this.versions = opts.versions ?? null
  }

  resolve(path: string): ProjectEntry {
    const projectPath = resolve(path)
    if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
      throw new Error('project path must be an existing directory')
    }
    const entry = this.entryForPath(projectPath)
    const loaded = this.load()
    const existing = loaded.find((item) => item.project_id === entry.project_id)
    const next: ProjectEntry = {
      ...entry,
      summary: existing?.summary ?? '',
      created_at: existing?.created_at ?? entry.created_at,
    }
    const ensured = this.stateStore.ensureProject(next)
    this.saveSorted([...loaded.filter((item) => item.project_id !== entry.project_id), ensured])
    return { ...ensured }
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
    return this.stateStore.readAgents(entry.project_id)
  }

  readManagedMemory(projectId: string): string {
    return this.stateStore.readManagedMemory(projectId)
  }

  updateMemory(projectId: string, content: string): ProjectEntry {
    const entry = this.get(projectId)
    if (!entry) throw new Error(`unknown project: ${projectId}`)
    this.stateStore.ensureProject(entry)
    if (this.versions && existsSync(entry.agents_path)) {
      this.versions.snapshotPath(entry.agents_path, { target: 'project', reason: 'write_project_memory' })
    }
    this.stateStore.writeManagedMemory(projectId, content)

    const updated: ProjectEntry = {
      ...entry,
      summary: summarize(content),
      updated_at: stamp(),
    }
    this.stateStore.writeProjectJson(updated)
    this.saveSorted([...this.load().filter((item) => item.project_id !== projectId), updated])
    return { ...updated }
  }

  summaryForChat(opts: { limit?: number } = {}): string {
    const limit = opts.limit ?? 8
    const lines: string[] = []
    for (const item of this.list().slice(0, limit)) {
      const name = item.project_name || item.project_path || 'project'
      const label = item.project_path ? `${name} (${item.project_path})` : name
      lines.push(`- ${label}: 已绑定为 Build 项目`)
    }
    return lines.join('\n')
  }

  private entryForPath(projectPath: string): ProjectEntry {
    const projectId = createHash('sha256').update(projectPath, 'utf8').digest('hex').slice(0, 16)
    const now = stamp()
    const paths = this.stateStore.paths(projectId)
    return {
      project_id: projectId,
      project_path: projectPath,
      workspace_path: projectPath,
      project_name: basename(projectPath) || projectPath,
      summary: '',
      created_at: now,
      updated_at: now,
      ...paths,
      legacy_agents_path: null,
      legacy_imported_at: null,
      version: VERSION,
    }
  }

  private load(): ProjectEntry[] {
    if (!existsSync(this.indexPath)) return []
    try {
      const data = JSON.parse(readFileSync(this.indexPath, 'utf8') || '[]')
      return Array.isArray(data) ? data.filter(isObject).map((item) => normalizeProject(item, this.projectsDir)) : []
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

function normalizeProject(raw: Record<string, unknown>, projectsDir: string): ProjectEntry {
  const projectId = String(raw.project_id ?? '')
  const stateStore = new ProjectStateStore(projectsDir)
  const paths = stateStore.paths(projectId)
  return {
    project_id: projectId,
    project_path: String(raw.project_path ?? ''),
    workspace_path: String(raw.workspace_path ?? raw.project_path ?? ''),
    project_name: String(raw.project_name ?? ''),
    summary: String(raw.summary ?? ''),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
    ...paths,
    legacy_agents_path: nullableText(raw.legacy_agents_path),
    legacy_imported_at: nullableText(raw.legacy_imported_at),
    version: Number(raw.version ?? VERSION) || VERSION,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stamp(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0800`
}
