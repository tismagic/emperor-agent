from __future__ import annotations

from aiohttp import web

from ..state import WebUIState


def register(app: web.Application, state: WebUIState) -> None:
    app.router.add_get("/api/desktop-pet", state.get_desktop_pet)
    app.router.add_post("/api/desktop-pet", state.post_desktop_pet)
