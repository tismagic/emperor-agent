from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from agent.control import ControlManager, ProposePlanTool
from agent.plans.models import PlanStatus
from agent.providers.base import LLMProvider, LLMResponse
from agent.runner import AgentRunner
from agent.subagents import SubagentRegistry
from agent.tools import ToolRegistry
from agent.tools.todo import TodoStore


class FakeProvider(LLMProvider):
    def __init__(self, responses: list[LLMResponse]) -> None:
        super().__init__(default_model="fake")
        self.responses = responses
        self.seen_messages: list[list[dict[str, Any]]] = []

    async def chat(self, **kwargs: Any) -> LLMResponse:
        self.seen_messages.append(kwargs.get("messages") or [])
        if self.responses:
            return self.responses.pop(0)
        return LLMResponse(content="done")


def make_completed_plan(
    tmp_path: Path,
    *,
    files: list[str] | None = None,
    risk_note: str = "",
) -> tuple[ControlManager, str]:
    manager = ControlManager(tmp_path)
    todo_store = TodoStore()
    manager.set_todo_store(todo_store)
    manager.set_mode("plan")
    tool = ProposePlanTool(manager)
    changed_files = files or [
        "agent/runner.py",
        "agent/control/manager.py",
        "tests/unit/test_plan_independent_verification.py",
    ]
    tool.execute(
        title="Independent verification gate",
        summary="Require adversarial review before final answer.",
        plan_markdown="# Plan\n\n- Implement gate\n- Run tests",
        steps=[
            {
                "id": "step_1",
                "title": "Implement gate",
                "description": "Add independent verification gate for non-trivial plans.",
                "files": changed_files,
                "commands": [],
                "acceptance": ["final answer waits for independent verification"],
                "risk": "medium",
                "risk_note": risk_note,
            }
        ],
        assumptions=[],
        risk_level="medium",
    )
    pending = manager.payload()["pending"]
    plan_id = pending["meta"]["plan_id"]
    manager.approve(pending["id"])
    updated = manager.sync_plan_from_todos([
        {
            "id": 1,
            "plan_step_id": "step_1",
            "content": "Implement gate",
            "status": "completed",
        }
    ], evidence={"source": "test", "summary": "step done"})
    assert updated is not None
    assert updated.status == PlanStatus.COMPLETED.value
    return manager, plan_id


def test_non_trivial_completed_plan_requires_independent_verification(tmp_path: Path) -> None:
    manager, plan_id = make_completed_plan(tmp_path)

    followup = manager.plan_independent_verification_followup(dispatch_available=True)

    assert followup is not None
    assert followup["plan_id"] == plan_id
    assert followup["request"]["changed_files"] == [
        "agent/runner.py",
        "agent/control/manager.py",
        "tests/unit/test_plan_independent_verification.py",
    ]
    assert "changed_files>=3" in followup["request"]["risk_signals"]
    assert "[PLAN_INDEPENDENT_VERIFICATION_REQUIRED]" in followup["message"]
    assert "dispatch_subagent" in followup["message"]
    assert "verification_reviewer" in followup["message"]


def test_sensitive_completed_plan_requires_verification_even_with_one_file(tmp_path: Path) -> None:
    manager, plan_id = make_completed_plan(tmp_path, files=["agent/permissions/policy.py"])

    followup = manager.plan_independent_verification_followup(dispatch_available=True)

    assert followup is not None
    assert followup["plan_id"] == plan_id
    assert "permission" in followup["request"]["risk_signals"]


def test_independent_verification_failure_blocks_final_answer(tmp_path: Path) -> None:
    manager, plan_id = make_completed_plan(tmp_path)
    manager.record_independent_verification_result(
        plan_id=plan_id,
        result={
            "source": "independent_verification",
            "reviewer": "verification_reviewer",
            "passed": False,
            "summary": "Regression test for runtime cancellation was not run.",
            "commands": [".venv/bin/python -m pytest tests/unit/test_runner_state.py -q"],
        },
    )

    followup = manager.plan_independent_verification_followup(dispatch_available=True)

    assert followup is not None
    assert followup["status"] == "failed"
    assert "[PLAN_INDEPENDENT_VERIFICATION_FAILED]" in followup["message"]
    assert "Regression test for runtime cancellation was not run." in followup["message"]
    assert "修复" in followup["message"]


def test_passing_independent_verification_with_command_evidence_allows_final_answer(tmp_path: Path) -> None:
    manager, plan_id = make_completed_plan(tmp_path)
    manager.record_independent_verification_result(
        plan_id=plan_id,
        result={
            "source": "independent_verification",
            "reviewer": "verification_reviewer",
            "passed": True,
            "summary": "Reviewed plan evidence and reran focused tests.",
            "commands": [".venv/bin/python -m pytest tests/unit/test_plan_independent_verification.py -q"],
        },
    )

    assert manager.plan_independent_verification_followup(dispatch_available=True) is None


def test_user_waiver_allows_final_answer_and_is_stored_as_plan_evidence(tmp_path: Path) -> None:
    manager, plan_id = make_completed_plan(tmp_path)

    manager.waive_independent_verification(plan_id=plan_id, reason="User approved shipping without reviewer.")

    assert manager.plan_independent_verification_followup(dispatch_available=False) is None
    saved = manager.plan_store.get(plan_id)
    assert saved is not None
    assert saved.verification[-1]["source"] == "independent_verification_waiver"
    assert saved.verification[-1]["waived"] is True
    assert saved.verification[-1]["reason"] == "User approved shipping without reviewer."


@pytest.mark.anyio
async def test_runner_final_answer_gate_injects_independent_verification_followup(tmp_path: Path) -> None:
    manager, plan_id = make_completed_plan(tmp_path)
    provider = FakeProvider([
        LLMResponse(content="premature final"),
        LLMResponse(content="still premature"),
    ])
    registry = ToolRegistry()
    runner = AgentRunner(
        provider=provider,
        model="fake",
        registry=registry,
        system_prompt="system",
        control_manager=manager,
        max_turns=2,
    )
    emitted: list[dict[str, Any]] = []

    async def emit(event: dict[str, Any]) -> None:
        emitted.append(event)

    reply = await runner.step_async([{"role": "user", "content": "execute approved plan"}], emit=emit)

    assert reply.startswith("（达到 max_turns=2")
    assert len(provider.seen_messages) == 2
    followup = provider.seen_messages[1][-1]
    assert followup["role"] == "user"
    assert "[PLAN_INDEPENDENT_VERIFICATION_REQUIRED]" in followup["content"]
    assert plan_id in followup["content"]
    assert "ask_user" in followup["content"]
    assert any(
        event.get("event") == "turn_phase"
        and event.get("phase") == "plan_followup"
        and event.get("detail", {}).get("verification") == "required"
        for event in emitted
    )


def test_registry_exposes_verification_reviewer_subagent(tmp_path: Path) -> None:
    templates = Path(__file__).resolve().parents[2] / "templates" / "subagents"
    registry = SubagentRegistry(templates)

    spec = registry.get("verification_reviewer")

    assert spec is not None
    assert "独立复核" in spec.description
    assert "write_file" not in spec.tool_names
    assert "edit_file" not in spec.tool_names
