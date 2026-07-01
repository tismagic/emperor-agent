import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { gzipSync } from 'node:zlib'
import { basename, dirname, join, relative } from 'node:path'

type Row = Record<string, any>

export interface RuntimeStats {
  version: number
  path: string
  bytes: number
  events: number
  latestSeq: number
  latestTs: number | null
  activeTurnEvents: number
  activeTurns: number
  archiveFiles: number
  archiveBytes: number
  archives: Array<Record<string, unknown>>
  lastArchiveAt: number | null
  hotLimitEvents: number
  hotLimitBytes: number
  needsRotation: boolean
}

export class RuntimeEventStore {
  readonly root: string
  readonly runtimeDir: string
  readonly eventsFile: string
  readonly archiveDir: string
  readonly indexFile: string
  private _latestSeq = 0

  constructor(root: string, opts: { sessionDirOverride?: boolean } = {}) {
    this.root = root
    this.runtimeDir = opts.sessionDirOverride ? join(root, 'runtime') : join(root, 'memory', 'runtime')
    this.eventsFile = join(this.runtimeDir, 'events.jsonl')
    this.archiveDir = join(this.runtimeDir, 'archive')
    this.indexFile = join(this.runtimeDir, 'index.json')
    this.ensure()
    this._latestSeq = this.scanLatestSeq()
  }

  get latestSeq(): number {
    return this._latestSeq
  }

  append(event: Row, opts: { turnId?: string | null } = {}): Row {
    this._latestSeq += 1
    const payload = jsonSafe({ ...event }) as Row
    payload.seq = this._latestSeq
    if (payload.ts === undefined) payload.ts = Date.now() / 1000
    if (opts.turnId && !payload.turn_id) payload.turn_id = opts.turnId
    appendFileSync(this.eventsFile, JSON.stringify(payload) + '\n', 'utf8')
    this.writeIndex(this.statsFromIndex(this.loadIndex()))
    return payload
  }

  replayAfter(seq: number, opts: { limit?: number | null } = {}): Row[] {
    const out = this.iterEvents().filter((event) => Number(event.seq || 0) > seq)
    return opts.limit && out.length > opts.limit ? out.slice(-opts.limit) : out
  }

  recent(limit: number): Row[] {
    if (limit <= 0) return []
    return this.iterEvents().slice(-limit)
  }

  eventsForTurns(turnIds: string[], opts: { limit?: number | null } = {}): Row[] {
    const wanted = new Set(turnIds.filter(Boolean).map(String))
    if (!wanted.size) return []
    const out = this.iterEvents().filter((event) => wanted.has(String(event.turn_id || '')))
    return opts.limit && out.length > opts.limit ? out.slice(-opts.limit) : out
  }

  stats(opts: { activeTurnIds?: string[] | null } = {}): RuntimeStats {
    return this.statsFromIndex(this.loadIndex(), { activeTurnIds: opts.activeTurnIds ?? [] })
  }

  compact(activeTurnIds: string[]): RuntimeStats {
    const active = new Set(activeTurnIds.filter(Boolean).map(String))
    const keep: Row[] = []
    const archive: Row[] = []
    for (const event of this.iterEvents()) {
      const turnId = String(event.turn_id || '')
      if (turnId && active.has(turnId)) keep.push(event)
      else archive.push(event)
    }
    if (archive.length) {
      this.appendArchive(archive)
      this.rewriteHot(keep)
    }
    const index = this.loadIndex()
    if (archive.length) index.lastArchiveAt = Date.now() / 1000
    this.writeIndex(this.statsFromIndex(index, { activeTurnIds: [...active] }))
    return this.stats({ activeTurnIds: [...active] })
  }

  private ensure(): void {
    mkdirSync(this.runtimeDir, { recursive: true })
    mkdirSync(this.archiveDir, { recursive: true })
    if (!existsSync(this.eventsFile)) writeFileSync(this.eventsFile, '', 'utf8')
    if (!existsSync(this.indexFile)) this.writeIndex(this.statsFromIndex({ version: 1 }))
  }

  private scanLatestSeq(): number {
    const index = this.loadIndex()
    let latest = Number(index.latestSeq ?? index.latest_seq ?? 0) || 0
    for (const event of this.iterEvents()) latest = Math.max(latest, Number(event.seq || 0) || 0)
    return latest
  }

  private iterEvents(): Row[] {
    if (!existsSync(this.eventsFile)) return []
    const rows: Row[] = []
    for (let line of readFileSync(this.eventsFile, 'utf8').split('\n')) {
      line = line.trim()
      if (!line) continue
      try {
        const raw = JSON.parse(line)
        if (raw && typeof raw === 'object' && typeof raw.event === 'string') rows.push(raw)
      } catch {
        continue
      }
    }
    return rows
  }

