import { resolve } from 'node:path'
import {
  activeEntry,
  buildWizardModelConfig,
  findEntry,
  loadModelConfig,
  markEntryVision,
  saveModelConfig,
  type ModelConfig,
  type ModelEntry,
  type WizardModelSettings,
} from '../../config/model-config'
import { buildProviderSnapshot, type ModelRole, type ModelRoute, type ProviderSnapshot } from '../../model/router'
import { modelAvailability, type ModelAvailability } from '../../model/availability'
import type { OpenAiMessage } from '../../providers/base'
import { providerOptions } from '../../providers/registry'

type Dict = Record<string, any>

export interface CoreModelRouterLike {
  route(useCase: string, agentType?: string | null, task?: string | null): ModelRoute
  payload?(): Record<string, unknown>
}

export interface CoreModelServiceDeps {
  router: CoreModelRouterLike | (() => CoreModelRouterLike)
  refreshModelConfig?: () => void | Promise<void>
}

export interface CurrentModelPayload {
  provider: string
  providerLabel: string
  model: string
  apiBase: string | null
  maxTokens: number
  temperature: number
  reasoningEffort: string | null
  contextWindowTokens: number
  entryName: string
  entryLabel: string
  supportsVision: boolean
  mainModelId: string
  secondaryModelId: string
  modelRole: ModelRole
}

export interface ModelConfigPayload {
  current: CurrentModelPayload
  secondary: CurrentModelPayload | null
  availability: ModelAvailability
  routing: Record<string, unknown>
  config: Dict
  providerOptions: Array<Record<string, unknown>>
}

export class CoreModelService {
  readonly root: string
  private readonly deps: CoreModelServiceDeps

  constructor(root: string, deps: CoreModelServiceDeps) {
    this.root = resolve(root)
    this.deps = deps
  }

  async getConfig(): Promise<ModelConfigPayload> {
    const config = await loadModelConfig(this.root)
    const entry = activeEntry(config) ?? null
    const current = this.router().route('main_agent').snapshot
    const secondary = entry?.secondaryModelId
      ? this.snapshotPayload(this.router().route('memory_compaction').snapshot, entry)
      : null
    return {
      current: this.snapshotPayload(current, entry),
      secondary,
      availability: modelAvailability(config),
      routing: this.router().payload?.() ?? { secondaryEnabled: Boolean(entry?.secondaryModelId), fallbackToMain: true },
      config: redactApiKeys(config.raw),
      providerOptions: providerOptions(),
    }
  }

  async saveConfig(input: unknown): Promise<ModelConfigPayload> {
    const body = isRecord(input) && isRecord(input.config) ? input.config : input
    if (!isRecord(body)) throw new Error('model config must be an object')
    const existing = (await loadModelConfig(this.root)).raw
    const next = structuredClone(body)
    restoreMaskedKeys(next, existing)
    await saveModelConfig(this.root, next, { validateComplete: true })
    await this.deps.refreshModelConfig?.()
    return this.getConfig()
  }

  async saveOnboardingConfig(input: unknown): Promise<ModelConfigPayload> {
    const settings = wizardSettings(input)
    const existing = (await loadModelConfig(this.root)).raw
    const next = buildWizardModelConfig(existing, settings)
    await saveModelConfig(this.root, next, { validateComplete: true })
    await this.deps.refreshModelConfig?.()
    return this.getConfig()
  }

  async test(body: Dict): Promise<Dict> {
    const entryName = String(body.entryName ?? '').trim()
    const kind = String(body.kind ?? 'text').toLowerCase()
    let role = String(body.role ?? 'main').toLowerCase() as ModelRole
    if (!['text', 'vision'].includes(kind)) return { ok: false, kind, error: "kind must be 'text' or 'vision'" }
    if (!entryName) return { ok: false, kind, error: 'entryName required' }
    if (!['main', 'secondary'].includes(role)) return { ok: false, kind, error: "role must be 'main' or 'secondary'" }
    if (kind === 'vision') role = 'main'

    const config = await loadModelConfig(this.root)
    const entry = findEntry(config, entryName)
    if (role === 'secondary' && entry && !entry.secondaryModelId) {
      return { ok: false, kind, error: 'secondaryModelId is required before testing the secondary model' }
    }

    let snapshot: ProviderSnapshot
    try {
      snapshot = this.snapshotForModelTest(config, entryName, role)
    } catch (error) {
      return { ok: false, kind, error: `snapshot failed: ${error instanceof Error ? error.message : String(error)}` }
    }

    const started = Date.now()
    try {
      const response = await snapshot.provider.chat({
        messages: kind === 'vision' ? visionProbeMessages() : [{ role: 'user', content: 'Reply with exactly one word: pong' }],
        tools: null,
        model: snapshot.model,
        maxTokens: 64,
        temperature: 0,
        reasoningEffort: null,
      })
      const sample = String(response.content || '').trim().slice(0, 200)
      const ok = kind === 'vision' ? visionOk(sample) : Boolean(sample && sample.toLowerCase().includes('pong'))
      const payload: Dict = {
        ok,
        kind,
        latencyMs: Date.now() - started,
        model: snapshot.model,
        provider: snapshot.providerName,
        modelRole: snapshot.modelRole,
        sample,
        finishReason: response.finishReason || 'stop',
      }
      if (kind === 'vision' && ok) {
        try {
          await markEntryVision(this.root, entryName, true)
          await this.deps.refreshModelConfig?.()
          payload.visionMarked = true
        } catch {
          payload.visionMarked = false
        }
      }
      return payload
    } catch (error) {
      return {
        ok: false,
        kind,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
        model: snapshot.model,
        provider: snapshot.providerName,
        modelRole: snapshot.modelRole,
      }
    }
  }

