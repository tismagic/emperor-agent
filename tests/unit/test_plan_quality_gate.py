from __future__ import annotations

from pathlib import Path

from agent.control import ControlManager, ProposePlanTool
from agent.control.tools import parse_pause_result
from agent.plans.models import PlanStatus


def test_propose_plan_rejects_weak_plan_without_pending_card(tmp_path: Path) -> None:
    manager = ControlManager(tmp_path)
    manager.set_mode("plan")
    tool = ProposePlanTool(manager)

    result = tool.execute(
        title="Improve code",
        summary="Make things better",
        plan_markdown="# Plan\n\n- Fix issue",
        steps=[
            {
                "id": "step_1",
                "title": "fix issue",
                "risk": "medium",
            },
            {
                "id": "step_2",
                "title": "improve code",
                "description": "Change implementation",
                "risk": "medium",
            },
        ],
        assumptions=[],
        risk_level="medium",
    )

    assert result.startswith("Error: plan quality gate failed")
    assert "step_1 has no target files, discovery reference, or concrete scope" in result
    assert "step_1 title is too generic" in result
    assert "step_2 has no verification command or manual verification rule" in result
    assert manager.payload()["pending"] is None
    assert all(plan.status != PlanStatus.WAITING_APPROVAL.value for plan in manager.plan_store.list())


def test_propose_plan_rejects_high_risk_step_without_risk_and_rollback_notes(tmp_path: Path) -> None:
    manager = ControlManager(tmp_path)
    manager.set_mode("plan")
    tool = ProposePlanTool(manager)

    result = tool.execute(
        title="Auth migration",
        summary="Migrate authentication storage",
        plan_markdown="# Plan\n\n- Migrate auth storage",
        steps=[
            {
                "id": "step_1",
                "title": "Migrate auth token storage",
                "description": "Move auth tokens to the new encrypted storage path.",
                "files": ["agent/auth/storage.py"],
                "commands": [".venv/bin/python -m pytest tests/unit/test_auth_storage.py -q"],
                "acceptance": ["existing sessions can still be read"],
                "risk": "high",
            }
        ],
        assumptions=[],
        risk_level="high",
    )

    assert result.startswith("Error: plan quality gate failed")
    assert "step_1 is high risk but has no risk note" in result
    assert "step_1 is high risk but has no rollback path" in result
    assert manager.payload()["pending"] is None


def test_propose_plan_accepts_concrete_verifiable_plan(tmp_path: Path) -> None:
    manager = ControlManager(tmp_path)
    manager.set_mode("plan")
    tool = ProposePlanTool(manager)

    result = tool.execute(
        title="Plan quality gate",
        summary="Reject weak plans before approval",
        plan_markdown="# Plan\n\n- Add gate tests\n- Implement gate\n\n## 验证\n- Run focused pytest",
        steps=[
            {
                "id": "step_1",
                "title": "Add plan quality gate tests",
                "description": "Cover weak plans and accepted concrete plans.",
                "files": ["tests/unit/test_plan_quality_gate.py"],
                "commands": [".venv/bin/python -m pytest tests/unit/test_plan_quality_gate.py -q"],
                "acceptance": ["weak plans return a repairable tool error"],
                "risk": "low",
            },
            {
                "id": "step_2",
                "title": "Enforce plan quality before PlanCard creation",
                "description": "Wire the gate through ProposePlanTool without changing approved execution state.",
                "files": ["agent/control/tools.py", "agent/plans/quality.py"],
                "commands": [".venv/bin/python -m pytest tests/unit/test_plan_runtime.py -q"],
                "acceptance": ["accepted plans still create a pending PlanCard"],
                "risk": "high",
                "risk_note": "The gate can over-block model-generated plans if rules are too strict.",
                "rollback": "Disable enforce_quality on ProposePlanTool while keeping low-level create_plan available.",
            },
        ],
        assumptions=["internal create_plan helper remains available for tests"],
        risk_level="high",
    )

    interaction = parse_pause_result(result)

    assert interaction is not None
    assert manager.payload()["pending"]["id"] == interaction["id"]
    saved = manager.plan_store.get(interaction["meta"]["plan_id"])
    assert saved is not None
    assert saved.status == PlanStatus.WAITING_APPROVAL.value
    assert saved.steps[1].risk_note.startswith("The gate can over-block")
    assert saved.steps[1].rollback.startswith("Disable enforce_quality")
