import { describe, expect, it } from 'vitest'
import type { BootstrapPayload, ModelConfigPayload } from '../../types'
import {
  createOnboardingDraft,
  onboardingValidationErrors,
  shouldShowOnboarding,
  wizardSettingsFromDraft,
} from './onboardingModel'

describe('onboarding model flow (MIG-APP-001)', () => {
  it('does not auto-open the wizard for a fresh default model config', () => {
    const payload = boot({
      current: { provider: 'deepseek', model: 'deepseek-chat', mainModelId: 'deepseek-chat', secondaryModelId: '' },
      config: {
        agents: { defaults: { model: '', provider: 'auto', maxTokens: 8192, temperature: 0.1, contextWindowTokens: 128000 } },
        models: [],
        providers: {},
      },
      providerOptions: [{ name: 'deepseek', displayName: 'DeepSeek', defaultApiBase: 'https://api.deepseek.com', region: 'cn' }],
    })

    expect(shouldShowOnboarding(payload)).toBe(false)
    expect(shouldShowOnboarding(payload, { requested: true })).toBe(true)
    expect(createOnboardingDraft(payload)).toMatchObject({
      provider: 'deepseek',
      name: 'deepseek-work',
      mainModelId: 'deepseek-chat',
      secondaryModelId: 'deepseek-chat',
      apiBase: 'https://api.deepseek.com',
      maxTokens: 8192,
      temperature: 0.1,
      contextWindowTokens: 128000,
    })
  })

  it('does not interrupt an existing complete model entry with a saved key', () => {
    const payload = boot({
      current: { provider: 'openai', model: 'gpt-main', mainModelId: 'gpt-main', secondaryModelId: 'gpt-mini' },
      config: {
        agents: { defaults: { model: 'work', provider: 'auto' } },
        models: [{
          name: 'work',
          provider: 'openai',
          apiKey: '***1234',
          mainModelId: 'gpt-main',
          secondaryModelId: 'gpt-mini',
        }],
        providers: {},
      },
      providerOptions: [{ name: 'openai', displayName: 'OpenAI', defaultApiBase: 'https://api.openai.com/v1', region: 'foreign' }],
    })

    expect(shouldShowOnboarding(payload)).toBe(false)
  })

  it('requires an api key only when no existing credential can be preserved', () => {
    const payload = boot({
      current: { provider: 'deepseek', model: 'deepseek-chat', mainModelId: 'deepseek-chat', secondaryModelId: 'deepseek-chat' },
      config: {
        agents: { defaults: { model: 'deepseek-work', provider: 'deepseek' } },
        models: [{ name: 'deepseek-work', provider: 'deepseek', apiKey: '***cret', mainModelId: 'deepseek-chat', secondaryModelId: 'deepseek-chat' }],
        providers: {},
      },
      providerOptions: [{ name: 'deepseek', displayName: 'DeepSeek', defaultApiBase: 'https://api.deepseek.com', region: 'cn' }],
    })
    const draft = createOnboardingDraft(payload)

    expect(onboardingValidationErrors(draft, payload)).toEqual([])
    expect(wizardSettingsFromDraft(draft, payload).apiKey).toBe('')

    const fresh = boot({
      current: { provider: 'deepseek', model: 'deepseek-chat', mainModelId: 'deepseek-chat', secondaryModelId: 'deepseek-chat' },
      config: { agents: { defaults: {} }, models: [], providers: {} },
      providerOptions: payload.modelConfig.providerOptions,
    })
    expect(onboardingValidationErrors(createOnboardingDraft(fresh), fresh)).toContain('API Key 不能为空')
  })
})

function boot(modelConfig: ModelConfigPayload): BootstrapPayload {
  return {
    app: 'Emperor Agent',
    tools: [],
    skills: [],
    memory: {},
    modelConfig,
  }
}