  private router(): CoreModelRouterLike {
    return typeof this.deps.router === 'function' ? this.deps.router() : this.deps.router
  }

  private snapshotForModelTest(config: ModelConfig, entryName: string, role: ModelRole): ProviderSnapshot {
    const routed = role === 'secondary'
      ? this.router().route('memory_compaction').snapshot
      : this.router().route('main_agent').snapshot
    if (routed.entryName === entryName) return routed
    return buildProviderSnapshot(config, { modelOverride: entryName, role })
  }

  private snapshotPayload(snapshot: ProviderSnapshot, entry: ModelEntry | null): CurrentModelPayload {
    return {
      provider: snapshot.providerName,
      providerLabel: snapshot.providerLabel,
      model: snapshot.model,
      apiBase: snapshot.apiBase,
      maxTokens: snapshot.generation.maxTokens,
      temperature: snapshot.generation.temperature,
      reasoningEffort: snapshot.generation.reasoningEffort,
      contextWindowTokens: snapshot.contextWindowTokens,
      entryName: entry?.name ?? snapshot.entryName,
      entryLabel: entry?.label || entry?.name || snapshot.entryLabel,
      supportsVision: Boolean(snapshot.supportsVision),
      mainModelId: entry?.mainModelId ?? (snapshot.modelRole === 'main' ? snapshot.model : ''),
      secondaryModelId: entry?.secondaryModelId ?? '',
      modelRole: snapshot.modelRole,
    }
  }
}

export function redactApiKeys(raw: Dict): Dict {
  const out = structuredClone(raw)
  for (const prov of Object.values(out.providers ?? {})) {
    if (isRecord(prov) && typeof prov.apiKey === 'string' && prov.apiKey) prov.apiKey = maskKey(prov.apiKey)
  }
  for (const entry of out.models ?? []) {
    if (isRecord(entry) && typeof entry.apiKey === 'string' && entry.apiKey) entry.apiKey = maskKey(entry.apiKey)
  }
  return out
}

export function restoreMaskedKeys(config: Dict, existing: Dict): void {
  const incomingProviders = isRecord(config.providers) ? config.providers : {}
  const existingProviders = isRecord(existing.providers) ? existing.providers : {}
  for (const [name, prov] of Object.entries(incomingProviders)) {
    if (isRecord(prov) && typeof prov.apiKey === 'string' && prov.apiKey.startsWith('***')) {
      const old = existingProviders[name]
      prov.apiKey = isRecord(old) ? String(old.apiKey ?? '') : ''
    }
  }

  const existingModels = new Map<string, Dict>()
  for (const item of Array.isArray(existing.models) ? existing.models : []) {
    if (isRecord(item) && item.name) existingModels.set(String(item.name), item)
  }
  for (const entry of Array.isArray(config.models) ? config.models : []) {
    if (!isRecord(entry) || typeof entry.apiKey !== 'string' || !entry.apiKey.startsWith('***')) continue
    const old = existingModels.get(String(entry.name ?? ''))
    entry.apiKey = old ? String(old.apiKey ?? '') : ''
  }
}

function maskKey(key: string): string {
  return key.length > 4 ? `***${key.slice(-4)}` : '***'
}

function isRecord(value: unknown): value is Dict {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function wizardSettings(input: unknown): WizardModelSettings {
  if (!isRecord(input)) throw new Error('wizard settings must be an object')
  return {
    provider: String(input.provider ?? '').trim(),
    name: String(input.name ?? '').trim(),
    label: String(input.label ?? '').trim(),
    apiKey: String(input.apiKey ?? ''),
    apiBase: String(input.apiBase ?? ''),
    mainModelId: String(input.mainModelId ?? '').trim(),
    secondaryModelId: String(input.secondaryModelId ?? '').trim(),
    maxTokens: Number(input.maxTokens ?? 8192),
    temperature: Number(input.temperature ?? 0.1),
    contextWindowTokens: Number(input.contextWindowTokens ?? 128000),
    reasoningEffort: input.reasoningEffort ? String(input.reasoningEffort) : null,
  }
}

const PROBE_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2w=='

function visionProbeMessages(): OpenAiMessage[] {
  return [{
    role: 'user',
    content: [
      { type: 'text', text: 'Reply with ONE English word only: name a visible color in this image.' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PROBE_JPEG_BASE64}` } },
    ],
  }]
}

function visionOk(sample: string): boolean {
  const lower = sample.toLowerCase()
  return Boolean(sample) && !['invalid', 'error', 'cannot', 'unable', 'sorry'].some((token) => lower.includes(token))
}
