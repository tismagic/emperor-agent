/**
 * context_pipeline: 微压缩 + 流水线编排 (MIG-CORE-004/005)。
 * 对齐 Python `agent/context_pipeline/microcompact.py` + `pipeline.py`。
 */
import { type OpenAiMsg, pairToolCalls } from './pairing'
import { capToolResults, shrinkOldToolResults } from './tool-results'

export { pairToolCalls, capToolResults, shrinkOldToolResults }
export { DEFAULT_KEEP_RECENT, DEFAULT_TOOL_RESULT_BUDGET } from './tool-results'

export const DEFAULT_MICROCOMPACT_KEEP_RECENT = 20

export interface Projection {
  messages: OpenAiMsg[]
  filled: number
  dropped: number
  cappedCount: number
  shrunkCount: number
}

export class ContextPipeline {
  readonly perCallLimit: number
  readonly keepRecent: number
  readonly replacementMinBytes: number
  readonly replacementPreviewChars: number
  readonly microcompactKeepRecent: number

  constructor(opts?: {
    perCallLimit?: number
    keepRecent?: number
    replacementMinBytes?: number
    replacementPreviewChars?: number
    microcompactKeepRecent?: number
  }) {
    this.perCallLimit = opts?.perCallLimit ?? 8000
    this.keepRecent = opts?.keepRecent ?? 10
    this.replacementMinBytes = opts?.replacementMinBytes ?? 8000
    this.replacementPreviewChars = opts?.replacementPreviewChars ?? 1000
    this.microcompactKeepRecent = opts?.microcompactKeepRecent ?? DEFAULT_MICROCOMPACT_KEEP_RECENT
  }

  project(history: OpenAiMsg[]): Projection {
    const [paired, filled, dropped] = pairToolCalls(history)
    const [capped, cappedCount] = capToolResults(paired, this.perCallLimit)
    const [shrunk, shrunkCount] = shrinkOldToolResults(capped, this.keepRecent, this.replacementMinBytes)
    const [microed] = this.microcompact(shrunk)
    return { messages: microed, filled, dropped, cappedCount, shrunkCount }
  }

  /** 超阈值时压缩更早历史。对齐 `microcompact`。 */
  private microcompact(history: OpenAiMsg[]): [OpenAiMsg[], number] {
    if (history.length <= this.microcompactKeepRecent) return [history, 0]
    const cutoff = history.length - this.microcompactKeepRecent
    const keep = history.slice(cutoff)
    const toCompact = history.slice(0, cutoff)
    // Summarize the older block as a synthetic user message
    const summaryCount = toCompact.filter((m) => m.role !== 'system').length
    if (summaryCount === 0) return [keep, 0]
    const summaryParts: string[] = []
    for (const msg of toCompact) {
      if (msg.role === 'system') { keep.unshift(msg); continue }
      const c = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '')
      summaryParts.push(`[${msg.role}] ${c.slice(0, this.replacementPreviewChars)}${c.length > this.replacementPreviewChars ? '...' : ''}`)
    }
    const summary = `[microcompact] earlier history:\n${summaryParts.join('\n')}`
    return [[{ role: 'user', content: summary }, ...keep], toCompact.length]
  }
}
