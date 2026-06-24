from __future__ import annotations

from agent.tasks.models import TaskKind, TaskRecord, TaskStatus
from agent.tasks.store import TaskStore


def test_task_store_round_trips_records(tmp_path) -> None:
    store = TaskStore(tmp_path)
    record = TaskRecord(
        id="task_1",
        kind=TaskKind.SUBAGENT.value,
        status=TaskStatus.RUNNING.value,
        title="inspect files",
        source="dispatch_subagent",
        turn_id="turn_1",
        started_at=123.0,
    )

    store.upsert(record)

    assert store.get("task_1") == record
    assert store.list()[0].id == "task_1"


def test_task_store_marks_corrupt_index(tmp_path) -> None:
    store = TaskStore(tmp_path)
    store.index_file.write_text("{bad json", encoding="utf-8")

    records = store.list()

    assert records == []
    assert list(store.tasks_dir.glob("index.json.corrupt-*"))


def _rec(i: int, status: str = TaskStatus.COMPLETED.value) -> TaskRecord:
    return TaskRecord(
        id=f"t{i}",
        kind=TaskKind.SUBAGENT.value,
        status=status,
        title="x",
        source="test",
        started_at=float(i),
    )


def test_terminal_tasks_archived_over_cap(tmp_path) -> None:
    store = TaskStore(tmp_path, max_terminal=10)
    for i in range(25):
        store.upsert(_rec(i))

    hot_completed = [t for t in store.list() if t.status == TaskStatus.COMPLETED.value]
    assert len(hot_completed) <= 10
    # archived records remain retrievable via get()
    assert store.get("t0") is not None
    assert store.get("t0").status == TaskStatus.COMPLETED.value


def test_non_terminal_tasks_never_archived(tmp_path) -> None:
    store = TaskStore(tmp_path, max_terminal=5)
    store.upsert(_rec(100, status=TaskStatus.QUEUED.value))
    store.upsert(_rec(101, status=TaskStatus.PENDING.value))
    store.upsert(_rec(102, status=TaskStatus.RUNNING.value))
    for i in range(20):  # flood terminal records past the cap
        store.upsert(_rec(i))

    assert store.get("t100").status == TaskStatus.QUEUED.value
    assert store.get("t101").status == TaskStatus.PENDING.value
    assert store.get("t102").status == TaskStatus.RUNNING.value
    hot_ids = {t.id for t in store.list()}
    assert {"t100", "t101", "t102"} <= hot_ids


def test_archive_merge_dedupe_loses_nothing(tmp_path) -> None:
    store = TaskStore(tmp_path, max_terminal=2)
    for i in range(6):  # forces multiple archive flushes into the same monthly file
        store.upsert(_rec(i))

    for i in range(6):
        assert store.get(f"t{i}") is not None, f"t{i} lost"
