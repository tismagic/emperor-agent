/**
 * 控制流异常 (MIG-CTRL-011)。对齐 Python `agent/control/exceptions.py`。
 * TurnPaused: 暂停当前回合，携带 interaction + tool_messages。
 */
export class TurnPaused extends Error {
  readonly interaction: Record<string, unknown>
  readonly toolMessages: Array<Record<string, unknown>>

  constructor(
    interaction: Record<string, unknown>,
    toolMessages: Array<Record<string, unknown>> = [],
  ) {
    const kind = interaction.kind ?? 'interaction'
    const ident = interaction.id ?? 'unknown'
    super(`turn paused for ${kind}: ${ident}`)
    this.name = 'TurnPaused'
    this.interaction = interaction
    this.toolMessages = toolMessages
  }
}
