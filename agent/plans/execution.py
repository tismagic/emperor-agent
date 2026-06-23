from __future__ import annotations

import time
from dataclasses import replace
from typing import Any

from .models import PlanRecord, PlanStatus, PlanStep, PlanStepStatus


class PlanExecutionState:
    def __init__(self, plan: PlanRecord) -> None:
        self.plan = plan

    def start_next_step(self) -> PlanRecord:
        if any(step.status == PlanStepStatus.ACTIVE.value for step in self.plan.steps):
            return self.plan
        steps: list[PlanStep] = []
        activated = False
        for step in self.plan.steps:
            if not activated and step.status == PlanStepStatus.PENDING.value:
                steps.append(replace(step, status=PlanStepStatus.ACTIVE.value))
                activated = True
            else:
                steps.append(step)
        return replace(
            self.plan,
            status=PlanStatus.EXECUTING.value,
            updated_at=time.time(),
            steps=steps,
        )

    def complete_step(self, step_id: str, *, evidence: dict[str, Any]) -> PlanRecord:
        steps = [
            replace(step, status=PlanStepStatus.DONE.value, evidence=[*step.evidence, evidence])
            if step.id == step_id
            else step
            for step in self.plan.steps
        ]
        status = (
            PlanStatus.COMPLETED.value
            if steps and all(step.status == PlanStepStatus.DONE.value for step in steps)
            else PlanStatus.EXECUTING.value
        )
        return replace(
            self.plan,
            status=status,
            completed_at=time.time() if status == PlanStatus.COMPLETED.value else self.plan.completed_at,
            updated_at=time.time(),
            steps=steps,
        )

    def fail_step(self, step_id: str, *, evidence: dict[str, Any]) -> PlanRecord:
        steps = [
            replace(step, status=PlanStepStatus.FAILED.value, evidence=[*step.evidence, evidence])
            if step.id == step_id
            else step
            for step in self.plan.steps
        ]
        return replace(
            self.plan,
            status=PlanStatus.FAILED.value,
            updated_at=time.time(),
            steps=steps,
        )
