from __future__ import annotations

from pathlib import Path

from agent.control import ControlManager, ProposePlanTool
from agent.plans.models import PlanStatus, PlanStepStatus
from agent.plans.store import PlanStore
from agent.tools.todo import TodoStore


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
