from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

_UTC8 = timezone(timedelta(hours=8))
_VERSION = 1

PROJECT_MEMORY_START = "<!-- emperor-agent:project-memory:start -->"
PROJECT_MEMORY_END = "<!-- emperor-agent:project-memory:end -->"
_DEFAULT_BLOCK = "## Emperor Agent Project Memory\n\n- 尚未记录项目情况。"


class ProjectStore:
    """Local project registry and AGENTS.md managed memory block."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self.projects_dir = self.root / "memory" / "projects"
        self.index_path = self.projects_dir / "index.json"

    def resolve(self, path: str | Path) -> dict[str, Any]:
        project_path = Path(path).expanduser().resolve()
        if not project_path.exists() or not project_path.is_dir():
            raise ValueError("project path must be an existing directory")
        self._ensure_agents(project_path)
        entry = self._entry_for_path(project_path)
        loaded = self._load()
        items = [item for item in loaded if item.get("project_id") != entry["project_id"]]
        existing = next((item for item in loaded if item.get("project_id") == entry["project_id"]), {})
        entry["summary"] = str(existing.get("summary") or "")
        entry["created_at"] = str(existing.get("created_at") or entry["created_at"])
        items.append(entry)
        self._save_sorted(items)
        return dict(entry)

    def get(self, project_id: str) -> dict[str, Any] | None:
        for item in self._load():
            if item.get("project_id") == project_id:
                return dict(item)
        return None

    def list(self) -> list[dict[str, Any]]:
        return sorted(self._load(), key=lambda item: str(item.get("updated_at") or ""), reverse=True)

    def read_agents(self, project_id: str) -> str:
        entry = self.get(project_id)
        if not entry:
            return ""
        path = Path(str(entry.get("project_path") or "")) / "AGENTS.md"
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8")

    def read_managed_memory(self, project_id: str) -> str:
        return _extract_block(self.read_agents(project_id)) or ""

    def update_memory(self, project_id: str, content: str) -> dict[str, Any]:
        entry = self.get(project_id)
        if entry is None:
            raise KeyError(f"unknown project: {project_id}")
        project_path = Path(str(entry["project_path"]))
        agents_path = project_path / "AGENTS.md"
        self._ensure_agents(project_path)
        current = agents_path.read_text(encoding="utf-8")
        text = _replace_block(current, content.strip() or _DEFAULT_BLOCK)
        agents_path.write_text(text.rstrip() + "\n", encoding="utf-8")

        summary = _summarize(content)
        updated = dict(entry)
        updated["summary"] = summary
        updated["updated_at"] = self._stamp()
        items = [item for item in self._load() if item.get("project_id") != project_id]
        items.append(updated)
        self._save_sorted(items)
        return updated

    def summary_for_chat(self, *, limit: int = 8) -> str:
        lines: list[str] = []
        for item in self.list()[:limit]:
            name = str(item.get("project_name") or item.get("project_path") or "project")
            summary = str(item.get("summary") or "").strip()
            path = str(item.get("project_path") or "")
            label = f"{name} ({path})" if path else name
            lines.append(f"- {label}: {summary or '已绑定为 Build 项目'}")
        return "\n".join(lines)

    def _entry_for_path(self, project_path: Path) -> dict[str, Any]:
        project_id = hashlib.sha256(str(project_path).encode("utf-8")).hexdigest()[:16]
        now = self._stamp()
        return {
            "project_id": project_id,
            "project_path": str(project_path),
            "project_name": project_path.name or str(project_path),
            "summary": "",
            "created_at": now,
            "updated_at": now,
            "agents_path": str(project_path / "AGENTS.md"),
            "version": _VERSION,
        }

    def _ensure_agents(self, project_path: Path) -> None:
        agents_path = project_path / "AGENTS.md"
        if not agents_path.exists():
            agents_path.write_text(
                "# AGENTS.md\n\n"
                "本文件记录该项目给 Agent 的协作规则和项目记忆。\n\n"
                f"{PROJECT_MEMORY_START}\n{_DEFAULT_BLOCK}\n{PROJECT_MEMORY_END}\n",
                encoding="utf-8",
            )
            return
        text = agents_path.read_text(encoding="utf-8")
        if PROJECT_MEMORY_START in text and PROJECT_MEMORY_END in text:
            return
        agents_path.write_text(
            text.rstrip()
            + "\n\n"
            + f"{PROJECT_MEMORY_START}\n{_DEFAULT_BLOCK}\n{PROJECT_MEMORY_END}\n",
            encoding="utf-8",
        )

    def _load(self) -> list[dict[str, Any]]:
        if not self.index_path.exists():
            return []
        try:
            data = json.loads(self.index_path.read_text(encoding="utf-8") or "[]")
        except (json.JSONDecodeError, OSError):
            return []
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    def _save_sorted(self, items: list[dict[str, Any]]) -> None:
        items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.index_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(self.index_path)

    def _stamp(self) -> str:
        return datetime.now(_UTC8).strftime("%Y-%m-%dT%H:%M:%S%z")


def _extract_block(text: str) -> str | None:
    start = text.find(PROJECT_MEMORY_START)
    end = text.find(PROJECT_MEMORY_END)
    if start < 0 or end < 0 or end < start:
        return None
    body_start = start + len(PROJECT_MEMORY_START)
    return text[body_start:end].strip()


def _replace_block(text: str, content: str) -> str:
    start = text.find(PROJECT_MEMORY_START)
    end = text.find(PROJECT_MEMORY_END)
    if start < 0 or end < 0 or end < start:
        return text.rstrip() + "\n\n" + f"{PROJECT_MEMORY_START}\n{content}\n{PROJECT_MEMORY_END}"
    body_start = start + len(PROJECT_MEMORY_START)
    return text[:body_start].rstrip() + "\n" + content.strip() + "\n" + text[end:].lstrip()


def _summarize(content: str) -> str:
    lines = []
    for line in str(content or "").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        stripped = re.sub(r"^[-*+\d.)\s]+", "", stripped).strip()
        if stripped:
            lines.append(stripped)
    parts = [part.strip(" \t\r\n。；;") for part in re.split(r"[\n。；;]+", "\n".join(lines)) if part.strip(" \t\r\n。；;")]
    return "；".join(parts)[:120]
