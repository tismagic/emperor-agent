import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadModelConfig } from '../../config/model-config'
import { ModelRouter, type ModelRoute, type ProviderSnapshot } from '../../model/router'
import { LLMProvider, type ChatArgs, type LLMResponse } from '../../providers/base'
import { CoreModelService } from './model-service'

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('CoreModelService (MIG-IPC-007)', () => {
  it('returns WebUI model payloads with current/secondary snapshots, provider options, and redacted keys', async () => {
    const root = tmp('emperor-model-service-')
    writeModelConfig(root, {
      agents: { defaults: { model: 'primary', provider: 'auto', maxTokens: 8192, temperature: 0.1, reasoningEffort: null, contextWindowTokens: 128000 } },
      models: [{
        name: 'primary',
        mainModelId: 'gpt-main',
        secondaryModelId: 'gpt-mini',
        provider: 'openai',
        apiKey: 'sk-entry-secret-1234',
        apiBase: 'https://entry.example/v1',
        maxTokens: 4096,
        temperature: 0.2,
        contextWindowTokens: 32000,
        reasoningEffort: 'low',
        label: 'Primary Entry',
        supportsVision: true,
      }],
      providers: {
        openai: { apiKey: 'sk-provider-secret-9876', apiBase: 'https://provider.example/v1', extraHeaders: null, extraBody: null },
      },
    })
    const router = new ModelRouter(root, await loadModelConfig(root))
    const service = new CoreModelService(root, { router })

    const payload = await service.getConfig()

    expect(payload.current).toMatchObject({
      provider: 'openai',
      providerLabel: 'OpenAI',
      model: 'gpt-main',
      apiBase: 'https://entry.example/v1',
      maxTokens: 4096,
      temperature: 0.2,
      reasoningEffort: 'low',
      contextWindowTokens: 32000,
      entryName: 'primary',
      entryLabel: 'Primary Entry',
      supportsVision: true,
      mainModelId: 'gpt-main',
      secondaryModelId: 'gpt-mini',
      modelRole: 'main',
    })
    expect(payload.secondary).toMatchObject({
      provider: 'openai',
      model: 'gpt-mini',
      mainModelId: 'gpt-main',
      secondaryModelId: 'gpt-mini',
      modelRole: 'secondary',
    })
    expect(payload.routing).toMatchObject({ secondaryEnabled: true, fallbackToMain: true })
    expect(payload.config.providers?.openai?.apiKey).toBe('***9876')
    expect(payload.config.models?.[0]?.apiKey).toBe('***1234')
    expect(payload.providerOptions.some((option) => option.name === 'openai' && option.displayName === 'OpenAI')).toBe(true)
    expect(payload.availability).toMatchObject({ usable: true })
  })

  it('reports a fresh default config as unavailable until a usable model is configured', async () => {
    const root = tmp('emperor-model-service-fresh-')
    const service = new CoreModelService(root, {
      router: new ModelRouter(root, await loadModelConfig(root)),
    })

    const payload = await service.getConfig()

    expect(payload.availability).toMatchObject({
      usable: false,
      code: 'model_configuration_required',
      action: 'open_model_settings',
      provider: null,
      entryName: null,
    })
    expect(payload.availability.message).toContain('配置模型')
  })

  it('allows local providers without an API key but rejects remote providers without one', async () => {
    const localRoot = tmp('emperor-model-service-local-')
    writeModelConfig(localRoot, {
      agents: { defaults: { model: 'local', provider: 'auto', maxTokens: 8192, temperature: 0.1, reasoningEffort: null, contextWindowTokens: 128000 } },
      models: [{
        name: 'local',
        mainModelId: 'llama3',
        secondaryModelId: '',
        provider: 'ollama',
        apiKey: '',
      }],
      providers: { ollama: { apiKey: '', apiBase: 'http://localhost:11434/v1', extraHeaders: null, extraBody: null } },
    })
    const local = new CoreModelService(localRoot, {
      router: new ModelRouter(localRoot, await loadModelConfig(localRoot)),
    })

    await expect(local.getConfig()).resolves.toMatchObject({
      availability: { usable: true, provider: 'ollama', entryName: 'local' },
    })

    const remoteRoot = tmp('emperor-model-service-remote-missing-key-')
    writeModelConfig(remoteRoot, {
      agents: { defaults: { model: 'remote', provider: 'auto', maxTokens: 8192, temperature: 0.1, reasoningEffort: null, contextWindowTokens: 128000 } },
      models: [{
        name: 'remote',
        mainModelId: 'deepseek-chat',
        secondaryModelId: '',
        provider: 'deepseek',
        apiKey: '',
      }],
      providers: { deepseek: { apiKey: '', apiBase: 'https://api.deepseek.com', extraHeaders: null, extraBody: null } },
    })
    const remote = new CoreModelService(remoteRoot, {
      router: new ModelRouter(remoteRoot, await loadModelConfig(remoteRoot)),
    })

    await expect(remote.getConfig()).resolves.toMatchObject({
      availability: {
        usable: false,
        code: 'model_configuration_required',
        action: 'open_model_settings',
        provider: 'deepseek',
        entryName: 'remote',
      },
    })
  })

  it('restores masked keys on save, validates complete entries, and refreshes the host model config', async () => {
    const root = tmp('emperor-model-service-save-')
    writeModelConfig(root, {
      agents: { defaults: { model: 'primary', provider: 'auto', maxTokens: 8192, temperature: 0.1, reasoningEffort: null, contextWindowTokens: 128000 } },
      models: [{
        name: 'primary',
        mainModelId: 'old-main',
        secondaryModelId: 'old-mini',
        provider: 'openai',
        apiKey: 'sk-entry-old-1234',
      }],
      providers: {
        openai: { apiKey: 'sk-provider-old-9876', apiBase: 'https://api.openai.com/v1', extraHeaders: null, extraBody: null },
      },
    })
    let refreshes = 0
    const service = new CoreModelService(root, {
      router: new ModelRouter(root, await loadModelConfig(root)),
      refreshModelConfig: () => { refreshes += 1 },
    })

    const saved = await service.saveConfig({
      config: {
        agents: { defaults: { model: 'primary', provider: 'auto', maxTokens: 8192, temperature: 0.1, reasoningEffort: null, contextWindowTokens: 128000 } },
        models: [{
          name: 'primary',
          mainModelId: 'new-main',
          secondaryModelId: 'new-mini',
          provider: 'openai',
          apiKey: '***1234',
        }],
        providers: {
          openai: { apiKey: '***9876', apiBase: 'https://api.openai.com/v1', extraHeaders: null, extraBody: null },
        },
      },
    })

    const onDisk = JSON.parse(readFileSync(join(root, 'model_config.json'), 'utf8'))
    expect(onDisk.models[0].apiKey).toBe('sk-entry-old-1234')
    expect(onDisk.providers.openai.apiKey).toBe('sk-provider-old-9876')
    expect(saved.config.models?.[0]?.apiKey).toBe('***1234')
    expect(refreshes).toBe(1)

    await expect(service.saveConfig({ models: [{ name: 'broken', mainModelId: 'main', provider: 'openai' }] }))
      .rejects.toThrow('Secondary Model ID')
    expect(refreshes).toBe(1)
  })

  it('saves onboarding wizard settings through the migrated builder', async () => {
    const root = tmp('emperor-model-service-onboarding-')
    writeModelConfig(root, {
      agents: { defaults: { model: 'old', provider: 'auto', maxTokens: 8192, temperature: 0.1, reasoningEffort: null, contextWindowTokens: 128000 } },
      models: [{
        name: 'old',
        mainModelId: 'old-main',
        secondaryModelId: 'old-mini',
        provider: 'deepseek',
        apiKey: 'sk-existing-secret',
      }],
      providers: { deepseek: { apiKey: '', apiBase: 'https://api.deepseek.com', extraHeaders: null, extraBody: null } },
    })
    let refreshes = 0
    const service = new CoreModelService(root, {
      router: new ModelRouter(root, await loadModelConfig(root)),
      refreshModelConfig: () => { refreshes += 1 },
    })

    const saved = await service.saveOnboardingConfig({
      provider: 'deepseek',
      name: 'deepseek-work',
      label: 'DeepSeek Work',
      apiKey: '',
      apiBase: 'https://api.deepseek.com',
      mainModelId: 'deepseek-chat',
      secondaryModelId: 'deepseek-chat',
      maxTokens: 4096,
      temperature: 0.2,
      contextWindowTokens: 64000,
      reasoningEffort: null,
    })

    const onDisk = JSON.parse(readFileSync(join(root, 'model_config.json'), 'utf8'))
    expect(onDisk.agents.defaults).toMatchObject({
      model: 'deepseek-work',
      provider: 'deepseek',
      maxTokens: 4096,
      temperature: 0.2,
      contextWindowTokens: 64000,
    })
    expect(onDisk.models).toHaveLength(1)
    expect(onDisk.models[0]).toMatchObject({
      name: 'deepseek-work',
      provider: 'deepseek',
      apiKey: 'sk-existing-secret',
      mainModelId: 'deepseek-chat',
      secondaryModelId: 'deepseek-chat',
      id: 'deepseek-chat',
    })
    expect(saved.config.models?.[0]?.apiKey).toBe('***cret')
    expect(refreshes).toBe(1)
  })

  it('tests text and vision model probes, marking successful vision entries and refreshing the host', async () => {
    const root = tmp('emperor-model-service-test-')
    writeModelConfig(root, {
      agents: { defaults: { model: 'fake', provider: 'auto', maxTokens: 8192, temperature: 0.1, reasoningEffort: null, contextWindowTokens: 128000 } },
      models: [{
        name: 'fake',
        mainModelId: 'fake-main',
        secondaryModelId: 'fake-mini',
        provider: 'custom',
        supportsVision: false,
      }],
      providers: { custom: { apiKey: '', apiBase: '', extraHeaders: null, extraBody: null } },
    })
    const provider = new FakeProvider()
    let refreshes = 0
    const service = new CoreModelService(root, {
      router: fakeRouter(provider),
      refreshModelConfig: () => { refreshes += 1 },
    })

    provider.reply = 'pong'
    await expect(service.test({ entryName: 'fake', kind: 'text', role: 'secondary' })).resolves.toMatchObject({
      ok: true,
      kind: 'text',
      model: 'fake-mini',
      provider: 'fake',
      modelRole: 'secondary',
      sample: 'pong',
    })
    expect(provider.calls.at(-1)?.messages.at(-1)?.content).toBe('Reply with exactly one word: pong')

    provider.reply = 'red'
    await expect(service.test({ entryName: 'fake', kind: 'vision', role: 'secondary' })).resolves.toMatchObject({
      ok: true,
      kind: 'vision',
      model: 'fake-main',
      modelRole: 'main',
      sample: 'red',
      visionMarked: true,
    })
    expect(JSON.stringify(provider.calls.at(-1)?.messages)).toContain('image_url')
    expect((await loadModelConfig(root)).models[0]?.supportsVision).toBe(true)
    expect(refreshes).toBe(1)
  })
})

