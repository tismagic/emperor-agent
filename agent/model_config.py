from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .providers import GenerationSettings, ProviderSnapshot, create_provider
from .providers.registry import PROVIDERS, find_by_name, provider_options


MODEL_CONFIG_FILE = "model_config.json"
MODEL_CONFIG_EXAMPLE_FILE = "model_config.example.json"


DEFAULT_MODEL_CONFIG: dict[str, Any] = {
    "agents": {
        "defaults": {
            "model": "deepseek-v4-flash",
            "provider": "deepseek",
            "maxTokens": 20000,
            "temperature": 0.1,
            "reasoningEffort": None,
            "contextWindowTokens": 200000,
        }
    },
    "providers": {
        "deepseek": {
            "apiKey": "",
            "apiBase": "https://api.deepseek.com",
            "extraHeaders": None,
            "extraBody": None,
        },
        "deepseekAnthropic": {
            "apiKey": "",
            "apiBase": "https://api.deepseek.com/anthropic",
            "extraHeaders": None,
            "extraBody": None,
        },
        "anthropic": {
            "apiKey": "",
            "apiBase": None,
            "extraHeaders": None,
            "extraBody": None,
        },
        "openai": {
            "apiKey": "",
            "apiBase": None,
            "extraHeaders": None,
            "extraBody": None,
        },
        "openrouter": {
            "apiKey": "",
            "apiBase": "https://openrouter.ai/api/v1",
            "extraHeaders": None,
            "extraBody": None,
        },
        "dashscope": {
            "apiKey": "",
            "apiBase": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "extraHeaders": None,
            "extraBody": None,
        },
        "siliconflow": {
            "apiKey": "",
            "apiBase": "https://api.siliconflow.cn/v1",
            "extraHeaders": None,
            "extraBody": None,
        },
        "ollama": {
            "apiKey": "",
            "apiBase": "http://localhost:11434/v1",
            "extraHeaders": None,
            "extraBody": None,
        },
        "vllm": {
            "apiKey": "",
            "apiBase": "http://localhost:8000/v1",
            "extraHeaders": None,
            "extraBody": None,
        },
        "azure_openai": {
            "apiKey": "",
            "apiBase": "",
            "extraHeaders": None,
            "extraBody": None,
        },
        "bedrock": {
            "apiKey": "",
            "apiBase": None,
            "extraHeaders": None,
            "extraBody": None,
        },
        "openai_codex": {
            "apiKey": "",
            "apiBase": "https://chatgpt.com/backend-api",
            "extraHeaders": None,
            "extraBody": None,
        },
        "github_copilot": {
            "apiKey": "",
            "apiBase": "https://api.githubcopilot.com",
            "extraHeaders": None,
            "extraBody": None,
        },
        "custom": {
            "apiKey": "",
            "apiBase": "",
            "extraHeaders": None,
            "extraBody": None,
        },
    },
}


@dataclass(frozen=True)
class AgentDefaults:
    model: str
    provider: str
    max_tokens: int
    temperature: float
    reasoning_effort: str | None
    context_window_tokens: int


@dataclass(frozen=True)
class ProviderConfig:
    api_key: str | None
    api_base: str | None
    extra_headers: dict[str, str] | None
    extra_body: dict[str, Any] | None


@dataclass(frozen=True)
class ModelConfig:
    defaults: AgentDefaults
    providers: dict[str, ProviderConfig]
    raw: dict[str, Any]


