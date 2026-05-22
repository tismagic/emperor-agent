from __future__ import annotations

import json
import time
from collections import OrderedDict, deque
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import uuid4

from .models import ExternalAttachment, ExternalInbound


@dataclass
class ExternalBridgeState:
    seen: set[tuple[str, str]] = field(default_factory=set)
    inbox: deque[dict[str, Any]] = field(default_factory=deque)
    pending: deque[ExternalInbound] = field(default_factory=deque)
    outbox: OrderedDict[str, dict[str, Any]] = field(default_factory=OrderedDict)
    recent_errors: deque[dict[str, Any]] = field(default_factory=deque)


class ExternalBridgeStore:
    """Durable state store for the external bridge foundation.

    The bridge is still single-mainline and adapter-agnostic; this store only keeps
    queue/status state so restarts do not lose inbound/outbound bookkeeping.
    """

    def __init__(self, root: Path, *, max_recent: int = 100):
        self.root = Path(root).resolve()
        self.max_recent = max_recent
        self.external_dir = self.root / "memory" / "external"
        self.state_file = self.external_dir / "state.json"
        self.external_dir.mkdir(parents=True, exist_ok=True)

    def load(self) -> ExternalBridgeState:
        if not self.state_file.exists():
            return ExternalBridgeState(
                inbox=deque(maxlen=self.max_recent),
                pending=deque(maxlen=self.max_recent),
                recent_errors=deque(maxlen=self.max_recent),
            )
        try:
            raw = json.loads(self.state_file.read_text(encoding="utf-8") or "{}")
            if not isinstance(raw, dict):
                raise ValueError("external state root must be an object")
        except Exception:
            self._preserve_corrupt_state()
            return ExternalBridgeState(
                inbox=deque(maxlen=self.max_recent),
                pending=deque(maxlen=self.max_recent),
                recent_errors=deque(maxlen=self.max_recent),
            )

        seen = {
            (str(item[0]), str(item[1]))
            for item in raw.get("seen", [])
            if isinstance(item, list | tuple) and len(item) == 2 and item[0] and item[1]
        }
        inbox = deque(
            [item for item in raw.get("inbox", []) if isinstance(item, dict)],
            maxlen=self.max_recent,
        )
        pending = deque(
            [_inbound_from_dict(item) for item in raw.get("pending", []) if isinstance(item, dict)],
            maxlen=self.max_recent,
        )
        outbox = OrderedDict()
        for item in raw.get("outbox", []) or []:
            if not isinstance(item, dict):
                continue
            message = item.get("message") if isinstance(item.get("message"), dict) else {}
            message_id = str(message.get("id") or "")
            if message_id:
                outbox[message_id] = item
        recent_errors = deque(
            [item for item in raw.get("recentErrors", []) if isinstance(item, dict)],
            maxlen=self.max_recent,
        )
        return ExternalBridgeState(
            seen=seen,
            inbox=inbox,
            pending=pending,
            outbox=outbox,
            recent_errors=recent_errors,
        )

    def save(
        self,
        *,
        seen: set[tuple[str, str]],
        inbox: deque[dict[str, Any]],
        pending: deque[ExternalInbound],
        outbox: OrderedDict[str, dict[str, Any]],
        recent_errors: deque[dict[str, Any]],
    ) -> None:
        payload = {
            "version": 1,
            "updatedAt": time.time(),
            "seen": [[platform, message_id] for platform, message_id in sorted(seen)],
            "inbox": list(inbox)[-self.max_recent:],
            "pending": [message.to_dict() for message in list(pending)[-self.max_recent:]],
            "outbox": list(outbox.values())[-self.max_recent:],
            "recentErrors": list(recent_errors)[-self.max_recent:],
        }
        self.external_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.state_file.with_name(f".{self.state_file.name}.{uuid4().hex}.tmp")
        try:
            tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            tmp.replace(self.state_file)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise

    def diagnostics(self) -> dict[str, Any]:
        corrupt = sorted(
            self.external_dir.glob("state.json.corrupt-*"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        return {
            "path": self.state_file.as_posix(),
            "exists": self.state_file.exists(),
            "bytes": self.state_file.stat().st_size if self.state_file.exists() else 0,
            "corruptBackups": [
                {
                    "path": item.as_posix(),
                    "bytes": item.stat().st_size,
                    "updatedAt": item.stat().st_mtime,
                }
                for item in corrupt[:10]
            ],
        }

    def _preserve_corrupt_state(self) -> None:
        backup = self.state_file.with_name(
            f"{self.state_file.name}.corrupt-{int(time.time())}-{uuid4().hex[:8]}"
        )
        with suppress(OSError):
            if self.state_file.exists():
                self.state_file.rename(backup)


def _inbound_from_dict(raw: dict[str, Any]) -> ExternalInbound:
    attachments = []
    for item in raw.get("attachments", []) or []:
        if not isinstance(item, dict):
            continue
        attachments.append(ExternalAttachment(
            name=str(item.get("name") or ""),
            mime=str(item.get("mime") or ""),
            size=int(item.get("size") or 0),
            path=str(item.get("path") or ""),
            metadata=item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
        ))
    payload: dict[str, Any] = {
        "platform": str(raw.get("platform") or ""),
        "sender_id": str(raw.get("sender_id") or raw.get("senderId") or ""),
        "target_id": str(raw.get("target_id") or raw.get("targetId") or ""),
        "external_message_id": str(
            raw.get("external_message_id") or raw.get("externalMessageId") or ""
        ),
        "content": str(raw.get("content") or ""),
        "attachments": attachments,
        "metadata": raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {},
        "received_at": float(raw.get("received_at") or raw.get("receivedAt") or time.time()),
    }
    if raw.get("id"):
        payload["id"] = str(raw.get("id"))
    return ExternalInbound(**payload)
