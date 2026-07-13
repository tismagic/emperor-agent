import { randomUUID } from 'node:crypto'
import { TaskKind, TaskRecord, TaskStatus } from './models'
import { SidechainTranscript } from './sidechain'
import { TaskStore } from './store'
import type { HookAggregateDecision, HookEventName } from '../hooks/models'
import { relativePortable } from '../util/paths'

export interface TaskStartOptions {
  kind: string
  title: string
  source: string
  turnId?: string | null
  toolCallId?: string | null
  jobId?: string | null
  sessionId?: string | null
  status?: string
  metadata?: Record<string, unknown> | null
}

export interface TaskHookHost {
  run(
    eventName: Extract<HookEventName, 'TaskCreated' | 'TaskCompleted'>,
    opts: {
      taskKind: string
      task: Record<string, unknown>
      sessionId: string | null
    },
  ): HookAggregateDecision | Promise<HookAggregateDecision>
}

export interface TaskTransitionResult {
  committed: boolean
  record: TaskRecord
  reason: string
}

export class TaskManager {
  readonly root: string
  readonly store: TaskStore

  private readonly hooks: TaskHookHost | null

  constructor(root: string, opts: { hooks?: TaskHookHost | null } = {}) {
    this.root = root
    this.store = new TaskStore(root)
    this.hooks = opts.hooks ?? null
  }

  startTask(opts: TaskStartOptions): TaskRecord {
    const record = this.taskCandidate(opts)
    this.store.upsert(record)
    return record
  }

  async startTaskWithHooks(opts: TaskStartOptions): Promise<TaskRecord | null> {
    const record = this.taskCandidate(opts)
    if (this.hooks) {
      const decision = await this.hooks.run('TaskCreated', {
        taskKind: record.kind,
        task: record.toDict() as unknown as Record<string, unknown>,
        sessionId: record.session_id,
      })
      if (decision.decision === 'deny' || decision.decision === 'ask')
        return null
    }
    this.store.upsert(record)
    return record
  }

  private taskCandidate(opts: TaskStartOptions): TaskRecord {
    const taskId = `${TaskManager.prefix(opts.kind)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const transcript = new SidechainTranscript(this.root, taskId)
    const record = new TaskRecord({
      id: taskId,
      kind: opts.kind,
      status: opts.status ?? TaskStatus.RUNNING,
      title: opts.title.slice(0, 160),
      source: opts.source,
      started_at: Date.now() / 1000,
      turn_id: opts.turnId ?? null,
      tool_call_id: opts.toolCallId ?? null,
      job_id: opts.jobId ?? null,
      session_id: opts.sessionId ?? null,
      transcript_path: relativePortable(this.root, transcript.path),
      metadata: opts.metadata ?? {},
    })
    return record
  }

  updateTask(
    taskId: string,
    fields: Record<string, unknown>,
  ): TaskRecord | null {
    const record = this.store.get(taskId)
    if (!record) return null
    const payload: Record<string, unknown> = { ...record.toDict() }
    const map: Record<string, string> = {
      turnId: 'turn_id',
      toolCallId: 'tool_call_id',
      jobId: 'job_id',
      outputPath: 'output_path',
      transcriptPath: 'transcript_path',
    }
    const allowed = new Set([
      'status',
      'title',
      'source',
      'turn_id',
      'tool_call_id',
      'job_id',
      'output_path',
      'transcript_path',
      'progress',
      'metadata',
    ])
    for (const [key, value] of Object.entries(fields)) {
      const target = map[key] ?? key
      if (allowed.has(target)) payload[target] = value
    }
    const updated = TaskRecord.fromDict(payload)
    this.store.upsert(updated)
    return updated
  }

  appendSidechain(taskId: string, message: Record<string, unknown>): void {
    new SidechainTranscript(this.root, taskId).append(message)
  }

  readSidechain(
    taskId: string,
    opts: { offset?: number; limit?: number } = {},
  ): ReturnType<SidechainTranscript['read']> {
    return new SidechainTranscript(this.root, taskId).read(opts)
  }

  completeTask(
    taskId: string,
    opts: { summary?: string } = {},
  ): TaskRecord | null {
    const record = this.store.get(taskId)
    if (!record) return null
    return this.finish(record, TaskStatus.COMPLETED, {
      summary: opts.summary ?? '',
    })
  }

  async completeTaskWithHooks(
    taskId: string,
    opts: { summary?: string } = {},
  ): Promise<TaskTransitionResult | null> {
    const record = this.store.get(taskId)
    if (!record) return null
    const candidate = this.finishedCandidate(record, TaskStatus.COMPLETED, {
      summary: opts.summary ?? '',
    })
    if (this.hooks) {
      const decision = await this.hooks.run('TaskCompleted', {
        taskKind: candidate.kind,
        task: candidate.toDict() as unknown as Record<string, unknown>,
        sessionId: candidate.session_id,
      })
      if (decision.decision === 'deny' || decision.decision === 'ask') {
        return { committed: false, record, reason: decision.reason }
      }
    }
    this.store.upsert(candidate)
    return { committed: true, record: candidate, reason: '' }
  }

  failTask(taskId: string, opts: { error: string }): TaskRecord | null {
    const record = this.store.get(taskId)
    if (!record) return null
    return this.finish(record, TaskStatus.FAILED, { error: opts.error })
  }

  cancelTask(
    taskId: string,
    opts: { reason?: string } = {},
  ): TaskRecord | null {
    const record = this.store.get(taskId)
    if (!record) return null
    return this.finish(record, TaskStatus.CANCELLED, {
      reason: opts.reason ?? 'cancelled',
    })
  }

  private finish(
    record: TaskRecord,
    status: string,
    progress: Record<string, unknown>,
  ): TaskRecord {
    const updated = this.finishedCandidate(record, status, progress)
    this.store.upsert(updated)
    return updated
  }

  private finishedCandidate(
    record: TaskRecord,
    status: string,
    progress: Record<string, unknown>,
  ): TaskRecord {
    return TaskRecord.fromDict({
      ...record.toDict(),
      status,
      ended_at: Date.now() / 1000,
      progress: { ...record.progress, ...progress },
    })
  }

  static prefix(kind: string): string {
    const mapping: Record<string, string> = {
      [TaskKind.PLAN_STEP]: 'planstep',
      [TaskKind.SUBAGENT]: 'subagent',
      [TaskKind.TEAM_WAKE]: 'team',
      [TaskKind.SCHEDULER_RUN]: 'scheduler',
    }
    return mapping[kind] ?? 'task'
  }
}
