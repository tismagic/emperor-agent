import { describe, expect, it } from 'vitest'
import { projectChatEvents } from './chatProjection'

describe('chatProjection', () => {
  it('rebuilds text, thought, tool, and control segments from runtime replay', () => {
    const state = projectChatEvents([
      { event: 'user_message', seq: 1, session_id: 's1', turn_id: 'turn_1', content: 'run tools' },
      { event: 'message_delta', seq: 2, session_id: 's1', turn_id: 'turn_1', delta: 'hello ' },
      { event: 'agent_thought', seq: 3, session_id: 's1', turn_id: 'turn_1', stage: 'tool_intent', label: '思考参考', summary: 'call read_file', source: 'audit', status: 'done', tool_call_ids: ['call_1'], tool_names: ['read_file'] },
      { event: 'tool_call', seq: 4, session_id: 's1', turn_id: 'turn_1', id: 'call_1', name: 'read_file', arguments: { path: 'a.txt' } },
      { event: 'tool_result', seq: 5, session_id: 's1', turn_id: 'turn_1', id: 'call_1', name: 'read_file', summary: 'ok' },
      { event: 'ask_request', seq: 6, session_id: 's1', turn_id: 'turn_1', interaction: { id: 'ask_1', kind: 'ask', status: 'waiting', context: 'scope?' } },
      { event: 'assistant_done', seq: 7, session_id: 's1', turn_id: 'turn_1', content: 'hello world' },
    ], { sessionId: 's1' })

    expect(state.lastSeq).toBe(7)
    expect(state.messages[0]).toMatchObject({ role: 'user', content: 'run tools', turn_id: 'turn_1' })
    const assistant = state.messages.find((message) => message.role === 'assistant')
    expect(assistant).toMatchObject({ role: 'assistant', content: 'hello world', streaming: false, turn_id: 'turn_1' })
    expect(assistant?.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', content: 'hello world' }),
      expect.objectContaining({ type: 'thought', status: 'done', stage: 'tool_intent', summary: 'call read_file' }),
      expect.objectContaining({ type: 'tool', name: 'read_file', status: 'done', summary: 'ok' }),
      expect.objectContaining({ type: 'ask', interaction: expect.objectContaining({ id: 'ask_1' }) }),
    ]))
  })

  it('deduplicates replay events by seq and ignores other sessions', () => {
    const state = projectChatEvents([
      { event: 'user_message', seq: 1, session_id: 's1', turn_id: 'turn_1', content: 'keep' },
      { event: 'user_message', seq: 1, session_id: 's1', turn_id: 'turn_1', content: 'keep duplicate' },
      { event: 'user_message', seq: 2, session_id: 's2', turn_id: 'turn_2', content: 'drop' },
      { event: 'tool_result', seq: 3, session_id: 's1', turn_id: 'turn_1', id: 'orphan', name: 'grep', summary: 'result first' },
      { event: 'assistant_done', seq: 4, session_id: 's1', turn_id: 'turn_1', content: 'done' },
    ], { sessionId: 's1' })

    expect(state.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(JSON.stringify(state.messages)).not.toContain('drop')
    const assistant = state.messages.find((message) => message.role === 'assistant')
    expect(assistant?.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool', name: 'grep', status: 'done', summary: 'result first' }),
    ]))
  })

  it('replays new tool output and safely degrades legacy summary-only tool events', () => {
    const state = projectChatEvents([
      { event: 'user_message', seq: 1, session_id: 's1', turn_id: 'turn_1', content: 'tools' },
      { event: 'tool_call', seq: 2, session_id: 's1', turn_id: 'turn_1', id: 'call_new', name: 'run_command', arguments: { command: 'printf ok' } },
      { event: 'tool_result', seq: 3, session_id: 's1', turn_id: 'turn_1', id: 'call_new', name: 'run_command', summary: 'run_command exit 0', output: 'ok\n' },
      { event: 'tool_call', seq: 4, session_id: 's1', turn_id: 'turn_1', id: 'call_old', name: 'grep', arguments: { pattern: 'x' } },
      { event: 'tool_result', seq: 5, session_id: 's1', turn_id: 'turn_1', id: 'call_old', name: 'grep', summary: 'legacy grep summary' },
      { event: 'assistant_done', seq: 6, session_id: 's1', turn_id: 'turn_1', content: 'done' },
    ], { sessionId: 's1' })

    const assistant = state.messages.find((message) => message.role === 'assistant')
    const tools = assistant?.segments.filter((segment) => segment.type === 'tool') ?? []

    expect(tools.find((tool) => tool.toolId === 'call_new')).toMatchObject({
      summary: 'run_command exit 0',
      output: 'ok\n',
      outputMissing: false,
    })
    expect(tools.find((tool) => tool.toolId === 'call_old')).toMatchObject({
      summary: 'legacy grep summary',
      outputMissing: true,
    })
    expect(tools.find((tool) => tool.toolId === 'call_old')?.output).toBeUndefined()
  })

  it('keeps a plan approval resume turn inside the paused assistant flow during replay', () => {
    const state = projectChatEvents([
      { event: 'user_message', seq: 1, session_id: 's1', turn_id: 'turn_plan', content: 'make a plan' },
      { event: 'message_delta', seq: 2, session_id: 's1', turn_id: 'turn_plan', delta: 'drafting ' },
      {
        event: 'plan_draft',
        seq: 3,
        session_id: 's1',
        turn_id: 'turn_plan',
        interaction: { id: 'plan_1', kind: 'plan', status: 'waiting', title: 'Plan', plan_markdown: '# Plan' },
      },
      { event: 'turn_paused', seq: 4, session_id: 's1', turn_id: 'turn_plan', interaction: { id: 'plan_1', kind: 'plan', status: 'waiting' } },
      { event: 'plan_approved', seq: 5, session_id: 's1', interaction: { id: 'plan_1', kind: 'plan', status: 'approved' } },
      { event: 'user_message', seq: 6, session_id: 's1', turn_id: 'turn_resume', source: 'control', ui_hidden: true, content: '' },
      { event: 'message_delta', seq: 7, session_id: 's1', turn_id: 'turn_resume', delta: 'executing' },
      { event: 'assistant_done', seq: 8, session_id: 's1', turn_id: 'turn_resume', content: 'drafting executing' },
    ], { sessionId: 's1' })

    const assistants = state.messages.filter((message) => message.role === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({ content: 'drafting executing', streaming: false })
    expect(assistants[0]?.segments).toEqual([
      expect.objectContaining({ type: 'text', content: 'drafting ' }),
      expect.objectContaining({ type: 'plan', interaction: expect.objectContaining({ id: 'plan_1', status: 'approved' }) }),
      expect.objectContaining({ type: 'text', content: 'executing' }),
    ])
  })
})
