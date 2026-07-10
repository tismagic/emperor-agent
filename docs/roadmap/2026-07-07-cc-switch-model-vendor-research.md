# cc-switch 模型厂商配置调研

Date: 2026-07-07

Source: https://github.com/farion1231/cc-switch (branch `main`)

本调研提取 cc-switch（管理 Claude Code / Codex / Gemini CLI 等编程 Agent 工具 API 配置的桌面应用）中收录的**主流模型厂商**配置信息，对照填入 emperor-agent 现有的模型配置系统（`packages/core/src/providers/registry.ts` 的 `ProviderSpec` + `packages/core/src/config/model-config.ts` 的 `ModelEntry`）。收录字段：**每个厂商的 base URL（按 7 个工具区分）、官网、API Key 申请页、模型列表获取方式、厂商 Logo、模型/定价/quirk**。

**范围说明**：cc-switch 原始收录了约 75 个厂商（含 30 个长尾中转商和十多个冷门厂商），本文档仅保留**主流国内外模型厂商和著名聚合平台**，去除了仅做 Claude/OpenAI 透传转售的无自有模型能力的中转商。

---

## 1. 我们当前的字段速查

### `ProviderSpec`（`packages/core/src/providers/registry.ts:16-37`）

```ts
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
  region: string // 'foreign' | 'aggregator' | 'cloud' | 'cn' | 'local' | 'other'
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
```

目前 **31 个**已注册厂商。新增一个 OpenAI 兼容厂商只需在 `PROVIDERS` 数组里用 `spec({...})` 加一条记录，UI/IPC 层完全数据驱动，无需改前端代码。

### `ModelEntry`（`packages/core/src/config/model-config.ts:27-57`）

```ts
export interface ModelEntry {
  name: string
  id: string
  mainModelId: string
  provider: string
  secondaryModelId: string
  apiKey: string | null
  apiBase: string | null
  extraHeaders: Record<string, string> | null
  extraBody: Record<string, unknown> | null
  maxTokens: number | null
  temperature: number | null
  contextWindowTokens: number | null
  reasoningEffort: string | null
  label: string
  supportsVision: boolean
}
```

**Gap**：`ModelEntry` 目前没有定价字段、logo 字段、官网字段。本文档数据供后续 schema 扩展参考，本次不涉及代码改动。

---

## 2. 模型列表获取方式

| #         | 路径                          | 覆盖范围                                 | 说明                                                                                                                                                                     |
| --------- | ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1         | 通用 OpenAI 兼容 `/v1/models` | 除 OAuth 厂商外的**全部厂商**            | `Authorization: Bearer {api_key}`；候选 URL 生成会剥离 `/api/anthropic`、`/apps/anthropic`、`/step_plan`、`/api/coding` 等 Anthropic 兼容子路径后重试；15 秒超时；不落盘 |
| 2         | Codex OAuth 私有 endpoint     | 仅 `openai_codex`                        | `chatgpt.com/backend-api/codex/models`，带 `chatgpt-account-id` 等专属 header                                                                                            |
| 3         | GitHub Copilot 私有 endpoint  | 仅 `github_copilot`                      | `{api_base}/models`，模拟 VSCode header，内存缓存                                                                                                                        |
| 4（独立） | `models.dev` 定价目录         | Usage/计费面板专属，与上面的"选模型"无关 | 前端 `fetch("https://models.dev/api.json")`，用户手动导入定价                                                                                                            |

**结论**：除 `openai_codex`/`github_copilot` 外，所有厂商都可以直接用 `base + /v1/models` 拉取模型列表。

---

## 3. 厂商身份信息（官网 / API Key 页面 / Logo）

### 图标方案建议

cc-switch 的图标主要来自 npm 依赖 **`@lobehub/icons-static-svg`**（MIT 协议，`lobehub/lobe-icons` 项目），覆盖绝大多数知名厂商。**建议我们直接安装这个包作为依赖来引用**，授权清晰、无需手工维护图标文件。少数厂商（如 longcat、byteplus）在 lobehub 库中没有对应图标，需要自行到厂商官网获取或使用通用占位符。

下表 `apiKeyUrl` 大多带有 cc-switch 的推广参数（`?aff=...`、`?ref=...`），**实际使用前请去掉**。

