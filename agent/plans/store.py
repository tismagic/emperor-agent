from __future__ import annotations

import json
import time
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .models import PlanRecord


class PlanStore:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root).resolve()
        self.plan_dir = self.root / "memory" / "plans"
        self.index_file = self.plan_dir / "index.json"
        self._lock = RLock()
        self.plan_dir.mkdir(parents=True, exist_ok=True)
        if not self.index_file.exists():
            self._write({})

    def list(self) -> list[PlanRecord]:
        data = self._read()
        return [PlanRecord.from_dict(item) for item in data.values() if isinstance(item, dict)]

    def get(self, plan_id: str) -> PlanRecord | None:
        payload = self._read().get(str(plan_id))
        return PlanRecord.from_dict(payload) if isinstance(payload, dict) else None

    def latest(self) -> PlanRecord | None:
        plans = self.list()
        return max(plans, key=lambda item: item.updated_at) if plans else None

    def save(self, record: PlanRecord) -> None:
        with self._lock:
            data = self._read()
            data[record.id] = record.to_dict()
            self._write(data)

    def _read(self) -> dict[str, dict]:
        with self._lock:
            try:
                raw = json.loads(self.index_file.read_text(encoding="utf-8") or "{}")
            except json.JSONDecodeError:
                corrupt = self.index_file.with_name(f"index.json.corrupt-{int(time.time())}-{uuid4().hex[:8]}")
                self.index_file.replace(corrupt)
                self._write({})
                return {}
        return raw if isinstance(raw, dict) else {}

    def _write(self, data: dict) -> None:
        self.plan_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.index_file.with_name(f".{self.index_file.name}.{uuid4().hex}.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.index_file)
