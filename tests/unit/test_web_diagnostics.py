from __future__ import annotations

import asyncio

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from agent.web.app import error_middleware
from agent.web.routes.diagnostics import register


class FakeDiagnosticsService:
    async def get_diagnostics(self, request: web.Request) -> web.Response:
        return web.json_response({"ok": True, "external": {"exists": True}})


class FakeState:
    def __init__(self) -> None:
        self.diagnostics_service = FakeDiagnosticsService()


async def _boom(request: web.Request) -> web.Response:
    raise RuntimeError("secret internal path /tmp/private")


def test_diagnostics_route_returns_payload() -> None:
    async def scenario() -> None:
        app = web.Application()
        register(app, FakeState())  # type: ignore[arg-type]
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            response = await client.get("/api/diagnostics")
            data = await response.json()
            assert response.status == 200
            assert data["ok"] is True
        finally:
            await client.close()

    asyncio.run(scenario())


def test_api_error_middleware_hides_internal_exception_text() -> None:
    async def scenario() -> None:
        app = web.Application(middlewares=[error_middleware])
        app.router.add_get("/api/boom", _boom)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            response = await client.get("/api/boom")
            data = await response.json()
            assert response.status == 500
            assert data["error"] == "Internal server error"
            assert "errorId" in data
            assert "secret internal path" not in str(data)
        finally:
            await client.close()

    asyncio.run(scenario())
