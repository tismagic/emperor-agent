from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

DEFAULT_MICROCOMPACT_KEEP_RECENT = 12
DEFAULT_MICROCOMPACT_MIN_CHARS = 6000
DEFAULT_MICROCOMPACT_HEAD_CHARS = 1200
DEFAULT_MICROCOMPACT_TAIL_CHARS = 600


@dataclass(frozen=True)
class MicrocompactRecord:
    index: int
    role: str
    original_chars: int
    kept_head_chars: int
    kept_tail_chars: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def microcompact_text_messages(
    history: list[dict[str, Any]],
    *,
    keep_recent: int = DEFAULT_MICROCOMPACT_KEEP_RECENT,
    min_chars: int = DEFAULT_MICROCOMPACT_MIN_CHARS,
    head_chars: int = DEFAULT_MICROCOMPACT_HEAD_CHARS,
    tail_chars: int = DEFAULT_MICROCOMPACT_TAIL_CHARS,
) -> tuple[list[dict[str, Any]], list[MicrocompactRecord]]:
    cutoff = max(0, len(history) - keep_recent)
    out: list[dict[str, Any]] = []
    records: list[MicrocompactRecord] = []
    for index, message in enumerate(history):
        copied = dict(message)
        content = copied.get("content")
        if _should_microcompact(copied, content, index=index, cutoff=cutoff, min_chars=min_chars):
            text = str(content)
            head = text[:max(1, head_chars)]
            tail = text[-max(0, tail_chars):] if tail_chars > 0 else ""
            copied["content"] = _microcompact_message(
                role=str(copied.get("role") or "message"),
                original_chars=len(text),
                head=head,
                tail=tail,
            )
            records.append(MicrocompactRecord(
                index=index,
                role=str(copied.get("role") or ""),
                original_chars=len(text),
                kept_head_chars=len(head),
                kept_tail_chars=len(tail),
            ))
        out.append(copied)
    return out, records


def _should_microcompact(
    message: dict[str, Any],
    content: Any,
    *,
    index: int,
    cutoff: int,
    min_chars: int,
) -> bool:
    if index >= cutoff:
        return False
    if message.get("role") not in {"user", "assistant"}:
        return False
    if message.get("tool_calls"):
        return False
    if not isinstance(content, str):
        return False
    return len(content) > min_chars


def _microcompact_message(*, role: str, original_chars: int, head: str, tail: str) -> str:
    lines = [
        "[local_microcompact]",
        f"role: {role}",
        f"original_chars: {original_chars}",
        "This older text message was locally shortened before the model request.",
        "",
        "head:",
        head,
    ]
    if tail:
        lines.extend(["", "tail:", tail])
    return "\n".join(lines).strip()
