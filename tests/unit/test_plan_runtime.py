from __future__ import annotations

from pathlib import Path

from agent.control import ControlManager, ProposePlanTool
from agent.plans.store import PlanStore


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
