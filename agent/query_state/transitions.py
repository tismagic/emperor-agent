from __future__ import annotations

from dataclasses import replace

from .models import QueryState, QueryTransition, TransitionReason


def begin_iteration(state: QueryState) -> QueryTransition:
    next_state = replace(
        state,
        turn_count=state.turn_count + 1,
        transition=TransitionReason.ITERATION.value,
    )
    return QueryTransition(reason=TransitionReason.ITERATION.value, next_state=next_state)


def max_turns_reached(state: QueryState) -> QueryTransition | None:
    if state.max_turns is None or state.turn_count < state.max_turns:
        return None
    reply = f"（达到 max_turns={state.max_turns} 上限，未办妥；history 中已有部分进展）"
    next_state = replace(state, transition=TransitionReason.MAX_TURNS.value, completed=True)
    return QueryTransition(
        reason=TransitionReason.MAX_TURNS.value,
        next_state=next_state,
        terminal_reply=reply,
    )


def tool_followup(state: QueryState) -> QueryTransition:
    next_state = replace(
        state,
        transition=TransitionReason.TOOL_FOLLOWUP.value,
        empty_retries=0,
        length_retries=0,
    )
    return QueryTransition(reason=TransitionReason.TOOL_FOLLOWUP.value, next_state=next_state)


def empty_response_retry(state: QueryState, *, max_retries: int) -> QueryTransition | None:
    if state.empty_retries >= max_retries:
        return None
    attempt = state.empty_retries + 1
    next_state = replace(
        state,
        transition=TransitionReason.EMPTY_RESPONSE_RETRY.value,
        empty_retries=attempt,
    )
    return QueryTransition(
        reason=TransitionReason.EMPTY_RESPONSE_RETRY.value,
        next_state=next_state,
        messages=[{"role": "user", "content": "（上一轮无任何输出，请继续推进或给出最终答复）"}],
        events=[{
            "event": "tool_error",
            "name": "_empty_response",
            "message": f"empty response, retry {attempt}/{max_retries}",
        }],
    )


def length_recovery(state: QueryState, reply: str, *, max_retries: int) -> QueryTransition | None:
    if state.length_retries >= max_retries:
        return None
    attempt = state.length_retries + 1
    next_state = replace(
        state,
        transition=TransitionReason.LENGTH_RECOVERY.value,
        length_retries=attempt,
    )
    messages: list[dict[str, str]] = []
    if reply:
        assistant_message = {"role": "assistant", "content": reply}
        if state.turn_id:
            assistant_message["turn_id"] = state.turn_id
        messages.append(assistant_message)
    messages.append({"role": "user", "content": "（上一轮被 max_tokens 截断，请从中断处续写，不要重复已输出内容）"})
    return QueryTransition(
        reason=TransitionReason.LENGTH_RECOVERY.value,
        next_state=next_state,
        messages=messages,
        events=[{
            "event": "tool_error",
            "name": "_length_truncation",
            "message": f"truncated, continuing {attempt}/{max_retries}",
        }],
    )


def todo_followup(
    state: QueryState,
    *,
    unfinished_text: str,
    unfinished_count: int,
) -> QueryTransition:
    content = (
        "差事尚未办妥，以下任务仍未完成，请按计划继续执行，"
        "并按规矩更新 todolist 状态：\n" + unfinished_text
    )
    next_state = replace(state, transition=TransitionReason.TODO_CONTINUATION.value)
    return QueryTransition(
        reason=TransitionReason.TODO_CONTINUATION.value,
        next_state=next_state,
        messages=[{"role": "user", "content": content}],
        events=[],
    )


def mark_paused(state: QueryState, reason: TransitionReason) -> QueryTransition:
    next_state = replace(state, transition=reason.value, paused=True)
    return QueryTransition(reason=reason.value, next_state=next_state)


def mark_completed(state: QueryState) -> QueryTransition:
    next_state = replace(state, transition=TransitionReason.COMPLETED.value, completed=True)
    return QueryTransition(reason=TransitionReason.COMPLETED.value, next_state=next_state)
