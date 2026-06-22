from __future__ import annotations

from aiohttp import web

from ..state import WebUIState


def register(app: web.Application, state: WebUIState) -> None:
    service = state.skill_service
    app.router.add_get("/api/tools", service.get_tools)
    app.router.add_get("/api/skills", service.get_skills)
    app.router.add_get("/api/skill", service.get_skill)
    app.router.add_post("/api/skill", service.post_skill)
    app.router.add_delete("/api/skill", service.delete_skill)
    app.router.add_post("/api/skills/import", service.import_skills)
