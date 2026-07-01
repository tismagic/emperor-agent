import * as fs from 'node:fs'
import * as path from 'node:path'

// Map an app:// request pathname to a file inside the bundled renderer.
//
// Rules:
// - root ("/") and any extensionless path (a Vue history-mode route such as
//   "/chat" or "/skills/foo") resolve to index.html (SPA fallback).
// - paths with a file extension resolve to that file under rendererRoot.
// - anything that escapes rendererRoot (directory traversal) falls back to
//   index.html rather than leaking host files.
export function resolveAssetPath(requestPath: string, rendererRoot: string): string {
  const indexHtml = path.join(rendererRoot, 'index.html')

  let rel: string
  try {
    rel = decodeURIComponent(requestPath)
  } catch {
    return indexHtml
  }
  rel = rel.replace(/^\/+/, '')
  if (rel === '') return indexHtml

  const resolved = path.resolve(rendererRoot, rel)
  const rootWithSep = rendererRoot.endsWith(path.sep) ? rendererRoot : rendererRoot + path.sep
  if (resolved !== rendererRoot && !resolved.startsWith(rootWithSep)) {
    return indexHtml
  }

  if (!path.extname(resolved)) return indexHtml
  return resolved
}

export function resolveAttachmentRawPath(requestUrl: string, root: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'app:' || url.host !== 'attachments') return null
  const parts = url.pathname.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part) } catch { return '' }
  })
  if (parts.length !== 2 || parts[1] !== 'raw') return null
  const match = /^att_(\d{4}-\d{2})_([0-9a-f]{8})$/.exec(parts[0] || '')
  if (!match) return null
  const [, month, hash8] = match
  const dir = path.join(root, 'memory', 'attachments', month!)
  let names: string[]
  try {
    names = fs.readdirSync(dir).sort()
  } catch {
    return null
  }
  for (const name of names) {
    if (!name.startsWith(`${hash8}-`) || name.endsWith('.txt')) continue
    const candidate = path.resolve(dir, name)
    const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep
    if (!candidate.startsWith(dirWithSep)) continue
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

export function resolveMediaRawPath(requestUrl: string, root: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'app:' || url.host !== 'media') return null
  const parts = url.pathname.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part) } catch { return '' }
  })
  if (parts.length !== 2 || parts[1] !== 'raw') return null
  const match = /^media_(\d{4}-\d{2})_([0-9a-f]{8})$/.exec(parts[0] || '')
  if (!match) return null
  const [, month, hash8] = match
  const dir = path.join(root, 'memory', 'media', month!)
  let names: string[]
  try {
    names = fs.readdirSync(dir).sort()
  } catch {
    return null
  }
  for (const name of names) {
    if (!name.startsWith(`${hash8}-`)) continue
    const candidate = path.resolve(dir, name)
    const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep
    if (!candidate.startsWith(dirWithSep)) continue
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Try the next candidate.
    }
  }
  return null
}
