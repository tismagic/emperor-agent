import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CoreConfigService } from './config-service'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('CoreConfigService (MIG-IPC-007)', () => {
  it('reads and writes USER.local.md without touching emperor.local.json', () => {
    const root = tmp('emperor-config-service-')
    mkdirSync(join(root, 'templates', 'init'), { recursive: true })
    writeFileSync(join(root, 'templates', 'init', 'USER.md'), '# Seed User\n\n', 'utf8')
    let refreshes = 0
    const service = new CoreConfigService(root, {
      refreshRuntimeContext: () => { refreshes += 1 },
    })

    expect(service.getUserConfig()).toEqual({
      path: 'templates/USER.local.md',
      content: '# Seed User\n\n',
    })
    expect(readFileSync(join(root, 'templates', 'USER.local.md'), 'utf8')).toBe('# Seed User\n\n')
    expect(existsSync(join(root, 'emperor.local.json'))).toBe(false)

    expect(service.saveUserConfig('新的偏好\n\n')).toEqual({
      path: 'templates/USER.local.md',
      content: '新的偏好\n',
    })
    expect(readFileSync(join(root, 'templates', 'USER.local.md'), 'utf8')).toBe('新的偏好\n')
    expect(refreshes).toBe(1)
  })

  it('saves MCP config and asks the host to reload MCP tools once', async () => {
    const root = tmp('emperor-config-mcp-')
    let reloads = 0
    const service = new CoreConfigService(root, {
      reloadMcp: () => { reloads += 1 },
    })

    await expect(service.saveMcpConfig({ defaults: {} })).rejects.toThrow("mcp_config: 'servers' must be an object")

    const saved = await service.saveMcpConfig({
      servers: {
        docs: { transport: 'stdio', command: 'docs-mcp', enabled: true },
      },
      defaults: { read_only: true },
    })

    expect(saved.servers.docs).toMatchObject({
      name: 'docs',
      transport: 'stdio',
      command: 'docs-mcp',
      enabled: true,
    })
    expect(saved.defaults.read_only).toBe(true)
    expect(reloads).toBe(1)
  })
})
