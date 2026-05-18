from __future__ import annotations

import json
from pathlib import Path

from agent.runtime import RuntimeEventStore


def test_runtime_event_store_appends_and_recovers_seq(tmp_path: Path) -> None:
    store = RuntimeEventStore(tmp_path)

    first = store.append({"event": "user_message", "content": "hello"}, turn_id="turn_1")
    second = store.append({"event": "tool_call", "name": "read_file"}, turn_id="turn_1")

    assert first["seq"] == 1
    assert second["seq"] == 2
    assert second["turn_id"] == "turn_1"

    restored = RuntimeEventStore(tmp_path)
    assert restored.latest_seq == 2
    assert [item["event"] for item in restored.replay_after(1)] == ["tool_call"]


def test_runtime_event_store_filters_turns_and_skips_bad_lines(tmp_path: Path) -> None:
    store = RuntimeEventStore(tmp_path)
    store.append({"event": "user_message", "content": "a"}, turn_id="turn_a")
    store.append({"event": "assistant_done", "content": "a"}, turn_id="turn_a")
    store.append({"event": "user_message", "content": "b"}, turn_id="turn_b")
    with store.events_file.open("a", encoding="utf-8") as f:
        f.write("{bad json\n")
        f.write(json.dumps({"seq": 99, "event": "assistant_done", "turn_id": "turn_b"}) + "\n")

    events = store.events_for_turns(["turn_b"])

    assert [event["event"] for event in events] == ["user_message", "assistant_done"]
    assert all(event["turn_id"] == "turn_b" for event in events)
