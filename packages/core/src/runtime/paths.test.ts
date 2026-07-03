import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureRuntimeStateDirs, resolveRuntimePaths } from './paths'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('RuntimePaths', () => {
  it('keeps runtime assets at runtimeRoot and private state under .emperor by default', () => {
    const root = tmp('emperor-runtime-paths-')
    const paths = resolveRuntimePaths(root)

    expect(paths.runtimeRoot).toBe(root)
    expect(paths.stateRoot).toBe(join(root, '.emperor'))
    expect(paths.templatesDir).toBe(join(root, 'templates'))
    expect(paths.skillsDir).toBe(join(root, 'skills'))
    expect(paths.assetsDir).toBe(join(root, 'assets'))
    expect(paths.memoryRoot).toBe(join(root, '.emperor', 'memory'))
    expect(paths.sessionsRoot).toBe(join(root, '.emperor', 'sessions'))
    expect(paths.projectsRoot).toBe(join(root, '.emperor', 'projects'))
    expect(paths.attachmentsRoot).toBe(join(root, '.emperor', 'attachments'))
    expect(paths.mediaRoot).toBe(join(root, '.emperor', 'media'))
  })

  it('creates only state directories when ensuring runtime state', () => {
    const root = tmp('emperor-runtime-paths-')
    const paths = resolveRuntimePaths(root)

    ensureRuntimeStateDirs(paths)

    expect(existsSync(paths.stateRoot)).toBe(true)
    expect(existsSync(paths.memoryRoot)).toBe(true)
    expect(existsSync(paths.sessionsRoot)).toBe(true)
    expect(existsSync(paths.projectsRoot)).toBe(true)
    expect(existsSync(paths.attachmentsRoot)).toBe(true)
    expect(existsSync(paths.mediaRoot)).toBe(true)
    expect(existsSync(paths.templatesDir)).toBe(false)
    expect(existsSync(paths.skillsDir)).toBe(false)
    expect(existsSync(paths.assetsDir)).toBe(false)
  })

  it('supports an explicit stateRoot outside runtimeRoot', () => {
    const root = tmp('emperor-runtime-root-')
    const stateRoot = tmp('emperor-state-root-')
    const paths = resolveRuntimePaths(root, { stateRoot })

    expect(paths.runtimeRoot).toBe(root)
    expect(paths.stateRoot).toBe(stateRoot)
    expect(paths.memoryRoot).toBe(join(stateRoot, 'memory'))
    expect(paths.sessionsRoot).toBe(join(stateRoot, 'sessions'))
  })
})
