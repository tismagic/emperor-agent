import type { ChatMessage } from '../../types'

export function messageScrollSignature(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1]
  if (!last) return '0'
  if (last.role === 'user') {
    return [
      messages.length,
      last.id,
      last.content.length,
      last.attachments?.length ?? 0,
      last.source ?? '',
    ].join(':')
  }
  return [
    messages.length,
    last.id,
    last.content.length,
    last.segments.length,
    last.todos?.length ?? 0,
    last.streaming ? 1 : 0,
  ].join(':')
}
