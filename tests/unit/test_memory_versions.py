from __future__ import annotations

from pathlib import Path

from agent.memory import MemoryStore
from agent.memory_versions import MemoryVersionStore


def make_store(tmp_path: Path) -> MemoryVersionStore:
    memory_dir = tmp_path / "memory"
    user_file = tmp_path / "templates" / "USER.local.md"
    memory_dir.mkdir(parents=True)
    user_file.parent.mkdir(parents=True)
    return MemoryVersionStore(tmp_path, memory_dir, user_file)


def test_memory_version_store_snapshots_and_restores(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    target = tmp_path / "memory" / "MEMORY.local.md"
    target.write_text("old\n", encoding="utf-8")

    version = store.snapshot_path(target, target="memory", reason="test")
    target.write_text("new\n", encoding="utf-8")
    detail = store.detail(version.id)
    restored = store.restore(version.id)

    assert detail["version"]["id"] == version.id
    assert "-old" in detail["diff"]
    assert "+new" in detail["diff"]
    assert restored["content"] == "old\n"
    assert target.read_text(encoding="utf-8") == "old\n"
    assert store.list()[0].reason.startswith("pre_restore:")


def test_memory_version_store_skips_duplicate_latest_snapshot(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    target = tmp_path / "memory" / "MEMORY.local.md"
    target.write_text("same\n", encoding="utf-8")

    first = store.snapshot_path(target, target="memory", reason="one")
    second = store.snapshot_path(target, target="memory", reason="two")

    assert first.id == second.id
    assert len(store.list()) == 1


def test_memory_store_writes_create_versions(tmp_path: Path) -> None:
    memory_dir = tmp_path / "memory"
    user_file = tmp_path / "templates" / "USER.local.md"
    user_file.parent.mkdir(parents=True)
    user_file.write_text("user old\n", encoding="utf-8")
    store = MemoryStore(memory_dir, user_file)

    store.write_memory("memory new")
    store.write_user("user new")
    store.append_episode("first")
    store.append_episode("second")

    versions = store.versions.list(limit=10)
    assert {item.target for item in versions} >= {"memory", "user", "episode"}
