import { describe, it, expect } from 'vitest'
import { resolveConfig } from './config'

const throwingRead = (): string => {
  throw new Error('ENOENT')
}

describe('resolveConfig', () => {
  it('falls back to defaults when emperor.local.json is unreadable', () => {
    const cfg = resolveConfig({ readFile: throwingRead })
    expect(cfg.configSource).toBe('default')
  })

  it('detects a readable emperor.local.json', () => {
    const readFile = () => JSON.stringify({ webui: { host: '0.0.0.0', port: 9100 } })
    const cfg = resolveConfig({ readFile })
    expect(cfg.configSource).toBe('file')
  })

  it('honors --root and EMPEROR_AGENT_ROOT for the config path', () => {
    const seen: string[] = []
    const readFile = (p: string): string => {
      seen.push(p)
      throw new Error('ENOENT')
    }
    resolveConfig({ argv: ['--root', '/tmp/custom-root'], readFile })
    expect(seen[0]).toBe('/tmp/custom-root/emperor.local.json')

    seen.length = 0
    resolveConfig({ env: { EMPEROR_AGENT_ROOT: '/tmp/env-root' }, readFile })
    expect(seen[0]).toBe('/tmp/env-root/emperor.local.json')
  })

  it('uses packaged default root when no explicit root is provided', () => {
    const seen: string[] = []
    const readFile = (p: string): string => {
      seen.push(p)
      throw new Error('ENOENT')
    }

    const cfg = resolveConfig({ defaultRoot: '/Users/me/Library/Application Support/Emperor Agent/runtime', readFile })

    expect(cfg.root).toBe('/Users/me/Library/Application Support/Emperor Agent/runtime')
    expect(seen[0]).toBe('/Users/me/Library/Application Support/Emperor Agent/runtime/emperor.local.json')
  })

  it('keeps explicit roots ahead of packaged default root', () => {
    const readFile = throwingRead

    expect(resolveConfig({ argv: ['--root', '/manual'], defaultRoot: '/runtime', readFile }).root).toBe('/manual')
    expect(resolveConfig({ env: { EMPEROR_AGENT_ROOT: '/env' }, defaultRoot: '/runtime', readFile }).root).toBe('/env')
  })
})
