from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

_VERDICT_BLOCK = re.compile(r"```verdict\s*(.*?)```", re.DOTALL | re.IGNORECASE)


@dataclass(frozen=True)
class ReviewerVerdict:
    passed: bool
    summary: str = ""
    commands: list[str] = field(default_factory=list)
    command_evidence: list[dict[str, Any]] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "summary": self.summary,
            "commands": list(self.commands),
            "command_evidence": list(self.command_evidence),
        }


def parse_reviewer_verdict(text: str | None) -> ReviewerVerdict | None:
    if not text:
        return None
    blocks = _VERDICT_BLOCK.findall(text)
    if not blocks:
        return None
    raw = blocks[-1].strip()  # last block wins
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or "passed" not in data:
        return None
    commands = [str(item) for item in (data.get("commands") or []) if str(item).strip()]
    evidence = [item for item in (data.get("command_evidence") or []) if isinstance(item, dict)]
    return ReviewerVerdict(
        passed=bool(data.get("passed")),
        summary=str(data.get("summary") or "")[:1000],
        commands=commands,
        command_evidence=evidence,
    )
