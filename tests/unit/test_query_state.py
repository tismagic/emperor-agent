from __future__ import annotations

from agent.query_state.models import QueryState, TransitionReason
from agent.query_state.transitions import (
    begin_iteration,
    empty_response_retry,
    length_recovery,
    max_turns_reached,
    todo_followup,
    tool_followup,
)


def test_query_state_tracks_iteration_and_max_turns() -> None:
    state = QueryState(turn_id="turn_1", max_turns=1)

    first = begin_iteration(state)
    blocked = max_turns_reached(first.next_state)

    assert first.reason == TransitionReason.ITERATION.value
    assert first.next_state.turn_count == 1
    assert blocked is not None
    assert blocked.reason == TransitionReason.MAX_TURNS.value
    assert blocked.terminal_reply == "（达到 max_turns=1 上限，未办妥；history 中已有部分进展）"


def test_query_state_empty_response_retry_has_message_and_event() -> None:
    state = QueryState()

    transition = empty_response_retry(state, max_retries=2)

    assert transition is not None
    assert transition.reason == TransitionReason.EMPTY_RESPONSE_RETRY.value
    assert transition.next_state.empty_retries == 1
    assert transition.messages == [{"role": "user", "content": "（上一轮无任何输出，请继续推进或给出最终答复）"}]
    assert transition.events == [
        {
            "event": "tool_error",
            "name": "_empty_response",
            "message": "empty response, retry 1/2",
        }
    ]


def test_query_state_length_recovery_preserves_partial_reply_with_turn_id() -> None:
    state = QueryState(turn_id="turn_1")

    transition = length_recovery(state, "partial", max_retries=3)

    assert transition is not None
    assert transition.reason == TransitionReason.LENGTH_RECOVERY.value
    assert transition.next_state.length_retries == 1
    assert transition.messages == [
        {"role": "assistant", "content": "partial", "turn_id": "turn_1"},
        {"role": "user", "content": "（上一轮被 max_tokens 截断，请从中断处续写，不要重复已输出内容）"},
    ]
    assert transition.events[0]["message"] == "truncated, continuing 1/3"


def test_query_state_tool_followup_resets_retry_counters() -> None:
    state = QueryState(empty_retries=1, length_retries=1)

    transition = tool_followup(state)

    assert transition.reason == TransitionReason.TOOL_FOLLOWUP.value
    assert transition.next_state.empty_retries == 0
    assert transition.next_state.length_retries == 0


def test_query_state_todo_followup_builds_continuation_prompt() -> None:
    transition = todo_followup(QueryState(), unfinished_text="  [ ] 1. Run tests", unfinished_count=1)

    assert transition.reason == TransitionReason.TODO_CONTINUATION.value
    assert transition.next_state.transition == TransitionReason.TODO_CONTINUATION.value
    assert transition.messages == [
        {
            "role": "user",
            "content": "差事尚未办妥，以下任务仍未完成，请按计划继续执行，并按规矩更新 todolist 状态：\n  [ ] 1. Run tests",
        }
    ]
    assert transition.events == []
