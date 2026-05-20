from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import time
import uuid
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any, Literal


MemoryVersionTarget = Literal["memory", "user", "episode"]
_DATE_EPISODE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.md$")


@dataclass
class MemoryVersion:
    id: str
    target: MemoryVersionTarget
    rel_path: str
    label: str
    reason: str
    created_at: float
    content_hash: str
    bytes: int

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "MemoryVersion":
        target = str(raw.get("target") or "memory")
        if target not in {"memory", "user", "episode"}:
            target = "memory"
        return cls(
            id=str(raw.get("id") or ""),
            target=target,  # type: ignore[arg-type]
            rel_path=str(raw.get("relPath") or raw.get("rel_path") or ""),
            label=str(raw.get("label") or ""),
            reason=str(raw.get("reason") or ""),
            created_at=float(raw.get("createdAt") or raw.get("created_at") or 0),
            content_hash=str(raw.get("contentHash") or raw.get("content_hash") or ""),
            bytes=int(raw.get("bytes") or 0),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "target": self.target,
            "relPath": self.rel_path,
            "label": self.label,
            "reason": self.reason,
            "createdAt": self.created_at,
            "contentHash": self.content_hash,
            "bytes": self.bytes,
        }


class MemoryVersionStore:
    """Lightweight local snapshot store for editable memory files."""

    def __init__(self, root: Path, memory_dir: Path, user_file: Path, *, max_versions: int = 300):
        self.root = Path(root).resolve()
        self.memory_dir = Path(memory_dir).resolve()
        self.user_file = Path(user_file).resolve()
        self.max_versions = max(1, int(max_versions))
        self.versions_dir = self.memory_dir / "versions"
        self.snapshots_dir = self.versions_dir / "snapshots"
        self.index_file = self.versions_dir / "index.json"
        self._lock = RLock()

    def snapshot_path(
        self,
        path: Path,
        *,
        target: MemoryVersionTarget | None = None,
        reason: str = "manual",
    ) -> MemoryVersion | None:
        with self._lock:
            real = Path(path).resolve()
            if not real.exists():
                return None
            resolved_target = target or self._target_for_path(real)
            if resolved_target is None:
                raise ValueError(f"memory version path is not allowed: {real}")
            content = real.read_text(encoding="utf-8")
            digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
            rel_path = self._rel(real)
            existing = self._load_index()
            latest = next((item for item in existing if item.rel_path == rel_path), None)
            if latest and latest.content_hash == digest:
                return latest
            stamp = time.time()
            version = MemoryVersion(
                id=self._new_id(stamp, digest),
                target=resolved_target,
                rel_path=rel_path,
                label=real.name,
                reason=str(reason or "manual"),
                created_at=stamp,
                content_hash=digest,
                bytes=len(content.encode("utf-8")),
            )
            self._write_snapshot(version, content)
            self._write_index([version, *existing][: self.max_versions])
            return version

    def list(self, *, limit: int = 80, target: MemoryVersionTarget | None = None) -> list[MemoryVersion]:
        with self._lock:
            items = self._load_index()
            if target:
                items = [item for item in items if item.target == target]
            return items[: max(1, int(limit))]

    def detail(self, version_id: str) -> dict[str, Any]:
        with self._lock:
            version, content = self._read_snapshot(version_id)
            current = self._current_content(version.rel_path)
            diff = "\n".join(difflib.unified_diff(
                content.splitlines(),
                current.splitlines(),
                fromfile=f"{version.rel_path}@{version.id}",
                tofile=version.rel_path,
                lineterm="",
            ))
            return {
                "version": version.to_dict(),
                "content": content,
                "currentContent": current,
                "diff": diff,
            }

    def restore(self, version_id: str) -> dict[str, Any]:
        with self._lock:
            version, content = self._read_snapshot(version_id)
            target = self._resolve_rel(version.rel_path)
            resolved_target = self._target_for_path(target)
            if resolved_target is None:
                raise ValueError(f"memory version path is not allowed: {version.rel_path}")
            self.snapshot_path(target, target=resolved_target, reason=f"pre_restore:{version.id}")
            self._atomic_write_text(target, content.rstrip() + "\n")
            return {
                "version": version.to_dict(),
                "path": version.rel_path,
                "content": target.read_text(encoding="utf-8"),
            }

    def payload(self, *, limit: int = 30) -> dict[str, Any]:
        with self._lock:
            all_items = self._load_index()
            return {
                "versions": [item.to_dict() for item in all_items[: max(1, int(limit))]],
                "count": len(all_items),
                "path": self._rel(self.index_file),
            }

    def _load_index(self) -> list[MemoryVersion]:
        if not self.index_file.exists():
            return []
        try:
            raw = json.loads(self.index_file.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError:
            corrupt = self.index_file.with_name(f"index.corrupt-{int(time.time())}.json")
            self.index_file.replace(corrupt)
            return []
        rows = raw.get("versions") if isinstance(raw, dict) else []
        out: list[MemoryVersion] = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            version = MemoryVersion.from_dict(row)
            if version.id:
                out.append(version)
        return out

    def _write_index(self, versions: list[MemoryVersion]) -> None:
        self._atomic_write_json(
            self.index_file,
            {
                "schemaVersion": 1,
                "updatedAt": time.time(),
                "versions": [item.to_dict() for item in versions],
            },
        )

    def _write_snapshot(self, version: MemoryVersion, content: str) -> None:
        self._atomic_write_json(
            self.snapshots_dir / f"{version.id}.json",
            {"version": version.to_dict(), "content": content},
        )

    def _read_snapshot(self, version_id: str) -> tuple[MemoryVersion, str]:
        safe_id = str(version_id or "").strip()
        if not re.match(r"^[a-zA-Z0-9_.-]{8,80}$", safe_id):
            raise ValueError("invalid memory version id")
        path = self.snapshots_dir / f"{safe_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"memory version not found: {safe_id}")
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or not isinstance(raw.get("version"), dict):
            raise ValueError("memory version snapshot is invalid")
        return MemoryVersion.from_dict(raw["version"]), str(raw.get("content") or "")

    def _target_for_path(self, path: Path) -> MemoryVersionTarget | None:
        real = Path(path).resolve()
        if real == (self.memory_dir / "MEMORY.local.md").resolve():
            return "memory"
        if real == self.user_file:
            return "user"
        if real.parent == self.memory_dir and _DATE_EPISODE_RE.match(real.name):
            return "episode"
        return None

    def _resolve_rel(self, rel_path: str) -> Path:
        target = (self.root / rel_path).resolve()
        if self._target_for_path(target) is None:
            raise ValueError(f"memory version path is not allowed: {rel_path}")
        return target

    def _current_content(self, rel_path: str) -> str:
        target = self._resolve_rel(rel_path)
        return target.read_text(encoding="utf-8") if target.exists() else ""

    def _rel(self, path: Path) -> str:
        try:
            return str(Path(path).resolve().relative_to(self.root))
        except ValueError:
            return str(path)

    @staticmethod
    def _new_id(stamp: float, digest: str) -> str:
        return f"memv_{int(stamp * 1000)}_{digest[:8]}_{uuid.uuid4().hex[:6]}"

    @staticmethod
    def _atomic_write_text(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with tmp.open("w", encoding="utf-8") as f:
                f.write(content)
                f.flush()
                with suppress(OSError):
                    os.fsync(f.fileno())
            tmp.replace(path)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise

    @staticmethod
    def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
        MemoryVersionStore._atomic_write_text(
            path,
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        )