function writeModelConfig(root: string, raw: Record<string, unknown>): void {
  writeFileSync(join(root, 'model_config.json'), `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
}

class FakeProvider extends LLMProvider {
  calls: ChatArgs[] = []
  reply = 'pong'

  constructor() {
    super({ defaultModel: 'fake-main' })
  }

  async chat(args: ChatArgs): Promise<LLMResponse> {
    this.calls.push(args)
    return {
      content: this.reply,
      toolCalls: [],
      finishReason: 'stop',
      usage: { input: 1, output: 1 },
      reasoningContent: null,
      thinkingBlocks: null,
    }
  }
}

function fakeRouter(provider: FakeProvider): { route: (useCase: string) => ModelRoute; payload: () => Record<string, unknown> } {
  return {
    route: (useCase: string) => ({
      snapshot: snapshot(provider, useCase === 'memory_compaction' ? 'secondary' : 'main'),
      fallback: null,
      useCase,
      reason: `${useCase}:fake`,
      estimatedTokens: null,
    }),
    payload: () => ({ secondaryEnabled: true, fallbackToMain: true, mainModel: 'fake-main', secondaryModel: 'fake-mini' }),
  }
}

function snapshot(provider: FakeProvider, role: 'main' | 'secondary'): ProviderSnapshot {
  return {
    provider,
    providerName: 'fake',
    providerLabel: 'Fake Provider',
    model: role === 'main' ? 'fake-main' : 'fake-mini',
    apiBase: 'https://fake.example/v1',
    generation: { maxTokens: 64, temperature: 0, reasoningEffort: null },
    contextWindowTokens: 100000,
    config: {},
    supportsVision: role === 'main',
    entryName: 'fake',
    entryLabel: 'Fake',
    modelRole: role,
    routeReason: `${role}_model`,
  }
}
