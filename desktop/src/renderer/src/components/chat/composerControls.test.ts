import { describe, expect, it } from 'vitest'
import { composerModeOptions, composerSendDisabled, currentComposerMode } from './composerControls'

describe('composer control model', () => {
  it('keeps the stop button clickable while a turn is busy', () => {
    expect(composerSendDisabled({ busy: true, content: '', attachmentCount: 0 })).toBe(false)
  })

  it('disables send only when idle with no content or attachments', () => {
    expect(composerSendDisabled({ busy: false, content: '', attachmentCount: 0 })).toBe(true)
    expect(composerSendDisabled({ busy: false, content: 'hi', attachmentCount: 0 })).toBe(false)
    expect(composerSendDisabled({ busy: false, content: '', attachmentCount: 1 })).toBe(false)
  })

  it('blocks idle sending when the model is unavailable without disabling the busy stop button', () => {
    expect(composerSendDisabled({ busy: false, content: 'hi', attachmentCount: 0, sendBlockedReason: '请先配置模型' })).toBe(true)
    expect(composerSendDisabled({ busy: false, content: '', attachmentCount: 1, sendBlockedReason: '请先配置模型' })).toBe(true)
    expect(composerSendDisabled({ busy: true, content: 'hi', attachmentCount: 0, sendBlockedReason: '请先配置模型' })).toBe(false)
  })

  it('exposes accept_edits as the middle permission mode', () => {
    expect(composerModeOptions.map((option) => option.value)).toEqual([
      'ask_before_edit',
      'accept_edits',
      'auto',
      'plan',
    ])
    expect(currentComposerMode('accept_edits')).toMatchObject({
      value: 'accept_edits',
      short: '编辑',
    })
    expect(currentComposerMode('normal').value).toBe('ask_before_edit')
  })
})
