from __future__ import annotations

import time
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class VerificationCommand:
    command: str
    cwd: str | None = None
    timeout_seconds: int = 300

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class VerificationResult:
    command: str
    exit_code: int
    passed: bool
    summary: str
    stdout_tail: str
    stderr_tail: str
    checked_at: float

    @classmethod
    def from_completed(
        cls,
        command: VerificationCommand,
        *,
        exit_code: int,
        stdout: str,
        stderr: str,
    ) -> VerificationResult:
        output = (stdout or stderr or f"exit_code={exit_code}").strip()
        summary = output.splitlines()[-1][:500] if output else f"exit_code={exit_code}"
        return cls(
            command=command.command,
            exit_code=exit_code,
            passed=exit_code == 0,
            summary=summary,
            stdout_tail=stdout[-4000:],
            stderr_tail=stderr[-4000:],
            checked_at=time.time(),
        )

    def to_dict(self) -> dict:
        return asdict(self)
