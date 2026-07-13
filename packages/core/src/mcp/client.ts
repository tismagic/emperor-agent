import type { ToolRegistry } from '../tools/registry'
import { MCPToolAdapter } from './adapter'
import { loadMcpConfig, type MCPConfig, type ServerConfig } from './config'
import { MCPConnection, SSEConnection, StdioConnection } from './connection'
import type { ExecutionEnvironment } from '../environment/snapshot'

export type MCPConnectionFactory = (
  cfg: ServerConfig,
  executionEnvironment?: ExecutionEnvironment | null,
) => MCPConnection

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
    this.connectionFactory =
      opts.connectionFactory ??
      ((config, executionEnvironment) =>
        createConnection(config, executionEnvironment, (snapshot) =>
          this.configForSnapshot(config.name, snapshot),
        ))
  }

  async initialize(
    executionEnvironment: ExecutionEnvironment | null = null,
  ): Promise<void> {
    if (this.initialized) return
    this.config = executionEnvironment
      ? await loadMcpConfigForEnvironment(this.root, executionEnvironment)
      : await loadMcpConfig(this.root)
    const defaults = this.config.defaults

    for (const server of Object.values(this.config.servers)) {
      if (!server.enabled) continue
      const conn = this.connectionFactory(server, executionEnvironment)
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

  private async configForSnapshot(
    serverName: string,
    snapshot: ExecutionEnvironment,
  ): Promise<ServerConfig | null> {
    const config = (await loadMcpConfigForEnvironment(this.root, snapshot))
      .servers[serverName]
    return config?.enabled && config.transport !== 'sse' ? config : null
  }
}

function createConnection(
  cfg: ServerConfig,
  executionEnvironment: ExecutionEnvironment | null = null,
  configResolver:
    | ((
        snapshot: ExecutionEnvironment,
      ) => ServerConfig | null | Promise<ServerConfig | null>)
    | null = null,
): MCPConnection {
  return cfg.transport === 'sse'
    ? new SSEConnection(cfg.name, cfg)
    : new StdioConnection(cfg.name, cfg, {
        executionEnvironment,
        configResolver,
      })
}

async function loadMcpConfigForEnvironment(
  root: string,
  executionEnvironment: ExecutionEnvironment,
): Promise<MCPConfig> {
  return await loadMcpConfig(
    root,
    (name) => executionEnvironment.selectEnv([name])[name],
  )
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
