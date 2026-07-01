import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import type { AgentLoop } from '../../agent/loop'
import { Compactor } from '../../memory/compactor'
import { memoryVersionToDict, type MemoryVersionTarget } from '../../memory/versions'
import type { WatchlistService } from '../../watchlist/service'

type Dict = Record<string, any>

export interface CoreMemoryServiceDeps {
  loop: AgentLoop
  watchlist: WatchlistService
  refreshRuntimeContext?: () => void
}

export class CoreMemoryService {
  readonly root: string
  private readonly loop: AgentLoop
  private readonly watchlist: WatchlistService
  private readonly refreshRuntimeContext?: () => void

  constructor(root: string, deps: CoreMemoryServiceDeps) {
    this.root = resolve(root)
    this.loop = deps.loop
    this.watchlist = deps.watchlist
    this.refreshRuntimeContext = deps.refreshRuntimeContext
  }

  getMemory(): Dict {
    const memoryDir = join(this.root, 'memory')
    const episodes = existsSync(memoryDir)
      ? readdirSync(memoryDir)
        .filter((name) => isEpisodeFilename(name))
        .sort()
        .map((name) => this.rel(join(memoryDir, name)))
      : []
    const turnIds = this.loop.activeMemoryStore.loadUnarchivedTurnIds()
    return {
      long_term: this.loop.sharedMemory.readMemory(),
      today_episode: this.loop.sharedMemory.readTodayEpisode(),
      episodes,
      context: this.contextPayload(),
      projects: this.loop.projectStore.list(),
      tokens: this.loop.tokenTracker.statsByDate(),
      tokensByModel: this.loop.tokenTracker.statsByProviderModel(),
      tokensByUsageType: this.loop.tokenTracker.statsByUsageType(),
      tokenTotals: this.loop.tokenTracker.totals(),
      history: this.loop.activeMemoryStore.historyStats(),
      runtime: this.loop.runtimeStore.stats({ activeTurnIds: turnIds }),
      schedulerMaintenance: this.schedulerMaintenance(),
      watchlist: this.watchlist.payload(),
      versions: this.loop.sharedMemory.versions.payload({ limit: 30 }),
    }
  }

  saveMemory(content: string): Dict {
    this.loop.sharedMemory.writeMemory(content)
    this.refreshRuntimeContext?.()
    return { path: 'memory/MEMORY.local.md', content: this.loop.sharedMemory.readMemory() }
  }

  getEpisode(date: string): Dict {
    const safe = validateEpisodeDate(date)
    const path = join(this.root, 'memory', `${safe}.md`)
    if (!existsSync(path)) throw new Error(`Episode not found: ${safe}`)
    return { date: safe, content: readFileSync(path, 'utf8') }
  }

  saveEpisode(content: string, date: string): Dict {
    const safe = validateEpisodeDate(date)
    const path = join(this.root, 'memory', `${safe}.md`)
    mkdirSync(join(this.root, 'memory'), { recursive: true })
    if (existsSync(path)) this.loop.sharedMemory.versions.snapshotPath(path, { target: 'episode', reason: 'webui_save_episode' })
    writeFileSync(path, `${String(content || '').trimEnd()}\n`, 'utf8')
    return this.getEpisode(safe)
  }

  listVersions(opts: { limit?: number; target?: string | null } = {}): Dict {
    const target = normalizeVersionTarget(opts.target ?? null)
    const versions = this.loop.sharedMemory.versions.list({ limit: opts.limit ?? 80, target })
    return {
      versions: versions.map(memoryVersionToDict),
      count: this.loop.sharedMemory.versions.list({ limit: 10000 }).length,
    }
  }

  getVersion(versionId: string): Dict {
    return this.loop.sharedMemory.versions.detail(versionId)
  }

  restoreVersion(versionId: string): Dict {
    const restored = this.loop.sharedMemory.versions.restore(versionId)
    this.refreshRuntimeContext?.()
    return { restored, memory: this.getMemory() }
  }

  getWatchlist(): Dict {
    return this.watchlist.payload()
  }

  saveWatchlist(content: string): Dict {
    return this.watchlist.write(content)
  }

  async checkWatchlist(): Promise<Dict> {
    ;(this.watchlist as unknown as { modelRouter: unknown }).modelRouter = this.loop.modelRouter
    const decision = await this.loop.activeTasks.run({
      taskId: 'watchlist:manual-check',
      kind: 'watchlist',
      label: 'Watchlist manual check',
      awaitable: this.watchlist.check(),
    })
    return { decision: decision.toDict(), watchlist: this.watchlist.payload() }
  }

  tokens(): Dict {
    const tracker = this.loop.tokenTracker
    return {
      totals: tracker.totals(),
      byDate: tracker.statsByDate(),
      byModel: tracker.statsByProviderModel(),
      byUsageType: tracker.statsByUsageType(),
      byDateModel: tracker.statsByDateModel(),
      byHour: tracker.statsByHour(),
      streak: tracker.streakMetrics(),
      sessions: tracker.sessionCount(),
      messages: this.countHistoryMessages(),
      recentCalls: tracker.recentCalls(),
      recentCacheCalls: tracker.recentCacheCalls(),
      generatedAt: localIsoSeconds(),
    }
  }

