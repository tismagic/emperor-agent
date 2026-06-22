from __future__ import annotations

import re
import shutil
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any

from aiohttp import web

if TYPE_CHECKING:
    from ..state import WebUIState

_SKILL_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,80}$")


@dataclass(frozen=True)
class SkillArchive:
    root: str
    members: tuple[str, ...]


class SkillService:
    def __init__(self, state: WebUIState):
        self.state = state

    async def get_tools(self, request: web.Request) -> web.Response:
        return self.state._json(self.tools())

    async def get_skills(self, request: web.Request) -> web.Response:
        return self.state._json(self.skills())

    async def get_skill(self, request: web.Request) -> web.Response:
        return self.state._json(self.read_skill(request.query.get("name", "")))

    async def post_skill(self, request: web.Request) -> web.Response:
        body = await self.state._body(request)
        data = self.write_skill(str(body.get("name") or ""), str(body.get("content") or ""))
        return self.state._json(data)

    async def delete_skill(self, request: web.Request) -> web.Response:
        name = request.query.get("name", "")
        if not _safe_skill_name(name):
            raise web.HTTPBadRequest(reason="Invalid skill name")
        skill_dir = self.state.root / "skills" / name
        if not skill_dir.exists():
            raise web.HTTPNotFound(reason=f"Skill not found: {name}")
        shutil.rmtree(skill_dir)
        self.state.loop.refresh_runtime_context()
        return self.state._json({"deleted": name})

    async def import_skills(self, request: web.Request) -> web.Response:
        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != "file":
            raise web.HTTPBadRequest(reason="Expected multipart field 'file'")
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        try:
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                tmp.write(chunk)
            tmp.close()
            try:
                root = install_skill_archive(Path(tmp.name), self.state.root / "skills")
            except ValueError as exc:
                raise web.HTTPBadRequest(reason=str(exc)) from exc
            self.state.loop.refresh_runtime_context()
            return self.state._json({"imported": root})
        finally:
            Path(tmp.name).unlink(missing_ok=True)

    def tools(self) -> list[dict[str, Any]]:
        out = []
        for definition in self.state.loop.registry.get_definitions():
            tool = self.state.loop.registry.get(definition["name"])
            is_mcp = definition["name"].startswith("mcp_")
            server = ""
            if is_mcp:
                parts = definition["name"].split("_", 2)
                server = parts[1] if len(parts) >= 2 else ""
            out.append({
                "name": definition["name"],
                "description": definition["description"],
                "parameters": definition["input_schema"],
                "read_only": bool(getattr(tool, "read_only", False)),
                "exclusive": bool(getattr(tool, "exclusive", False)),
                "concurrency_safe": bool(getattr(tool, "concurrency_safe", False)),
                "source": "mcp" if is_mcp else "builtin",
                "server": server,
            })
        return out

    def skills(self) -> list[dict[str, Any]]:
        items = []
        for name, skill in sorted(self.state.loop.skills.skills.items()):
            path = Path(skill["path"])
            items.append({
                "name": name,
                "description": skill["meta"].get("description", ""),
                "path": path.resolve().relative_to(self.state.root).as_posix(),
                "tags": skill["meta"].get("tags", ""),
                "always": bool(skill["meta"].get("always", False)),
            })
        return items

    def read_skill(self, name: str) -> dict[str, Any]:
        skill = self.state.loop.skills.skills.get(name)
        if not skill:
            raise web.HTTPNotFound(reason=f"Skill not found: {name}")
        path = Path(skill["path"])
        return {
            "name": name,
            "path": path.resolve().relative_to(self.state.root).as_posix(),
            "content": path.read_text(encoding="utf-8"),
        }

    def write_skill(self, name: str, content: str) -> dict[str, Any]:
        if not _safe_skill_name(name):
            raise web.HTTPBadRequest(reason="Skill name must be a safe directory name")
        skill_dir = self.state.root / "skills" / name
        skill_dir.mkdir(parents=True, exist_ok=True)
        path = skill_dir / "SKILL.md"
        path.write_text(content.rstrip() + "\n", encoding="utf-8")
        self.state.loop.refresh_runtime_context()
        return self.read_skill(name)


def install_skill_archive(archive_path: Path, skills_dir: Path) -> str:
    archive = inspect_skill_archive(archive_path)
    skills_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".skill-import-", dir=skills_dir) as tmp_dir:
        stage_dir = Path(tmp_dir)
        _extract_validated_archive(archive_path, stage_dir, archive)
        target = skills_dir / archive.root
        backup = _replace_directory(stage_dir / archive.root, target)
        if backup is not None:
            shutil.rmtree(backup)
    return archive.root


def inspect_skill_archive(archive_path: Path) -> SkillArchive:
    try:
        with zipfile.ZipFile(archive_path, "r") as zf:
            members = [_normalize_zip_member(info.filename) for info in zf.infolist()]
    except zipfile.BadZipFile as exc:
        raise ValueError("Invalid zip file") from exc

    members = [member for member in members if member]
    if not members:
        raise ValueError("Empty zip file")

    roots = {PurePosixPath(member).parts[0] for member in members}
    if len(roots) != 1:
        raise ValueError("Skill archive must contain a single root directory")
    root = next(iter(roots))
    if not _safe_skill_name(root):
        raise ValueError(f"Invalid skill root directory: {root}")
    if f"{root}/SKILL.md" not in members:
        raise ValueError(f"Missing SKILL.md in zip root ({root})")
    return SkillArchive(root=root, members=tuple(members))


def _extract_validated_archive(
    archive_path: Path,
    stage_dir: Path,
    archive: SkillArchive,
) -> None:
    allowed = set(archive.members)
    with zipfile.ZipFile(archive_path, "r") as zf:
        for info in zf.infolist():
            member = _normalize_zip_member(info.filename)
            if not member or member not in allowed:
                continue
            target = stage_dir / member
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)


def _replace_directory(source: Path, target: Path) -> Path | None:
    backup: Path | None = None
    if target.exists():
        backup = target.with_name(f".{target.name}.bak-{uuid.uuid4().hex}")
        target.rename(backup)
    try:
        source.rename(target)
    except BaseException:
        if backup is not None and not target.exists():
            backup.rename(target)
        raise
    return backup


def _normalize_zip_member(raw: str) -> str:
    name = raw.replace("\\", "/").strip()
    if not name:
        return ""
    path = PurePosixPath(name)
    if path.is_absolute():
        raise ValueError(f"unsafe path in skill zip: {raw}")
    parts = path.parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"unsafe path in skill zip: {raw}")
    return path.as_posix().rstrip("/")


def _safe_skill_name(name: str | None) -> bool:
    return bool(name and _SKILL_RE.match(name))
