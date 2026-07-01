import type { AttachmentRef } from '../types'
import { apiUrl, hasCoreBridge, invokeCore } from './backend'

export async function uploadAttachment(file: File): Promise<AttachmentRef> {
  if (hasCoreBridge()) {
    const raw = new Uint8Array(await file.arrayBuffer())
    return await invokeCore('attachments.save', {
      raw,
      name: file.name,
      mime: file.type || 'application/octet-stream',
    }) as AttachmentRef
  }
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(apiUrl('/api/attachments'), { method: 'POST', body: fd })
  if (!r.ok) {
    let message = `HTTP ${r.status}`
    try {
      const data = await r.json()
      if (data && typeof data.error === 'string') message = data.error
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }
  return (await r.json()) as AttachmentRef
}

export function attachmentRawUrl(id: string): string {
  if (hasCoreBridge()) return `app://attachments/${encodeURIComponent(id)}/raw`
  return apiUrl(`/api/attachments/${encodeURIComponent(id)}/raw`)
}
