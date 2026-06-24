from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .models import TaskRecord

# Terminal statuses are eligible for archival once the hot index exceeds the cap.
# Non-terminal tasks (queued / pending / running) always stay in the hot index.
_TERMINAL = {"completed", "failed", "cancelled"}


class TaskStore:
    def __init__(self, root: Path | str, *, max_terminal: int = 500) -> None:
        self.root = Path(root).resolve()
        self.tasks_dir = self.root / "memory" / "tasks"
        self.index_file = self.tasks_dir / "index.json"
        self.archive_dir = self.tasks_dir / "archive"
        self.max_terminal = max(1, int(max_terminal))
        self._lock = RLock()
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        if not self.index_file.exists():
            self._write(self.index_file, {})

    def list(self) -> list[TaskRecord]:
        """Hot index only — archived (old terminal) tasks are not listed by default."""
        data = self._read(self.index_file)
        return [TaskRecord.from_dict(item) for item in data.values() if isinstance(item, dict)]

    def get(self, task_id: str) -> TaskRecord | None:
        key = str(task_id)
        payload = self._read(self.index_file).get(key)
        if isinstance(payload, dict):
            return TaskRecord.from_dict(payload)
        return self._get_archived(key)

    def upsert(self, record: TaskRecord) -> None:
        with self._lock:
            data = self._read(self.index_file)
            data[record.id] = record.to_dict()
            self._archive_if_needed(data)
            self._write(self.index_file, data)

    # --- archival ---------------------------------------------------------

    def _archive_if_needed(self, data: dict) -> None:
        terminal = [
            item for item in data.values()
            if isinstance(item, dict) and str(item.get("status")) in _TERMINAL
        ]
        if len(terminal) <= self.max_terminal:
            return
        terminal.sort(key=lambda item: float(item.get("started_at") or 0.0))
        overflow = terminal[: len(terminal) - self.max_terminal]
        by_month: dict[str, list[dict]] = {}
        for item in overflow:
            by_month.setdefault(self._month_key(item), []).append(item)
            data.pop(str(item.get("id")), None)
        for month, items in by_month.items():
            self._merge_archive(month, items)

    def _merge_archive(self, month: str, items: list[dict]) -> None:
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        path = self.archive_dir / f"{month}.json"
        existing = self._read(path) if path.exists() else {}
        for item in items:
            existing[str(item.get("id"))] = item
        self._write(path, existing)

    def _get_archived(self, task_id: str) -> TaskRecord | None:
        if not self.archive_dir.exists():
            return None
        for path in sorted(self.archive_dir.glob("*.json"), reverse=True):
            payload = self._read(path).get(task_id)
            if isinstance(payload, dict):
                return TaskRecord.from_dict(payload)
        return None

    @staticmethod
    def _month_key(item: dict) -> str:
        ts = float(item.get("started_at") or time.time())
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m")

    # --- io ---------------------------------------------------------------

    def _read(self, path: Path) -> dict[str, dict]:
        with self._lock:
            try:
                raw = json.loads(path.read_text(encoding="utf-8") or "{}")
            except FileNotFoundError:
                return {}
            except json.JSONDecodeError:
                corrupt = path.with_name(f"{path.name}.corrupt-{int(time.time())}-{uuid4().hex[:8]}")
                path.replace(corrupt)
                self._write(path, {})
                return {}
        return raw if isinstance(raw, dict) else {}

    def _write(self, path: Path, data: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
