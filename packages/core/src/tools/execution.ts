/**
 * ToolExecutionEngine (MIG-CORE-008 支撑)。对齐 Python `agent/tools/execution.py`。
 * concurrency_safe 连续工具成组并发，其余顺序执行；emit tool_run_* 事件；TurnPaused 冒泡。
 */
import type { ToolCallRequest } from '../providers/base'
import { ToolResultObj } from './base'
import type { ToolRegistry } from './registry'
import { TurnPaused } from '../control/exceptions'
import * as runtimeEvents from '../agent/runtime-events'

export type StreamEmitter = (event: Record<string, unknown>) => void | Promise<void>
type ToolRunStatus = 'queued' | 'executing' | 'completed' | 'failed' | 'cancelled'

interface ToolRunState {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: ToolRunStatus
  concurrencySafe: boolean
  result: ToolResultObj | null
  error: string | null
}

export class ToolExecutionEngine {
  private readonly registry: ToolRegistry
  constructor(registry: ToolRegistry) { this.registry = registry }

  async runBatch(
    toolCalls: ToolCallRequest[],
    opts?: { emit?: StreamEmitter | null; runOne?: (call: ToolCallRequest) => Promise<ToolResultObj> },
  ): Promise<Array<Record<string, unknown>>> {
    const emit = opts?.emit ?? null
    const runOne = opts?.runOne
    const states = toolCalls.map((call) => this.stateForCall(call))
    if (emit) {
      for (const state of states) {
        await emit(runtimeEvents.toolRunQueued({ id: state.id, name: state.name, arguments: state.arguments }))
      }
    }
    const resultsById = new Map<string, ToolResultObj>()
    let index = 0
    while (index < toolCalls.length) {
      const state = states[index]!
      if (state.concurrencySafe) {
        const groupCalls: ToolCallRequest[] = []
        const groupStates: ToolRunState[] = []
        while (index < toolCalls.length && states[index]!.concurrencySafe) {
          groupCalls.push(toolCalls[index]!)
          groupStates.push(states[index]!)
          index += 1
        }
        const gathered = await Promise.allSettled(
          groupCalls.map((call, i) => this.runState(call, groupStates[i]!, { emit, runOne })),
        )
        for (let i = 0; i < groupCalls.length; i++) {
          const call = groupCalls[i]!
          const item = groupStates[i]!
          const raw = gathered[i]!
          if (raw.status === 'rejected') {
            if (raw.reason instanceof TurnPaused) throw raw.reason
            const result = ToolResultObj.fromText(`Error: ${raw.reason}`, { isError: true })
            item.status = 'failed'
            item.error = String(raw.reason)
            resultsById.set(call.id, result)
            if (emit) await emit(runtimeEvents.toolRunFailed({ id: call.id, name: call.name, message: String(raw.reason) }))
          } else {
            resultsById.set(call.id, raw.value)
          }
        }
        continue
      }
      resultsById.set(toolCalls[index]!.id, await this.runState(toolCalls[index]!, state, { emit, runOne }))
      index += 1
    }
    return toolCalls.map((call) => ({
      role: 'tool',
      tool_call_id: call.id,
      name: call.name,
      content: (resultsById.get(call.id) ?? ToolResultObj.fromText('')).modelContent,
    }))
  }

  private stateForCall(call: ToolCallRequest): ToolRunState {
    const tool = this.registry.get(call.name)
    const concurrencySafe = Boolean(tool && tool.isConcurrencySafe(call.arguments))
    return { id: call.id, name: call.name, arguments: call.arguments, status: 'queued', concurrencySafe, result: null, error: null }
  }

  private async runState(
    call: ToolCallRequest,
    state: ToolRunState,
    opts: { emit: StreamEmitter | null; runOne?: (call: ToolCallRequest) => Promise<ToolResultObj> },
  ): Promise<ToolResultObj> {
    state.status = 'executing'
    if (opts.emit) await opts.emit(runtimeEvents.toolRunStarted({ id: state.id, name: state.name }))
    let result: ToolResultObj
    try {
      if (!opts.runOne) {
        result = await this.registry.executeResult(call.name, call.arguments)
      } else {
        result = coerceToolResult(await opts.runOne(call))
      }
    } catch (exc) {
      if (exc instanceof TurnPaused) {
        state.status = 'cancelled'
        if (opts.emit) await opts.emit(runtimeEvents.toolRunCancelled({ id: state.id, name: state.name, reason: 'turn_paused' }))
        throw exc
      }
      state.status = 'failed'
      state.error = String(exc)
      if (opts.emit) await opts.emit(runtimeEvents.toolRunFailed({ id: state.id, name: state.name, message: String(exc) }))
      return ToolResultObj.fromText(`Error: ${exc}`, { isError: true })
    }
    state.status = result.isError ? 'failed' : 'completed'
    state.result = result
    if (opts.emit) {
      if (result.isError) {
        await opts.emit(runtimeEvents.toolRunFailed({ id: state.id, name: state.name, message: result.summary }))
      } else {
        await opts.emit(
          runtimeEvents.toolRunCompleted({
            id: state.id,
            name: state.name,
            summary: result.summary,
            artifacts: result.artifactPayloads().length ? result.artifactPayloads() : null,
            metadata: Object.keys(result.metadata).length ? result.metadata : null,
          }),
        )
      }
    }
    return result
  }
}

function coerceToolResult(value: ToolResultObj | string): ToolResultObj {
  if (value instanceof ToolResultObj) return value
  const text = String(value)
  return ToolResultObj.fromText(text, { isError: text.startsWith('Error:') })
}
