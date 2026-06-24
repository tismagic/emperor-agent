import type { AssistantMessage, ToolArtifactRef, ToolSegment, ToolStatus } from '../types'

export interface ToolResultUpdate {
  summary?: string
  artifacts?: ToolArtifactRef[]
  metadata?: Record<string, unknown>
  todos?: ToolSegment['todos']
  isError?: boolean
  endedAt?: number
}

export interface ToolRunUpdate {
  status: Extract<ToolStatus, 'done' | 'error' | 'error_aborted'>
  summary?: string
  artifacts?: ToolArtifactRef[]
  metadata?: Record<string, unknown>
  endedAt?: number
}

export function applyToolResultToSegment(segment: ToolSegment, update: ToolResultUpdate) {
  finishTimedTool(segment, update.endedAt)
  segment.status = update.isError ? 'error' : 'done'
  segment.summary = update.summary || (update.isError ? '工具执行出错' : '已完成')
  if (update.artifacts) segment.artifacts = update.artifacts
  if (update.metadata) segment.metadata = update.metadata
  if (update.todos) segment.todos = update.todos
}

export function applyToolRunUpdateToSegment(segment: ToolSegment, update: ToolRunUpdate) {
  finishTimedTool(segment, update.endedAt)
  segment.status = update.status
  if (update.summary) segment.summary = update.summary
  if (update.artifacts) segment.artifacts = update.artifacts
  if (update.metadata) segment.metadata = update.metadata
}

export function settleRunningToolSegments(
  assistant: AssistantMessage,
  options: { endedAt?: number; summary?: string; status?: Extract<ToolStatus, 'error_aborted' | 'error'> } = {},
) {
  const endedAt = options.endedAt ?? Date.now()
  let settled = 0
  for (const segment of assistant.segments) {
    if (segment.type !== 'tool' || segment.status !== 'running') continue
    finishTimedTool(segment, endedAt)
    segment.status = options.status || 'error_aborted'
    segment.summary = options.summary || segment.summary || '工具未返回结束事件'
    settled += 1
  }
  return settled
}

function finishTimedTool(segment: ToolSegment, endedAt = Date.now()) {
  segment.endedAt = endedAt
  if (segment.startedAt) segment.durationMs = Math.max(0, endedAt - segment.startedAt)
}
