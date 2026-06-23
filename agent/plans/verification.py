from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass

_TOOL_ERROR_HINT = "[Analyze the error above and try a different approach.]"


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

    @classmethod
    def from_tool_output(cls, command: VerificationCommand, content: str) -> VerificationResult:
        text = _strip_tool_error_hint(str(content or "").strip())
        failed: re.Match[str] | None = re.match(
            r"^Error: command exited with code (?P<code>\d+)\n?(?P<body>.*)$",
            text,
            re.DOTALL,
        )
        if failed is not None:
            return cls.from_completed(
                command,
                exit_code=int(failed.group("code")),
                stdout="",
                stderr=failed.group("body").strip(),
            )
        if text.startswith("Error: command timed out"):
            return cls.from_completed(command, exit_code=124, stdout="", stderr=text)
        if text.startswith("Error:"):
            return cls.from_completed(command, exit_code=1, stdout="", stderr=text)
        return cls.from_completed(command, exit_code=0, stdout=text, stderr="")

    def to_dict(self) -> dict:
        return asdict(self)


def _strip_tool_error_hint(text: str) -> str:
    lines = text.splitlines()
    if lines and lines[-1].strip() == _TOOL_ERROR_HINT:
        return "\n".join(lines[:-1]).strip()
    return text
