from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class TransitionReason(StrEnum):
    ITERATION = "iteration"
    TOOL_FOLLOWUP = "tool_followup"
    EMPTY_RESPONSE_RETRY = "empty_response_retry"
    LENGTH_RECOVERY = "length_recovery"
    TODO_CONTINUATION = "todo_continuation"
    PLAN_PAUSE = "plan_pause"
    ASK_PAUSE = "ask_pause"
    MAX_TURNS = "max_turns"
    COMPLETED = "completed"


@dataclass(frozen=True)
class QueryState:
    turn_id: str | None = None
    turn_count: int = 0
    transition: str | None = None
    empty_retries: int = 0
    length_retries: int = 0
    max_turns: int | None = None
    paused: bool = False
    completed: bool = False


@dataclass(frozen=True)
class QueryTransition:
    reason: str
    next_state: QueryState
    messages: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    terminal_reply: str | None = None
