import type { ToolRegistry } from '../tools/registry'
import { MCPToolAdapter } from './adapter'
import { loadMcpConfig, type MCPConfig, type ServerConfig } from './config'
import { MCPConnection, SSEConnection, StdioConnection } from './connection'

export type MCPConnectionFactory = (cfg: ServerConfig) => MCPConnection

export class MCPClient {
  readonly root: string
  config: MCPConfig | null = null
  private readonly connectionFactory: MCPConnectionFactory
  private readonly connections = new Map<string, MCPConnection>()
  private readonly tools: MCPToolAdapter[] = []
  private initialized = false

  constructor(
    root: string,
    opts: { connectionFactory?: MCPConnectionFactory } = {},
  ) {
    this.root = root
    this.connectionFactory = opts.connectionFactory ?? createConnection
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.config = loadMcpConfig(this.root)
    const defaults = this.config.defaults

    for (const server of Object.values(this.config.servers)) {
      if (!server.enabled) continue
      const conn = this.connectionFactory(server)
      this.connections.set(server.name, conn)
      const ok = await conn.connect()
      if (!ok) continue
      const discovered = await conn.listTools()
      for (const tool of discovered) {
        const overrides = server.tool_overrides[tool.name] ?? {}
        this.tools.push(
          new MCPToolAdapter({
            serverName: server.name,
            toolName: tool.name,
            description: tool.description ?? '',
            parametersSchema: tool.inputSchema ?? {
              type: 'object',
              properties: {},
              required: [],
            },
            connection: conn,
            readOnly: booleanOption(
              overrides.read_only,
              defaults.read_only,
              false,
            ),
            exclusive: booleanOption(
              overrides.exclusive,
              defaults.exclusive,
              false,
            ),
            maxResultChars: positiveInt(
              overrides.max_result_chars ?? defaults.max_result_chars,
            ),
          }),
        )
      }
    }

    this.initialized = true
  }

  getTools(): MCPToolAdapter[] {
    return [...this.tools]
  }

  registerTools(registry: ToolRegistry): void {
    for (const tool of this.tools) registry.register(tool)
  }

  getConnection(serverName: string): MCPConnection | undefined {
    return this.connections.get(serverName)
  }

  async close(): Promise<void> {
    for (const conn of this.connections.values())
      await conn.disconnect().catch(() => {})
    this.connections.clear()
    this.tools.length = 0
    this.initialized = false
  }
}

function createConnection(cfg: ServerConfig): MCPConnection {
  return cfg.transport === 'sse'
    ? new SSEConnection(cfg.name, cfg)
    : new StdioConnection(cfg.name, cfg)
}

function booleanOption(
  value: unknown,
  fallback: unknown,
  defaultValue: boolean,
): boolean {
  if (typeof value === 'boolean') return value
  if (typeof fallback === 'boolean') return fallback
  return defaultValue
}

function positiveInt(value: unknown): number | null {
  if (typeof value === 'boolean') return null
  if (typeof value === 'number' && Number.isInteger(value) && value > 0)
    return value
  return null
}
