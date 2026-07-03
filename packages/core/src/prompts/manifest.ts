import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PromptSectionInput {
  name: string
  content: string
  source: string
  priority: number
  budgetChars: number | null
  version: string | null
  scope?: string | null
}

export interface PromptManifestSection {
  name: string
  source: string
  priority: number
  budgetChars: number | null
  version: string | null
  scope: string | null
  hash: string
  charCount: number
  tokenEstimate: number
  clipped: boolean
  redacted: boolean
}

export interface PromptSnapshot {
  version: 1
  sessionId: string | null
  turnId: string
  createdAt: string
  model: string
  provider: string | null
  modelRole: string
  estimatedInputTokens: number | null
  sections: PromptManifestSection[]
  totals: {
    charCount: number
    tokenEstimate: number
  }
}

export function toPromptManifestSection(section: PromptSectionInput): PromptManifestSection {
  const content = String(section.content ?? '')
  const budgetChars = section.budgetChars ?? null
  return {
    name: String(section.name || 'section'),
    source: String(section.source || 'unknown'),
    priority: Number(section.priority ?? 0),
    budgetChars,
    version: section.version ?? null,
    scope: section.scope ?? null,
    hash: createHash('sha256').update(content, 'utf8').digest('hex'),
    charCount: content.length,
    tokenEstimate: estimateTokens(content),
    clipped: budgetChars !== null && (content.length >= budgetChars || content.includes('clipped by ContextBuilder')),
    redacted: true,
  }
}

export function writePromptSnapshot(opts: {
  dir: string
  sessionId?: string | null
  turnId: string
  model: string
  provider?: string | null
  modelRole?: string | null
  estimatedInputTokens?: number | null
  sections: PromptSectionInput[]
}): PromptSnapshot {
  mkdirSync(opts.dir, { recursive: true })
  const sections = opts.sections.map(toPromptManifestSection)
  const snapshot: PromptSnapshot = {
    version: 1,
    sessionId: opts.sessionId ?? null,
    turnId: opts.turnId,
    createdAt: new Date().toISOString(),
    model: opts.model,
    provider: opts.provider ?? null,
    modelRole: opts.modelRole ?? 'main',
    estimatedInputTokens: opts.estimatedInputTokens ?? null,
    sections,
    totals: {
      charCount: sections.reduce((sum, section) => sum + section.charCount, 0),
      tokenEstimate: sections.reduce((sum, section) => sum + section.tokenEstimate, 0),
    },
  }
  writeFileSync(join(opts.dir, `${safeName(opts.turnId)}.json`), JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
  return snapshot
}

export function listRecentPromptSnapshots(sessionsRoot: string, limit = 5): { count: number; recent: PromptSnapshot[] } {
  const snapshots: PromptSnapshot[] = []
  if (!existsSync(sessionsRoot)) return { count: 0, recent: [] }
  for (const sessionName of readdirSync(sessionsRoot)) {
    const snapshotDir = join(sessionsRoot, sessionName, 'prompt-snapshots')
    if (!existsSync(snapshotDir) || !statSync(snapshotDir).isDirectory()) continue
    for (const name of readdirSync(snapshotDir)) {
      if (!name.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(readFileSync(join(snapshotDir, name), 'utf8') || '{}')
        if (isPromptSnapshot(parsed)) snapshots.push(parsed)
      } catch {
        // Diagnostics should not fail because one snapshot file is corrupt.
      }
    }
  }
  snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { count: snapshots.length, recent: snapshots.slice(0, limit) }
}

function isPromptSnapshot(value: unknown): value is PromptSnapshot {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as PromptSnapshot).sections))
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function safeName(value: string): string {
  return String(value || 'turn').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'turn'
}
