import { describe, expect, it } from 'vitest'
import { Tool, ToolResultObj } from './base'
import { toolParamsSchema } from './schema'
import { ToolRegistry } from './registry'
import { ToolExecutionEngine } from './execution'

class SafeTool extends Tool {
  override name = 'safe_tool'
  override description = 'concurrency-safe fake'
  override parameters = toolParamsSchema({}, [])
  override concurrencySafe = true
  execute(): string { return 'ok' }
}

describe('ToolExecutionEngine concurrency cap (Wave3.3)', () => {
  it('caps concurrent-safe group execution at the default limit while preserving result order', async () => {
    const registry = new ToolRegistry()
    registry.register(new SafeTool())
    const engine = new ToolExecutionEngine(registry)
    let inflight = 0
    let maxInflight = 0
    const runOne = async (call: { id: string }): Promise<ToolResultObj> => {
      inflight += 1
      maxInflight = Math.max(maxInflight, inflight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inflight -= 1
      return ToolResultObj.fromText(`result:${call.id}`)
    }
    const calls = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: 'safe_tool', arguments: {} }))

    const results = await engine.runBatch(calls, { runOne })

    expect(maxInflight).toBeLessThanOrEqual(6)
    expect(maxInflight).toBeGreaterThan(1)
    expect(results.map((r) => r.tool_call_id)).toEqual(calls.map((c) => c.id))
    expect(results.map((r) => r.content)).toEqual(calls.map((c) => `result:${c.id}`))
  })

  it('createStreamingRun starts eager-eligible tools before finish and defers the rest', async () => {
    const registry = new ToolRegistry()
    registry.register(new SafeTool())
    const engine = new ToolExecutionEngine(registry)
    const startOrder: string[] = []
    const runOne = async (call: { id: string }): Promise<ToolResultObj> => {
      startOrder.push(call.id)
      return ToolResultObj.fromText(`r:${call.id}`)
    }
    const run = engine.createStreamingRun({
      runOne,
      canStartEarly: (call) => call.id === 'eager',
    })

    run.enqueue({ id: 'eager', name: 'safe_tool', arguments: {} })
    run.enqueue({ id: 'deferred', name: 'safe_tool', arguments: {} })
    // 让已入队的 eager 工具有机会先跑
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(startOrder).toEqual(['eager'])

    const results = await run.finish([
      { id: 'eager', name: 'safe_tool', arguments: {} },
      { id: 'deferred', name: 'safe_tool', arguments: {} },
    ])
    expect(startOrder).toEqual(['eager', 'deferred'])
    expect(results.map((r) => r.tool_call_id)).toEqual(['eager', 'deferred'])
    expect(results.map((r) => r.content)).toEqual(['r:eager', 'r:deferred'])
  })

  it('createStreamingRun executes stragglers present only in the final response', async () => {
    const registry = new ToolRegistry()
    registry.register(new SafeTool())
    const engine = new ToolExecutionEngine(registry)
    const ran: string[] = []
    const run = engine.createStreamingRun({
      runOne: async (call) => { ran.push(call.id); return ToolResultObj.fromText(call.id) },
      canStartEarly: () => true,
    })
    run.enqueue({ id: 'a', name: 'safe_tool', arguments: {} })
    await new Promise((resolve) => setTimeout(resolve, 5))

    const results = await run.finish([
      { id: 'a', name: 'safe_tool', arguments: {} },
      { id: 'b', name: 'safe_tool', arguments: {} },
    ])
    expect(ran.sort()).toEqual(['a', 'b'])
    expect(results.map((r) => r.tool_call_id)).toEqual(['a', 'b'])
    expect(ran.filter((id) => id === 'a')).toHaveLength(1)
  })

  it('honors an explicit maxConcurrency override', async () => {
    const registry = new ToolRegistry()
    registry.register(new SafeTool())
    const engine = new ToolExecutionEngine(registry)
    let inflight = 0
    let maxInflight = 0
    const runOne = async (): Promise<ToolResultObj> => {
      inflight += 1
      maxInflight = Math.max(maxInflight, inflight)
      await new Promise((resolve) => setTimeout(resolve, 3))
      inflight -= 1
      return ToolResultObj.fromText('ok')
    }
    const calls = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: 'safe_tool', arguments: {} }))

    await engine.runBatch(calls, { runOne, maxConcurrency: 2 })

    expect(maxInflight).toBeLessThanOrEqual(2)
  })
})
