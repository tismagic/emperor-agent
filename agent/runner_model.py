from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from loguru import logger

from .providers import LLMProvider
from .runtime import events as runtime_events


StreamEmitter = Callable[[dict[str, Any]], Awaitable[None]]


class ModelCaller:
    """Call the selected model and perform one-shot fallback to the main model."""

    def __init__(self, runner) -> None:
        self.runner = runner

    async def ask(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        emit: StreamEmitter | None,
    ):
        async def on_delta(delta: str) -> None:
            if emit:
                await emit({"event": "message_delta", "delta": delta})

        runner = self.runner
        try:
            runner._last_model_call = {
                "model": runner.model,
                "provider": runner.provider_name,
                "model_role": runner.model_role,
                "route_reason": runner.route_reason,
                "used_fallback": False,
            }
            return await self._call_provider(
                provider=runner.provider,
                model=runner.model,
                max_tokens=runner.max_tokens,
                temperature=runner.temperature,
                reasoning_effort=runner.reasoning_effort,
                messages=messages,
                tools=tools,
                emit=emit,
                on_delta=on_delta,
            )
        except Exception as exc:
            if not (runner.fallback_provider and runner.fallback_model):
                raise
            logger.warning(
                "model route fallback: {} / {} -> {} because {}",
                runner.provider_name,
                runner.model,
                runner.fallback_model,
                exc,
            )
            if emit:
                await emit(runtime_events.model_route_fallback(
                    from_model=runner.model,
                    to_model=runner.fallback_model,
                    reason=str(exc),
                    usage_type=runner.usage_type,
                ))
            generation = runner.fallback_generation
            runner._last_model_call = {
                "model": runner.fallback_model,
                "provider": runner.fallback_provider_name,
                "model_role": runner.fallback_model_role,
                "route_reason": f"{runner.route_reason}:fallback",
                "used_fallback": True,
            }
            return await self._call_provider(
                provider=runner.fallback_provider,
                model=runner.fallback_model,
                max_tokens=min(runner.max_tokens, int(getattr(generation, "max_tokens", runner.max_tokens) or runner.max_tokens)),
                temperature=getattr(generation, "temperature", runner.temperature),
                reasoning_effort=getattr(generation, "reasoning_effort", runner.reasoning_effort),
                messages=messages,
                tools=tools,
                emit=emit,
                on_delta=on_delta,
            )

    @staticmethod
    async def _call_provider(
        *,
        provider: LLMProvider,
        model: str,
        max_tokens: int,
        temperature: float,
        reasoning_effort: str | None,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        emit: StreamEmitter | None,
        on_delta,
    ):
        if emit:
            return await provider.chat_stream(
                messages=messages,
                tools=tools,
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                reasoning_effort=reasoning_effort,
                on_content_delta=on_delta,
            )
        return await provider.chat(
            messages=messages,
            tools=tools,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            reasoning_effort=reasoning_effort,
        )
