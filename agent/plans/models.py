from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class PlanStatus(StrEnum):
    DRAFT = "draft"
    WAITING_APPROVAL = "waiting_approval"
    APPROVED = "approved"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PlanStepStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    DONE = "done"
    FAILED = "failed"
    BLOCKED = "blocked"
    SKIPPED = "skipped"


def _valid_value(value: Any, allowed: set[str], fallback: str) -> str:
    text = str(value or "").strip()
    return text if text in allowed else fallback


@dataclass(frozen=True)
class PlanStep:
    id: str
    title: str
    status: str = PlanStepStatus.PENDING.value
    description: str = ""
    files: list[str] = field(default_factory=list)
    commands: list[str] = field(default_factory=list)
    acceptance: list[str] = field(default_factory=list)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    risk: str = "medium"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> PlanStep:
        return cls(
            id=str(raw["id"]),
            title=str(raw["title"]),
            status=_valid_value(
                raw.get("status"),
                {item.value for item in PlanStepStatus},
                PlanStepStatus.PENDING.value,
            ),
            description=str(raw.get("description") or ""),
            files=[str(item) for item in raw.get("files") or []],
            commands=[str(item) for item in raw.get("commands") or []],
            acceptance=[str(item) for item in raw.get("acceptance") or []],
            evidence=[item for item in raw.get("evidence") or [] if isinstance(item, dict)],
            risk=str(raw.get("risk") or "medium"),
        )


@dataclass(frozen=True)
class PlanRecord:
    id: str
    title: str
    summary: str
    status: str
    created_at: float
    updated_at: float
    source_interaction_id: str | None = None
    approved_at: float | None = None
    completed_at: float | None = None
    plan_markdown: str = ""
    assumptions: list[str] = field(default_factory=list)
    steps: list[PlanStep] = field(default_factory=list)
    verification: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["steps"] = [step.to_dict() for step in self.steps]
        return payload

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> PlanRecord:
        return cls(
            id=str(raw["id"]),
            title=str(raw["title"]),
            summary=str(raw["summary"]),
            status=_valid_value(raw.get("status"), {item.value for item in PlanStatus}, PlanStatus.DRAFT.value),
            created_at=float(raw["created_at"]),
            updated_at=float(raw["updated_at"]),
            source_interaction_id=raw.get("source_interaction_id"),
            approved_at=raw.get("approved_at"),
            completed_at=raw.get("completed_at"),
            plan_markdown=str(raw.get("plan_markdown") or ""),
            assumptions=[str(item) for item in raw.get("assumptions") or []],
            steps=[PlanStep.from_dict(item) for item in raw.get("steps") or [] if isinstance(item, dict)],
            verification=[item for item in raw.get("verification") or [] if isinstance(item, dict)],
            metadata=dict(raw.get("metadata") or {}),
        )
