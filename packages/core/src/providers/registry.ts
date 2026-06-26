/**
 * Provider Registry (MIG-PROV-002)。
 *
 * 对齐 Python `agent/providers/registry.py`：ProviderSpec 只描述「访问方式」，不内嵌 model 列表。
 * 字段、默认值与 PROVIDERS 表逐条保真（32 条）。`findByName` 容忍 - / _ 互换。
 */

export type ProviderBackend =
  | 'openai_compat'
  | 'anthropic'
  | 'azure_openai'
  | 'bedrock'
  | 'openai_codex'
  | 'github_copilot'

export interface ProviderSpec {
  name: string
  displayName: string
  backend: ProviderBackend
  keywords: readonly string[]
  defaultApiBase: string | null
  envKey: string
  envExtras: ReadonlyArray<readonly [string, string]>
  region: string
  isGateway: boolean
  isLocal: boolean
  isOauth: boolean
  isDirect: boolean
  detectByKeyPrefix: string
  detectByBaseKeyword: string
  stripModelPrefix: boolean
  supportsMaxCompletionTokens: boolean
  supportsPromptCaching: boolean
  thinkingStyle: string
  reasoningAsContent: boolean
  modelOverrides: ReadonlyArray<readonly [string, Record<string, unknown>]>
}

type SpecInput = Pick<ProviderSpec, 'name' | 'displayName' | 'backend'> & Partial<ProviderSpec>

function spec(input: SpecInput): ProviderSpec {
  return {
    keywords: [],
    defaultApiBase: null,
    envKey: '',
    envExtras: [],
    region: 'other',
    isGateway: false,
    isLocal: false,
    isOauth: false,
    isDirect: false,
    detectByKeyPrefix: '',
    detectByBaseKeyword: '',
    stripModelPrefix: false,
    supportsMaxCompletionTokens: false,
    supportsPromptCaching: false,
    thinkingStyle: '',
    reasoningAsContent: false,
    modelOverrides: [],
    ...input,
  }
}

