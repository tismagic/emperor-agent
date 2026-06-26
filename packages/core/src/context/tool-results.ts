/**
 * context_pipeline: 工具结果截断/摘要 (MIG-CORE-003)。
 * 对齐 Python `agent/context_pipeline/tool_results.py`。
 */
import type { OpenAiMsg } from './pairing'

export const DEFAULT_KEEP_RECENT = 10
export const DEFAULT_TOOL_RESULT_BUDGET = 8000

function contentTextSize(msg: OpenAiMsg): number {
  const c = msg.content
  if (typeof c === 'string') return c.length
  return JSON.stringify(c ?? '').length
}

/** 单条结果硬截断：保留 head(100) + tail + 截断标记。对齐 `cap_tool_results`。 */
export function capToolResults(
  history: OpenAiMsg[],
  perCallLimit: number = DEFAULT_TOOL_RESULT_BUDGET,
): [OpenAiMsg[], number] {
  let capped = 0
  const out = history.map((msg) => {
    if (msg.role !== 'tool') return msg
    const text = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '')
    if (text.length <= perCallLimit) return msg
    capped++
    const head = text.slice(0, Math.max(1, perCallLimit - 100))
    const tail = text.slice(-100)
    return { ...msg, content: `${head}\n...[truncated, total ${text.length} chars]...${tail}` }
  })
  return [out, capped]
}

/** 旧的大工具结果 → 摘要行。对齐 `shrink_old_tool_results`。 */
export function shrinkOldToolResults(
  history: OpenAiMsg[],
  keepRecent: number = DEFAULT_KEEP_RECENT,
  replacementMinBytes: number = 8000,
): [OpenAiMsg[], number] {
  if (history.length <= keepRecent) return [history.slice(), 0]
  const toolIndices: number[] = []
  history.forEach((m, i) => { if (m.role === 'tool') toolIndices.push(i) })
  const cutoff = history.length - keepRecent
  let shrunk = 0
  const out = history.map((msg, i) => {
    if (msg.role !== 'tool' || i >= cutoff) return msg
    if (contentTextSize(msg) < replacementMinBytes) return msg
    shrunk++
    const name = msg.name ?? ''
    const size = contentTextSize(msg)
    return { ...msg, content: `[shrunk] ${name} → ${size} chars omitted` }
  })
  return [out, shrunk]
}
