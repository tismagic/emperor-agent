import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { resolveAssetPath, resolveAttachmentRawPath, resolveMediaRawPath } from './protocol'

const ROOT = '/app/out/renderer'

describe('resolveAssetPath', () => {
  it('maps the root path to index.html', () => {
    expect(resolveAssetPath('/', ROOT)).toBe(path.join(ROOT, 'index.html'))
  })

  it('serves real asset files with an extension', () => {
    expect(resolveAssetPath('/assets/index-abc.js', ROOT)).toBe(path.join(ROOT, 'assets/index-abc.js'))
  })

  it('falls back to index.html for extensionless deep-link routes', () => {
    expect(resolveAssetPath('/chat', ROOT)).toBe(path.join(ROOT, 'index.html'))
    expect(resolveAssetPath('/skills/foo', ROOT)).toBe(path.join(ROOT, 'index.html'))
  })

  it('blocks directory traversal by falling back to index.html', () => {
    expect(resolveAssetPath('/../etc/passwd', ROOT)).toBe(path.join(ROOT, 'index.html'))
    expect(resolveAssetPath('/../../secret.js', ROOT)).toBe(path.join(ROOT, 'index.html'))
  })
})

describe('resolveAttachmentRawPath', () => {
  it('maps app://attachments/{id}/raw to an attachment file under memory/attachments', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'emperor-attachment-protocol-'))
    const dir = path.join(root, 'memory', 'attachments', '2026-06')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'abcdef12-photo.png'), 'image')

    expect(resolveAttachmentRawPath('app://attachments/att_2026-06_abcdef12/raw', root)).toBe(path.join(dir, 'abcdef12-photo.png'))
  })

  it('rejects malformed attachment URLs', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'emperor-attachment-protocol-'))
    expect(resolveAttachmentRawPath('app://attachments/../../secret/raw', root)).toBeNull()
    expect(resolveAttachmentRawPath('app://bundle/index.html', root)).toBeNull()
  })
})

describe('resolveMediaRawPath', () => {
  it('maps app://media/{id}/raw to a managed media file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'emperor-media-protocol-'))
    const dir = path.join(root, 'memory', 'media', '2026-06')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'abcdef12-screen.png'), 'image')

    expect(resolveMediaRawPath('app://media/media_2026-06_abcdef12/raw', root)).toBe(path.join(dir, 'abcdef12-screen.png'))
  })

  it('rejects malformed media URLs', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'emperor-media-protocol-'))
    expect(resolveMediaRawPath('app://media/../../secret/raw', root)).toBeNull()
    expect(resolveMediaRawPath('app://attachments/att_2026-06_abcdef12/raw', root)).toBeNull()
  })
})
