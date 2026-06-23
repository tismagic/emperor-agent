from __future__ import annotations

import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

_UTC8 = timezone(timedelta(hours=8))
_SORT_MODES = {"manual", "created_at", "updated_at"}
_SECTIONS = ("projects", "chats")

DEFAULT_SIDEBAR_STATE: dict[str, Any] = {
    "section_order": ["projects", "chats"],
    "project_sort": "updated_at",
    "chat_sort": "updated_at",
    "project_order": [],
    "chat_order": [],
    "project_session_order": {},
    "collapsed_project_ids": [],
}


class SidebarStateStore:
    """Small local JSON store for Electron sidebar preferences."""

    def __init__(self, root: Path) -> None:
        self.path = root / "memory" / "ui" / "sidebar-state.json"

    def load(
        self,
        *,
        valid_project_ids: set[str] | None = None,
        valid_session_ids: set[str] | None = None,
    ) -> dict[str, Any]:
        data = self._read()
        state = self._normalize(
            data,
            valid_project_ids=valid_project_ids,
            valid_session_ids=valid_session_ids,
        )
        self._save(state)
        return state

    def patch(
        self,
        update: dict[str, Any],
        *,
        valid_project_ids: set[str] | None = None,
        valid_session_ids: set[str] | None = None,
    ) -> dict[str, Any]:
        current = self._read()
        merged = dict(current)
        for key in DEFAULT_SIDEBAR_STATE:
            if key in update:
                merged[key] = update[key]
        state = self._normalize(
            merged,
            valid_project_ids=valid_project_ids,
            valid_session_ids=valid_session_ids,
        )
        self._save(state)
        return state

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return dict(DEFAULT_SIDEBAR_STATE)
        try:
            raw = self.path.read_text(encoding="utf-8").strip()
            if not raw:
                return dict(DEFAULT_SIDEBAR_STATE)
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("sidebar state must be an object")
            return data
        except (OSError, json.JSONDecodeError, ValueError):
            ts = datetime.now(_UTC8).strftime("%Y%m%dT%H%M%S")
            corrupt = self.path.with_name(f"sidebar-state.corrupt-{ts}.json")
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(self.path), str(corrupt))
            except OSError:
                pass
            return dict(DEFAULT_SIDEBAR_STATE)

    def _save(self, state: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(self.path)

    def _normalize(
        self,
        data: dict[str, Any],
        *,
        valid_project_ids: set[str] | None,
        valid_session_ids: set[str] | None,
    ) -> dict[str, Any]:
        state = dict(DEFAULT_SIDEBAR_STATE)
        section_order = [str(x) for x in _as_list(data.get("section_order")) if str(x) in _SECTIONS]
        for section in _SECTIONS:
            if section not in section_order:
                section_order.append(section)
        state["section_order"] = section_order[: len(_SECTIONS)]
        state["project_sort"] = _sort_mode(data.get("project_sort"))
        state["chat_sort"] = _sort_mode(data.get("chat_sort"))
        state["project_order"] = _clean_ids(data.get("project_order"), valid_project_ids)
        state["chat_order"] = _clean_ids(data.get("chat_order"), valid_session_ids)
        state["collapsed_project_ids"] = _clean_ids(data.get("collapsed_project_ids"), valid_project_ids)

        project_session_order: dict[str, list[str]] = {}
        raw_project_session_order = data.get("project_session_order")
        if isinstance(raw_project_session_order, dict):
            for raw_project_id, raw_session_ids in raw_project_session_order.items():
                project_id = str(raw_project_id)
                if valid_project_ids is not None and project_id not in valid_project_ids:
                    continue
                project_session_order[project_id] = _clean_ids(raw_session_ids, valid_session_ids)
        state["project_session_order"] = project_session_order
        return state


def _sort_mode(value: Any) -> str:
    mode = str(value or "updated_at")
    return mode if mode in _SORT_MODES else "updated_at"


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _clean_ids(value: Any, valid_ids: set[str] | None) -> list[str]:
    out: list[str] = []
    for raw in _as_list(value):
        item = str(raw)
        if item in out:
            continue
        if valid_ids is not None and item not in valid_ids:
            continue
        out.append(item)
    return out
