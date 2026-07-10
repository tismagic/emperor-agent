import { randomUUID } from 'node:crypto'
import { nowTs } from '../util/time'

export function newExternalId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export class ExternalAttachment {
  name: string
  mime: string
  size: number
  path: string
  metadata: Record<string, unknown>

  constructor(opts: {
    name: string
    mime?: string
    size?: number
    path?: string
    metadata?: Record<string, unknown>
  }) {
    this.name = opts.name
    this.mime = opts.mime ?? ''
    this.size = opts.size ?? 0
    this.path = opts.path ?? ''
    this.metadata = opts.metadata ?? {}
  }

  toDict(): Record<string, unknown> {
    return {
      name: this.name,
      mime: this.mime,
      size: this.size,
      path: this.path,
      metadata: { ...this.metadata },
    }
  }

  static fromDict(raw: Record<string, unknown>): ExternalAttachment {
    return new ExternalAttachment({
      name: String(raw.name ?? ''),
      mime: String(raw.mime ?? ''),
      size: Number(raw.size ?? 0),
      path: String(raw.path ?? ''),
      metadata: objectOrEmpty(raw.metadata),
    })
  }
}

export class ExternalInbound {
  platform: string
  sender_id: string
  content: string
  external_message_id: string
  target_id: string
  attachments: ExternalAttachment[]
  metadata: Record<string, unknown>
  received_at: number
  id: string

  constructor(opts: {
    platform: string
    sender_id: string
    content: string
    external_message_id?: string
    target_id?: string
    attachments?: ExternalAttachment[]
    metadata?: Record<string, unknown>
    received_at?: number
    id?: string
  }) {
    this.platform = opts.platform
    this.sender_id = opts.sender_id
    this.content = opts.content
    this.external_message_id = opts.external_message_id ?? ''
    this.target_id = opts.target_id ?? ''
    this.attachments = opts.attachments ?? []
    this.metadata = opts.metadata ?? {}
    this.received_at = opts.received_at ?? nowTs()
    this.id = opts.id ?? newExternalId('ext_in')
  }

  get dedupeKey(): [string, string] | null {
    const messageId = this.external_message_id.trim()
    return messageId ? [this.platform, messageId] : null
  }

  toDict(): Record<string, unknown> {
    return {
      id: this.id,
      platform: this.platform,
      sender_id: this.sender_id,
      target_id: this.target_id,
      external_message_id: this.external_message_id,
      content: this.content,
      attachments: this.attachments.map((item) => item.toDict()),
      metadata: { ...this.metadata },
      received_at: this.received_at,
    }
  }

  static fromDict(raw: Record<string, unknown>): ExternalInbound {
    const attachments = Array.isArray(raw.attachments)
      ? raw.attachments
          .filter(isRecord)
          .map((item) => ExternalAttachment.fromDict(item))
      : []
    return new ExternalInbound({
      id: String(raw.id ?? '') || undefined,
      platform: String(raw.platform ?? ''),
      sender_id: String(raw.sender_id ?? raw.senderId ?? ''),
      target_id: String(raw.target_id ?? raw.targetId ?? ''),
      external_message_id: String(
        raw.external_message_id ?? raw.externalMessageId ?? '',
      ),
      content: String(raw.content ?? ''),
      attachments,
      metadata: objectOrEmpty(raw.metadata),
      received_at: Number(raw.received_at ?? raw.receivedAt ?? nowTs()),
    })
  }
}

export class ExternalOutbound {
  platform: string
  target_id: string
  content: string
  media: string[]
  metadata: Record<string, unknown>
  id: string
  created_at: number

  constructor(opts: {
    platform: string
    target_id: string
    content: string
    media?: string[]
    metadata?: Record<string, unknown>
    id?: string
    created_at?: number
  }) {
    this.platform = opts.platform
    this.target_id = opts.target_id
    this.content = opts.content
    this.media = opts.media ?? []
    this.metadata = opts.metadata ?? {}
    this.id = opts.id ?? newExternalId('ext_out')
    this.created_at = opts.created_at ?? nowTs()
  }

  toDict(): Record<string, unknown> {
    return {
      id: this.id,
      platform: this.platform,
      target_id: this.target_id,
      content: this.content,
      media: [...this.media],
      metadata: { ...this.metadata },
      created_at: this.created_at,
    }
  }
}

export class ExternalDeliveryResult {
  ok: boolean
  external_message_id: string
  error: string
  metadata: Record<string, unknown>

  constructor(opts: {
    ok: boolean
    external_message_id?: string
    error?: string
    metadata?: Record<string, unknown>
  }) {
    this.ok = opts.ok
    this.external_message_id = opts.external_message_id ?? ''
    this.error = opts.error ?? ''
    this.metadata = opts.metadata ?? {}
  }

  toDict(): Record<string, unknown> {
    return {
      ok: this.ok,
      external_message_id: this.external_message_id,
      error: this.error,
      metadata: { ...this.metadata },
    }
  }
}

export function seenKey(platform: string, messageId: string): string {
  return `${platform}\u0000${messageId}`
}

export function splitSeenKey(key: string): [string, string] {
  const idx = key.indexOf('\u0000')
  return idx >= 0 ? [key.slice(0, idx), key.slice(idx + 1)] : ['', '']
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
