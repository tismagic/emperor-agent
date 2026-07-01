import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = 1

export interface SessionEntry {
  id: string
  title: string
  created_at: string
  updated_at: string
  preview: string
  message_count: number
  title_status: string
  mode: 'chat' | 'build'
  project_id: string | null
  project_path: string | null
  project_name: string | null
  archived_at: string | null
  version: number
}

export interface SessionCreateOptions {
  titleStatus?: string | null
  mode?: string
  project?: Record<string, unknown> | null
}

export class SessionStore {
  readonly root: string
  readonly sessionsDir: string
  readonly indexPath: string

  constructor(root: string) {
    this.root = root
    this.sessionsDir = join(root, 'sessions')
    this.indexPath = join(this.sessionsDir, 'index.json')
  }

  sessionDir(sessionId: string): string {
    return join(this.sessionsDir, sessionId)
  }

  list(opts: { includeArchived?: boolean } = {}): SessionEntry[] {
    let items = this.load()
    if (!opts.includeArchived) items = items.filter((item) => !item.archived_at)
    items.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
    return items
  }

  create(title = '', opts: SessionCreateOptions = {}): SessionEntry {
    const now = stamp()
    const cleanTitle = title.trim()
    const mode = opts.mode === 'build' ? 'build' : 'chat'
    const project = opts.project ?? {}
    const entry: SessionEntry = {
      id: randomUUID().replace(/-/g, '').slice(0, 16),
      title: cleanTitle || 'Untitled',
      created_at: now,
      updated_at: now,
      preview: '',
      message_count: 0,
      title_status: opts.titleStatus || (cleanTitle ? 'manual' : 'placeholder'),
      mode,
      project_id: nullableText(project.project_id),
      project_path: nullableText(project.project_path),
      project_name: nullableText(project.project_name),
      archived_at: null,
      version: VERSION,
    }
    const items = this.load()
    items.push(entry)
    this.save(items)
    mkdirSync(this.sessionDir(entry.id), { recursive: true })
    return entry
  }

  get(sessionId: string): SessionEntry | null {
    return this.load().find((item) => item.id === sessionId) ?? null
  }

  delete(sessionId: string): boolean {
    const items = this.load()
    if (items.length <= 1) return false
    const idx = items.findIndex((item) => item.id === sessionId)
    if (idx < 0) return false
    items.splice(idx, 1)
    this.save(items)
    rmSync(this.sessionDir(sessionId), { recursive: true, force: true })
    return true
  }

  rename(sessionId: string, title: string): boolean {
    const items = this.load()
    for (const item of items) {
      if (item.id !== sessionId) continue
      item.title = title.trim()
      item.updated_at = stamp()
      item.title_status = 'manual'
      this.save(items)
      return true
    }
    return false
  }

  archive(sessionId: string): SessionEntry | null {
    return this.setArchived(sessionId, true)
  }

  restore(sessionId: string): SessionEntry | null {
    return this.setArchived(sessionId, false)
  }

  setGeneratedTitle(sessionId: string, title: string): SessionEntry | null {
    const items = this.load()
    for (const item of items) {
      if (item.id !== sessionId) continue
      item.title = title.trim()
      item.title_status = 'generated'
      item.updated_at = stamp()
      this.save(items)
      return { ...item }
    }
    return null
  }

  touch(sessionId: string, preview: string, opts: { incrementMessages?: boolean } = {}): SessionEntry | null {
    const items = this.load()
    for (const item of items) {
      if (item.id !== sessionId) continue
      item.preview = preview.slice(0, 280)
      if (opts.incrementMessages) item.message_count = Number(item.message_count || 0) + 1
      item.updated_at = stamp()
      this.save(items)
      return { ...item }
    }
    return null
  }

  private load(): SessionEntry[] {
    if (!existsSync(this.indexPath)) return []
    try {
      const text = readFileSync(this.indexPath, 'utf8').trim()
      if (!text) return []
      const data = JSON.parse(text)
      if (!Array.isArray(data)) throw new Error('index.json must be a list')
      let changed = false
      const normalized: SessionEntry[] = []
      for (const item of data) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          changed = true
          continue
        }
        const clean = normalizeSession(item as Record<string, unknown>)
        if (JSON.stringify(clean) !== JSON.stringify(item)) changed = true
        normalized.push(clean)
      }
      if (changed) this.save(normalized)
      return normalized
    } catch {
      this.quarantineIndex()
      return []
    }
  }

  private save(items: SessionEntry[]): void {
    mkdirSync(this.sessionsDir, { recursive: true })
    const tmp = this.indexPath.replace(/\.json$/, '.json.tmp')
    writeFileSync(tmp, JSON.stringify(items, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.indexPath)
  }

  private quarantineIndex(): void {
    mkdirSync(this.sessionsDir, { recursive: true })
    if (!existsSync(this.indexPath)) return
    const target = join(this.sessionsDir, `index.corrupt-${stampForFilename()}.json`)
    try { renameSync(this.indexPath, target) } catch { /* ignore */ }
  }

  private setArchived(sessionId: string, archived: boolean): SessionEntry | null {
    const items = this.load()
    for (const item of items) {
      if (item.id !== sessionId) continue
      item.archived_at = archived ? stamp() : null
      item.updated_at = stamp()
      this.save(items)
      return { ...item }
    }
    return null
  }
}

function normalizeSession(raw: Record<string, unknown>): SessionEntry {
  const mode = String(raw.mode ?? 'chat').trim().toLowerCase() === 'build' ? 'build' : 'chat'
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? 'Untitled'),
    created_at: String(raw.created_at ?? raw.createdAt ?? ''),
    updated_at: String(raw.updated_at ?? raw.updatedAt ?? ''),
    preview: String(raw.preview ?? ''),
    message_count: toInt(raw.message_count ?? raw.messageCount, 0),
    title_status: String(raw.title_status ?? raw.titleStatus ?? 'manual'),
    mode,
    project_id: nullableText(raw.project_id ?? raw.projectId),
    project_path: nullableText(raw.project_path ?? raw.projectPath),
    project_name: nullableText(raw.project_name ?? raw.projectName),
    archived_at: nullableText(raw.archived_at ?? raw.archivedAt),
    version: toInt(raw.version, VERSION),
  }
}

function nullableText(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(String(value), 10)
  return Number.isFinite(n) ? n : fallback
}

function stamp(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0800`
}

function stampForFilename(): string {
  return stamp().replace(/[-:]/g, '').replace('+0800', '')
}