  private statsFromIndex(index: Row, opts: { activeTurnIds?: string[] | null } = {}): RuntimeStats {
    const events = this.iterEvents()
    const active = new Set((opts.activeTurnIds ?? []).filter(Boolean).map(String))
    const activeEvents = events.filter((event) => active.size && active.has(String(event.turn_id || '')))
    const latestTs = Math.max(0, ...events.map(eventTsSeconds))
    const archiveFiles = existsSync(this.archiveDir)
      ? readdirSync(this.archiveDir).filter((name) => name.endsWith('.jsonl.gz')).sort()
      : []
    const archives = archiveFiles.map((name) => {
      const path = join(this.archiveDir, name)
      const st = statSync(path)
      return { path: relative(this.root, path), bytes: st.size, updatedAt: st.mtimeMs / 1000 }
    })
    const bytes = existsSync(this.eventsFile) ? statSync(this.eventsFile).size : 0
    const archiveBytes = archives.reduce((sum, item) => sum + Number(item.bytes || 0), 0)
    const latestSeq = Math.max(
      this._latestSeq,
      Number(index.latestSeq ?? index.latest_seq ?? 0) || 0,
      Math.max(0, ...events.map((event) => Number(event.seq || 0) || 0)),
    )
    return {
      version: 1,
      path: relative(this.root, this.eventsFile),
      bytes,
      events: events.length,
      latestSeq,
      latestTs: latestTs || null,
      activeTurnEvents: activeEvents.length,
      activeTurns: active.size,
      archiveFiles: archives.length,
      archiveBytes,
      archives,
      lastArchiveAt: (index.lastArchiveAt ?? index.last_archive_at ?? null) as number | null,
      hotLimitEvents: 5000,
      hotLimitBytes: 5 * 1024 * 1024,
      needsRotation: bytes > 5 * 1024 * 1024 || events.length > 5000,
    }
  }

  private loadIndex(): Row {
    try {
      const raw = JSON.parse(readFileSync(this.indexFile, 'utf8') || '{}')
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { version: 1, latestSeq: this._latestSeq }
    } catch {
      return { version: 1, latestSeq: this._latestSeq }
    }
  }

  private writeIndex(index: Row): void {
    const payload = { ...jsonSafe(index) as Row, version: 1 }
    const tmp = join(this.runtimeDir, `.${basename(this.indexFile)}.${randomUUID().replace(/-/g, '')}.tmp`)
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(tmp, this.indexFile)
  }

  private appendArchive(events: Row[]): void {
    const grouped = new Map<string, Row[]>()
    for (const event of events) {
      const month = archiveMonth(event)
      if (!grouped.has(month)) grouped.set(month, [])
      grouped.get(month)!.push(event)
    }
    for (const [month, rows] of grouped) {
      const path = join(this.archiveDir, `${month}.jsonl.gz`)
      const body = rows.map((event) => JSON.stringify(jsonSafe(event)) + '\n').join('')
      const chunk = gzipSync(Buffer.from(body, 'utf8'))
      if (existsSync(path)) appendFileSync(path, chunk)
      else writeFileSync(path, chunk)
    }
  }

  private rewriteHot(events: Row[]): void {
    const tmp = join(dirname(this.eventsFile), `.${basename(this.eventsFile)}.${randomUUID().replace(/-/g, '')}.tmp`)
    writeFileSync(tmp, events.map((event) => JSON.stringify(jsonSafe(event)) + '\n').join(''), 'utf8')
    renameSync(tmp, this.eventsFile)
  }
}

function eventTsSeconds(event: Row): number {
  const ts = event.ts
  if (typeof ts === 'number') return ts
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts)
    return Number.isFinite(parsed) ? parsed / 1000 : 0
  }
  return 0
}

function archiveMonth(event: Row): string {
  const ts = event.ts
  if (typeof ts === 'number') return new Date(ts * 1000).toISOString().slice(0, 7)
  if (typeof ts === 'string' && ts.length >= 7 && ts[4] === '-') return ts.slice(0, 7)
  return new Date().toISOString().slice(0, 7)
}

function jsonSafe(value: unknown): unknown {
  try {
    JSON.stringify(value)
    return value
  } catch {
    if (Array.isArray(value)) return value.map(jsonSafe)
    if (value && typeof value === 'object') {
      const out: Row = {}
      for (const [key, item] of Object.entries(value as Row)) {
        if (!String(key).startsWith('_')) out[String(key)] = jsonSafe(item)
      }
      return out
    }
    return String(value)
  }
}
