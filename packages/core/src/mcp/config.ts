import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ServerConfig {
  name: string
  transport: 'stdio' | 'sse' | string
  enabled: boolean
  command: string | null
  args: string[]
  env: Record<string, string>
  url: string | null
  headers: Record<string, string>
  tool_overrides: Record<string, Record<string, unknown>>
}

export interface MCPConfig {
  servers: Record<string, ServerConfig>
  defaults: Record<string, unknown>
}

export const DEFAULT_MCP_CONFIG = {
  servers: {},
  defaults: {
    read_only: false,
    exclusive: false,
  },
} satisfies Record<string, unknown>

export const MCP_CONFIG_FILE = 'mcp_config.json'

const ENV_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
export type EnvironmentValueSource =
  Record<string, string | undefined> | ((name: string) => string | undefined)

export function loadMcpConfig(
  root: string,
  env: EnvironmentValueSource = process.env,
): MCPConfig {
  const path = join(root, MCP_CONFIG_FILE)
  const raw = structuredClone(DEFAULT_MCP_CONFIG) as Record<string, unknown>
  if (existsSync(path)) {
    const loaded = JSON.parse(readFileSync(path, 'utf8') || '{}') as Record<
      string,
      unknown
    >
    deepMerge(raw, expandEnv(loaded, env) as Record<string, unknown>)
  }
  return parseConfig(raw)
}

export function saveMcpConfig(
  root: string,
  raw: Record<string, unknown>,
): void {
  if (
    !raw.servers ||
    typeof raw.servers !== 'object' ||
    Array.isArray(raw.servers)
  )
    throw new Error("mcp_config: 'servers' must be an object")
  const data = { ...raw }
  if (
    !data.defaults ||
    typeof data.defaults !== 'object' ||
    Array.isArray(data.defaults)
  )
    data.defaults = DEFAULT_MCP_CONFIG.defaults
  writeFileSync(
    join(root, MCP_CONFIG_FILE),
    JSON.stringify(data, null, 2) + '\n',
    'utf8',
  )
}

export function expandEnv(
  value: unknown,
  env: EnvironmentValueSource = process.env,
): unknown {
  if (typeof value === 'string') {
    return value.replace(
      ENV_RE,
      (match, name: string) => environmentValue(env, name) ?? match,
    )
  }
  if (Array.isArray(value)) return value.map((item) => expandEnv(item, env))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = expandEnv(v, env)
    return out
  }
  return value
}

function environmentValue(
  env: EnvironmentValueSource,
  name: string,
): string | undefined {
  return typeof env === 'function' ? env(name) : env[name]
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      deepMerge(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      target[key] = value
    }
  }
  return target
}

function parseConfig(raw: Record<string, unknown>): MCPConfig {
  const serversRaw =
    raw.servers &&
    typeof raw.servers === 'object' &&
    !Array.isArray(raw.servers)
      ? (raw.servers as Record<string, unknown>)
      : {}
  const servers: Record<string, ServerConfig> = {}
  for (const [name, cfg] of Object.entries(serversRaw)) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue
    const obj = cfg as Record<string, unknown>
    servers[name] = {
      name,
      transport: stringValue(obj.transport, 'stdio'),
      enabled: obj.enabled === undefined ? true : Boolean(obj.enabled),
      command: nullableString(obj.command),
      args: Array.isArray(obj.args) ? obj.args.map((item) => String(item)) : [],
      env: stringRecord(obj.env),
      url: nullableString(obj.url),
      headers: stringRecord(obj.headers),
      tool_overrides: objectRecord(obj.tool_overrides),
    }
  }
  const defaults =
    raw.defaults &&
    typeof raw.defaults === 'object' &&
    !Array.isArray(raw.defaults)
      ? (raw.defaults as Record<string, unknown>)
      : DEFAULT_MCP_CONFIG.defaults
  return { servers, defaults }
}

function stringValue(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim()
  return text || fallback
}

function nullableString(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>))
    out[k] = String(v)
  return out
}

function objectRecord(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, Record<string, unknown>> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v))
      out[k] = v as Record<string, unknown>
  }
  return out
}