### 海外大厂

| Vendor(key) | Website                   | API Key 页面               | Icon (lobehub)            |
| ----------- | ------------------------- | -------------------------- | ------------------------- |
| openai      | chatgpt.com/codex         | — (OAuth)                  | `openai.svg`              |
| anthropic   | anthropic.com/claude-code | — (OAuth)                  | `anthropic.svg` `#D4915D` |
| gemini      | ai.google.dev             | aistudio.google.com/apikey | `gemini.svg`              |
| xai         | —（cc-switch 无预设）     | —                          | `xai.svg`                 |
| mistral     | —（cc-switch 无预设）     | —                          | `mistral.svg` `#FF7000`   |
| groq        | —（cc-switch 无预设）     | —                          | 无                        |

### 国内厂商

| Vendor(key)              | Website                                      | API Key 页面                             | Icon (lobehub)                       |
| ------------------------ | -------------------------------------------- | ---------------------------------------- | ------------------------------------ |
| deepseek                 | platform.deepseek.com                        | platform.deepseek.com/api_keys           | `deepseek.svg` `#1E88E5`             |
| dashscope (Qwen/Bailian) | bailian.console.aliyun.com                   | bailian.console.aliyun.com/#/api-key     | `qwen.svg` / `bailian.svg`           |
| moonshot (Kimi)          | platform.kimi.com                            | platform.kimi.com/console/api-keys       | `kimi.svg` / `moonshot.svg`          |
| zhipu (GLM)              | open.bigmodel.cn / z.ai                      | bigmodel.cn/claude-code / z.ai/subscribe | `zhipu.svg` / `chatglm.svg`          |
| volcengine (Doubao/Ark)  | volcengine.com/product/ark                   | console.volcengine.com/ark/...           | `doubao.svg` / `bytedance.svg`       |
| byteplus (火山国际)      | byteplus.com/en/product/modelark             | 同 website                               | `byteplus.png`（自定义，非 lobehub） |
| minimax                  | platform.minimaxi.com / .io                  | .../subscribe/coding-plan                | `minimax.svg` `#FF6B6B`              |
| stepfun                  | platform.stepfun.com/step-plan               | .../interface-key                        | `stepfun.svg` `#005AFF`              |
| xiaomi_mimo              | platform.xiaomimimo.com                      | .../console/api-keys                     | `xiaomimimo.svg`                     |
| longcat (美团)           | longcat.chat/platform                        | .../api_keys                             | `longcat-color.svg`（自定义）        |
| qianfan (Baidu ERNIE)    | cloud.baidu.com/product/qianfan_modelbuilder | console.bce.baidu.com/qianfan/...        | `baidu.svg` `#2932E1`                |

### 聚合平台

| Vendor(key) | Website                          | API Key 页面                      | Icon (lobehub)              |
| ----------- | -------------------------------- | --------------------------------- | --------------------------- |
| openrouter  | openrouter.ai                    | openrouter.ai/keys                | `openrouter.svg`            |
| together    | together.ai                      | api.together.ai/settings/api-keys | 无                          |
| huggingface | huggingface.co                   | huggingface.co/settings/tokens    | `huggingface.svg` `#FFD21E` |
| siliconflow | siliconflow.cn / siliconflow.com | cloud.siliconflow.cn/i/YflgU2Ve   | `siliconflow.svg`           |

### 云平台

| Vendor(key)  | Website                       | API Key 页面 | Icon (lobehub)        |
| ------------ | ----------------------------- | ------------ | --------------------- |
| azure_openai | learn.microsoft.com/.../codex | —            | `azure.svg` `#0078D4` |
| bedrock      | aws.amazon.com/bedrock/       | —            | `aws.svg` `#FF9900`   |

### 本地部署 / OAuth / 兜底

| Vendor(key)    | Website                     | API Key 页面 | Icon                 |
| -------------- | --------------------------- | ------------ | -------------------- |
| ollama         | ollama.com                  | —            | `ollama.svg`         |
| lm_studio      | lmstudio.ai                 | —            | 无                   |
| vllm           | —                           | —            | 无                   |
| ovms           | —                           | —            | 无                   |
| openai_codex   | openai.com/chatgpt/pricing  | — (OAuth)    | `openai.svg`（复用） |
| github_copilot | github.com/features/copilot | — (OAuth)    | `githubcopilot.svg`  |
| custom         | —                           | —            | 无（通用兜底）       |