def ensure_model_config(root: Path) -> Path:
    path = root / MODEL_CONFIG_FILE
    if not path.exists():
        path.write_text(
            json.dumps(DEFAULT_MODEL_CONFIG, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return path


def ensure_example_config(root: Path) -> Path:
    path = root / MODEL_CONFIG_EXAMPLE_FILE
    if not path.exists():
        path.write_text(
            json.dumps(DEFAULT_MODEL_CONFIG, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return path


def load_model_config(root: Path, *, create: bool = True) -> ModelConfig:
    root = root.resolve()
    if create:
        ensure_model_config(root)
        ensure_example_config(root)
    path = root / MODEL_CONFIG_FILE
    raw = copy.deepcopy(DEFAULT_MODEL_CONFIG)
    if path.exists():
        loaded = json.loads(path.read_text(encoding="utf-8") or "{}")
        _deep_merge(raw, loaded)
    return parse_model_config(raw)


def save_model_config(root: Path, data: dict[str, Any]) -> ModelConfig:
    config = parse_model_config(_normalized_raw(data))
    path = root.resolve() / MODEL_CONFIG_FILE
    path.write_text(json.dumps(config.raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ensure_example_config(root.resolve())
    return config


def build_provider_snapshot(root: Path, *, model_override: str | None = None) -> ProviderSnapshot:
    config = load_model_config(root)
    defaults = config.defaults
    model = model_override or defaults.model
    provider_name = _resolve_provider_name(defaults.provider, model, config.providers)
    spec = find_by_name(provider_name)
    if spec is None:
        raise ValueError(f"Unknown provider: {provider_name}")
    provider_cfg = config.providers.get(spec.name) or ProviderConfig(None, spec.default_api_base, None, None)
    generation = GenerationSettings(
        max_tokens=defaults.max_tokens,
        temperature=defaults.temperature,
        reasoning_effort=defaults.reasoning_effort,
    )
    provider = create_provider(
        spec=spec,
        api_key=provider_cfg.api_key,
        api_base=provider_cfg.api_base or spec.default_api_base,
        model=model,
        extra_headers=provider_cfg.extra_headers,
        extra_body=provider_cfg.extra_body,
    )
    provider.generation = generation
    return ProviderSnapshot(
        provider=provider,
        provider_name=spec.name,
        provider_label=spec.display_name,
        model=model,
        api_base=provider_cfg.api_base or spec.default_api_base,
        generation=generation,
        context_window_tokens=defaults.context_window_tokens,
        config=config.raw,
    )


def model_config_payload(root: Path) -> dict[str, Any]:
    snapshot = build_provider_snapshot(root)
    return {
        "current": {
            "provider": snapshot.provider_name,
            "providerLabel": snapshot.provider_label,
            "model": snapshot.model,
            "apiBase": snapshot.api_base,
            "maxTokens": snapshot.generation.max_tokens,
            "temperature": snapshot.generation.temperature,
            "reasoningEffort": snapshot.generation.reasoning_effort,
            "contextWindowTokens": snapshot.context_window_tokens,
        },
        "config": snapshot.config,
        "providerOptions": provider_options(),
    }


def parse_model_config(raw: dict[str, Any]) -> ModelConfig:
    normalized = _normalized_raw(raw)
    defaults_raw = normalized["agents"]["defaults"]
    defaults = AgentDefaults(
        model=str(defaults_raw.get("model") or "deepseek-v4-flash"),
        provider=str(defaults_raw.get("provider") or "deepseek"),
        max_tokens=_int(defaults_raw.get("maxTokens"), 20000),
        temperature=_float(defaults_raw.get("temperature"), 0.1),
        reasoning_effort=_nullable_str(defaults_raw.get("reasoningEffort")),
        context_window_tokens=_int(defaults_raw.get("contextWindowTokens"), 200000),
    )
    providers_raw = normalized.get("providers") or {}
    providers: dict[str, ProviderConfig] = {}
    for spec in PROVIDERS:
        item = providers_raw.get(spec.name) or providers_raw.get(_legacy_provider_key(spec.name)) or {}
        providers[spec.name] = ProviderConfig(
            api_key=_nullable_str(item.get("apiKey")),
            api_base=_nullable_str(item.get("apiBase")),
            extra_headers=_dict_or_none(item.get("extraHeaders")),
            extra_body=_dict_or_none(item.get("extraBody")),
        )
    return ModelConfig(defaults=defaults, providers=providers, raw=normalized)


def _normalized_raw(raw: dict[str, Any]) -> dict[str, Any]:
    normalized = copy.deepcopy(DEFAULT_MODEL_CONFIG)
    _deep_merge(normalized, raw or {})
    providers = normalized.setdefault("providers", {})
    for spec in PROVIDERS:
        legacy = _legacy_provider_key(spec.name)
        if legacy != spec.name and legacy in providers:
            providers.setdefault(spec.name, {})
            _deep_merge(providers[spec.name], providers[legacy])
        providers.setdefault(spec.name, {
            "apiKey": "",
            "apiBase": spec.default_api_base or "",
            "extraHeaders": None,
            "extraBody": None,
        })
    normalized.setdefault("agents", {}).setdefault("defaults", copy.deepcopy(DEFAULT_MODEL_CONFIG["agents"]["defaults"]))
    return normalized


def _legacy_provider_key(name: str) -> str:
    aliases = {
        "azure_openai": "azureOpenai",
        "openai_codex": "openaiCodex",
        "github_copilot": "githubCopilot",
    }
    return aliases.get(name, name)


def _resolve_provider_name(provider: str, model: str, providers: dict[str, ProviderConfig]) -> str:
    if provider and provider.lower() not in {"auto", "default"}:
        spec = find_by_name(provider)
        if spec is None:
            raise ValueError(f"Unknown provider: {provider}")
        return spec.name

    normalized_model = model.lower().replace("_", "-")
    for spec in PROVIDERS:
        if any(keyword and keyword in normalized_model for keyword in spec.keywords):
            return spec.name
    for name, config in providers.items():
        if config.api_key:
            return name
    return "deepseek"


def _deep_merge(target: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    for key, value in source.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _deep_merge(target[key], value)
        else:
            target[key] = value
    return target


def _nullable_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text != "" else None


def _dict_or_none(value: Any) -> dict | None:
    return value if isinstance(value, dict) else None


def _int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
