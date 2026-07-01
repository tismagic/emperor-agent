import { describe, expect, it } from 'vitest'
import type { ToolSegment } from '../../types'
import { toolTargetLabel, toolTitle } from './toolDisplay'

function tool(name: string, extra: Partial<ToolSegment> = {}): ToolSegment {
  return {
    id: 'tool-1',
    type: 'tool',
    name,
    status: 'done',
    ...extra,
  }
}

describe('tool display helpers', () => {
  it('prefers result metadata path over call arguments for file tools', () => {
    expect(toolTitle(tool('read_file', {
      arguments: { path: 'stale/path.ts' },
      metadata: { path: 'src/current/path.ts' },
    }))).toBe('Read · path.ts')
  })

  it('uses the final file name for file tool targets', () => {
    expect(toolTitle(tool('read_file', {
      arguments: { path: '/a/b/mario/js/collision.js' },
    }))).toBe('Read · collision.js')
    expect(toolTitle(tool('edit_file', {
      metadata: { path: 'desktop/src/renderer/src/App.vue' },
    }))).toBe('Edit · App.vue')
  })

  it('keeps bash titles generic while other non-file tools show targets', () => {
    expect(toolTitle(tool('glob', { arguments: { pattern: 'src/**/*.vue' } }))).toBe('Glob · src/**/*.vue')
    expect(toolTitle(tool('grep', { arguments: { pattern: 'projectAssistantFlow' } }))).toBe('Search · projectAssistantFlow')
    expect(toolTitle(tool('run_command', { arguments: { command: 'npm run build -- --mode production' } }))).toBe('Bash · 执行命令')
  })

  it('shortens long non-file targets while preserving useful tail content', () => {
    const label = toolTargetLabel(tool('edit_file', {
      arguments: { path: '/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/ToolGroup.vue' },
    }))

    expect(label).toBe('ToolGroup.vue')

    const url = toolTargetLabel(tool('web_fetch', {
      arguments: { url: 'https://example.com/docs/some/really/long/path/that/keeps/going/reference.html' },
    }))

    expect(url).toBe('.../that/keeps/going/reference.html')
  })
})
