import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PROJECT_MEMORY_END,
  PROJECT_MEMORY_START,
  ProjectStateStore,
} from './state-store'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('ProjectStateStore', () => {
  it('keeps private project memory under state root and leaves workspace AGENTS.md untouched', () => {
    const stateRoot = tmp('emperor-project-state-')
    const workspace = tmp('emperor-project-workspace-')
    const workspaceAgents = join(workspace, 'AGENTS.md')
    const legacyText = [
      '# Workspace Instructions',
      '',
      'Do not mutate this file.',
      '',
      PROJECT_MEMORY_START,
      '- legacy private memory',
      PROJECT_MEMORY_END,
      '',
    ].join('\n')
    writeFileSync(workspaceAgents, legacyText, 'utf8')
    const store = new ProjectStateStore(join(stateRoot, 'projects'))

    const ensured = store.ensureProject({
      project_id: 'project_1',
      project_path: workspace,
      project_name: 'workspace',
      summary: '',
      created_at: '2026-07-02T09:00:00+0800',
      updated_at: '2026-07-02T09:00:00+0800',
      version: 1,
    })

    expect(ensured.memory_path).toBe(join(stateRoot, 'projects', 'project_1', 'AGENTS.local.md'))
    expect(ensured.prompt_overlay_path).toBe(join(stateRoot, 'projects', 'project_1', 'prompt-overlay.md'))
    expect(ensured.legacy_agents_path).toBe(workspaceAgents)
    expect(ensured.legacy_imported_at).toBeTruthy()
    expect(readFileSync(workspaceAgents, 'utf8')).toBe(legacyText)
    expect(store.readManagedMemory('project_1')).toContain('legacy private memory')

    store.writeManagedMemory('project_1', '## Project\n\n- state only')

    expect(store.readManagedMemory('project_1')).toContain('state only')
    expect(readFileSync(workspaceAgents, 'utf8')).toBe(legacyText)
    expect(existsSync(ensured.prompt_overlay_path)).toBe(true)
    expect(readFileSync(ensured.project_json_path, 'utf8')).toContain('"memory_path"')
  })
})