  async compact(): Promise<Dict> {
    const unarchivedHistory = this.loop.activeMemoryStore.loadUnarchivedHistory()
    const count = unarchivedHistory.length
    if (count < 2) {
      return {
        status: 'skipped',
        count,
        message: '未归档消息不足 2 条，无需压缩。',
        memory: this.getMemory(),
        unarchivedHistory,
      }
    }

    const compactor = this.buildCompactor()
    await compactor.compactStartupAsync(unarchivedHistory)
    const runtime = this.loop.runtimeStore.compact(this.loop.activeMemoryStore.loadUnarchivedTurnIds())
    this.loop.history = []
    this.refreshRuntimeContext?.()
    return {
      status: 'compacted',
      count,
      message: `已压缩 ${count} 条未归档消息。`,
      memory: this.getMemory(),
      unarchivedHistory: this.loop.activeMemoryStore.loadUnarchivedHistory(),
      runtime,
    }
  }

  private buildCompactor(): Compactor {
    const route = this.loop.modelRouter.route('memory_compaction')
    const snapshot = route.snapshot
    const fallback = route.fallback
    return new Compactor({
      provider: snapshot.provider,
      model: snapshot.model,
      memoryStore: this.loop.activeMemoryStore,
      docsDir: this.loop.templatesDir,
      maxTokens: snapshot.generation.maxTokens,
      temperature: snapshot.generation.temperature,
      reasoningEffort: snapshot.generation.reasoningEffort,
      providerName: snapshot.providerName,
      tokenTracker: this.loop.tokenTracker,
      usageType: 'memory_compaction',
      modelRole: snapshot.modelRole,
      routeReason: snapshot.routeReason,
      fallbackProvider: fallback?.provider ?? null,
      fallbackModel: fallback?.model ?? null,
      fallbackProviderName: fallback?.providerName ?? null,
      fallbackGeneration: fallback?.generation ?? null,
      fallbackModelRole: fallback?.modelRole ?? 'main',
      fallbackRouteReason: fallback?.routeReason,
    })
  }

  private contextPayload(): Dict {
    const sessionId = this.loop.activeSessionId || ''
    const session = sessionId ? this.loop.sessionStore.get(sessionId) : null
    const mode = String(session?.mode || 'chat')
    const projectId = String(session?.project_id || '')
    const project = projectId ? this.loop.projectStore.get(projectId) : null
    const sources = ['templates/SOUL.md', 'templates/TOOL.md', 'templates/USER.local.md']
    if (mode === 'build') sources.push('Project AGENTS.md')
    else sources.push('memory/MEMORY.local.md', 'memory/projects/index.json')
    return {
      mode,
      session,
      sources,
      project,
      projectIndexSummary: this.loop.projectStore.summaryForChat(),
      projectMemory: projectId ? this.loop.projectStore.readManagedMemory(projectId) : '',
    }
  }

  private schedulerMaintenance(): Dict {
    const jobs = this.loop.schedulerService.listJobs({ includeDisabled: true }).filter((job) => job.protected)
    const nextRuns = jobs.filter((job) => job.enabled && job.state.next_run_at_ms).map((job) => job.state.next_run_at_ms!)
    return {
      jobs: jobs.length,
      enabled: jobs.filter((job) => job.enabled).length,
      nextRunAtMs: nextRuns.length ? Math.min(...nextRuns) : null,
      lastError: jobs.find((job) => job.state.last_status === 'error' && job.state.last_error)?.state.last_error ?? null,
    }
  }

  private countHistoryMessages(): number {
    const historyFile = this.loop.activeMemoryStore.historyFile
    if (!existsSync(historyFile)) return 0
    let count = 0
    for (const line of readFileSync(historyFile, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const row = JSON.parse(trimmed)
        if (row?.role === 'user' || row?.role === 'assistant') count += 1
      } catch {
        // Ignore corrupt history rows in diagnostics-style summaries.
      }
    }
    return count
  }

  private rel(path: string): string {
    const r = relative(this.root, resolve(path))
    return r.startsWith('..') ? resolve(path) : r
  }
}

export function validateEpisodeDate(date: string): string {
  const safe = String(date || '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(safe)
  if (!match) throw new Error('episode date must be YYYY-MM-DD')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('episode date must be YYYY-MM-DD')
  }
  return safe
}

function isEpisodeFilename(name: string): boolean {
  if (basename(name) !== name || !name.endsWith('.md')) return false
  try {
    validateEpisodeDate(name.slice(0, -3))
    return true
  } catch {
    return false
  }
}

function normalizeVersionTarget(target: string | null): MemoryVersionTarget | null {
  if (!target) return null
  if (target === 'memory' || target === 'user' || target === 'episode') return target
  throw new Error('Invalid version target')
}

function localIsoSeconds(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
