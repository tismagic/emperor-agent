"""Session CRUD endpoints. Routes are registered on the aiohttp app and
delegate to the session store already hosted on `AgentLoop`."""
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
    loop = state.loop

    async def list_sessions(req: web.Request) -> web.Response:
        include_archived = str(req.query.get("archived") or "").lower() in {"1", "true", "yes"}
        items = loop.session_store.list(include_archived=include_archived)
        return web.json_response(items, dumps=lambda v: _json.dumps(v, ensure_ascii=False))

    async def create_session(req: web.Request) -> web.Response:
        body = await _body(req)
        title = str(body.get("title", "") or "Untitled")
        mode = str(body.get("mode") or "chat")
        project = body.get("project") if isinstance(body.get("project"), dict) else None
        if mode == "build" and project is None:
            project_path = str(body.get("project_path") or "").strip()
            if not project_path:
                raise web.HTTPBadRequest(reason="Build session requires project_path")
            try:
                project = state.loop.project_store.resolve(project_path)
            except ValueError as exc:
                raise web.HTTPBadRequest(reason=str(exc)) from exc
        entry = loop.session_store.create(title, mode=mode, project=project)
        return web.json_response(entry, status=201, dumps=lambda v: _json.dumps(v, ensure_ascii=False))

    async def rename_session(req: web.Request) -> web.Response:
        sid = req.match_info["id"]
        body = await _body(req)
        if "archived" in body:
            entry = loop.session_store.archive(sid) if body.get("archived") else loop.session_store.restore(sid)
            if entry is None:
                raise web.HTTPNotFound()
            return web.json_response(entry, dumps=lambda v: _json.dumps(v, ensure_ascii=False))
        title = str(body.get("title", "")).strip()
        if not title:
            raise web.HTTPBadRequest(reason="title is required")
        ok = loop.session_store.rename(sid, title)
        if not ok:
            raise web.HTTPNotFound()
        items = loop.session_store.list(include_archived=True)
        entry = next((e for e in items if e["id"] == sid), None)
        return web.json_response(entry or {}, dumps=lambda v: _json.dumps(v, ensure_ascii=False))

    async def delete_session(req: web.Request) -> web.Response:
        sid = req.match_info["id"]
        ok = loop.session_store.delete(sid)
        if not ok:
            raise web.HTTPBadRequest(reason="cannot delete session")
        return web.json_response({"deleted": True}, dumps=lambda v: _json.dumps(v, ensure_ascii=False))

    async def activate_session(req: web.Request) -> web.Response:
        sid = req.match_info["id"]
        state.activate_session(sid)
        return web.json_response({"active": sid, "complete": True}, dumps=lambda v: _json.dumps(v, ensure_ascii=False))

    app.router.add_get("/api/sessions", list_sessions)
    app.router.add_post("/api/sessions", create_session)
    app.router.add_patch("/api/sessions/{id}", rename_session)
    app.router.add_delete("/api/sessions/{id}", delete_session)
    app.router.add_post("/api/sessions/{id}/activate", activate_session)