export const PROVIDERS: readonly ProviderSpec[] = [
  // ─── 海外大厂 ───
  spec({ name: 'openai', displayName: 'OpenAI', backend: 'openai_compat', keywords: ['openai', 'gpt', 'o1', 'o3', 'o4'], defaultApiBase: 'https://api.openai.com/v1', envKey: 'OPENAI_API_KEY', region: 'foreign', supportsMaxCompletionTokens: true }),
  spec({ name: 'anthropic', displayName: 'Anthropic', backend: 'anthropic', keywords: ['anthropic', 'claude'], envKey: 'ANTHROPIC_API_KEY', region: 'foreign', supportsPromptCaching: true }),
  spec({ name: 'gemini', displayName: 'Google Gemini', backend: 'openai_compat', keywords: ['gemini', 'gemma', 'google'], defaultApiBase: 'https://generativelanguage.googleapis.com/v1beta/openai/', envKey: 'GEMINI_API_KEY', region: 'foreign' }),
  spec({ name: 'xai', displayName: 'xAI Grok', backend: 'openai_compat', keywords: ['xai', 'grok'], defaultApiBase: 'https://api.x.ai/v1', envKey: 'XAI_API_KEY', region: 'foreign' }),
  spec({ name: 'mistral', displayName: 'Mistral AI', backend: 'openai_compat', keywords: ['mistral', 'codestral'], defaultApiBase: 'https://api.mistral.ai/v1', envKey: 'MISTRAL_API_KEY', region: 'foreign' }),
  spec({ name: 'groq', displayName: 'Groq', backend: 'openai_compat', keywords: ['groq'], defaultApiBase: 'https://api.groq.com/openai/v1', envKey: 'GROQ_API_KEY', region: 'foreign' }),
  // ─── 聚合 / 网关 ───
  spec({ name: 'openrouter', displayName: 'OpenRouter', backend: 'openai_compat', keywords: ['openrouter'], defaultApiBase: 'https://openrouter.ai/api/v1', envKey: 'OPENROUTER_API_KEY', region: 'aggregator', isGateway: true, detectByKeyPrefix: 'sk-or-', detectByBaseKeyword: 'openrouter', supportsPromptCaching: true }),
  spec({ name: 'huggingface', displayName: 'Hugging Face', backend: 'openai_compat', keywords: ['huggingface', 'hugging-face'], defaultApiBase: 'https://router.huggingface.co/v1', envKey: 'HF_TOKEN', region: 'aggregator', isGateway: true, detectByKeyPrefix: 'hf_', detectByBaseKeyword: 'huggingface' }),
  spec({ name: 'aihubmix', displayName: 'AiHubMix', backend: 'openai_compat', keywords: ['aihubmix'], defaultApiBase: 'https://aihubmix.com/v1', envKey: 'AIHUBMIX_API_KEY', region: 'aggregator', isGateway: true, detectByBaseKeyword: 'aihubmix', stripModelPrefix: true }),
  spec({ name: 'siliconflow', displayName: 'SiliconFlow (硅基流动)', backend: 'openai_compat', keywords: ['siliconflow'], defaultApiBase: 'https://api.siliconflow.cn/v1', envKey: 'SILICONFLOW_API_KEY', region: 'aggregator', isGateway: true, detectByBaseKeyword: 'siliconflow' }),
  // ─── 云厂 ───
  spec({ name: 'azure_openai', displayName: 'Azure OpenAI', backend: 'azure_openai', keywords: ['azure', 'azure-openai'], region: 'cloud', isDirect: true }),
  spec({ name: 'bedrock', displayName: 'AWS Bedrock', backend: 'bedrock', keywords: ['bedrock', 'anthropic.claude', 'amazon.nova', 'meta.', 'mistral.', 'cohere.', 'deepseek.', 'moonshot.'], envKey: 'AWS_BEARER_TOKEN_BEDROCK', region: 'cloud', isDirect: true }),
  // ─── 国内 ───
  spec({ name: 'deepseek', displayName: 'DeepSeek', backend: 'openai_compat', keywords: ['deepseek'], defaultApiBase: 'https://api.deepseek.com', envKey: 'DEEPSEEK_API_KEY', region: 'cn', thinkingStyle: 'thinking_type' }),
  spec({ name: 'dashscope', displayName: 'Alibaba DashScope (Qwen)', backend: 'openai_compat', keywords: ['dashscope', 'qwen'], defaultApiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', envKey: 'DASHSCOPE_API_KEY', region: 'cn', thinkingStyle: 'enable_thinking' }),
  spec({ name: 'moonshot', displayName: 'Moonshot Kimi', backend: 'openai_compat', keywords: ['moonshot', 'kimi'], defaultApiBase: 'https://api.moonshot.cn/v1', envKey: 'MOONSHOT_API_KEY', region: 'cn', modelOverrides: [['kimi-k2', { temperature: 1.0 }], ['kimi-k2.5', { temperature: 1.0 }], ['kimi-k2.6', { temperature: 1.0 }]] }),
  spec({ name: 'zhipu', displayName: 'Zhipu GLM (智谱)', backend: 'openai_compat', keywords: ['zhipu', 'glm', 'zai'], defaultApiBase: 'https://open.bigmodel.cn/api/paas/v4/', envKey: 'ZAI_API_KEY', envExtras: [['ZHIPUAI_API_KEY', '{api_key}']], region: 'cn' }),
  spec({ name: 'volcengine', displayName: 'VolcEngine 火山方舟 (含豆包)', backend: 'openai_compat', keywords: ['volcengine', 'volces', 'ark', 'doubao'], defaultApiBase: 'https://ark.cn-beijing.volces.com/api/v3', envKey: 'ARK_API_KEY', region: 'cn', isGateway: true, detectByBaseKeyword: 'volces', thinkingStyle: 'thinking_type' }),
  spec({ name: 'volcengine_coding_plan', displayName: 'VolcEngine Coding Plan', backend: 'openai_compat', keywords: ['volcengine-plan'], defaultApiBase: 'https://ark.cn-beijing.volces.com/api/coding/v3', envKey: 'ARK_API_KEY', region: 'cn', isGateway: true, stripModelPrefix: true, thinkingStyle: 'thinking_type' }),
  spec({ name: 'byteplus', displayName: 'BytePlus (海外火山)', backend: 'openai_compat', keywords: ['byteplus'], defaultApiBase: 'https://ark.ap-southeast.bytepluses.com/api/v3', envKey: 'BYTEPLUS_API_KEY', region: 'cn', isGateway: true, detectByBaseKeyword: 'bytepluses', stripModelPrefix: true, thinkingStyle: 'thinking_type' }),
  spec({ name: 'minimax', displayName: 'MiniMax', backend: 'openai_compat', keywords: ['minimax'], defaultApiBase: 'https://api.minimax.io/v1', envKey: 'MINIMAX_API_KEY', region: 'cn', thinkingStyle: 'reasoning_split' }),
  spec({ name: 'stepfun', displayName: 'Step Fun (阶跃星辰)', backend: 'openai_compat', keywords: ['stepfun', 'step'], defaultApiBase: 'https://api.stepfun.com/v1', envKey: 'STEPFUN_API_KEY', region: 'cn', reasoningAsContent: true }),
  spec({ name: 'xiaomi_mimo', displayName: 'Xiaomi MIMO (小米)', backend: 'openai_compat', keywords: ['xiaomi', 'mimo'], defaultApiBase: 'https://api.xiaomimimo.com/v1', envKey: 'XIAOMIMIMO_API_KEY', region: 'cn' }),
  spec({ name: 'longcat', displayName: 'LongCat (美团)', backend: 'openai_compat', keywords: ['longcat'], defaultApiBase: 'https://api.longcat.chat/openai/v1', envKey: 'LONGCAT_API_KEY', region: 'cn' }),
  spec({ name: 'qianfan', displayName: 'Qianfan 千帆 (文心 ERNIE)', backend: 'openai_compat', keywords: ['qianfan', 'ernie', 'wenxin'], defaultApiBase: 'https://qianfan.baidubce.com/v2', envKey: 'QIANFAN_API_KEY', region: 'cn' }),
  // ─── 本地部署 ───
  spec({ name: 'ollama', displayName: 'Ollama', backend: 'openai_compat', keywords: ['ollama', 'llama', 'nemotron'], defaultApiBase: 'http://localhost:11434/v1', envKey: 'OLLAMA_API_KEY', region: 'local', isLocal: true, detectByBaseKeyword: '11434' }),
  spec({ name: 'lm_studio', displayName: 'LM Studio', backend: 'openai_compat', keywords: ['lm-studio', 'lmstudio', 'lm_studio'], defaultApiBase: 'http://localhost:1234/v1', envKey: 'LM_STUDIO_API_KEY', region: 'local', isLocal: true, detectByBaseKeyword: '1234' }),
  spec({ name: 'vllm', displayName: 'vLLM', backend: 'openai_compat', keywords: ['vllm'], envKey: 'HOSTED_VLLM_API_KEY', region: 'local', isLocal: true }),
  spec({ name: 'ovms', displayName: 'OpenVINO Model Server', backend: 'openai_compat', keywords: ['openvino', 'ovms'], defaultApiBase: 'http://localhost:8000/v3', region: 'local', isLocal: true, isDirect: true }),
  // ─── OAuth-based ───
  spec({ name: 'openai_codex', displayName: 'OpenAI Codex', backend: 'openai_codex', keywords: ['openai-codex', 'codex'], defaultApiBase: 'https://chatgpt.com/backend-api', region: 'other', isOauth: true, detectByBaseKeyword: 'codex', stripModelPrefix: true }),
  spec({ name: 'github_copilot', displayName: 'GitHub Copilot', backend: 'github_copilot', keywords: ['github_copilot', 'copilot'], defaultApiBase: 'https://api.githubcopilot.com', region: 'other', isOauth: true, stripModelPrefix: true, supportsMaxCompletionTokens: true }),
  // ─── 兜底 ───
  spec({ name: 'custom', displayName: 'Custom', backend: 'openai_compat', keywords: [], region: 'other', isDirect: true }),
]

/** 按 registry name 精确查找；容忍 - / _ 互换。对齐 `find_by_name`。 */
export function findByName(name: string | null | undefined): ProviderSpec | undefined {
  if (!name) return undefined
  const normalized = name.replace(/-/g, '_').toLowerCase()
  return PROVIDERS.find((s) => s.name === normalized)
}

/** WebUI ProviderOption 下拉元数据。对齐 `provider_options`。 */
export function providerOptions(): Array<Record<string, unknown>> {
  return PROVIDERS.map((s) => ({
    name: s.name,
    displayName: s.displayName,
    backend: s.backend,
    defaultApiBase: s.defaultApiBase ?? '',
    region: s.region,
    isGateway: s.isGateway,
    isLocal: s.isLocal,
    isOauth: s.isOauth,
    isDirect: s.isDirect,
    thinkingStyle: s.thinkingStyle || null,
  }))
}
