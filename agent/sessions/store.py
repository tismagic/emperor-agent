"""Session registry stored as ``sessions/index.json``.

Each session entry: ``{id, title, created_at, updated_at, preview, version}``.
"""
from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

_UTC8 = timezone(timedelta(hours=8))
_VERSION = 1


class SessionStore:
    def __init__(self, root: Path) -> None:
        self.sessions_dir = root / "sessions"
        self.index_path = self.sessions_dir / "index.json"

    # ── internal helpers ────────────────────────────────────────────
    def _load(self) -> list[dict]:
        if not self.index_path.exists():
            return []
        try:
            raw = self.index_path.read_text(encoding="utf-8").strip()
            if not raw:
                return []
            data = json.loads(raw)
            if not isinstance(data, list):
                raise ValueError("index.json must be a list")
            changed = False
            normalized = []
            for item in data:
                if not isinstance(item, dict):
                    changed = True
                    continue
                clean = self._normalize(item)
                changed = changed or clean != item
                normalized.append(clean)
            if changed:
                self._save(normalized)
            return normalized
        except (json.JSONDecodeError, ValueError, OSError):
            # Quarantine corrupt index, start fresh
            ts = datetime.now(_UTC8).strftime("%Y%m%dT%H%M%S")
            corrupt_path = self.sessions_dir / f"index.corrupt-{ts}.json"
            try:
                shutil.move(str(self.index_path), str(corrupt_path))
            except OSError:
                pass
            return []

    def _save(self, items: list[dict]) -> None:
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.index_path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(items, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        tmp.replace(self.index_path)

    def _stamp(self) -> str:
        return datetime.now(_UTC8).strftime("%Y-%m-%dT%H:%M:%S%z")

    def _dir(self, session_id: str) -> Path:
        return self.sessions_dir / session_id

    def session_dir(self, session_id: str) -> Path:
        return self._dir(session_id)

    # ── public API ──────────────────────────────────────────────────
    def list(self, *, include_archived: bool = False) -> list[dict]:
        items = self._load()
        if not include_archived:
            items = [item for item in items if not item.get("archived_at")]
        items.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return items

    def create(
        self,
        title: str = "",
        *,
        title_status: str | None = None,
        mode: str = "chat",
        project: dict | None = None,
    ) -> dict:
        now = self._stamp()
        sid = uuid.uuid4().hex[:16]
        clean_title = title.strip()
        clean_mode = "build" if mode == "build" else "chat"
        project = project or {}
        entry = {
            "id": sid,
            "title": clean_title or "Untitled",
            "created_at": now,
            "updated_at": now,
            "preview": "",
            "message_count": 0,
            "title_status": title_status or ("manual" if clean_title else "placeholder"),
            "mode": clean_mode,
            "project_id": str(project.get("project_id") or "") or None,
            "project_path": str(project.get("project_path") or "") or None,
            "project_name": str(project.get("project_name") or "") or None,
            "archived_at": None,
            "version": _VERSION,
        }
        items = self._load()
        items.append(entry)
        self._save(items)
        self._dir(sid).mkdir(parents=True, exist_ok=True)
        return entry

    def get(self, session_id: str) -> dict | None:
        for item in self._load():
            if item.get("id") == session_id:
                return item
        return None

    def delete(self, session_id: str) -> bool:
        items = self._load()
        if len(items) <= 1:
            return False
        idx = next((i for i, e in enumerate(items) if e.get("id") == session_id), None)
        if idx is None:
            return False
        del items[idx]
        self._save(items)
        shutil.rmtree(self._dir(session_id), ignore_errors=True)
        return True

    def rename(self, session_id: str, title: str) -> bool:
        items = self._load()
        for e in items:
            if e.get("id") == session_id:
                e["title"] = title.strip()
                e["updated_at"] = self._stamp()
                e["title_status"] = "manual"
                self._save(items)
                return True
        return False

    def archive(self, session_id: str) -> dict | None:
        return self._set_archived(session_id, archived=True)

    def restore(self, session_id: str) -> dict | None:
        return self._set_archived(session_id, archived=False)

    def set_generated_title(self, session_id: str, title: str) -> dict | None:
        items = self._load()
        for e in items:
            if e.get("id") == session_id:
                e["title"] = title.strip()
                e["title_status"] = "generated"
                e["updated_at"] = self._stamp()
                self._save(items)
                return dict(e)
        return None

    def touch(self, session_id: str, preview: str, *, increment_messages: bool = False) -> dict | None:
        items = self._load()
        for e in items:
            if e.get("id") == session_id:
                e["preview"] = preview[:280]
                if increment_messages:
                    e["message_count"] = int(e.get("message_count") or 0) + 1
                e["updated_at"] = self._stamp()
                self._save(items)
                return dict(e)
        return None

    def _normalize(self, item: dict) -> dict:
        clean = dict(item)
        mode = str(clean.get("mode") or "chat").strip().lower()
        if mode != "build":
            mode = "chat"
        clean["mode"] = mode
        clean.setdefault("message_count", 0)
        clean.setdefault("title_status", "manual")
        clean["project_id"] = str(clean.get("project_id") or "") or None
        clean["project_path"] = str(clean.get("project_path") or "") or None
        clean["project_name"] = str(clean.get("project_name") or "") or None
        clean["archived_at"] = str(clean.get("archived_at") or "") or None
        clean["version"] = int(clean.get("version") or _VERSION)
        return clean

    def _set_archived(self, session_id: str, *, archived: bool) -> dict | None:
        items = self._load()
        for e in items:
            if e.get("id") == session_id:
                e["archived_at"] = self._stamp() if archived else None
                e["updated_at"] = self._stamp()
                self._save(items)
                return dict(e)
        return None
