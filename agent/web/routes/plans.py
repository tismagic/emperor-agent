from __future__ import annotations

from aiohttp import web


def register(app: web.Application, state) -> None:
    app.router.add_get("/api/plans", list_plans)
    app.router.add_get("/api/plans/{plan_id}", get_plan)


async def list_plans(request: web.Request) -> web.Response:
    store = request.app["container"].plan_store
    return web.json_response({"plans": [item.to_dict() for item in store.list()]})


async def get_plan(request: web.Request) -> web.Response:
    store = request.app["container"].plan_store
    plan = store.get(request.match_info["plan_id"])
    if plan is None:
        raise web.HTTPNotFound(reason="plan not found")
    return web.json_response({"plan": plan.to_dict()})
