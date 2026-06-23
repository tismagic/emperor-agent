from __future__ import annotations

import asyncio

from agent.providers.base import LLMProvider, LLMResponse
from agent.sessions.title import SessionTitleService, fallback_session_title, sanitize_session_title


class FakeProvider(LLMProvider):
    def __init__(self, response: str, *, fail: bool = False) -> None:
        super().__init__(default_model="fake-title-model")
        self.response = response
        self.fail = fail
        self.calls: list[dict] = []

    async def chat(
        self,
        *,
        messages,
        tools=None,
        model=None,
        max_tokens=4096,
        temperature=0.7,
        reasoning_effort=None,
    ) -> LLMResponse:
        self.calls.append({
            "messages": messages,
            "tools": tools,
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
        })
        if self.fail:
            raise RuntimeError("primary failed")
        return LLMResponse(content=self.response, usage={"input": 3, "output": 2})


class FakeRoute:
    def __init__(self, provider: FakeProvider, fallback: FakeProvider | None = None) -> None:
        self.snapshot = type(
            "Snapshot",
            (),
            {
                "provider": provider,
                "model": "secondary-title",
                "provider_name": "fake",
                "model_role": "secondary",
                "generation": type("Generation", (), {"max_tokens": 1024, "temperature": 0.6, "reasoning_effort": None})(),
            },
        )()
        self.fallback = None
        if fallback is not None:
            self.fallback = type(
                "Snapshot",
                (),
                {
                    "provider": fallback,
                    "model": "main-title",
                    "provider_name": "fake",
                    "model_role": "main",
                    "generation": type("Generation", (), {"max_tokens": 1024, "temperature": 0.2, "reasoning_effort": None})(),
                },
            )()


class FakeRouter:
    def __init__(self, provider: FakeProvider, fallback: FakeProvider | None = None) -> None:
        self.route_obj = FakeRoute(provider, fallback)
        self.use_cases: list[str] = []

    def route(self, use_case: str, *, task: str | None = None):
        self.use_cases.append(use_case)
        return self.route_obj


def test_sanitize_session_title_strips_boilerplate_and_punctuation() -> None:
    assert sanitize_session_title("《关于 帮我优化 Codex UI！》") == "Codex UI"
    assert sanitize_session_title("如何实现真实会话路由？") == "真实会话路由"
    assert sanitize_session_title("\"配置 MCP 工具\"") == "配置 MCP 工具"


def test_fallback_session_title_uses_clean_first_message() -> None:
    assert fallback_session_title("请帮我实现真实懒创建会话，需要同步标题") == "真实懒创建会话"
    assert fallback_session_title("   !!!   ") == "新会话"


def test_session_title_service_uses_secondary_route_and_sanitizes_output() -> None:
    provider = FakeProvider("「关于 优化 Codex UI？」")
    router = FakeRouter(provider)
    service = SessionTitleService(router)  # type: ignore[arg-type]

    title = asyncio.run(service.generate("帮我优化 Codex UI 的整体布局"))

    assert title == "Codex UI"
    assert router.use_cases == ["session_title"]
    assert provider.calls[0]["tools"] is None
    assert provider.calls[0]["max_tokens"] <= 64
    assert provider.calls[0]["temperature"] == 0.1


def test_session_title_service_falls_back_to_main_model() -> None:
    secondary = FakeProvider("", fail=True)
    main = FakeProvider("真实会话路由")
    router = FakeRouter(secondary, main)
    service = SessionTitleService(router)  # type: ignore[arg-type]

    title = asyncio.run(service.generate("修复多会话切换"))

    assert title == "真实会话路由"
    assert len(secondary.calls) == 1
    assert len(main.calls) == 1
