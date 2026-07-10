import { describe, expect, it } from 'vitest'
import {
  bubbleForContent,
  bubbleForTool,
  clipBubbleText,
  mapRuntimeEvent,
  toolAnimation,
} from '../event-mapper.js'

describe('event-mapper', () => {
  it('maps runtime lifecycle events', () => {
    expect(mapRuntimeEvent({ event: 'user_message' })).toEqual({
      animation: 'thinking',
      bubble: '收到，开始想。',
    })
    expect(mapRuntimeEvent({ event: 'ask_request' })).toEqual({
      animation: 'notification',
      bubble: '需要主人拍板。',
      bubbleDurationMs: 0,
    })
    expect(mapRuntimeEvent({ event: 'plan_draft' })!.bubble).toBe(
      '需要主人拍板。',
    )
    expect(mapRuntimeEvent({ event: 'plan_draft' })!.bubbleDurationMs).toBe(0)
    expect(mapRuntimeEvent({ event: 'turn_paused' })!.animation).toBe(
      'notification',
    )
    expect(mapRuntimeEvent({ event: 'turn_paused' })!.bubbleDurationMs).toBe(0)
    expect(mapRuntimeEvent({ event: 'assistant_done' })!.animation).toBe(
      'happy',
    )
    expect(mapRuntimeEvent({ event: 'assistant_done' })!.bubble).toBe(
      '办好了。',
    )
    expect(
      mapRuntimeEvent({
        event: 'assistant_done',
        content: '奉天承运皇帝诏曰，事情已经办妥。',
      })!.bubble,
    ).toBe('办好了：奉天承运皇帝诏曰，事情已经办妥。')
    expect(mapRuntimeEvent({ event: 'assistant_done' })!.resetAfterMs).toBe(
      4000,
    )
    expect(
      mapRuntimeEvent({ event: 'runtime_task_cancelled' })!.animation,
    ).toBe('dizzy')
    expect(mapRuntimeEvent({ event: 'runtime_task_cancelled' })!.bubble).toBe(
      '已停下当前任务。',
    )
    expect(mapRuntimeEvent({ event: 'unknown' })).toBeNull()
  })

  it('maps tools to tool-aware animations', () => {
    expect(toolAnimation('read_file')).toBe('debugger')
    expect(toolAnimation('grep')).toBe('debugger')
    expect(toolAnimation('write_file')).toBe('typing')
    expect(toolAnimation('run_command')).toBe('building')
    expect(toolAnimation('web_fetch')).toBe('wizard')
    expect(toolAnimation('mcp_server_call')).toBe('beacon')
    expect(toolAnimation('dispatch_subagent')).toBe('conducting')
  })

  it('maps tools to detailed clipped bubbles without raw object payload', () => {
    const effect = mapRuntimeEvent({
      event: 'tool_call',
      name: 'read_file',
      arguments: { path: '/private/secret-plan.md' },
    })

    expect(
      bubbleForTool('read_file', { path: '/private/secret-plan.md' }),
    ).toBe('正在读文件：secret-plan.md')
    expect(
      bubbleForTool('run_command', {
        command: "date '+%Y年%m月%d日 %H:%M:%S'",
      }),
    ).toBe("正在运行命令：date '+%Y年%m月%d日 %H:%M:%S'")
    expect(effect!.animation).toBe('debugger')
    expect(effect!.bubble).toBe('正在读文件：secret-plan.md')
    expect(effect!.bubble.includes('/private')).toBe(false)
    expect(effect!.bubble.includes('[object Object]')).toBe(false)
  })

  it('clips detailed content bubbles', () => {
    expect(clipBubbleText('一二三四五六七八九十', 8)).toBe('一二三四五...')
    expect(bubbleForContent('正在回复：', '  奉天\n承运  ')).toBe(
      '正在回复：奉天 承运',
    )
    const effect = mapRuntimeEvent({
      event: 'message_delta',
      delta: '这是一段会进入桌宠气泡的详细回复内容'.repeat(6),
    })
    expect(effect!.animation).toBe('typing')
    expect(
      effect!.bubble.startsWith(
        '正在回复：这是一段会进入桌宠气泡的详细回复内容',
      ),
    ).toBe(true)
    expect(effect!.bubble.endsWith('...')).toBe(true)
    expect(effect!.appendAssistantDelta).toBe(true)
  })

  it('tracks subagent event effects', () => {
    expect(
      mapRuntimeEvent({
        event: 'subagent_start',
        agent_type: 'reviewer',
        purpose: '检查变更',
      }),
    ).toEqual({
      animation: 'conducting',
      bubble: '正在派遣队友：reviewer：检查变更',
      subagentDelta: 1,
    })
    expect(mapRuntimeEvent({ event: 'subagent_error' })!.animation).toBe(
      'dizzy',
    )
    expect(mapRuntimeEvent({ event: 'subagent_error' })!.bubble).toBe(
      '队友那边出错了。',
    )
    expect(mapRuntimeEvent({ event: 'team_run_tool_call' })!.animation).toBe(
      'conducting',
    )
    expect(
      mapRuntimeEvent({
        event: 'team_run_tool_call',
        name: 'grep',
        arguments: { pattern: 'desktopPet' },
      })!.bubble,
    ).toBe('队友用工具：正在搜索：desktopPet')
    expect(
      mapRuntimeEvent({ event: 'team_run_tool_call' })!.subagentDelta,
    ).toBeUndefined()
  })
})
