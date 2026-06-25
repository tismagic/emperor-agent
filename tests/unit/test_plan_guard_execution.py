from __future__ import annotations

from pathlib import Path

from agent.control import ControlManager, ProposePlanTool


def _approve_executing_plan(tmp_path: Path) -> tuple[ControlManager, str]:
    """Create + approve a plan, returning the manager and the real resume message."""
    manager = ControlManager(tmp_path)
    manager.set_mode("plan")
    tool = ProposePlanTool(manager)
    tool.execute(
        title="Architecture refactor",
        summary="Restructure permission and security modules",
        plan_markdown="# Plan\n\n架构设计：改造权限与安全模块，多模块实现并补测试。",
        steps=[
            {
                "id": "step_1",
                "title": "Add failing tests",
                "description": "Concrete work for step 1.",
                "files": ["tests/unit/test_x.py"],
                "acceptance": ["Tests added."],
            }
        ],
        assumptions=[],
        risk_level="medium",
    )
    pending = manager.payload()["pending"]
    resume = manager.approve(pending["id"])
    return manager, resume.message


def test_executing_plan_continuation_does_not_retrigger_plan_guard(tmp_path: Path) -> None:
    manager, resume_message = _approve_executing_plan(tmp_path)

    # The approval resume carries the full plan body (架构/权限/安全 hard signals).
    decision = manager.assess_plan_decision(resume_message)

    assert decision.behavior == "proceed"
    assert "executing_plan" in decision.signals


def test_new_high_impact_request_still_triggers_plan_guard(tmp_path: Path) -> None:
    manager, _resume_message = _approve_executing_plan(tmp_path)

    # A fresh free-text request (no CONTROL prefix) must still be guarded,
    # even while a plan is executing — the exemption must not be over-broad.
    decision = manager.assess_plan_decision("请实现一个全新的架构改造，涉及权限与安全，多模块从头到尾")

    assert decision.behavior == "required"


def test_control_marker_without_executing_plan_is_not_exempted(tmp_path: Path) -> None:
    # Both gate conditions are required: a CONTROL marker alone (no executable plan)
    # must fall through to the normal policy.
    manager = ControlManager(tmp_path)

    decision = manager.assess_plan_decision("[CONTROL:PLAN_APPROVED]\n架构设计 权限 安全 多模块 实现")

    assert decision.behavior != "proceed" or "executing_plan" not in decision.signals