---

## 4. 完整 Base URL 矩阵（按 7 个工具区分）

以下 URL 均省略 `https://` 前缀；`同` 表示与左侧最近的非空单元格相同；`—` 表示该工具没有此厂商的预设。

### 海外大厂

| Vendor(+变体)                         | Claude                            | Claude Desktop | Codex | Gemini | Hermes | OpenClaw | OpenCode |
| ------------------------------------- | --------------------------------- | -------------- | ----- | ------ | ------ | -------- | -------- |
| openai（Codex OAuth）                 | —                                 | —              | OAuth | —      | —      | —        | —        |
| anthropic（Claude Official）          | OAuth                             | —              | —     | —      | —      | —        | —        |
| gemini（作为 Claude/Desktop backend） | generativelanguage.googleapis.com | 同             | —     | —      | —      | —        | —        |
| gemini（Gemini CLI 自身）             | —                                 | —              | —     | OAuth  | —      | —        | —        |

> xai / mistral / groq：cc-switch 无预设，仅我们自有的 `openai_compat` 覆盖。

### 国内厂商

| Vendor(+变体)                   | Claude                                       | Claude Desktop | Codex                                     | Gemini | Hermes                            | OpenClaw                     | OpenCode |
| ------------------------------- | -------------------------------------------- | -------------- | ----------------------------------------- | ------ | --------------------------------- | ---------------------------- | -------- |
| deepseek                        | api.deepseek.com/anthropic                   | 同             | api.deepseek.com                          | —      | api.deepseek.com                  | api.deepseek.com/v1          | 同       |
| dashscope（Bailian）            | dashscope.aliyuncs.com/apps/anthropic        | 同             | dashscope.aliyuncs.com/compatible-mode/v1 | —      | 同Codex                           | —                            | 同Codex  |
| dashscope（Bailian For Coding） | coding.dashscope.aliyuncs.com/apps/anthropic | 同             | —                                         | —      | 同Claude                          | —                            | —        |
| moonshot（Kimi）                | api.moonshot.cn/anthropic                    | 同             | api.moonshot.cn/v1                        | —      | 同                                | 同                           | 同       |
| moonshot（Kimi For Coding）     | api.kimi.com/coding/                         | 同             | api.kimi.com/coding/v1                    | —      | 同Claude                          | api.kimi.com/v1              | 同Codex  |
| zhipu（CN）                     | open.bigmodel.cn/api/anthropic               | 同             | open.bigmodel.cn/api/coding/paas/v4       | —      | 同Codex                           | 同                           | 同       |
| zhipu（en）                     | api.z.ai/api/anthropic                       | 同             | api.z.ai/api/coding/paas/v4               | —      | 同Codex                           | 同                           | 同       |
| volcengine（Agentplan）         | ark.cn-beijing.volces.com/api/coding         | 同             | .../api/coding/v3                         | —      | 同Claude                          | 同Codex                      | 同       |
| volcengine（DouBaoSeed）        | ark.cn-beijing.volces.com/api/compatible     | 同             | .../api/v3                                | —      | 同Claude                          | 同Codex                      | 同       |
| byteplus                        | ark.ap-southeast.bytepluses.com/api/coding   | 同             | .../api/coding/v3                         | —      | 同Claude                          | 同Codex                      | 同       |
| minimax（CN）                   | api.minimaxi.com/anthropic                   | 同             | api.minimaxi.com/v1                       | —      | 同Codex                           | 同                           | 同       |
| minimax（en）                   | api.minimax.io/anthropic                     | 同             | api.minimax.io/v1                         | —      | 同Codex                           | 同                           | 同       |
| stepfun（CN）                   | api.stepfun.com/step_plan                    | 同             | .../v1                                    | —      | api.stepfun.ai/v1（⚠ 域名不一致） | api.stepfun.com/step_plan/v1 | 同       |
| stepfun（en）                   | api.stepfun.ai/step_plan                     | 同             | .../v1                                    | —      | —                                 | api.stepfun.ai/step_plan/v1  | 同       |
| xiaomi_mimo                     | api.xiaomimimo.com/anthropic                 | 同             | .../v1                                    | —      | 同                                | 同                           | 同       |
| xiaomi_mimo（Token Plan）       | token-plan-cn.xiaomimimo.com/anthropic       | 同             | .../v1                                    | —      | 同                                | 同                           | 同       |
| longcat                         | api.longcat.chat/anthropic                   | 同             | api.longcat.chat/openai/v1                | —      | 同Codex                           | 同                           | 同       |
| qianfan                         | qianfan.baidubce.com/anthropic/coding        | 同             | qianfan.baidubce.com/v2/coding            | —      | —                                 | —                            | —        |

