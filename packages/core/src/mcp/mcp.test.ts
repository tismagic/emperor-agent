import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../tools/registry'
import { MCPToolAdapter } from './adapter'
import { loadMcpConfig, saveMcpConfig } from './config'
import {
  buildStdioEnv,
  MCPConnection,
  type MCPCallToolResult,
  type MCPToolDefinition,
} from './connection'
import { MCPClient } from './client'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

class FakeConnection extends MCPConnection {
  readonly tools: MCPToolDefinition[]
  readonly output: MCPCallToolResult
  connectOk: boolean
  called: Array<{ tool: string; args: Record<string, unknown> }> = []

  constructor(
    serverName: string,
    tools: MCPToolDefinition[],
    opts: { connectOk?: boolean; output?: MCPCallToolResult | string } = {},
  ) {
    super(serverName)
    this.tools = tools
    this.connectOk = opts.connectOk ?? true
    this.output =
      typeof opts.output === 'string'
        ? { content: opts.output, isError: false }
        : (opts.output ?? { content: 'ok', isError: false })
  }

  override async connect(): Promise<boolean> {
    this.connected = this.connectOk
    return this.connected
  }

  override async disconnect(): Promise<void> {
    this.connected = false
  }

  override async listTools(): Promise<MCPToolDefinition[]> {
    return this.connected ? this.tools : []
  }

  override async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPCallToolResult> {
    this.called.push({ tool: toolName, args })
    return {
      ...this.output,
      content: `${this.output.content}:${toolName}:${JSON.stringify(args)}`,
    }
  }
}

describe('MCP config', () => {
  it('loads defaults, deep-merges mcp_config.json, and expands env placeholders', () => {
    const root = tmp('emperor-mcp-config-')
    writeFileSync(
      join(root, 'mcp_config.json'),
      JSON.stringify({
        defaults: { read_only: true, max_result_chars: 777 },
        servers: {
          alpha: {
            transport: 'stdio',
            command: '${BIN}/server',
            args: ['--token=${TOKEN}', 42],
            env: { API_TOKEN: '${TOKEN}' },
            tool_overrides: { search: { read_only: false } },
          },
          ignored: 'bad',
        },
      }),
      'utf8',
    )

    const cfg = loadMcpConfig(root, { BIN: '/bin', TOKEN: 'secret' })
    expect(cfg.defaults).toMatchObject({
      read_only: true,
      exclusive: false,
      max_result_chars: 777,
    })
    expect(Object.keys(cfg.servers)).toEqual(['alpha'])
    expect(cfg.servers.alpha!.command).toBe('/bin/server')
    expect(cfg.servers.alpha!.args).toEqual(['--token=secret', '42'])
    expect(cfg.servers.alpha!.env.API_TOKEN).toBe('secret')
    expect(cfg.servers.alpha!.tool_overrides.search).toEqual({
      read_only: false,
    })
  })

  it('validates and writes raw config compatibly', () => {
    const root = tmp('emperor-mcp-save-')
    expect(() => saveMcpConfig(root, { servers: [] })).toThrow(/servers/)
    saveMcpConfig(root, { servers: {}, defaults: { read_only: true } })
    expect(
      JSON.parse(readFileSync(join(root, 'mcp_config.json'), 'utf8')).defaults
        .read_only,
    ).toBe(true)
  })
})

describe('MCP connection env', () => {
  it('keeps only safe inherited env and explicit server env', () => {
    const env = buildStdioEnv(
      { env: { SECRET_TOKEN: 'allowed-by-config', PATH: '/custom/bin' } },
      {
        PATH: '/bin',
        HOME: '/Users/me',
        OPENAI_API_KEY: 'leak',
        LANG: 'en_US.UTF-8',
      },
    )
    expect(env).toEqual({
      PATH: '/custom/bin',
      HOME: '/Users/me',
      LANG: 'en_US.UTF-8',
      SECRET_TOKEN: 'allowed-by-config',
    })
  })
})

