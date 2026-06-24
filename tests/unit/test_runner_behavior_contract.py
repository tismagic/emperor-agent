from __future__ import annotations

from agent.context_pipeline.pairing import pair_tool_calls
from agent.context_pipeline.tool_results import cap_tool_results, shrink_old_tool_results


def test_pair_tool_calls_fills_missing_tool_result() -> None:
    history = [
        {"role": "user", "content": "run it"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "read_file", "arguments": "{}"},
                }
            ],
        },
    ]

    cleaned, _filled, _dropped = pair_tool_calls(history)

    assert cleaned[-1] == {
        "role": "tool",
        "tool_call_id": "call_1",
        "name": "read_file",
        "content": "(tool execution interrupted)",
    }


def test_pair_tool_calls_drops_orphan_tool_message() -> None:
    history = [
        {"role": "tool", "tool_call_id": "orphan", "name": "read_file", "content": "bad"},
        {"role": "user", "content": "hello"},
    ]

    cleaned, _filled, _dropped = pair_tool_calls(history)

    assert cleaned == [{"role": "user", "content": "hello"}]


def test_cap_tool_result_keeps_head_and_tail() -> None:
    text = "a" * 9000 + "tail"
    history = [{"role": "tool", "tool_call_id": "call_1", "name": "grep", "content": text}]

    capped, _ = cap_tool_results(history, per_call_limit=8000)

    content = capped[0]["content"]
    assert content.startswith("a" * 100)
    assert content.endswith("tail")
    assert "truncated, total 9004 chars" in content


def test_shrink_old_tool_results_keeps_recent_tool_messages() -> None:
    old_large = {"role": "tool", "tool_call_id": "old", "name": "grep", "content": "x" * 2000}
    recent_large = {"role": "tool", "tool_call_id": "recent", "name": "grep", "content": "y" * 2000}
    history = [old_large, {"role": "user", "content": "middle"}, recent_large]

    shrunk, _ = shrink_old_tool_results(history, keep_recent=2)

    assert shrunk[0]["content"] == "[shrunk] grep → 2000 chars omitted"
    assert shrunk[2]["content"] == "y" * 2000