### 聚合平台

| Vendor            | Claude                | Claude Desktop | Codex                | Gemini            | Hermes               | OpenClaw | OpenCode |
| ----------------- | --------------------- | -------------- | -------------------- | ----------------- | -------------------- | -------- | -------- |
| openrouter        | openrouter.ai/api     | 同             | openrouter.ai/api/v1 | openrouter.ai/api | openrouter.ai/api/v1 | 同       | 同       |
| together          | —                     | —              | —                    | —                 | api.together.xyz/v1  | —        | —        |
| huggingface       | —（cc-switch 无预设） | —              | —                    | —                 | —                    | —        | —        |
| siliconflow（CN） | api.siliconflow.cn    | 同             | .../v1               | —                 | 同                   | 同       | —        |
| siliconflow（en） | api.siliconflow.com   | 同             | .../v1               | —                 | 同                   | 同       | —        |

### 云平台

| Vendor                    | Claude                                        | Claude Desktop | Codex                                        | Gemini | Hermes | OpenClaw                                | OpenCode                           |
| ------------------------- | --------------------------------------------- | -------------- | -------------------------------------------- | ------ | ------ | --------------------------------------- | ---------------------------------- |
| azure_openai              | —                                             | —              | `{RESOURCE}.openai.azure.com/openai`（模板） | —      | —      | —                                       | —                                  |
| bedrock（AKSK / API Key） | `bedrock-runtime.${AWS_REGION}.amazonaws.com` | —              | —                                            | —      | —      | —                                       | —                                  |
| bedrock（OpenClaw）       | —                                             | —              | —                                            | —      | —      | bedrock-runtime.us-west-2.amazonaws.com | —                                  |
| bedrock（OpenCode）       | —                                             | —              | —                                            | —      | —      | —                                       | SDK 从 region 派生，无字面 baseURL |

### 本地部署 / OAuth / 兜底

| Vendor                                      | Claude                        | Claude Desktop | Codex | Gemini   | Hermes | OpenClaw | OpenCode |
| ------------------------------------------- | ----------------------------- | -------------- | ----- | -------- | ------ | -------- | -------- |
| ollama / lm_studio / vllm / ovms            | —（cc-switch 不面向本地部署） | —              | —     | —        | —      | —        | —        |
| openai_codex（作为 Claude/Desktop backend） | chatgpt.com/backend-api/codex | 同             | —     | —        | —      | —        | —        |
| openai_codex（自身 OAuth）                  | —                             | —              | OAuth | —        | —      | —        | —        |
| github_copilot                              | api.githubcopilot.com         | 同             | —     | —        | —      | —        | —        |
| custom                                      | —                             | —              | —     | 用户自填 | —      | 用户自填 | 用户自填 |

---

## 5. 各厂商补充信息（定价 / 模型 / quirk）

> 定价单位统一为 USD / 百万 token（USD/Mtok），数据仅来源于 cc-switch 的 `openclawProviderPresets.ts`（唯一带真实定价的文件）。缺失即标注"无数据"。

### 海外大厂

| Vendor               | 模型 + 定价                    | 上下文窗口 | 备注                 |
| -------------------- | ------------------------------ | ---------- | -------------------- |
| openai               | OAuth，无 API Key 模式定价数据 | —          | —                    |
| anthropic            | OAuth 优先                     | —          | —                    |
| gemini               | OAuth 优先                     | —          | —                    |
| xai / mistral / groq | cc-switch 无数据               | —          | 我们通过各自官网补充 |

### 国内厂商

