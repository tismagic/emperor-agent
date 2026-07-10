import type {
  BootstrapPayload,
  ModelConfigRaw,
  ModelEntry,
  ProviderOption,
} from '../../types'

export interface OnboardingDraft {
  provider: string
  name: string
  label: string
  apiKey: string
  apiBase: string
  mainModelId: string
  secondaryModelId: string
  maxTokens: number
  temperature: number
  contextWindowTokens: number
  reasoningEffort: string
}

export interface WizardModelSettings {
  provider: string
  name: string
  label: string
  apiKey: string
  apiBase: string
  mainModelId: string
  secondaryModelId: string
  maxTokens: number
  temperature: number
  contextWindowTokens: number
  reasoningEffort: string | null
}

export function shouldShowOnboarding(
  payload: BootstrapPayload | null | undefined,
  options: { requested?: boolean } = {},
): boolean {
  if (!payload) return false
  if (payload.modelConfig?.availability?.usable === false) return true
  return Boolean(options.requested)
}

export function createOnboardingDraft(
  payload: BootstrapPayload | null | undefined,
): OnboardingDraft {
  const modelConfig = payload?.modelConfig
  const config = modelConfig?.config || {}
  const entry = activeRawEntry(config)
  const current = modelConfig?.current || {}
  const provider =
    String(
      entry?.provider ||
        current.provider ||
        defaultProvider(modelConfig?.providerOptions),
    ).trim() || 'deepseek'
  const option = providerOption(payload, provider)
  const mainModelId = String(
    entry?.mainModelId ||
      entry?.id ||
      current.mainModelId ||
      current.model ||
      'deepseek-chat',
  ).trim()
  const secondaryModelId = String(
    entry?.secondaryModelId ||
      current.secondaryModelId ||
      mainModelId ||
      'deepseek-chat',
  ).trim()
  const defaults = config.agents?.defaults || {}
  return {
    provider,
    name: String(entry?.name || 'deepseek-work').trim() || 'deepseek-work',
    label: String(entry?.label || '').trim(),
    apiKey: '',
    apiBase: String(
      entry?.apiBase || current.apiBase || option?.defaultApiBase || '',
    ).trim(),
    mainModelId: mainModelId || 'deepseek-chat',
    secondaryModelId: secondaryModelId || mainModelId || 'deepseek-chat',
    maxTokens: numberOr(
      entry?.maxTokens,
      current.maxTokens,
      defaults.maxTokens,
      8192,
    ),
    temperature: numberOr(
      entry?.temperature,
      current.temperature,
      defaults.temperature,
      0.1,
    ),
    contextWindowTokens: numberOr(
      entry?.contextWindowTokens,
      current.contextWindowTokens,
      defaults.contextWindowTokens,
      128000,
    ),
    reasoningEffort: String(
      entry?.reasoningEffort ||
        current.reasoningEffort ||
        defaults.reasoningEffort ||
        '',
    ),
  }
}

export function onboardingValidationErrors(
  draft: OnboardingDraft,
  payload: BootstrapPayload | null | undefined,
): string[] {
  const errors: string[] = []
  if (!draft.provider.trim()) errors.push('Provider 不能为空')
  if (!draft.name.trim()) errors.push('Entry name 不能为空')
  if (!draft.mainModelId.trim()) errors.push('Main Model ID 不能为空')
  if (!draft.secondaryModelId.trim()) errors.push('Secondary Model ID 不能为空')
  if (!Number.isFinite(draft.maxTokens) || draft.maxTokens <= 0)
    errors.push('Max Tokens 必须大于 0')
  if (!Number.isFinite(draft.temperature) || draft.temperature < 0)
    errors.push('Temperature 必须是非负数')
  if (
    !Number.isFinite(draft.contextWindowTokens) ||
    draft.contextWindowTokens <= 0
  )
    errors.push('Context Window 必须大于 0')
  if (
    providerRequiresApiKey(providerOption(payload, draft.provider)) &&
    !draft.apiKey.trim() &&
    !hasExistingCredential(payload, draft.provider)
  ) {
    errors.push('API Key 不能为空')
  }
  return errors
}

export function wizardSettingsFromDraft(
  draft: OnboardingDraft,
  payload: BootstrapPayload | null | undefined,
): WizardModelSettings {
  const errors = onboardingValidationErrors(draft, payload)
  if (errors.length) throw new Error(errors.join('\n'))
  const option = providerOption(payload, draft.provider)
  return {
    provider: draft.provider.trim(),
    name: draft.name.trim(),
    label: draft.label.trim(),
    apiKey: draft.apiKey.trim(),
    apiBase: draft.apiBase.trim() || option?.defaultApiBase || '',
    mainModelId: draft.mainModelId.trim(),
    secondaryModelId: draft.secondaryModelId.trim(),
    maxTokens: Math.trunc(Number(draft.maxTokens)),
    temperature: Number(draft.temperature),
    contextWindowTokens: Math.trunc(Number(draft.contextWindowTokens)),
    reasoningEffort: draft.reasoningEffort.trim() || null,
  }
}

export function hasExistingCredential(
  payload: BootstrapPayload | null | undefined,
  provider: string,
): boolean {
  const config = payload?.modelConfig?.config
  if (!config) return false
  const entry = activeRawEntry(config)
  if (
    entry &&
    String(entry.provider || '') === provider &&
    String(entry.apiKey || '').trim()
  )
    return true
  const providerConfig = config.providers?.[provider]
  return Boolean(String(providerConfig?.apiKey || '').trim())
}

function activeRawEntry(
  config: ModelConfigRaw | null | undefined,
): ModelEntry | null {
  const models = Array.isArray(config?.models) ? config.models : []
  if (!models.length) return null
  const defaultName = String(config?.agents?.defaults?.model || '')
  return models.find((entry) => entry.name === defaultName) || models[0] || null
}

function providerOption(
  payload: BootstrapPayload | null | undefined,
  provider: string,
): ProviderOption | undefined {
  return (payload?.modelConfig?.providerOptions || []).find(
    (option) => option.name === provider,
  )
}

function defaultProvider(options: ProviderOption[] | undefined): string {
  return (
    options?.find((option) => option.name === 'deepseek')?.name ||
    options?.[0]?.name ||
    'deepseek'
  )
}

function providerRequiresApiKey(option: ProviderOption | undefined): boolean {
  return !(option?.isLocal || option?.isOauth)
}

function numberOr(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return 0
}
