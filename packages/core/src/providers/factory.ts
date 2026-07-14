/**
 * Provider 工厂 (MIG-PROV-006)。
 * 对齐 Python `agent/providers/factory.py`：按 backend 造 provider。
 * snapshot 装配（`build_provider_snapshot`）依赖 model_config + credentials 解析 —— 在 CFG-004 ModelRouter。
 */
import type { LLMProviderConfig } from './base'
import type { ProviderSpec } from './registry'
import { AnthropicProvider } from './anthropic'
import {
  AzureOpenAIProvider,
  GitHubCopilotProvider,
  OpenAICodexProvider,
  OpenAICompatProvider,
} from './openai-compat'
import { BedrockProvider } from './bedrock'

export interface CreateProviderArgs extends LLMProviderConfig {
  spec?: ProviderSpec
}

export function createProvider(
  args: CreateProviderArgs,
): AnthropicProvider | OpenAICompatProvider | BedrockProvider {
  const { spec, ...common } = args
  // Transitional runtime bridge. RegistryProvider.backend is deliberately
  // limited to the two public protocols; Task 2 removes these dead branches.
  const backend = (spec?.backend ?? 'openai_compat') as
    | 'openai_compat'
    | 'anthropic'
    | 'azure_openai'
    | 'bedrock'
    | 'openai_codex'
    | 'github_copilot'
  switch (backend) {
    case 'anthropic':
      return new AnthropicProvider(common)
    case 'azure_openai':
      return new AzureOpenAIProvider({ ...common, spec })
    case 'bedrock':
      return new BedrockProvider(common)
    case 'openai_codex':
      return new OpenAICodexProvider({ ...common, spec })
    case 'github_copilot':
      return new GitHubCopilotProvider({ ...common, spec })
    default:
      return new OpenAICompatProvider({ ...common, spec })
  }
}
