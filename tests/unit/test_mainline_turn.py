from __future__ import annotations

import asyncio
from typing import Any

from agent.runtime.active import ActiveTaskRegistry
from agent.web.services.mainline_turn import MainlineTurnService


class FakeMemory:
    def __init__(self) -> None:
        self.rows: list[tuple[str, Any, dict[str, Any] | None]] = []
        self.checkpoints: list[list[dict[str, Any]]] = []

    def append_history(self, role: str, content: Any, extra: dict[str, Any] | None = None) -> None:
        self.rows.append((role, content, extra))

    def write_checkpoint(self, history: list[dict[str, Any]]) -> None:
        self.checkpoints.append(list(history))

    def clear_checkpoint(self) -> None:
        self.checkpoints.clear()


class FakeRunner:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def step_stream(self, history, emit, *, turn_id: str | None = None):
        self.calls.append({"history": list(history), "turn_id": turn_id})
        await emit({"event": "message_delta", "delta": "ok"})
        await emit({"event": "assistant_done", "content": "ok"})
        return "ok"


class FakeLoop:
    def __init__(self) -> None:
        self.memory = FakeMemory()
        self.runner = FakeRunner()


class FakeState:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.history: list[dict[str, Any]] = []
        self.loop = FakeLoop()
        self.events: list[dict[str, Any]] = []
        self.active_turn = False
        self.active_tasks = ActiveTaskRegistry()
        self.compact_calls = 0
        self._turn = 0

    def new_turn_id(self) -> str:
        self._turn += 1
        return f"turn_{self._turn}"

    async def _broadcast_event(self, event: dict[str, Any], *, turn_id: str | None = None) -> None:
        payload = dict(event)
        if turn_id:
            payload["turn_id"] = turn_id
        self.events.append(payload)

    def compact_runtime_events(self) -> dict[str, Any]:
        self.compact_calls += 1
        return {}


def test_mainline_turn_service_submits_single_mainline_turn() -> None:
    state = FakeState()
    service = MainlineTurnService(state)  # type: ignore[arg-type]

    turn_id = asyncio.run(
        service.submit(
            content="hello",
            display_content="hello",
            client_message_id="client_1",
            memory_extra={"displayContent": "hello"},
            label="Test turn",
        )
    )

    assert turn_id == "turn_1"
    assert state.history == [{"role": "user", "content": "hello", "turn_id": "turn_1"}]
    assert state.loop.memory.rows == [
        ("user", "hello", {"displayContent": "hello", "turn_id": "turn_1"})
    ]
    assert state.loop.runner.calls[0]["history"][0]["content"] == "hello"
    assert state.events[0]["event"] == "user_message"
    assert state.events[0]["client_message_id"] == "client_1"
    assert any(event["event"] == "assistant_done" for event in state.events)
    assert state.active_turn is False
    assert state.compact_calls == 1


def test_mainline_turn_service_preserves_attachment_ids_and_refs() -> None:
    state = FakeState()
    service = MainlineTurnService(state)  # type: ignore[arg-type]

    asyncio.run(
        service.submit(
            content="see file",
            display_content="see file",
            attachments=[{"id": "att_1", "name": "a.txt"}],
            attachment_ids=["att_1"],
        )
    )

    assert state.history[0]["attachments"] == ["att_1"]
    assert state.loop.memory.rows[0][2]["attachments"] == ["att_1"]
    assert state.events[0]["attachments"] == [{"id": "att_1", "name": "a.txt"}]


class SessionAwareFakeState(FakeState):
    def __init__(self) -> None:
        super().__init__()
        self.histories: dict[str, list[dict[str, Any]]] = {}
        self.memories: dict[str, FakeMemory] = {}
        self.prepared: list[dict[str, Any]] = []
        self.title_jobs: list[tuple[str, str]] = []

    async def prepare_session_for_turn(
        self,
        *,
        session_id: str | None,
        draft_session: dict[str, Any] | None,
        preview: str,
    ) -> dict[str, Any]:
        resolved = session_id or "created_session"
        created = session_id is None
        entry = {
            "id": resolved,
            "title": "新会话" if created else "Existing",
            "preview": preview[:280],
            "title_status": "pending" if created else "manual",
        }
        self.history = self.histories.setdefault(resolved, [])
        self.loop.memory = self.memories.setdefault(resolved, FakeMemory())
        self.prepared.append({
            "session_id": session_id,
            "draft_session": draft_session,
            "preview": preview,
            "entry": entry,
            "created": created,
        })
        return {
            "session": entry,
            "created": created,
            "client_draft_id": (draft_session or {}).get("client_draft_id"),
        }

    def schedule_session_title(self, session_id: str, first_message: str) -> None:
        self.title_jobs.append((session_id, first_message))


def test_mainline_turn_service_routes_turns_to_requested_session() -> None:
    state = SessionAwareFakeState()
    service = MainlineTurnService(state)  # type: ignore[arg-type]

    asyncio.run(
        service.submit(
            content="alpha question",
            display_content="alpha question",
            session_id="session_alpha",
        )
    )
    asyncio.run(
        service.submit(
            content="beta question",
            display_content="beta question",
            session_id="session_beta",
        )
    )

    assert state.histories["session_alpha"][0]["content"] == "alpha question"
    assert state.histories["session_beta"][0]["content"] == "beta question"
    assert state.memories["session_alpha"].rows[0][1] == "alpha question"
    assert state.memories["session_beta"].rows[0][1] == "beta question"
    assert state.loop.runner.calls[0]["history"][0]["content"] == "alpha question"
    assert state.loop.runner.calls[1]["history"][0]["content"] == "beta question"


def test_mainline_turn_service_commits_draft_session_and_schedules_title() -> None:
    state = SessionAwareFakeState()
    service = MainlineTurnService(state)  # type: ignore[arg-type]

    asyncio.run(
        service.submit(
            content="帮我优化 Codex 风格界面",
            display_content="帮我优化 Codex 风格界面",
            draft_session={"client_draft_id": "draft-1", "title": "新会话"},
        )
    )

    assert state.prepared[0]["created"] is True
    assert state.events[0]["event"] == "session_created"
    assert state.events[0]["client_draft_id"] == "draft-1"
    assert state.events[0]["session"]["id"] == "created_session"
    assert state.title_jobs == [("created_session", "帮我优化 Codex 风格界面")]
