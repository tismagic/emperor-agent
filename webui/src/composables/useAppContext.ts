import { inject, provide, type InjectionKey, type Ref } from 'vue'
import type {
  BootstrapPayload,
  ChatMessage,
  CompactResult,
  ModelConfigRaw,
  PendingState,
  RuntimeStatus,
} from '../types'
import type { SlashCommand } from '../commands'

export interface AppContext {
  boot: Ref<BootstrapPayload | null>
  loading: Ref<boolean>
  error: Ref<string>
  activeSkill: Ref<string | null>
  skillContent: Ref<string>
  activeConfig: Ref<string | null>
  configContent: Ref<string>

  messages: Ref<ChatMessage[]>
  busy: Ref<boolean>
  status: Ref<RuntimeStatus>
  pending: PendingState
  runtimeText: () => string

  commands: SlashCommand[]

  refreshAll: () => Promise<void>
  refreshMemory: (shouldToast?: boolean) => Promise<void>
  saveModelConfig: (config: ModelConfigRaw) => Promise<void>
  compactMemory: () => Promise<CompactResult>
  loadSkill: (name: string) => Promise<void>
  startNewSkill: (name: string) => void
  saveSkill: (content: string) => Promise<void>
  loadConfig: (path: string) => Promise<void>
  saveConfig: (content: string) => Promise<void>

  sendMessage: (content: string) => boolean
  clearChat: () => void
  submitFromComposer: (raw: string) => void

  showToast: (message: string) => void
  runSafely: (task: () => Promise<void>) => Promise<void>
}

export const APP_CONTEXT_KEY: InjectionKey<AppContext> = Symbol('emperor-agent:app-context')

export function provideAppContext(context: AppContext) {
  provide(APP_CONTEXT_KEY, context)
}

export function useAppContext(): AppContext {
  const ctx = inject(APP_CONTEXT_KEY)
  if (!ctx) {
    throw new Error('useAppContext() called outside of <App>; provideAppContext must run first.')
  }
  return ctx
}
