import type { AssistantMessage, ChatMessage, RuntimeHistoryItem } from '../types'
import {
  clearRuntimeSnapshotRaw,
  IN_FLIGHT_MAX_AGE_MS,
  readRuntimeSnapshotRaw,
  RUNTIME_MAX_AGE_MS,
} from './persistence'

export interface RuntimeSnapshot {
  messages: ChatMessage[]
  currentAssistantId: string | null
  lastSeq: number
  savedAt: number
  transcript?: RuntimeHistoryItem[]
}

function nextSnapshotId(prefix: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`
}

export function loadRuntimeSnapshot(history: RuntimeHistoryItem[]): RuntimeSnapshot | null {
  try {
    const raw = readRuntimeSnapshotRaw()
    if (!raw) return null
    const snapshot = JSON.parse(raw) as RuntimeSnapshot
    if (!snapshot.savedAt || Date.now() - snapshot.savedAt > RUNTIME_MAX_AGE_MS) {
      clearRuntimeSnapshotRaw()
      return null
    }
    if (!Array.isArray(snapshot.messages)) return null
    if (snapshot.currentAssistantId) {
      if (Date.now() - snapshot.savedAt > IN_FLIGHT_MAX_AGE_MS) {
        return finalizedSnapshot(snapshot)
      }
      if (!matchesInFlightBackendHistory(snapshot, history)) return null
      return snapshot
    }
    if (!matchesBackendHistory(snapshot, history)) return null
    return snapshot
  } catch {
    return null
  }
}

export function finalizedSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
  const messages = snapshot.messages.map((message) => {
    if (message.role !== 'assistant' || message.id !== snapshot.currentAssistantId) return message
    const fallback = '（上次回复已超时中断，请重新发送。）'
    const startedAt = assistantStartedAt(message)
    const endedAt = snapshot.savedAt
    const baseSegments = message.segments.map((segment) => {
      if (segment.type !== 'thought' || segment.status !== 'running') return segment
      return {
        ...segment,
        status: 'error_aborted' as const,
        endedAt,
        durationMs: segment.startedAt ? Math.max(0, endedAt - segment.startedAt) : segment.durationMs,
      }
    })
    const hasText = baseSegments.some((segment) => segment.type === 'text')
    const segments = hasText
      ? baseSegments
      : [...baseSegments, { id: nextSnapshotId('segment'), type: 'text' as const, content: fallback }]
    const content = message.content || fallback
    return {
      ...message,
      content,
      segments,
      streaming: false,
      startedAt,
      endedAt,
      durationMs: startedAt ? Math.max(0, endedAt - startedAt) : message.durationMs,
    } satisfies AssistantMessage
  })
  return { ...snapshot, messages, currentAssistantId: null, lastSeq: 0 }
}

function assistantStartedAt(message: AssistantMessage) {
  if (typeof message.startedAt === 'number') return message.startedAt
  const timedSegment = message.segments.find((segment) =>
    'startedAt' in segment && typeof segment.startedAt === 'number'
  )
  return timedSegment && 'startedAt' in timedSegment ? timedSegment.startedAt : undefined
}

export function matchesInFlightBackendHistory(snapshot: RuntimeSnapshot, history: RuntimeHistoryItem[]) {
  const expected = normalizeTranscript(history)
  const actual = normalizeTranscript(transcriptFromMessages(withoutCurrentAssistant(snapshot)))
  if (actual.length !== expected.length) return false
  return expected.every((item, index) => item.role === actual[index]?.role && item.content === actual[index]?.content)
}

export function withoutCurrentAssistant(snapshot: RuntimeSnapshot) {
  return snapshot.messages.filter((message) => message.id !== snapshot.currentAssistantId)
}

export function matchesBackendHistory(snapshot: RuntimeSnapshot, history: RuntimeHistoryItem[]) {
  const expected = normalizeTranscript(history)
  if (!expected.length) return false
  const actual = normalizeTranscript(snapshot.transcript?.length ? snapshot.transcript : transcriptFromMessages(snapshot.messages))
  if (actual.length !== expected.length) return false
  return expected.every((item, index) => item.role === actual[index]?.role && item.content === actual[index]?.content)
}

export function normalizeTranscript(items: RuntimeHistoryItem[]) {
  return items
    .filter((item) => (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map((item) => ({ role: item.role, content: item.content }))
}

export function transcriptFromMessages(items: ChatMessage[]): RuntimeHistoryItem[] {
  return items
    .filter((message) => !message.local)
    .map((message) => {
      if (message.role === 'user') return { role: 'user', content: message.content }
      return { role: 'assistant', content: assistantText(message) }
    })
}

export function assistantText(message: AssistantMessage) {
  if (message.content) return message.content
  return message.segments
    .filter((segment) => segment.type === 'text')
    .map((segment) => segment.content)
    .join('')
}
