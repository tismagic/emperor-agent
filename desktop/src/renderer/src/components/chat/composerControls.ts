export function composerSendDisabled(opts: {
  busy: boolean
  content: string
  attachmentCount: number
  sendBlockedReason?: string | null
}): boolean {
  if (opts.busy) return false
  if (opts.sendBlockedReason) return true
  return !opts.content.trim() && opts.attachmentCount === 0
}

export type ControlModeValue =
  'ask_before_edit' | 'accept_edits' | 'auto' | 'plan'

export interface ComposerModeOption {
  value: ControlModeValue
  label: string
  short: string
  description: string
}

export const composerModeOptions: ComposerModeOption[] = [
  {
    value: 'ask_before_edit',
    label: '询问确认',
    short: '询问',
    description: '高风险或不确定操作前先确认',
  },
  {
    value: 'accept_edits',
    label: '接受编辑',
    short: '编辑',
    description: '文件编辑可直接执行，shell、团队和定时任务仍需确认',
  },
  {
    value: 'auto',
    label: '自动执行',
    short: '自动',
    description: '在当前权限下直接推进任务',
  },
  {
    value: 'plan',
    label: '计划预览',
    short: '计划',
    description: '先只读探索，再提交计划审批',
  },
]

export function normalizeComposerControlMode(
  mode: string | null | undefined,
): ControlModeValue {
  if (mode === 'normal' || !mode) return 'ask_before_edit'
  if (mode === 'accept_edits') return 'accept_edits'
  if (mode === 'auto') return 'auto'
  if (mode === 'plan') return 'plan'
  return 'ask_before_edit'
}

export function currentComposerMode(
  mode: string | null | undefined,
): ComposerModeOption {
  const normalized = normalizeComposerControlMode(mode)
  return (
    composerModeOptions.find((item) => item.value === normalized) ??
    composerModeOptions[0]!
  )
}
