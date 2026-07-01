import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Tool } from '../../tools/base'
import { ToolRegistry } from '../../tools/registry'
import type { ToolParamsSchema } from '../../tools/schema'
import { CoreSkillService } from './skill-service'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

class FakeTool extends Tool {
  readonly name: string
  readonly description: string
  readonly parameters: ToolParamsSchema = { type: 'object', properties: { q: { type: 'string', description: 'query' } }, required: [] }
  override readOnly: boolean
  override concurrencySafe: boolean

  constructor(name: string, opts: { description?: string; readOnly?: boolean; concurrencySafe?: boolean } = {}) {
    super()
    this.name = name
    this.description = opts.description ?? `${name} description`
    this.readOnly = opts.readOnly ?? false
    this.concurrencySafe = opts.concurrencySafe ?? false
  }

  execute(): string {
    return 'ok'
  }
}

describe('CoreSkillService (MIG-IPC-007)', () => {
  it('projects tool definitions into WebUI capability payloads', () => {
    const registry = new ToolRegistry()
    registry.register(new FakeTool('read_file', { readOnly: true, concurrencySafe: true }))
    registry.register(new FakeTool('mcp_docs_search', { description: '[MCP:docs] Search docs', readOnly: true }))
    const service = new CoreSkillService(tmp('emperor-skill-service-tools-'), { registry })

    expect(service.tools()).toEqual([
      expect.objectContaining({
        name: 'read_file',
        parameters: { type: 'object', properties: { q: { type: 'string', description: 'query' } }, required: [] },
        read_only: true,
        concurrency_safe: true,
        source: 'builtin',
        server: '',
      }),
      expect.objectContaining({
        name: 'mcp_docs_search',
        description: '[MCP:docs] Search docs',
        read_only: true,
        source: 'mcp',
        server: 'docs',
      }),
    ])
  })

  it('lists, reads, writes, and deletes skills with frontmatter metadata', () => {
    const root = tmp('emperor-skill-service-skills-')
    const skillDir = join(root, 'skills', 'code-audit')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: code-audit',
      'description: Audit code changes',
      'tags: review backend',
      'always: true',
      '---',
      '',
      '# Code Audit',
      '',
    ].join('\n'), 'utf8')
    let refreshes = 0
    const service = new CoreSkillService(root, {
      refreshRuntimeContext: () => { refreshes += 1 },
    })

    expect(service.list()).toEqual([
      {
        name: 'code-audit',
        description: 'Audit code changes',
        path: 'skills/code-audit/SKILL.md',
        tags: 'review backend',
        always: true,
      },
    ])
    expect(service.get('code-audit')).toMatchObject({
      name: 'code-audit',
      path: 'skills/code-audit/SKILL.md',
      content: expect.stringContaining('# Code Audit'),
    })

    const saved = service.save('writer', '---\ndescription: Write docs\n---\n\n# Writer\n\n')

    expect(saved).toMatchObject({
      name: 'writer',
      path: 'skills/writer/SKILL.md',
      content: expect.stringContaining('# Writer'),
    })
    expect(readFileSync(join(root, 'skills', 'writer', 'SKILL.md'), 'utf8')).toContain('# Writer')
    expect(refreshes).toBe(1)

    expect(service.delete('writer')).toEqual({ deleted: 'writer' })
    expect(existsSync(join(root, 'skills', 'writer'))).toBe(false)
    expect(refreshes).toBe(2)
    expect(() => service.save('../bad', '# Bad')).toThrow('Skill name must be a safe directory name')
  })
})
