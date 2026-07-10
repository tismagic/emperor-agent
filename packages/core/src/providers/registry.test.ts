import { describe, expect, it } from 'vitest'
import { PROVIDERS, findByName, providerOptions } from './registry'

describe('provider registry', () => {
  it('has the full 31-provider table', () => {
    expect(PROVIDERS).toHaveLength(31)
  })

  it('findByName tolerates - / _ and is case-insensitive', () => {
    expect(findByName('openai')?.displayName).toBe('OpenAI')
    expect(findByName('azure-openai')?.name).toBe('azure_openai')
    expect(findByName('AZURE_OPENAI')?.name).toBe('azure_openai')
    expect(findByName('nope')).toBeUndefined()
    expect(findByName(null)).toBeUndefined()
  })

  it('preserves backend + behavior flags faithfully', () => {
    expect(findByName('anthropic')).toMatchObject({ backend: 'anthropic', supportsPromptCaching: true })
    expect(findByName('openai')).toMatchObject({ supportsMaxCompletionTokens: true })
    expect(findByName('deepseek')).toMatchObject({ thinkingStyle: 'thinking_type' })
    expect(findByName('bedrock')).toMatchObject({ backend: 'bedrock', isDirect: true })
    expect(findByName('custom')).toMatchObject({ isDirect: true, backend: 'openai_compat' })
  })

  it('moonshot keeps kimi temperature overrides', () => {
    expect(findByName('moonshot')?.modelOverrides).toEqual([
      ['kimi-k2', { temperature: 1.0 }],
      ['kimi-k2.5', { temperature: 1.0 }],
      ['kimi-k2.6', { temperature: 1.0 }],
    ])
  })

  it('providerOptions exposes UI metadata only for selectable specs', () => {
    const opts = providerOptions()
    expect(opts).toHaveLength(PROVIDERS.length - 2)
    expect(opts[0]).toMatchObject({ name: 'openai', displayName: 'OpenAI', backend: 'openai_compat' })
    expect(opts.some((option) => option.name === 'openai_codex')).toBe(false)
    expect(opts.some((option) => option.name === 'github_copilot')).toBe(false)
    expect(opts.find((option) => option.name === 'deepseek')).toMatchObject({
      apiKeyUrl: 'https://platform.deepseek.com/api_keys',
      websiteUrl: 'https://platform.deepseek.com',
      modelDiscovery: 'openai_compat',
    })
  })
})
