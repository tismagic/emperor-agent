import { describe, expect, it } from 'vitest'

describe('runtime snapshot helpers', () => {
  it('builds backend transcript from non-local messages', async () => {
    const { assistantText, transcriptFromMessages } = await import('./snapshot')
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', segments: [{ type: 'text', content: 'ok' }], streaming: false },
      { role: 'assistant', content: 'skip', local: true, segments: [], streaming: false },
    ]

    expect(transcriptFromMessages(messages as never)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'ok' },
    ])
    expect(assistantText(messages[1] as never)).toBe('ok')
  })

  it('finalizes stale current assistant snapshots', async () => {
    const { finalizedSnapshot } = await import('./snapshot')
    const snapshot = {
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          segments: [{ id: 'thought-1', type: 'thought', status: 'running', startedAt: 100 }],
          streaming: true,
        },
      ],
      currentAssistantId: 'assistant-1',
      lastSeq: 7,
      savedAt: 200,
      transcript: [],
    }

    const result = finalizedSnapshot(snapshot as never)

    expect(result.currentAssistantId).toBeNull()
    expect(result.lastSeq).toBe(0)
    expect(result.messages[0].streaming).toBe(false)
    expect(result.messages[0].content).toBe('（上次回复已超时中断，请重新发送。）')
    expect(result.messages[0].segments.some((segment: { type: string }) => segment.type === 'text')).toBe(true)
    expect(result.messages[0].segments[0].status).toBe('error_aborted')
  })
})
