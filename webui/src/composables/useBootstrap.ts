import { ref } from 'vue'
import { api, cloneJson } from '../api/http'
import type { BootstrapPayload, CompactResult, ConfigInfo, MemoryPayload, ModelConfigPayload, ModelConfigRaw, SkillInfo } from '../types'

export function useBootstrap(showToast: (message: string) => void) {
  const boot = ref<BootstrapPayload | null>(null)
  const loading = ref(true)
  const error = ref('')
  const modelDraftProvider = ref<string | null>(null)
  const activeSkill = ref<string | null>(null)
  const skillContent = ref('')
  const activeConfig = ref<string | null>(null)
  const configContent = ref('')

  async function loadBootstrap(showLoading = true) {
    try {
      if (showLoading) loading.value = true
      error.value = ''
      boot.value = await api<BootstrapPayload>('/api/bootstrap')
      modelDraftProvider.value = boot.value.modelConfig?.config?.agents?.defaults?.provider || null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function refreshMemory(shouldToast = true) {
    if (!boot.value) return
    boot.value.memory = await api<MemoryPayload>('/api/memory')
    if (shouldToast) showToast('记忆与 Token 统计已刷新')
  }

  async function refreshModelConfig() {
    if (!boot.value) return
    boot.value.modelConfig = await api<ModelConfigPayload>('/api/model-config')
    boot.value.model = boot.value.modelConfig.current?.model || boot.value.model
    boot.value.provider = boot.value.modelConfig.current?.provider || boot.value.provider
    modelDraftProvider.value = boot.value.modelConfig.config?.agents?.defaults?.provider || null
  }

  async function saveModelConfig(config: ModelConfigRaw) {
    const data = await api<ModelConfigPayload>('/api/model-config', {
      method: 'POST',
      body: JSON.stringify({ config }),
    })
    if (boot.value) {
      boot.value.modelConfig = data
      boot.value.model = data.current?.model || boot.value.model
      boot.value.provider = data.current?.provider || boot.value.provider
      boot.value.providerLabel = data.current?.providerLabel || boot.value.providerLabel
    }
    modelDraftProvider.value = data.config?.agents?.defaults?.provider || null
    showToast('模型配置已保存')
  }

  async function compactMemory() {
    const data = await api<CompactResult>('/api/compact', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (boot.value) {
      boot.value.memory = data.memory
      boot.value.unarchivedHistory = data.unarchivedHistory
    }
    return data
  }

  async function loadSkill(name: string) {
    const data = await api<{ name: string; content: string }>('/api/skill?name=' + encodeURIComponent(name))
    activeSkill.value = data.name
    skillContent.value = data.content
  }

  function startNewSkill(name: string) {
    activeSkill.value = name
    skillContent.value = `---\nname: ${name}\ndescription: Describe when to use this skill.\n---\n\n# ${name}\n\n## When to use\n\nUse this skill when...\n`
  }

  async function saveSkill(content: string) {
    if (!activeSkill.value) return
    await api<SkillInfo>('/api/skill', {
      method: 'POST',
      body: JSON.stringify({ name: activeSkill.value, content }),
    })
    await loadBootstrap(false)
    await loadSkill(activeSkill.value)
    showToast('Skill 已保存，并刷新了 Agent 上下文')
  }

  async function loadConfig(path: string) {
    const data = await api<{ path: string; content: string }>('/api/config?path=' + encodeURIComponent(path))
    activeConfig.value = data.path
    configContent.value = data.content
  }

  async function saveConfig(content: string) {
    if (!activeConfig.value) return
    await api<ConfigInfo>('/api/config', {
      method: 'POST',
      body: JSON.stringify({ path: activeConfig.value, content }),
    })
    await loadBootstrap(false)
    await loadConfig(activeConfig.value)
    showToast('配置已保存，并刷新了 Agent 上下文')
  }

  return {
    boot,
    loading,
    error,
    modelDraftProvider,
    activeSkill,
    skillContent,
    activeConfig,
    configContent,
    loadBootstrap,
    refreshMemory,
    refreshModelConfig,
    saveModelConfig,
    compactMemory,
    loadSkill,
    startNewSkill,
    saveSkill,
    loadConfig,
    saveConfig,
    cloneJson,
  }
}
