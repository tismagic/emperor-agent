from __future__ import annotations

from pathlib import Path

import pytest

from agent.control import ControlManager, ProposePlanTool
from agent.plans.models import PlanStatus, PlanStepStatus
from agent.plans.store import PlanStore
from agent.providers.base import LLMProvider, LLMResponse, ToolCallRequest
from agent.runner import AgentRunner
from agent.tools import ToolRegistry, UpdateTodosTool
from agent.tools.todo import TodoStore


class FakeProvider(LLMProvider):
    def __init__(self, responses: list[LLMResponse]) -> None:
        super().__init__(default_model="fake")
        self.responses = responses

    async def chat(self, **kwargs) -> LLMResponse:
        if self.responses:
            return self.responses.pop(0)
        return LLMResponse(content="done")


def test_propose_plan_persists_structured_steps(tmp_path: Path) -> None:
    manager = ControlManager(tmp_path)
    manager.plan_store = PlanStore(tmp_path)
    manager.set_mode("plan")
    tool = ProposePlanTool(manager)

    result = tool.execute(
        title="Runner upgrade",
        summary="Extract context pipeline",
        plan_markdown="# Plan\n\n- Add context pipeline",
        steps=[
            {
                "id": "step_1",
                "title": "Add failing tests",
                "files": ["tests/unit/test_context_pipeline.py"],
                "commands": [".venv/bin/python -m pytest tests/unit/test_context_pipeline.py -q"],
                "acceptance": ["context pipeline tests pass"],
            }
        ],
        assumptions=["keep provider behavior unchanged"],
        risk_level="medium",
    )

    assert result.startswith("__CONTROL_PAUSE__:")
    pending = manager.payload()["pending"]
    plan_id = pending["meta"]["plan_id"]
    saved = manager.plan_store.get(plan_id)
    assert saved is not None
    assert saved.steps[0].id == "step_1"
    assert saved.steps[0].commands == [".venv/bin/python -m pytest tests/unit/test_context_pipeline.py -q"]


def test_plan_approval_marks_structured_plan_approved(tmp_path: Path) -> None:
    manager = ControlManager(tmp_path)
    manager.set_mode("plan")
    tool = ProposePlanTool(manager)

    tool.execute(
        title="Runner upgrade",
        summary="Extract context pipeline",
        plan_markdown="# Plan\n\n- Add context pipeline",
        steps=[{"id": "step_1", "title": "Add failing tests"}],
        assumptions=[],
        risk_level="low",
    )
    pending = manager.payload()["pending"]
    plan_id = pending["meta"]["plan_id"]

    manager.approve(pending["id"])

    saved = manager.plan_store.get(plan_id)
    assert saved is not None
    assert saved.status == "approved"
    assert saved.approved_at is not None


def test_plan_approval_activates_first_step_when_todo_store_is_attached(tmp_path: Path) -> None:
    manager = ControlManager(tmp_path)
    todo_store = TodoStore()
    manager.set_todo_store(todo_store)
    manager.set_mode("plan")
    tool = ProposePlanTool(manager)

    tool.execute(
        title="Runner upgrade",
        summary="Extract context pipeline",
        plan_markdown="# Plan\n\n- Add context pipeline\n- Run tests",
        steps=[
            {"id": "step_1", "title": "Add failing tests"},
            {"id": "step_2", "title": "Run focused tests"},
        ],
        assumptions=[],
        risk_level="low",
    )
    pending = manager.payload()["pending"]
    plan_id = pending["meta"]["plan_id"]

    resume = manager.approve(pending["id"])

    saved = manager.plan_store.get(plan_id)
    assert saved is not None
    assert saved.status == PlanStatus.EXECUTING.value
    assert saved.steps[0].status == PlanStepStatus.ACTIVE.value
    assert saved.steps[1].status == PlanStepStatus.PENDING.value
    assert todo_store.todos == [
        {"id": 1, "content": "Add failing tests", "status": "in_progress"},
        {"id": 2, "content": "Run focused tests", "status": "pending"},
    ]
    assert resume.event["plan"]["status"] == PlanStatus.EXECUTING.value
    assert resume.event["todos"][0]["status"] == "in_progress"


