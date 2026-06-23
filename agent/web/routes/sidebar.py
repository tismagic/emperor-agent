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
    def valid_ids() -> tuple[set[str], set[str]]:
        sessions = state.loop.session_store.list(include_archived=True)
        projects = state.loop.project_store.list()
        session_ids = {str(item.get("id")) for item in sessions if item.get("id")}
        project_ids = {str(item.get("project_id")) for item in projects if item.get("project_id")}
        project_ids.update(str(item.get("project_id")) for item in sessions if item.get("project_id"))
        return project_ids, session_ids

    async def get_sidebar_state(_req: web.Request) -> web.Response:
        project_ids, session_ids = valid_ids()
        payload = state.sidebar_state.load(valid_project_ids=project_ids, valid_session_ids=session_ids)
        return web.json_response(payload, dumps=lambda v: _json.dumps(v, ensure_ascii=False))

    async def patch_sidebar_state(req: web.Request) -> web.Response:
        project_ids, session_ids = valid_ids()
        payload = state.sidebar_state.patch(
            await _body(req),
            valid_project_ids=project_ids,
            valid_session_ids=session_ids,
        )
        return web.json_response(payload, dumps=lambda v: _json.dumps(v, ensure_ascii=False))

    app.router.add_get("/api/sidebar-state", get_sidebar_state)
    app.router.add_patch("/api/sidebar-state", patch_sidebar_state)