describe('MCP adapter/client', () => {
  it('wraps tools as emperor Tool instances', async () => {
    const conn = new FakeConnection('alpha', [])
    await conn.connect()
    const adapter = new MCPToolAdapter({
      serverName: 'alpha',
      toolName: 'search',
      description: 'Search docs',
      parametersSchema: { type: 'object', properties: {}, required: [] },
      connection: conn,
      readOnly: true,
      exclusive: false,
      maxResultChars: 50,
    })

    expect(adapter.name).toBe('mcp_alpha_search')
    expect(adapter.description).toBe('[MCP:alpha] Search docs')
    expect(adapter.readOnly).toBe(true)
    expect(await adapter.execute({ q: 'hello' })).toMatchObject({
      isError: false,
      metadata: {
        mcp: true,
        untrusted: true,
        server: 'alpha',
        tool: 'mcp_alpha_search',
        mcp_tool: 'search',
      },
    })
    expect(conn.called).toEqual([{ tool: 'search', args: { q: 'hello' } }])
  })

  it('marks MCP protocol errors as failed untrusted tool results', async () => {
    const conn = new FakeConnection('alpha', [], {
      output: { content: 'remote failed', isError: true },
    })
    await conn.connect()
    const adapter = new MCPToolAdapter({
      serverName: 'alpha',
      toolName: 'search',
      description: 'Search docs',
      parametersSchema: { type: 'object', properties: {}, required: [] },
      connection: conn,
      readOnly: true,
      exclusive: false,
    })
    const registry = new ToolRegistry()
    registry.register(adapter)

    const result = await registry.executeResult('mcp_alpha_search', { q: 'x' })

    expect(result.isError).toBe(true)
    expect(result.metadata).toMatchObject({
      mcp: true,
      untrusted: true,
      server: 'alpha',
      tool: 'mcp_alpha_search',
      mcp_tool: 'search',
    })
    expect(result.modelContent).toContain('不可信输入')
    expect(result.modelContent).toContain('remote failed:search')
  })

  it('initializes enabled servers, ignores failures, applies overrides, and registers tools', async () => {
    const root = tmp('emperor-mcp-client-')
    writeFileSync(
      join(root, 'mcp_config.json'),
      JSON.stringify({
        defaults: { read_only: true, exclusive: false, max_result_chars: 123 },
        servers: {
          alpha: {
            enabled: true,
            transport: 'stdio',
            tool_overrides: {
              search: {
                read_only: false,
                exclusive: true,
                max_result_chars: 456,
              },
            },
          },
          beta: { enabled: true, transport: 'sse' },
          off: { enabled: false, transport: 'stdio' },
        },
      }),
      'utf8',
    )
    const conns: Record<string, FakeConnection> = {
      alpha: new FakeConnection('alpha', [
        {
          name: 'search',
          description: 'Search',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ]),
      beta: new FakeConnection(
        'beta',
        [
          {
            name: 'lookup',
            description: 'Lookup',
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
        ],
        { connectOk: false },
      ),
      off: new FakeConnection('off', [
        {
          name: 'disabled',
          description: '',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ]),
    }
    const client = new MCPClient(root, {
      connectionFactory: (cfg) => conns[cfg.name]!,
    })

    await client.initialize()
    const tools = client.getTools()
    expect(tools.map((tool) => tool.name)).toEqual(['mcp_alpha_search'])
    expect(tools[0]!.readOnly).toBe(false)
    expect(tools[0]!.exclusive).toBe(true)
    expect(tools[0]!.maxResultChars).toBe(456)
    expect(client.getConnection('beta')?.connected).toBe(false)

    const registry = new ToolRegistry()
    client.registerTools(registry)
    expect(registry.has('mcp_alpha_search')).toBe(true)
    expect(await registry.execute('mcp_alpha_search', { q: 'x' })).toContain(
      'ok:search',
    )

    await client.close()
    expect(client.getTools()).toEqual([])
  })
})
