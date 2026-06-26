/**
 * ToolRegistry (MIG-TOOL-003)。
 * 对齐 Python `agent/tools/registry.py`：注册、生成 definitions、参数校验/转型、执行。
 */
import type { Tool, ToolDefinition } from './base'

export class ToolRegistry {
  #tools = new Map<string, Tool>()

  register(tool: Tool): void {
    if (this.#tools.has(tool.name)) throw new Error(`Tool "${tool.name}" is already registered`)
    this.#tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined { return this.#tools.get(name) }

  has(name: string): boolean { return this.#tools.has(name) }

  /** builtin 在前，mcp_ 在后。对齐 `get_definitions`。 */
  getDefinitions(): ToolDefinition[] {
    const builtin: ToolDefinition[] = []
    const mcp: ToolDefinition[] = []
    for (const name of [...this.#tools.keys()].sort()) {
      const d = this.#tools.get(name)!.definition()
      ;(name.startsWith('mcp_') ? mcp : builtin).push(d)
    }
    return builtin.concat(mcp)
  }

  /** 参数转型 + 类型校验。对齐 `prepare_call`。 */
  prepareCall(name: string, args: Record<string, unknown>): Record<string, unknown> {
    const tool = this.#tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    return this.castParams(tool.parameters.properties, args)
  }

  private castParams(
    fields: Record<string, any>,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...args }
    for (const [key, schema] of Object.entries(fields ?? {})) {
      if (!(key in out)) continue
      const type = (schema as any).type
      const v = out[key]
      if (type === 'integer' || type === 'number') {
        const n = type === 'integer' ? Number.parseInt(String(v), 10) : Number.parseFloat(String(v))
        if (Number.isFinite(n)) out[key] = n
      } else if (type === 'boolean') {
        out[key] = typeof v === 'string' ? v === 'true' : Boolean(v)
      } else {
        out[key] = String(v ?? '')
      }
    }
    return out
  }

  /** 执行工具 + map_result。对齐 `execute_result`。 */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.#tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    const casted = this.prepareCall(name, args)
    const raw = await tool.execute(casted)
    const capped = raw.length > tool.maxResultChars ? raw.slice(0, tool.maxResultChars - 200) + `\n...[truncated, total ${raw.length} chars]...` : raw
    return capped
  }
}
