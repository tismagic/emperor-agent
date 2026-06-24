"""Plan execution mechanics: approved-plan activation, todo<->step sync, step task
tracking and verification sidechain.

Extracted verbatim from ControlManager (no behavior change). Interaction resolution
(approve / comment / cancel / answer) stays on the facade; this manager holds the
plan-state mechanics those methods drive. Shared queries (`_latest_executable_plan`,
`_has_ask_interaction`) and sub-managers (`permission_tokens`) are reached via `self._cm`.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from ..plans import (
    PlanDraftPhase,
    PlanEvidenceError,
    PlanExecutionState,
    PlanRecord,
    PlanStatus,
    PlanStep,
    PlanStepStatus,
    assess_step_verification,
)
from ..tasks import TaskKind, TaskStatus
from .models import Interaction, now_ts
from .plan_helpers import (
    _is_positive_int,
    _plan_status_from_todo,
    _step_verification_status,
    _task_status_from_plan_step,
)


class PlanExecutionManager:
    def __init__(self, control_manager) -> None:
        self._cm = control_manager

    def sync_plan_from_todos(
        self,
        todos: list[dict[str, Any]],
        *,
        evidence: dict[str, Any] | None = None,
    ) -> PlanRecord | None:
        record = self._cm._latest_executable_plan()
        if record is None or not record.steps:
            return None
        todo_by_step_id = {
            str(item.get("plan_step_id")): item
            for item in todos
            if isinstance(item, dict) and str(item.get("plan_step_id") or "").strip()
        }
        todo_by_index = {
            int(item.get("id")) - 1: item
            for item in todos
            if isinstance(item, dict) and _is_positive_int(item.get("id"))
        }
        now = now_ts()
        steps: list[PlanStep] = []
        for index, step in enumerate(record.steps):
            todo = todo_by_step_id.get(step.id) or todo_by_index.get(index)
            if todo is None:
                steps.append(step)
                continue
            todo_status = str(todo.get("status") or "pending")
            next_status = _plan_status_from_todo(todo_status)
            self._validate_plan_step_transition(step, todo=todo, next_status=next_status)
            step_evidence = list(step.evidence)
            if next_status == PlanStepStatus.DONE.value and step.status != PlanStepStatus.DONE.value:
                step_evidence.append({
                    **(evidence or {}),
                    "todo_id": todo.get("id"),
                    "plan_step_id": todo.get("plan_step_id") or step.id,
                    "todo_status": todo_status,
                    "synced_at": now,
                })
            if next_status == PlanStepStatus.BLOCKED.value and step.status != PlanStepStatus.BLOCKED.value:
                step_evidence.append({
                    **(evidence or {}),
                    "todo_id": todo.get("id"),
                    "plan_step_id": todo.get("plan_step_id") or step.id,
                    "todo_status": todo_status,
                    "blocked_reason": str(todo.get("blocked_reason") or "").strip(),
                    "synced_at": now,
                })
            steps.append(replace(step, status=next_status, evidence=step_evidence))

        plan_status = (
            PlanStatus.COMPLETED.value
            if steps and all(step.status in {PlanStepStatus.DONE.value, PlanStepStatus.SKIPPED.value} for step in steps)
            else PlanStatus.EXECUTING.value
        )
        updated = replace(
            record,
            status=plan_status,
            completed_at=now if plan_status == PlanStatus.COMPLETED.value else record.completed_at,
            updated_at=now,
            steps=steps,
        )
        updated = self._sync_plan_step_tasks(updated)
        self._cm.plan_store.save(updated)
        return updated

    def _validate_plan_step_transition(
        self,
        step: PlanStep,
        *,
        todo: dict[str, Any],
        next_status: str,
    ) -> None:
        if next_status == PlanStepStatus.BLOCKED.value:
            blocked_reason = str(todo.get("blocked_reason") or "").strip()
            if not blocked_reason and not self._cm._has_ask_interaction():
                raise PlanEvidenceError(
                    "PLAN_BLOCKED_REASON_REQUIRED",
                    step_id=step.id,
                    reason="blocked steps must include blocked_reason or be paired with ask_user",
                )
        if next_status != PlanStepStatus.DONE.value or step.status == PlanStepStatus.DONE.value:
            return
        assessment = assess_step_verification(step)
        if assessment.failed_required:
            raise PlanEvidenceError(
                "PLAN_EVIDENCE_FAILED",
                step_id=step.id,
                reason=f"declared verification failed: {'; '.join(assessment.failed_required[:3])}",
            )
        if assessment.blocking_errors:
            raise PlanEvidenceError(
                "PLAN_EVIDENCE_REQUIRED",
                step_id=step.id,
                reason=f"missing passing verification evidence for: {'; '.join(assessment.blocking_errors[:3])}",
            )

    def record_plan_step_tool_output(
        self,
        *,
        tool_name: str,
        summary: str,
        tool_call_id: str | None = None,
        artifacts: list[dict[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
        is_error: bool = False,
    ):
        record, step, task_id = self._active_plan_step_task()
        if record is None or step is None or task_id is None or self._cm.task_manager is None:
            return None
        message = {
            "kind": "tool_output",
            "role": "tool",
            "plan_id": record.id,
            "plan_step_id": step.id,
            "tool_name": str(tool_name or ""),
            "tool_call_id": tool_call_id,
            "content": str(summary or "")[:2000],
            "artifacts": artifacts or [],
            "metadata": metadata or {},
            "is_error": bool(is_error),
        }
        self._cm.task_manager.append_sidechain(task_id, message)
        task = self._cm.task_manager.store.get(task_id)
        progress = dict(task.progress) if task is not None else {}
        progress.update({
            "last_tool": str(tool_name or ""),
            "last_summary": str(summary or "")[:500],
            "last_tool_call_id": tool_call_id,
        })
        return self._cm.task_manager.update_task(task_id, progress=progress)

    def _sync_plan_step_tasks(self, record: PlanRecord) -> PlanRecord:
        if self._cm.task_manager is None or not record.steps:
            return record
        mapping = dict(record.metadata.get("plan_step_tasks") or {})
        for index, step in enumerate(record.steps, start=1):
            metadata = {
                "plan_id": record.id,
                "plan_step_id": step.id,
                "sequence": index,
                "verification_status": _step_verification_status(step),
            }
            task_id = str(mapping.get(step.id) or "")
            status = _task_status_from_plan_step(step.status)
            if task_id and self._cm.task_manager.store.get(task_id) is not None:
                task = self._cm.task_manager.store.get(task_id)
                progress = dict(task.progress) if task is not None else {}
                progress["verification_status"] = metadata["verification_status"]
                self._cm.task_manager.update_task(
                    task_id,
                    status=status,
                    title=step.title,
                    metadata=metadata,
                    progress=progress,
                )
                continue
            task = self._cm.task_manager.start_task(
                kind=TaskKind.PLAN_STEP.value,
                title=step.title,
                source="plan_step",
                status=status,
                metadata=metadata,
            )
            mapping[step.id] = task.id
        metadata = dict(record.metadata)
        metadata["plan_step_tasks"] = mapping
        return replace(record, metadata=metadata)

    def _active_plan_step_task(self) -> tuple[PlanRecord | None, PlanStep | None, str | None]:
        record = self._cm._latest_executable_plan()
        if record is None:
            return None, None, None
        mapping = record.metadata.get("plan_step_tasks") or {}
        if not isinstance(mapping, dict):
            return record, None, None
        for step in record.steps:
            if step.status != PlanStepStatus.ACTIVE.value:
                continue
            task_id = str(mapping.get(step.id) or "")
            return record, step, task_id or None
        return record, None, None

    def _append_plan_step_verification(
        self,
        record: PlanRecord,
        *,
        step_id: str,
        result: dict[str, Any],
    ) -> None:
        if self._cm.task_manager is None:
            return
        mapping = record.metadata.get("plan_step_tasks") or {}
        if not isinstance(mapping, dict):
            return
        task_id = str(mapping.get(step_id) or "")
        if not task_id:
            return
        passed = result.get("passed")
        verification_status = "passed" if passed is True else "failed" if passed is False else "unknown"
        self._cm.task_manager.append_sidechain(task_id, {
            "kind": "verification",
            "role": "tool",
            "plan_id": record.id,
            "plan_step_id": step_id,
            "tool_name": str(result.get("source") or "run_command"),
            "command": str(result.get("command") or ""),
            "content": str(result.get("summary") or result.get("error") or "")[:2000],
            "passed": passed,
            "result": dict(result),
        })
        task = self._cm.task_manager.store.get(task_id)
        progress = dict(task.progress) if task is not None else {}
        progress["verification_status"] = verification_status
        progress["last_verification"] = dict(result)
        fields: dict[str, Any] = {"progress": progress}
        if passed is False:
            fields["status"] = TaskStatus.FAILED.value
        self._cm.task_manager.update_task(task_id, **fields)

    def _update_plan_status(self, interaction: Interaction, status: str, *, approved: bool = False) -> None:
        plan_id = str(interaction.meta.get("plan_id") or "")
        if not plan_id:
            return
        record = self._cm.plan_store.get(plan_id)
        if record is None:
            return
        now = now_ts()
        draft = record.draft
        if approved:
            draft = replace(draft, phase=PlanDraftPhase.APPROVED.value)
        payload = {
            **record.to_dict(),
            "status": status,
            "updated_at": now,
            "draft": draft.to_dict(),
        }
        if approved:
            payload["approved_at"] = now
        self._cm.plan_store.save(PlanRecord.from_dict(payload))

    def _activate_approved_plan(self, interaction: Interaction) -> PlanRecord | None:
        plan_id = str(interaction.meta.get("plan_id") or "")
        if not plan_id:
            return None
        record = self._cm.plan_store.get(plan_id)
        if record is None:
            return None
        if self._cm.todo_store is None or not record.steps:
            return record
        activated = PlanExecutionState(record).start_next_step()
        activated = replace(
            activated,
            draft=replace(activated.draft, phase=PlanDraftPhase.EXECUTING.value),
        )
        activated = self._cm.permission_tokens.issue(activated)
        activated = self._sync_plan_step_tasks(activated)
        self._cm.plan_store.save(activated)
        self._cm.todo_store.sync_from_plan_steps([step.to_dict() for step in activated.steps])
        return activated
