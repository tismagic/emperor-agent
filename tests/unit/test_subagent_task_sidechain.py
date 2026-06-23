from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from agent.skills import SkillsLoader
from agent.subagents import SubagentRegistry
from agent.tasks import SidechainTranscript, TaskKind, TaskManager, TaskRecord, TaskStatus
from agent.tasks.store import TaskStore
from agent.tools import ToolRegistry
from agent.tools.dispatch import DispatchSubagentTool

REPO_ROOT = Path(__file__).resolve().parents[2]


class FakeRunner:
    def __init__(self, captured: dict[str, Any]):
        self.captured = captured

    def step(self, history: list[dict[str, Any]]) -> str:
        self.captured["history"] = history
        return "结论: done\n证据: fake\n风险: none\n建议下一步: none"


def _copy_templates(tmp_path: Path) -> Path:
    target = tmp_path / "templates"
    shutil.copytree(
        REPO_ROOT / "templates",
        target,
        ignore=shutil.ignore_patterns("USER.local.md"),
    )
    return target


def test_subagent_task_record_shape(tmp_path: Path) -> None:
    store = TaskStore(tmp_path)
    task_id = "subagent_1"
    record = {
        "id": task_id,
        "kind": TaskKind.SUBAGENT.value,
        "status": TaskStatus.RUNNING.value,
        "title": "read files",
        "source": "dispatch_subagent",
        "started_at": 1.0,
        "turn_id": "turn_1",
        "tool_call_id": "call_1",
        "transcript_path": "memory/tasks/subagent_1/transcript.jsonl",
    }

    store.upsert(TaskRecord.from_dict(record))

    loaded = store.get(task_id)
    assert loaded is not None
    assert loaded.kind == "subagent"
    assert loaded.transcript_path.endswith("transcript.jsonl")


def test_task_manager_records_sidechain_and_completion(tmp_path: Path) -> None:
    manager = TaskManager(tmp_path)
    record = manager.start_task(
        kind=TaskKind.SUBAGENT.value,
        title="read files",
        source="dispatch_subagent",
        tool_call_id="call_1",
    )

    manager.append_sidechain(record.id, {"role": "user", "content": "start"})
    updated = manager.complete_task(record.id, summary="done")

    assert updated is not None
    assert updated.status == TaskStatus.COMPLETED.value
    assert updated.progress["summary"] == "done"
    page = SidechainTranscript(tmp_path, record.id).read()
    assert page["messages"][0]["content"] == "start"
    assert updated.to_runtime_dict()["toolCallId"] == "call_1"


def test_dispatch_subagent_records_task_and_sidechain(tmp_path: Path) -> None:
    docs = _copy_templates(tmp_path)
    registry = SubagentRegistry(docs / "subagents", skills_loader=SkillsLoader(tmp_path / "skills"))
    captured: dict[str, Any] = {}
    manager = TaskManager(tmp_path)

    def runner_factory(**kwargs: Any) -> FakeRunner:
        captured["factory_task"] = kwargs.get("task")
        return FakeRunner(captured)

    tool = DispatchSubagentTool(
        client=None,
        model="",
        parent_registry=ToolRegistry(),
        subagent_registry=registry,
        runner_factory=runner_factory,
        task_manager=manager,
    )

    result = tool.execute(agent_type="sili_suitang", task="阅读核心流程", purpose="read files", parent_call_id="call_1")

    assert "结论: done" in result
    [record] = manager.store.list()
    assert record.kind == TaskKind.SUBAGENT.value
    assert record.status == TaskStatus.COMPLETED.value
    assert record.tool_call_id == "call_1"
    page = SidechainTranscript(tmp_path, record.id).read()
    assert [item["role"] for item in page["messages"]] == ["user", "assistant"]
    assert page["messages"][0]["content"] == captured["factory_task"]
    assert "结论: done" in page["messages"][1]["content"]
