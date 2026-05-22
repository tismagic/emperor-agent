from __future__ import annotations

import asyncio

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from agent.web.routes.desktop_pet import register


class FakeDesktopPetState:
    def __init__(self) -> None:
        self.payload = {
            "enabled": False,
            "autoStartWithWebui": True,
            "running": False,
            "pid": None,
            "lastError": None,
            "installCommand": "cd desktop-pet && npm install",
        }

    async def get_desktop_pet(self, request: web.Request) -> web.Response:
        return web.json_response(self.payload)

    async def post_desktop_pet(self, request: web.Request) -> web.Response:
        body = await request.json()
        if "enabled" not in body:
            raise web.HTTPBadRequest(reason="desktop-pet: 'enabled' is required")
        if not isinstance(body["enabled"], bool):
            raise web.HTTPBadRequest(reason="desktop-pet: 'enabled' must be a boolean")
        self.payload = {
            **self.payload,
            "enabled": bool(body["enabled"]),
            "running": bool(body["enabled"]),
            "pid": 1234 if body["enabled"] else None,
        }
        return web.json_response(self.payload)


def test_desktop_pet_routes_read_start_stop_and_bad_payload() -> None:
    async def scenario() -> None:
        state = FakeDesktopPetState()
        app = web.Application()
        register(app, state)  # type: ignore[arg-type]
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            response = await client.get("/api/desktop-pet")
            assert response.status == 200
            assert (await response.json())["enabled"] is False

            response = await client.post("/api/desktop-pet", json={"enabled": True})
            data = await response.json()
            assert response.status == 200
            assert data["enabled"] is True
            assert data["running"] is True

            response = await client.post("/api/desktop-pet", json={"enabled": False})
            data = await response.json()
            assert response.status == 200
            assert data["enabled"] is False
            assert data["running"] is False

            response = await client.post("/api/desktop-pet", json={})
            assert response.status == 400

            response = await client.post("/api/desktop-pet", json={"enabled": "true"})
            assert response.status == 400
        finally:
            await client.close()

    asyncio.run(scenario())
