import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateLegacyStateRoot } from './migrate-state-root'
import { ensureRuntimeStateDirs, resolveRuntimePaths } from './paths'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('migrateLegacyStateRoot', () => {
  it('copies legacy memory, sessions, and team state into .emperor once without deleting old data', () => {
    const root = tmp('emperor-legacy-state-')
    const paths = resolveRuntimePaths(root)
    mkdirSync(join(root, 'memory'), { recursive: true })
    mkdirSync(join(root, 'sessions', 'legacy-session'), { recursive: true })
    mkdirSync(join(root, '.team'), { recursive: true })
    writeFileSync(join(root, 'memory', 'MEMORY.local.md'), '# Legacy memory\n', 'utf8')
    writeFileSync(join(root, 'sessions', 'legacy-session', 'history.jsonl'), '{"role":"user","content":"old"}\n', 'utf8')
    writeFileSync(join(root, '.team', 'config.json'), '{"members":[]}\n', 'utf8')

    ensureRuntimeStateDirs(paths)
    const first = migrateLegacyStateRoot(paths)
    const second = migrateLegacyStateRoot(paths)

    expect(first.copied).toBe(3)
    expect(second.copied).toBe(0)
    expect(readFileSync(join(paths.memoryRoot, 'MEMORY.local.md'), 'utf8')).toContain('Legacy memory')
    expect(readFileSync(join(paths.sessionsRoot, 'legacy-session', 'history.jsonl'), 'utf8')).toContain('old')
    expect(readFileSync(join(paths.teamRoot, 'config.json'), 'utf8')).toContain('members')
    expect(existsSync(join(root, 'memory', 'MEMORY.local.md'))).toBe(true)
    expect(existsSync(join(root, 'sessions', 'legacy-session', 'history.jsonl'))).toBe(true)
    expect(existsSync(join(root, '.team', 'config.json'))).toBe(true)
    expect(readFileSync(join(paths.stateRoot, 'migration-log.jsonl'), 'utf8').trim().split('\n')).toHaveLength(3)
  })

  it('skips corrupt legacy json indexes and records the reason', () => {
    const root = tmp('emperor-legacy-state-corrupt-')
    const paths = resolveRuntimePaths(root)
    mkdirSync(join(root, 'sessions'), { recursive: true })
    writeFileSync(join(root, 'sessions', 'index.json'), '{bad json\n', 'utf8')

    ensureRuntimeStateDirs(paths)
    const result = migrateLegacyStateRoot(paths)

    expect(result.skipped).toBe(1)
    expect(existsSync(join(paths.sessionsRoot, 'index.json'))).toBe(false)
    const log = readFileSync(join(paths.stateRoot, 'migration-log.jsonl'), 'utf8')
    expect(log).toContain('skipped_corrupt_json')
    expect(log).toContain('sessions/index.json')
  })
})
