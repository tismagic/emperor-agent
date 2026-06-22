"""Per-session runtime event store and session-scoped broadcast."""
from __future__ import annotations

from pathlib import Path

from agent.runtime.store import RuntimeEventStore


def test_runtime_store_session_dir_isolation(tmp_path: Path) -> None:
    """Events appended to two session-scoped stores must not leak."""
    s1 = RuntimeEventStore(tmp_path / "sessions" / "aaa", session_dir_override=True)
    s2 = RuntimeEventStore(tmp_path / "sessions" / "bbb", session_dir_override=True)

    s1.append({"event": "user_message"}, turn_id="t1")
    s2.append({"event": "user_message"}, turn_id="t2")

    assert s1.latest_seq == 1
    assert s2.latest_seq == 1
    assert len(s1.recent(10)) == 1
    assert len(s2.recent(10)) == 1
    assert s1.recent(10)[0]["turn_id"] == "t1"
    assert s2.recent(10)[0]["turn_id"] == "t2"

    # s1's events file must be under its session, not global
    p1 = tmp_path / "sessions" / "aaa" / "runtime" / "events.jsonl"
    p2 = tmp_path / "sessions" / "bbb" / "runtime" / "events.jsonl"
    assert p1.exists()
    assert p2.exists()


def test_legacy_store_still_uses_memory_runtime(tmp_path: Path) -> None:
    """Without session_dir_override, behaviour is unchanged."""
    store = RuntimeEventStore(tmp_path)
    store.append({"event": "x"}, turn_id="t0")
    assert store.latest_seq == 1
    assert (tmp_path / "memory" / "runtime" / "events.jsonl").exists()