def test_control_manager_syncs_todos_back_to_plan_steps(tmp_path: Path) -> None:
    manager = ControlManager(tmp_path)
    todo_store = TodoStore()
    manager.set_todo_store(todo_store)
    manager.set_mode("plan")
    tool = ProposePlanTool(manager)
    tool.execute(
        title="Runner upgrade",
        summary="Extract context pipeline",
        plan_markdown="# Plan\n\n- Add failing tests\n- Run focused tests",
        steps=[
            {"id": "step_1", "title": "Add failing tests"},
            {"id": "step_2", "title": "Run focused tests"},
        ],
        assumptions=[],
        risk_level="low",
    )
    pending = manager.payload()["pending"]
    plan_id = pending["meta"]["plan_id"]
    manager.approve(pending["id"])

    updated = manager.sync_plan_from_todos(
        [
            {"id": 1, "content": "Add failing tests", "status": "completed"},
            {"id": 2, "content": "Run focused tests", "status": "in_progress"},
        ],
        evidence={"source": "update_todos", "summary": "todos updated"},
    )

    assert updated is not None
    assert updated.id == plan_id
    assert updated.status == PlanStatus.EXECUTING.value
    assert updated.steps[0].status == PlanStepStatus.DONE.value
    assert updated.steps[0].evidence[-1]["source"] == "update_todos"
    assert updated.steps[1].status == PlanStepStatus.ACTIVE.value


@pytest.mark.anyio
async def test_runner_update_todos_emits_plan_runtime_update(tmp_path: Path) -> None:
    manager = ControlManager(tmp_path)
    todo_store = TodoStore()
    manager.set_todo_store(todo_store)
    manager.set_mode("plan")
    tool = ProposePlanTool(manager)
    tool.execute(
        title="Runner upgrade",
        summary="Extract context pipeline",
        plan_markdown="# Plan\n\n- Add failing tests\n- Run focused tests",
        steps=[
            {"id": "step_1", "title": "Add failing tests"},
            {"id": "step_2", "title": "Run focused tests"},
        ],
        assumptions=[],
        risk_level="low",
    )
    pending = manager.payload()["pending"]
    plan_id = pending["meta"]["plan_id"]
    manager.approve(pending["id"])

    registry = ToolRegistry()
    registry.register(UpdateTodosTool(todo_store))
    runner = AgentRunner(
        provider=FakeProvider([
            LLMResponse(
                content="",
                tool_calls=[
                    ToolCallRequest(
                        id="call_1",
                        name="update_todos",
                        arguments={
                            "todos": [
                                {"id": 1, "content": "Add failing tests", "status": "completed"},
                                {"id": 2, "content": "Run focused tests", "status": "completed"},
                            ]
                        },
                    )
                ],
                finish_reason="tool_calls",
            ),
            LLMResponse(content="done"),
        ]),
        model="fake",
        registry=registry,
        system_prompt="system",
        todo_store=todo_store,
        control_manager=manager,
    )
    emitted: list[dict] = []

    async def emit(event: dict) -> None:
        emitted.append(event)

    await runner.step_async([{"role": "user", "content": "execute approved plan"}], emit=emit)

    saved = manager.plan_store.get(plan_id)
    assert saved is not None
    assert saved.status == PlanStatus.COMPLETED.value
    plan_events = [event for event in emitted if event.get("event") == "plan_runtime_update"]
    assert plan_events[-1]["plan"]["id"] == plan_id
    assert plan_events[-1]["plan"]["status"] == PlanStatus.COMPLETED.value
    assert plan_events[-1]["plan"]["steps"][0]["evidence"][-1]["tool_call_id"] == "call_1"
