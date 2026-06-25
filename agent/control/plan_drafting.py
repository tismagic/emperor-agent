"""Plan drafting: propose_plan / draft lifecycle / discovery ledger / draft Q&A.

Extracted verbatim from ControlManager (no behavior change). Reaches shared state
(plan_store, plan_decision_policy, control store, pending-interaction helpers) through
the owning ControlManager via `self._cm`.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from uuid import uuid4

from ..plans import (
    PlanDiscovery,
    PlanDraftPhase,
    PlanDraftState,
    PlanQualityGate,
    PlanRecord,
    PlanStatus,
)
from .clarification import _CONTROL_RESUME_RE
from .models import ControlMode, Interaction, InteractionStatus, now_ts
from .plan_helpers import (
    _dedupe_strings,
    _first_heading,
    _looks_like_plan,
    _metadata_without_plan_permission_tokens,
    _parse_plan_steps,
    _plain_summary,
    _ready_for_approval_draft,
)
from .plan_policy import PlanDecision


class PlanDraftingManager:
    def __init__(self, control_manager) -> None:
        self._cm = control_manager

    def create_plan(
        self,
        *,
        title: str,
        summary: str,
        plan_markdown: str,
        assumptions: list[str] | None = None,
        risk_level: str = "medium",
        steps: list[dict[str, Any]] | None = None,
        parent_call_id: str | None = None,
        meta: dict[str, Any] | None = None,
        enforce_quality: bool = False,
    ) -> Interaction:
        self._cm.ensure_no_pending()
        plan_meta = dict(meta or {})
        existing = self._plan_record_for_meta(plan_meta) or self._latest_draft_plan()
        plan_id = existing.id if existing is not None else f"plan_{uuid4().hex[:12]}"
        now = now_ts()
        structured_steps = _parse_plan_steps(steps or [])
        interaction = Interaction.plan(
            title=title,
            summary=summary,
            plan_markdown=plan_markdown,
            assumptions=assumptions,
            risk_level=risk_level,
            parent_call_id=parent_call_id,
            meta={**plan_meta, "plan_id": plan_id},
        )
        draft = _ready_for_approval_draft(
            existing.draft if existing is not None else PlanDraftState(),
            summary=interaction.summary,
            steps=structured_steps,
        )
        if enforce_quality:
            PlanQualityGate().require_ok(steps=structured_steps, draft=draft)
        self._cm.plan_store.save(
            PlanRecord(
                id=plan_id,
                title=interaction.title,
                summary=interaction.summary,
                status=PlanStatus.WAITING_APPROVAL.value,
                created_at=existing.created_at if existing is not None else now,
                updated_at=now,
                source_interaction_id=interaction.id,
                plan_markdown=interaction.plan_markdown,
                assumptions=list(interaction.assumptions),
                steps=structured_steps,
                draft=draft,
                metadata=_metadata_without_plan_permission_tokens({
                    **(existing.metadata if existing is not None else {}),
                    "risk_level": interaction.risk_level,
                }),
            )
        )
        self._cm._set_pending(interaction)
        return interaction

    def create_plan_from_text(self, text: str) -> Interaction:
        body = str(text or "").strip()
        if not body:
            body = "Plan 模式要求先提交可预览计划。"
        title = _first_heading(body) or "计划预览"
        summary = _plain_summary(body)
        if not _looks_like_plan(body):
            body = "\n".join([
                "# 计划预览",
                "",
                body,
                "",
                "## 验收",
                "- 用户批准后再执行任何写入或高影响操作。",
            ])
        return self.create_plan(
            title=title,
            summary=summary,
            plan_markdown=body,
            assumptions=[],
            risk_level="medium",
        )

    def assess_plan_decision(self, user_message: str) -> PlanDecision:
        state = self._cm.store.load()
        has_pending = bool(state.pending and state.pending.status == InteractionStatus.WAITING.value)
        # 已批准并在执行中的计划：其续跑控制消息（PLAN_APPROVED resume、执行期 ASK_ANSWERED 等）
        # 携带完整计划正文/含权限安全等高影响词，不应再次触发 plan guard。仅对 CONTROL 续跑标记豁免，
        # 执行期的全新自由文本高影响需求（无 CONTROL 前缀）仍照常评估。
        if _CONTROL_RESUME_RE.match(str(user_message or "")) and self._cm._latest_executable_plan() is not None:
            return PlanDecision(
                "proceed",
                "Approved plan is already executing; continuation control messages do not re-trigger the plan guard.",
                ["executing_plan"],
            )
        return self._cm.plan_decision_policy.assess(
            user_message,
            mode=state.mode,
            has_pending=has_pending,
        )

    def record_plan_discovery(
        self,
        *,
        source: str,
        summary: str,
        files: list[str] | None = None,
        symbols: list[str] | None = None,
        evidence_refs: list[str] | None = None,
    ) -> PlanRecord | None:
        if self._cm.mode != ControlMode.PLAN.value:
            return None
        text = str(summary or "").strip()
        if not text:
            return None
        now = now_ts()
        record = self._ensure_plan_draft()
        discovery = PlanDiscovery(
            id=f"disc_{uuid4().hex[:10]}",
            source=str(source or "tool").strip()[:80],
            summary=text[:1200],
            files=_dedupe_strings(files or []),
            symbols=_dedupe_strings(symbols or []),
            evidence_refs=_dedupe_strings(evidence_refs or []),
            created_at=now,
        ).to_dict()
        discoveries = [*record.draft.discoveries, discovery][-80:]
        draft = replace(
            record.draft,
            discoveries=discoveries,
            relevant_files=_dedupe_strings([*record.draft.relevant_files, *discovery["files"]]),
            last_context_refresh_at=now,
        )
        updated = replace(record, updated_at=now, draft=draft)
        self._cm.plan_store.save(updated)
        return updated

    def _ensure_plan_draft(self) -> PlanRecord:
        existing = self._latest_draft_plan()
        if existing is not None:
            return existing
        now = now_ts()
        record = PlanRecord(
            id=f"plan_{uuid4().hex[:12]}",
            title="Plan Draft",
            summary="Plan mode draft",
            status=PlanStatus.DRAFT.value,
            created_at=now,
            updated_at=now,
            draft=PlanDraftState(phase=PlanDraftPhase.EXPLORING.value),
            metadata={"risk_level": "medium"},
        )
        self._cm.plan_store.save(record)
        return record

    def _latest_draft_plan(self) -> PlanRecord | None:
        plans = [plan for plan in self._cm.plan_store.list() if plan.status == PlanStatus.DRAFT.value]
        if not plans:
            return None
        return max(plans, key=lambda item: item.updated_at)

    def _plan_record_for_meta(self, meta: dict[str, Any]) -> PlanRecord | None:
        plan_id = str(meta.get("plan_id") or "")
        return self._cm.plan_store.get(plan_id) if plan_id else None

    def _record_plan_open_questions(self, interaction: Interaction) -> None:
        record = self._plan_record_for_meta(interaction.meta)
        if record is None:
            return
        open_questions = list(record.draft.open_questions)
        for question in interaction.questions:
            open_questions.append({
                "interaction_id": interaction.id,
                "id": question.id,
                "header": question.header,
                "question": question.question,
                "options": [option.label for option in question.options],
                "context": interaction.context,
            })
        draft = replace(
            record.draft,
            phase=PlanDraftPhase.QUESTIONING.value,
            open_questions=open_questions,
        )
        self._cm.plan_store.save(replace(record, updated_at=now_ts(), draft=draft))

    def _record_plan_resolved_questions(self, interaction: Interaction) -> None:
        record = self._plan_record_for_meta(interaction.meta)
        if record is None:
            return
        question_ids = {question.id for question in interaction.questions}
        remaining_open = [
            item for item in record.draft.open_questions
            if item.get("interaction_id") != interaction.id or item.get("id") not in question_ids
        ]
        resolved = list(record.draft.resolved_questions)
        open_by_id = {
            str(item.get("id")): item
            for item in record.draft.open_questions
            if item.get("interaction_id") == interaction.id
        }
        for question in interaction.questions:
            answer = interaction.answers.get(question.id) or {}
            choice = answer.get("choice") if isinstance(answer, dict) else str(answer)
            freeform = answer.get("freeform") if isinstance(answer, dict) else ""
            source = open_by_id.get(question.id, {})
            resolved.append({
                "interaction_id": interaction.id,
                "id": question.id,
                "header": question.header,
                "question": question.question,
                "answer": str(choice or "").strip(),
                "freeform": str(freeform or "").strip(),
                "context": str(source.get("context") or interaction.context),
            })
        draft = replace(
            record.draft,
            phase=PlanDraftPhase.DESIGNING.value,
            open_questions=remaining_open,
            resolved_questions=resolved,
        )
        self._cm.plan_store.save(replace(record, updated_at=now_ts(), draft=draft))

    def _record_plan_comment(self, interaction: Interaction, comment: str) -> None:
        record = self._plan_record_for_meta(interaction.meta)
        if record is None:
            return
        metadata = dict(record.metadata)
        revisions = list(metadata.get("revisions") or [])
        revisions.append({
            "title": record.title,
            "summary": record.summary,
            "plan_markdown": record.plan_markdown,
            "comment": comment[:4000],
            "timestamp": now_ts(),
        })
        metadata["revisions"] = revisions[-20:]
        metadata = _metadata_without_plan_permission_tokens(metadata, reason="plan comment")
        draft = replace(record.draft, phase=PlanDraftPhase.REVIEWING.value)
        self._cm.plan_store.save(
            replace(
                record,
                status=PlanStatus.DRAFT.value,
                updated_at=now_ts(),
                draft=draft,
                metadata=metadata,
            )
        )
