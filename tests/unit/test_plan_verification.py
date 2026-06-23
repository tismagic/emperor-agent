from __future__ import annotations

from agent.plans.verification import VerificationCommand, VerificationResult
from agent.runtime import events as runtime_events


def test_verification_result_records_success() -> None:
    result = VerificationResult.from_completed(
        VerificationCommand(command=".venv/bin/python -m pytest tests/unit/test_plan_store.py -q"),
        exit_code=0,
        stdout="2 passed",
        stderr="",
    )

    assert result.passed is True
    assert result.summary == "2 passed"


def test_verification_result_records_failure() -> None:
    result = VerificationResult.from_completed(
        VerificationCommand(command="make check"),
        exit_code=2,
        stdout="",
        stderr="ruff failed",
    )

    assert result.passed is False
    assert result.summary == "ruff failed"


def test_plan_verification_runtime_events() -> None:
    start = runtime_events.plan_verification_start(plan_id="plan_1", step_id="step_1", command="pytest")
    done = runtime_events.plan_verification_done(
        plan_id="plan_1",
        step_id="step_1",
        result={"command": "pytest", "passed": True},
    )

    assert start == {
        "event": "plan_verification_start",
        "plan_id": "plan_1",
        "step_id": "step_1",
        "command": "pytest",
    }
    assert done["event"] == "plan_verification_done"
    assert done["result"]["passed"] is True
