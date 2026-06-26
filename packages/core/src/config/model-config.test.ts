import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ValidationError } from '../errors'
import {
  activeEntry,
  findEntry,
  loadModelConfig,
  markEntryVision,
  parseModelConfig,
  resolveProviderName,
  saveModelConfig,
  validateCompleteModelEntries,
} from './model-config'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'emperor-mc-'))
})

describe('parseModelConfig', () => {
  it('treats legacy id as mainModelId and fills providers for every spec', () => {
    const cfg = parseModelConfig({
      agents: { defaults: { model: 'a', maxTokens: 100 } },
      models: [{ name: 'a', id: 'gpt-4o', secondaryModelId: 'gpt-4o-mini', provider: 'openai' }],
    })
    expect(cfg.defaults.model).toBe('a')
    expect(cfg.defaults.maxTokens).toBe(100)
    const e = findEntry(cfg, 'a')!
    expect(e.mainModelId).toBe('gpt-4o')
    expect(e.id).toBe('gpt-4o')
    expect(e.secondaryModelId).toBe('gpt-4o-mini')
    expect(cfg.providers.openai).toBeDefined()
    expect(cfg.providers.anthropic).toBeDefined()
  })

  it('falls back name from mainModelId and dedupes duplicate names', () => {
    const cfg = parseModelConfig({
      models: [
        { mainModelId: 'm1', secondaryModelId: 's1' },
        { name: 'dup', mainModelId: 'x' },
        { name: 'dup', mainModelId: 'y' },
      ],
    })
    expect(cfg.models[0]!.name).toBe('m1')
    expect(cfg.models.map((m) => m.name)).toEqual(['m1', 'dup', 'dup-2'])
  })

  it('activeEntry prefers defaults.model then first entry', () => {
    const cfg = parseModelConfig({ agents: { defaults: { model: 'b' } }, models: [{ name: 'a' }, { name: 'b' }] })
    expect(activeEntry(cfg)?.name).toBe('b')
    const cfg2 = parseModelConfig({ models: [{ name: 'a' }] })
    expect(activeEntry(cfg2)?.name).toBe('a')
  })
})

describe('resolveProviderName', () => {
  it('honors explicit provider, else keyword-matches the model', () => {
    expect(resolveProviderName('openai', 'whatever', {})).toBe('openai')
    expect(resolveProviderName('bogus', 'x', {})).toBe('custom')
    expect(resolveProviderName('auto', 'claude-3-5-sonnet', {})).toBe('anthropic')
    expect(resolveProviderName('auto', 'deepseek-chat', {})).toBe('deepseek')
  })

  it('falls back to first provider with an apiKey, else deepseek', () => {
    expect(resolveProviderName('auto', 'mystery', { groq: { apiKey: 'k', apiBase: null, extraHeaders: null, extraBody: null } })).toBe('groq')
    expect(resolveProviderName('auto', 'mystery', {})).toBe('deepseek')
  })
})

describe('validateCompleteModelEntries', () => {
  it('rejects empty, duplicate names, and missing model ids', () => {
    expect(() => validateCompleteModelEntries({ models: [] })).toThrow(ValidationError)
    expect(() => validateCompleteModelEntries({ models: [{ name: 'a', mainModelId: 'm' }] })).toThrow(/Secondary/)
    expect(() =>
      validateCompleteModelEntries({
        models: [
          { name: 'a', mainModelId: 'm', secondaryModelId: 's' },
          { name: 'a', mainModelId: 'm2', secondaryModelId: 's2' },
        ],
      }),
    ).toThrow(/重复/)
  })

  it('accepts complete entries', () => {
    expect(() =>
      validateCompleteModelEntries({ models: [{ name: 'a', mainModelId: 'm', secondaryModelId: 's' }] }),
    ).not.toThrow()
  })
})

describe('model-config IO', () => {
  it('load creates a default config and round-trips a save with stable byte format', async () => {
    const cfg = await loadModelConfig(dir)
    expect(cfg.models).toHaveLength(0)
    await saveModelConfig(dir, {
      agents: { defaults: { model: 'a' } },
      models: [{ name: 'a', mainModelId: 'm', secondaryModelId: 's', provider: 'openai' }],
    })
    const onDisk = await readFile(join(dir, 'model_config.json'), 'utf8')
    expect(onDisk.endsWith('}\n')).toBe(true) // indent=2 + trailing newline
    const reloaded = await loadModelConfig(dir)
    expect(findEntry(reloaded, 'a')?.mainModelId).toBe('m')
  })

  it('markEntryVision flips supportsVision and persists', async () => {
    await saveModelConfig(dir, { models: [{ name: 'a', mainModelId: 'm', secondaryModelId: 's' }] })
    await markEntryVision(dir, 'a', true)
    const reloaded = await loadModelConfig(dir)
    expect(findEntry(reloaded, 'a')?.supportsVision).toBe(true)
    await expect(markEntryVision(dir, 'missing')).rejects.toThrow(ValidationError)
  })
})