| Vendor                   | 模型 + 定价 (USD/Mtok IN/OUT)                       | 上下文窗口                             | 特殊 quirk / 备注                                                                                                                |
| ------------------------ | --------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| deepseek                 | deepseek-v4-pro $1.68/$3.36, flash $0.14/$0.28      | 均 1,000,000                           | 模型探测需要剥离 `/anthropic` 子路径（`modelsUrl` override 到 `api.deepseek.com/models`）；`thinkingStyle: 'thinking_type'`      |
| dashscope                | qwen3.5-plus $0.002/$0.006（OpenClaw "Qwen Coder"） | 32,000                                 | Coding 变体独立域名 `coding.dashscope.aliyuncs.com`；`thinkingStyle: 'enable_thinking'`                                          |
| moonshot                 | kimi-k2.7-code $0.002/$0.006                        | 262,144（Kimi）/ 131,072（For Coding） | Coding 变体注入 `CLAUDE_CODE_AUTO_COMPACT_WINDOW=262144`；可选新增 `moonshot_coding_plan`                                        |
| zhipu                    | glm-5.1 $0.001/$0.001                               | 128,000                                | CN/intl 双域名（`open.bigmodel.cn` / `api.z.ai`）；可选拆成两个 ProviderSpec                                                     |
| volcengine（Agentplan）  | ark-code-latest 无定价                              | 256,000                                | 对应我们现有的 `volcengine_coding_plan`                                                                                          |
| volcengine（DouBaoSeed） | doubao-seed-2-1-pro-260628 $0.84/$4.2               | 262,144                                | Claude 侧加 `API_TIMEOUT_MS=3000000`；可能值得作为第三个 volcengine 变体补充                                                     |
| byteplus                 | ark-code-latest 无定价                              | 256,000                                | 火山国际版，与 `volcengine_coding_plan` 对应                                                                                     |
| minimax                  | MiniMax-M2.7 $0.001/$0.004                          | 200,000                                | Codex 侧模型 MiniMax-M3 支持并行工具调用 + 多模态（text/image）；`thinkingStyle: 'reasoning_split'`                              |
| stepfun                  | 无定价数据                                          | 262,144                                | ⚠ Hermes 文件里 CN 条目却用了 `.ai` 域名，与其余 6 文件不一致（`.com`），推测为复制粘贴失误；落地以多数结果为准                  |
| xiaomi_mimo              | mimo-v2.5-pro $1/$3（cacheRead $0.2）               | 1,048,576（outlim 131,072）            | 支持 reasoning；Token Plan 独立域名；可选新增 `xiaomi_mimo_token_plan`                                                           |
| longcat                  | LongCat-2.0 $0.001/$0.004                           | 1,048,576（outlim 131,072）            | OpenClaw 标注 `authHeader:true`（需显式 Bearer header）；Claude 加 `MAX_OUTPUT_TOKENS=131072` + `DISABLE_NONESSENTIAL_TRAFFIC=1` |
| qianfan                  | qianfan-code-latest 无定价                          | 131,072                                | 仅覆盖 Claude/Claude Desktop/Codex 三个工具                                                                                      |

### 聚合平台

| Vendor      | 模型 + 定价 (USD/Mtok IN/OUT)                                           | 上下文窗口                 | 备注                                                                                            |
| ----------- | ----------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| openrouter  | claude-opus-4.8 $5/$25, claude-sonnet-5 $3/$15                          | 1,000,000                  | 透传官方模型 ID；`isGateway:true`；`detectByKeyPrefix: 'sk-or-'`；`supportsPromptCaching: true` |
| together    | Qwen3-Coder-480B $无数据, DeepSeek-V3.2 无数据, Llama-4-Maverick 无数据 | 262,144 / 64,000 / 131,072 | cc-switch 目前只在 Hermes 接入，但本身是知名推理平台，值得作为通用 aggregator 收录              |
| huggingface | 无数据（cc-switch 无预设）                                              | —                          | 走 `https://router.huggingface.co/v1`；`isGateway:true`；`detectByKeyPrefix: 'hf_'`             |
| siliconflow | Pro/MiniMaxAI/MiniMax-M2.7 $0.001/$0.004                                | 200,000                    | CN 站模型带 `Pro/` 前缀，en 站无前缀；`isGateway:true`；可选区分 CN/intl                        |

### 云平台

