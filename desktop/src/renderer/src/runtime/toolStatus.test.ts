import { describe, expect, it } from 'vitest'
import type { AssistantMessage, ToolSegment } from '../types'
import { applyToolResultToSegment, settleRunningToolSegments } from './toolStatus'

function tool(extra: Partial<ToolSegment> = {}): ToolSegment {
  return {
    id: 'segment-1',
    type: 'tool',
    toolId: 'call-1',
    name: 'run_command',
    status: 'running',
    startedAt: 1_000,
    summary: '',
    ...extra,
  }
}

function assistant(segment: ToolSegment): AssistantMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    segments: [segment],
    streaming: true,
  }
}

describe('tool runtime status helpers', () => {
  it('marks error tool_result events as failed segments', () => {
    const segment = tool()

    applyToolResultToSegment(segment, {
      summary: 'Error: permission denied',
      isError: true,
      endedAt: 2_500,
    })

    expect(segment.status).toBe('error')
    expect(segment.durationMs).toBe(1_500)
    expect(segment.summary).toBe('Error: permission denied')
  })

  it('settles orphan running tools when an assistant turn finishes', () => {
    const segment = tool()
    const message = assistant(segment)

    settleRunningToolSegments(message, {
      endedAt: 4_000,
      summary: '工具未返回结束事件',
    })

    expect(segment.status).toBe('error_aborted')
    expect(segment.durationMs).toBe(3_000)
    expect(segment.summary).toBe('工具未返回结束事件')
  })
})
