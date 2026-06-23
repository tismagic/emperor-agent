from __future__ import annotations

import json as _json

from aiohttp import web


async def _body(request: web.Request) -> dict:
    if not request.can_read_body:
        return {}
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except _json.JSONDecodeError:
        return {}


def register(app: web.Application, state) -> None:
    async def list_projects(_req: web.Request) -> web.Response:
        return web.json_response(
            state.loop.project_store.list(),
            dumps=lambda v: _json.dumps(v, ensure_ascii=False),
        )

    async def resolve_project(req: web.Request) -> web.Response:
        body = await _body(req)
        path = str(body.get("path") or "").strip()
        if not path:
            raise web.HTTPBadRequest(reason="path is required")
        try:
            project = state.loop.project_store.resolve(path)
        except ValueError as exc:
            raise web.HTTPBadRequest(reason=str(exc)) from exc
        state.loop.refresh_runtime_context()
        return web.json_response(project, dumps=lambda v: _json.dumps(v, ensure_ascii=False))

    app.router.add_get("/api/projects", list_projects)
    app.router.add_post("/api/projects/resolve", resolve_project)
