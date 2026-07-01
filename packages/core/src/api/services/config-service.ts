import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadMcpConfig, saveMcpConfig, type MCPConfig } from '../../mcp/config'

export interface UserConfigPayload {
  path: 'templates/USER.local.md'
  content: string
}

export interface CoreConfigServiceHooks {
  refreshRuntimeContext?: () => void
  reloadMcp?: () => void | Promise<void>
}

export class CoreConfigService {
  readonly root: string
  readonly templatesDir: string
  private readonly hooks: CoreConfigServiceHooks

  constructor(root: string, hooks: CoreConfigServiceHooks = {}, opts: { templatesDir?: string } = {}) {
    this.root = resolve(root)
    this.templatesDir = resolve(opts.templatesDir ?? join(this.root, 'templates'))
    this.hooks = hooks
  }

  getUserConfig(): UserConfigPayload {
    const path = this.userConfigPath()
    return { path: 'templates/USER.local.md', content: readFileSync(path, 'utf8') }
  }

  saveUserConfig(content: string): UserConfigPayload {
    const path = this.userConfigPath()
    writeFileSync(path, `${String(content || '').trimEnd()}\n`, 'utf8')
    this.hooks.refreshRuntimeContext?.()
    return this.getUserConfig()
  }

  getMcpConfig(): MCPConfig {
    return loadMcpConfig(this.root)
  }

  async saveMcpConfig(raw: Record<string, unknown>): Promise<MCPConfig> {
    saveMcpConfig(this.root, raw)
    await this.hooks.reloadMcp?.()
    return this.getMcpConfig()
  }

  private userConfigPath(): string {
    const dir = join(this.root, 'templates')
    const local = join(dir, 'USER.local.md')
    if (!existsSync(local)) {
      mkdirSync(dir, { recursive: true })
      const init = join(this.templatesDir, 'init', 'USER.md')
      const content = existsSync(init) ? readFileSync(init, 'utf8') : '# 用户偏好\n\n'
      writeFileSync(local, content, 'utf8')
    }
    return local
  }
}
