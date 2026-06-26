/**
 * Tool 基类 + 能力标志 + ToolResult (MIG-TOOL-001/002)。
 * 对齐 Python `agent/tools/base.py` + `results.py` + `protocol.py`。
 */
import type { ToolParamsSchema } from './schema'

// ── results ──

export interface ToolArtifact {
  path: string
  kind: string
  bytes: number
  metadata: Record<string, unknown>
}

export interface ToolResult {
  modelContent: string
  displaySummary: string
  rawContent: string
  artifacts: ToolArtifact[]
  metadata: Record<string, unknown>
  isError: boolean
}

export function okResult(content: string, opts?: { summary?: string; meta?: Record<string, unknown> }): ToolResult {
  return {
    modelContent: content,
    displaySummary: opts?.summary ?? content.slice(0, 120),
    rawContent: content,
    artifacts: [],
    metadata: opts?.meta ?? {},
    isError: false,
  }
}

export function errResult(content: string, opts?: { meta?: Record<string, unknown> }): ToolResult {
  return { ...okResult(content, opts), isError: true }
}

// ── execution context ──

export interface ToolExecutionContext {
  root: string
  arguments: Record<string, unknown>
  turnId?: string | null
  parentCallId?: string | null
  emit?: ((event: string, payload: unknown) => void) | null
  loop?: unknown | null
}

// ── tool base ──

/** Tool definition as given to the LLM. */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: ToolParamsSchema
}

export abstract class Tool {
  abstract readonly name: string
  abstract readonly description: string
  abstract readonly parameters: ToolParamsSchema

  readOnly = false
  exclusive = false
  requiresRuntimeContext = false
  maxResultChars = 12_000
  concurrencySafe = false

  /** 子类可覆写以提供运行时参数感知的只读判定。对齐 `is_read_only(arguments)`。 */
  isReadOnly(_args: Record<string, unknown>): boolean { return this.readOnly }

  isDestructive(): boolean { return !this.isReadOnly({}) }

  isConcurrencySafe(): boolean { return this.concurrencySafe && !this.exclusive }

  abstract execute(args: Record<string, unknown>, ctx?: ToolExecutionContext): Promise<string> | string

  /** 可选：把原始输出映射为 ToolResult。默认包成 okResult。 */
  mapResult(raw: string, ctx: ToolExecutionContext): ToolResult {
    return okResult(raw, { meta: { tool: this.name } })
  }

  definition(): ToolDefinition {
    return { name: this.name, description: this.description, input_schema: this.parameters }
  }
}
