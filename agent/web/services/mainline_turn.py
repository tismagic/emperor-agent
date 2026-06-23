from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from loguru import logger

from ...control import TurnPaused
from ...runtime import events as runtime_events

if TYPE_CHECKING:
    from ..state import WebUIState


class MainlineTurnService:
    """Submit user-originated input into the single Emperor Agent mainline."""

    def __init__(self, state: WebUIState):
        self.state = state

    async def submit(
        self,
        *,
        content: Any,
        display_content: str,
        attachments: list[dict[str, Any]] | None = None,
        attachment_ids: list[str] | None = None,
        client_message_id: str = "",
        memory_extra: dict[str, Any] | None = None,
        turn_id: str | None = None,
        label: str = "Chat turn",
        session_id: str | None = None,
        draft_session: dict[str, Any] | None = None,
    ) -> str:
        """Append a turn to the selected session history and run the agent."""

        resolved_turn_id = turn_id or self.state.new_turn_id()
        session_info: dict[str, Any] | None = None
        if hasattr(self.state, "prepare_session_for_turn"):
            session_info = await self.state.prepare_session_for_turn(
                session_id=session_id,
                draft_session=draft_session,
                preview=display_content,
            )
            session_entry = session_info.get("session") if isinstance(session_info, dict) else None
            if session_info.get("created") and isinstance(session_entry, dict):
                await self.state._broadcast_event(
                    runtime_events.session_created(
                        session_entry,
                        client_draft_id=str(session_info.get("client_draft_id") or "") or None,
                    )
                )

        user_msg: dict[str, Any] = {
            "role": "user",
            "content": content,
            "turn_id": resolved_turn_id,
        }
        if attachment_ids:
            user_msg["attachments"] = list(attachment_ids)

        async with self.state.lock:
            self.state.history.append(user_msg)
            extra = dict(memory_extra or {})
            extra["turn_id"] = resolved_turn_id
            if attachment_ids:
                extra["attachments"] = list(attachment_ids)
            memory_store = getattr(self.state.loop, "active_memory_store", self.state.loop.memory)
            memory_store.append_history("user", content, extra=extra)

            await self.state._broadcast_event(
                runtime_events.user_message(
                    content=display_content,
                    attachments=attachments or [],
                    client_message_id=client_message_id,
                ),
                turn_id=resolved_turn_id,
            )
            self.state.active_turn = True
            if session_info and session_info.get("created") and hasattr(self.state, "schedule_session_title"):
                session_entry = session_info.get("session") if isinstance(session_info, dict) else None
                if isinstance(session_entry, dict) and session_entry.get("id"):
                    self.state.schedule_session_title(str(session_entry["id"]), display_content)

            async def emit(event: dict[str, Any]) -> None:
                await self.state._broadcast_event(event, turn_id=resolved_turn_id)

            try:
                await self.state.active_tasks.run(
                    task_id=f"turn:{resolved_turn_id}",
                    kind="turn",
                    label=label,
                    awaitable=self.state.loop.runner.step_stream(
                        self.state.history,
                        emit,
                        turn_id=resolved_turn_id,
                    ),
                    turn_id=resolved_turn_id,
                )
            except TurnPaused:
                pass
            except asyncio.CancelledError:
                logger.info("{} {} cancelled", label, resolved_turn_id)
            finally:
                self.state.active_turn = False
                self.state.compact_runtime_events()

        return resolved_turn_id
