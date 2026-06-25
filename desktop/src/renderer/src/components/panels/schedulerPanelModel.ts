import type { SchedulerJob } from '../../types'

const READONLY_TIME_FIELDS = ['createdAtMs', 'updatedAtMs', 'nextRunAtMs', 'lastRunAtMs'] as const

export function canEditSchedulerJob(job: SchedulerJob | null): boolean {
  if (!job) return false
  if (job.protected) return false
  if (job.payload?.kind === 'system_event') return false
  return true
}

export function readonlySchedulerTimeFields(): string[] {
  return [...READONLY_TIME_FIELDS]
}