| Vendor       | 模型 + 定价 (USD/Mtok IN/OUT)                                                                      | 备注                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| azure_openai | 无定价数据                                                                                         | `query_params.api-version=2025-04-01-preview`；`wire_api=responses`；⚠ cc-switch 该条目同时标了 `third_party` 和 `isOfficial:true`（疑似复制粘贴不一致） |
| bedrock      | opus $5/$25（cacheRead $0.5/cacheWrite $6.25）、sonnet $3/$15（0.3/3.75）、haiku $0.8/$4（0.08/1） | ctx opus/sonnet 1,000,000，haiku 200,000；OpenCode 侧不走字面 baseURL，用 SDK 的 region/accessKeyId/secretAccessKey 派生                                 |

### 本地部署 / OAuth / 兜底

| Vendor                           | 备注                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ollama / lm_studio / vllm / ovms | 本地部署，`isLocal:true`，无需 API Key；cc-switch 不覆盖此类场景                                      |
| openai_codex                     | 模型获取走私有 endpoint `chatgpt.com/backend-api/codex/models`（非标准 `/v1/models`）；`isOauth:true` |
| github_copilot                   | 模型获取走 `{api_base}/models` + VSCode 伪装 header；`isOauth:true`                                   |
| custom                           | 通用兜底，用户自填 base URL + API Key                                                                 |

---

## 6. 数据存疑点

- **Azure OpenAI**（cc-switch Codex 预设）同时标了 `category:"third_party"` 和 `isOfficial:true`，语义冲突，疑似复制粘贴遗留。
- **AWS Bedrock（OpenCode）** 不走字面 `baseURL`，通过 `@ai-sdk/amazon-bedrock` SDK 的 `region/accessKeyId/secretAccessKey` 参数内部派生 endpoint；OpenClaw 则固定写死 `us-west-2`。
- **StepFun** Hermes 文件里 CN 条目使用了 `.ai` 域名，与其余 6 文件（`.com`）不一致——推测为复制粘贴失误，落地以多数结果为准。
- CN/国际双域名的厂商（zhipu、minimax、stepfun、siliconflow）在 cc-switch 里各自是两个独立预设。是否拆成两个 `ProviderSpec` 条目留给实现阶段决定。
- 郭内厂商的 Coding Plan / Token Plan 变体（dashscope、moonshot、xiaomi_mimo、compshare 等）本质是一种"包月订阅"套餐，URL 路径与标准 API 不同，但底层协议仍是 OpenAI 兼容。是否新增独立的 `*_coding_plan` registry key 取决于我们是否需要区分"订阅制"和"按量付费"两种接入方式。
- 多家厂商同一个 Claude 模型的定价在不同渠道间完全一致（$5/$25、$3/$15 等），推测是直接照抄 Anthropic 官方标价，而非各渠道实际成本定价。
- 图标匹配：dashscope/moonshot/zhipu/qianfan/volcengine 等厂商在 lobehub 库里有多个近似候选图标，未能 100% 确认 cc-switch 实际渲染时选用哪一个。
- 厂商的 `apiKeyUrl` 绝大多数携带 cc-switch 自己的推广参数（`?aff=...`、`?ref=...`），复用前请自行清理。

---

## 7. 来源引用

- `src/config/claudeProviderPresets.ts`、`claudeDesktopProviderPresets.ts`、`codexProviderPresets.ts`、`geminiProviderPresets.ts`、`hermesProviderPresets.ts`、`openclawProviderPresets.ts`、`opencodeProviderPresets.ts`（均为 `raw.githubusercontent.com/farion1231/cc-switch/main/` 前缀）
- `src/types.ts`（`ProviderCategory`、`OpenClawModel.cost` 等接口定义）
- `src/config/iconInference.ts`、`scripts/extract-icons.js`、`package.json`（确认 `@lobehub/icons-static-svg` 依赖及 MIT 协议）
- `src-tauri/src/services/model_fetch.rs`、`codex_oauth_models.rs`、`proxy/providers/copilot_auth.rs`（模型列表获取）
- `src/components/usage/ModelsDevPickerDialog.tsx`（models.dev 定价导入）
- 我方参照文件：`packages/core/src/providers/registry.ts`、`packages/core/src/config/model-config.ts`
