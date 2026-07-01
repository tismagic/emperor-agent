import { randomUUID } from 'node:crypto'
import type { AgentLoop } from '../agent/loop'
import type { SchedulerAgentTurnPayload } from '../scheduler/executor'

export type MainlineEventSink = (event: Record<string, unknown>) => void | Promise<void>

export interface MainlineSubmitInput {
  content: string
  displayContent?: string | null
  attachments?: Array<Record<string, unknown>> | null
  attachmentIds?: string[] | null
  clientMessageId?: string | null
  memoryExtra?: Record<string, unknown> | null
  turnId?: string | null
  label?: string | null
  sessionId?: string | null
  source?: string | null
  scheduler?: Record<string, unknown> | null
  taskId?: string | null
  useActiveTask?: boolean
  emit?: MainlineEventSink | null
}

export interface MainlineSubmitResult {
  turnId: string
  content: string
  activeSessionId: string | null
}

export class MainlineTurnService {
  readonly loop: AgentLoop

  constructor(loop: AgentLoop) {
    this.loop = loop
  }

  async submit(input: MainlineSubmitInput): Promise<MainlineSubmitResult> {
    const turnId = input.turnId || randomUUID().replace(/-/g, '').slice(0, 16)
    const sessionId = String(input.sessionId ?? '').trim()
    if (sessionId && !sessionId.startsWith('draft:')) this.loop.activateSession(sessionId)

    const content = String(input.content ?? '')
    const displayContent = input.displayContent ?? content
    const reply = await this.loop.runUserTurn(content, {
      turnId,
      emit: input.emit ?? null,
      displayContent,
      clientMessageId: input.clientMessageId ?? turnId,
      source: input.source ?? null,
      scheduler: input.scheduler ?? null,
      memoryExtra: input.memoryExtra ?? null,
      taskId: input.taskId ?? null,
      useActiveTask: input.useActiveTask,
    })

    return { turnId, content: reply, activeSessionId: this.loop.activeSessionId }
  }

  async submitSchedulerTurn(payload: SchedulerAgentTurnPayload): Promise<string> {
    const result = await this.submit({
      content: payload.content,
      displayContent: payload.displayContent,
      clientMessageId: payload.clientMessageId,
      turnId: payload.clientMessageId,
      source: payload.source,
      scheduler: payload.scheduler,
      taskId: payload.taskId,
      emit: payload.deliver ? this.loop.eventSink : async () => undefined,
    })
    return result.content
  }
}

export class ChatService {
  readonly mainline: MainlineTurnService

  constructor(mainline: MainlineTurnService) {
    this.mainline = mainline
  }

  submit(input: MainlineSubmitInput): Promise<MainlineSubmitResult> {
    return this.mainline.submit({ ...input, source: input.source ?? 'chat' })
  }
}
