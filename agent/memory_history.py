"""Hot/cold storage for the raw conversation history log."""
from __future__ import annotations

import gzip
import json
import shutil
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4


_UTC8 = timezone(timedelta(hours=8))
_INDEX_VERSION = 1


class HistoryLog:
    """Keep `history.jsonl` small while preserving archived raw rows."""

    def __init__(self, memory_dir: Path, history_file: Path):
        self.memory_dir = Path(memory_dir)
        self.history_file = Path(history_file)
        self.archive_dir = self.memory_dir / "history_archive"
        self.index_file = self.memory_dir / "history_index.json"
        self.legacy_backup = self.memory_dir / "history.legacy-backup.jsonl"
        self._lock = RLock()
        self._ensure()

    def append(self, row: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            index = self._load_index()
            payload = dict(row)
            payload.setdefault("seq", int(index.get("latest_seq") or 0) + 1)
            payload.setdefault("archived", False)
            payload.setdefault("ts", datetime.now(_UTC8).isoformat(timespec="seconds"))
            with self.history_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(payload, ensure_ascii=False) + "\n")
            index["latest_seq"] = max(int(index.get("latest_seq") or 0), int(payload.get("seq") or 0))
            self._write_index(self._stats_from_index(index))
            return payload

    def compact(self, active_messages: list[dict[str, Any]]) -> None:
        """Archive rows no longer represented by active_messages and rewrite the hot log."""
        with self._lock:
            hot_rows = self._read_hot_rows()
            marker = {
                "seq": self._next_seq(hot_rows),
                "ts": datetime.now(_UTC8).isoformat(timespec="seconds"),
                "type": "compact_event",
                "archived": True,
            }
            active_rows = self._active_rows_from_messages(active_messages, hot_rows)
            archived_rows = self._rows_to_archive(hot_rows, active_rows)
            archived_rows.append(marker)
            if archived_rows:
                self._append_archive(archived_rows)
            self._rewrite_hot(active_rows)
            index = self._load_index()
            index["latest_seq"] = max(int(index.get("latest_seq") or 0), int(marker["seq"]))
            index["last_archive_at"] = marker["ts"]
            self._write_index(self._stats_from_index(index))

    def load_active_rows(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                row for row in self._read_hot_rows()
                if row.get("type") != "compact_event"
            ]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return self._stats_from_index(self._load_index())

    def _ensure(self) -> None:
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        if not self.history_file.exists():
            self.history_file.write_text("", encoding="utf-8")
        if not self.index_file.exists():
            self._migrate_legacy_history()
        else:
            self._write_index(self._stats_from_index(self._load_index()))

    def _migrate_legacy_history(self) -> None:
        rows = self._read_hot_rows(assign_seq=True)
        if self.history_file.exists() and not self.legacy_backup.exists():
            shutil.copyfile(self.history_file, self.legacy_backup)
        last_marker = -1
        for i, row in enumerate(rows):
            if row.get("type") == "compact_event":
                last_marker = i
        archived = rows[:last_marker + 1] if last_marker >= 0 else []
        active = rows[last_marker + 1:] if last_marker >= 0 else rows
        for row in archived:
            row["archived"] = True
        for row in active:
            row["archived"] = False
        if archived:
            self._append_archive(archived)
        self._rewrite_hot(active)
        latest = max((int(row.get("seq") or 0) for row in rows), default=0)
        self._write_index(self._stats_from_index({
            "version": _INDEX_VERSION,
            "latest_seq": latest,
            "migrated_at": datetime.now(_UTC8).isoformat(timespec="seconds"),
            "last_archive_at": archived[-1].get("ts") if archived else None,
        }))

    def _read_hot_rows(self, *, assign_seq: bool = False) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        latest = 0
        try:
            with self.history_file.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(row, dict):
                        continue
                    if assign_seq and not isinstance(row.get("seq"), int):
                        latest += 1
                        row["seq"] = latest
                    else:
                        latest = max(latest, int(row.get("seq") or 0))
                    row.setdefault("archived", False)
                    rows.append(row)
        except OSError:
            return []
        return rows

    def _active_rows_from_messages(
        self,
        messages: list[dict[str, Any]],
        hot_rows: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        hot_by_signature: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        for row in hot_rows:
            hot_by_signature.setdefault(self._signature(row), []).append(row)

        active: list[dict[str, Any]] = []
        next_seq = self._next_seq(hot_rows) - 1
        for msg in messages:
            role = str(msg.get("role") or "")
            if role not in {"user", "assistant"}:
                continue
            if "content" not in msg:
                continue
            base = {
                "role": role,
                "content": msg.get("content"),
            }
            for key in ("turn_id", "attachments", "displayContent"):
                if key in msg:
                    base[key] = msg[key]
            signature = self._signature(base)
            existing = hot_by_signature.get(signature, [])
            if existing:
                row = dict(existing.pop(0))
                row["archived"] = False
            else:
                next_seq += 1
                row = {
                    "seq": next_seq,
                    "ts": datetime.now(_UTC8).isoformat(timespec="seconds"),
                    "archived": False,
                    **_json_safe(base),
                }
            active.append(row)
        return active

    def _rows_to_archive(
        self,
        hot_rows: list[dict[str, Any]],
        active_rows: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        active_counts = Counter(self._signature(row) for row in active_rows)
        archived: list[dict[str, Any]] = []
        for row in hot_rows:
            sig = self._signature(row)
            if active_counts[sig] > 0:
                active_counts[sig] -= 1
                continue
            archived_row = dict(row)
            archived_row["archived"] = True
            archived.append(archived_row)
        return archived

    def _append_archive(self, rows: list[dict[str, Any]]) -> None:
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            month = self._archive_month(row)
            grouped.setdefault(month, []).append(row)
        for month, items in grouped.items():
            path = self.archive_dir / f"{month}.jsonl.gz"
            with gzip.open(path, "at", encoding="utf-8") as f:
                for row in items:
                    f.write(json.dumps(_json_safe(row), ensure_ascii=False) + "\n")

    def _rewrite_hot(self, rows: list[dict[str, Any]]) -> None:
        for row in rows:
            row["archived"] = False
        tmp = self.history_file.with_name(f".{self.history_file.name}.{uuid4().hex}.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(_json_safe(row), ensure_ascii=False) + "\n")
        tmp.replace(self.history_file)

    def _stats_from_index(self, index: dict[str, Any]) -> dict[str, Any]:
        hot_rows = self._read_hot_rows()
        archive_files = sorted(self.archive_dir.glob("*.jsonl.gz"))
        archives = [
            {
                "path": str(path.relative_to(self.memory_dir.parent)),
                "bytes": path.stat().st_size,
                "updated_at": datetime.fromtimestamp(path.stat().st_mtime, _UTC8).isoformat(timespec="seconds"),
            }
            for path in archive_files
        ]
        hot_bytes = self.history_file.stat().st_size if self.history_file.exists() else 0
        archive_bytes = sum(item["bytes"] for item in archives)
        return {
            "version": _INDEX_VERSION,
            "latest_seq": int(index.get("latest_seq") or self._next_seq(hot_rows) - 1),
            "active_lines": len(hot_rows),
            "active_bytes": hot_bytes,
            "archive_files": len(archives),
            "archive_bytes": archive_bytes,
            "archives": archives,
            "last_archive_at": index.get("last_archive_at"),
            "migrated_at": index.get("migrated_at"),
            "hot_limit_lines": 2000,
            "hot_limit_bytes": 5 * 1024 * 1024,
            "needs_rotation": hot_bytes > 5 * 1024 * 1024 or len(hot_rows) > 2000,
        }

    def _load_index(self) -> dict[str, Any]:
        try:
            raw = json.loads(self.index_file.read_text(encoding="utf-8") or "{}")
        except (json.JSONDecodeError, OSError):
            return {"version": _INDEX_VERSION, "latest_seq": self._next_seq(self._read_hot_rows()) - 1}
        return raw if isinstance(raw, dict) else {"version": _INDEX_VERSION}

    def _write_index(self, index: dict[str, Any]) -> None:
        payload = dict(index)
        payload["version"] = _INDEX_VERSION
        tmp = self.index_file.with_name(f".{self.index_file.name}.{uuid4().hex}.tmp")
        tmp.write_text(json.dumps(_json_safe(payload), ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.index_file)

    @staticmethod
    def _signature(row: dict[str, Any]) -> tuple[str, str, str]:
        role = str(row.get("role") or "")
        turn_id = str(row.get("turn_id") or "")
        content = json.dumps(_json_safe(row.get("content")), ensure_ascii=False, sort_keys=True)
        return role, turn_id, content

    @staticmethod
    def _next_seq(rows: list[dict[str, Any]]) -> int:
        return max((int(row.get("seq") or 0) for row in rows), default=0) + 1

    @staticmethod
    def _archive_month(row: dict[str, Any]) -> str:
        ts = str(row.get("ts") or "")
        if len(ts) >= 7 and ts[4:5] == "-" and ts[7:8] in {"", "T", "-"}:
            return ts[:7]
        return datetime.now(_UTC8).strftime("%Y-%m")


def _json_safe(obj: Any) -> Any:
    try:
        json.dumps(obj, ensure_ascii=False)
        return obj
    except (TypeError, ValueError):
        pass
    if isinstance(obj, list):
        return [_json_safe(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "__dict__"):
        return {k: _json_safe(v) for k, v in obj.__dict__.items() if not k.startswith("_")}
    return str(obj)
