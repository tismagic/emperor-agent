from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    display_name: str
    backend: str
    keywords: tuple[str, ...]
    default_api_base: str | None = None
    strip_model_prefix: bool = False
    supports_max_completion_tokens: bool = False
    thinking_style: str | None = None


PROVIDERS: tuple[ProviderSpec, ...] = (
    ProviderSpec(
        name="custom",
        display_name="Custom",
        backend="openai_compat",
        keywords=(),
    ),
    ProviderSpec(
        name="deepseek",
        display_name="DeepSeek",
        backend="openai_compat",
        keywords=("deepseek",),
        default_api_base="https://api.deepseek.com",
        thinking_style="thinking_type",
    ),
    ProviderSpec(
        name="deepseekAnthropic",
        display_name="DeepSeek (Anthropic)",
        backend="anthropic",
        keywords=("deepseek-anthropic", "deepseekanthropic"),
        default_api_base="https://api.deepseek.com/anthropic",
    ),
    ProviderSpec(
        name="anthropic",
        display_name="Anthropic",
        backend="anthropic",
        keywords=("anthropic", "claude"),
    ),
    ProviderSpec(
        name="openai",
        display_name="OpenAI",
        backend="openai_compat",
        keywords=("openai", "gpt", "o1", "o3", "o4"),
        supports_max_completion_tokens=True,
    ),
    ProviderSpec(
        name="openrouter",
        display_name="OpenRouter",
        backend="openai_compat",
        keywords=("openrouter",),
        default_api_base="https://openrouter.ai/api/v1",
    ),
    ProviderSpec(
        name="dashscope",
        display_name="DashScope",
        backend="openai_compat",
        keywords=("dashscope", "qwen"),
        default_api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
        thinking_style="enable_thinking",
    ),
    ProviderSpec(
        name="siliconflow",
        display_name="SiliconFlow",
        backend="openai_compat",
        keywords=("siliconflow",),
        default_api_base="https://api.siliconflow.cn/v1",
    ),
    ProviderSpec(
        name="ollama",
        display_name="Ollama",
        backend="openai_compat",
        keywords=("ollama", "llama", "qwen", "mistral"),
        default_api_base="http://localhost:11434/v1",
    ),
    ProviderSpec(
        name="vllm",
        display_name="vLLM",
        backend="openai_compat",
        keywords=("vllm",),
        default_api_base="http://localhost:8000/v1",
    ),
    ProviderSpec(
        name="azure_openai",
        display_name="Azure OpenAI",
        backend="azure_openai",
        keywords=("azure", "azure-openai"),
    ),
    ProviderSpec(
        name="bedrock",
        display_name="AWS Bedrock",
        backend="bedrock",
        keywords=("bedrock", "anthropic.claude", "amazon.nova", "deepseek."),
    ),
    ProviderSpec(
        name="openai_codex",
        display_name="OpenAI Codex",
        backend="openai_codex",
        keywords=("openai-codex", "openai_codex"),
        default_api_base="https://chatgpt.com/backend-api",
        strip_model_prefix=True,
    ),
    ProviderSpec(
        name="github_copilot",
        display_name="GitHub Copilot",
        backend="github_copilot",
        keywords=("github-copilot", "github_copilot", "copilot"),
        default_api_base="https://api.githubcopilot.com",
        strip_model_prefix=True,
    ),
)


def find_by_name(name: str | None) -> ProviderSpec | None:
    if not name:
        return None
    normalized = name.replace("_", "").replace("-", "").lower()
    for spec in PROVIDERS:
        if spec.name.replace("_", "").replace("-", "").lower() == normalized:
            return spec
    return None


def provider_options() -> list[dict[str, str]]:
    return [
        {
            "name": spec.name,
            "displayName": spec.display_name,
            "backend": spec.backend,
            "defaultApiBase": spec.default_api_base or "",
        }
        for spec in PROVIDERS
    ]
