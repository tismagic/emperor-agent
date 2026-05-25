from __future__ import annotations

from typing import Any

from .model_router import ModelRoute
from .runner import AgentRunner
from .telemetry import TokenTracker
from .tools import ToolRegistry


def build_routed_runner(
    *,
    route: ModelRoute,
    registry: ToolRegistry,
    system_prompt: str,
    token_tracker: TokenTracker | None,
    usage_type: str,
    max_tokens_cap: int | None = None,
    memory_store=None,
    compactor=None,
    todo_store=None,
    control_manager=None,
    max_context: int | None = None,
    max_turns: int = 12,
) -> AgentRunner:
    snapshot = route.snapshot
    fallback = route.fallback
    max_tokens = snapshot.generation.max_tokens
    if max_tokens_cap is not None:
        max_tokens = min(max_tokens_cap, max_tokens)
    kwargs: dict[str, Any] = {}
    if max_context is not None:
        kwargs["max_context"] = max_context
    return AgentRunner(
        provider=snapshot.provider,
        model=snapshot.model,
        registry=registry,
        system_prompt=system_prompt,
        max_tokens=max_tokens,
        temperature=snapshot.generation.temperature,
        reasoning_effort=snapshot.generation.reasoning_effort,
        provider_name=snapshot.provider_name,
        model_role=snapshot.model_role,
        route_reason=route.reason,
        route_estimated_tokens=route.estimated_tokens,
        fallback_provider=fallback.provider if fallback else None,
        fallback_model=fallback.model if fallback else None,
        fallback_provider_name=fallback.provider_name if fallback else None,
        fallback_generation=fallback.generation if fallback else None,
        fallback_model_role=fallback.model_role if fallback else "main",
        usage_type=usage_type,
        memory_store=memory_store,
        token_tracker=token_tracker,
        compactor=compactor,
        todo_store=todo_store,
        control_manager=control_manager,
        max_turns=max_turns,
        **kwargs,
    )
