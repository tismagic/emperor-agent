import { join } from 'node:path'
import { appendJsonl, readJsonl } from '../store/jsonl'
import type { HookAuditRecord } from './models'

export class HookAuditStore {
  readonly auditPath: string

  constructor(stateRoot: string) {
    this.auditPath = join(stateRoot, 'hooks', 'audit.jsonl')
  }

  async append(record: HookAuditRecord): Promise<void> {
    await appendJsonl(this.auditPath, record)
  }

  async replay(opts: { limit?: number } = {}): Promise<{ records: HookAuditRecord[]; badLines: { line: number; raw: string }[] }> {
    const replay = await readJsonl<HookAuditRecord>(this.auditPath)
    const limit = Math.max(0, Math.trunc(opts.limit ?? 100))
    const records = limit > 0 ? replay.records.slice(-limit) : []
    return { records, badLines: replay.badLines }
  }
}
