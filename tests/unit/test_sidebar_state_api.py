from __future__ import annotations

import asyncio
import json
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from agent.sessions.store import SessionStore
from agent.sidebar_state import SidebarStateStore


def test_sidebar_state_api_loads_and_patches_local_state(tmp_path: Path) -> None:
    from agent.web.routes.sidebar import register

    class FakeLoop:
        def __init__(self) -> None:
            self.session_store = SessionStore(tmp_path)
            self.project_store = _ProjectStore()

    class FakeState:
        def __init__(self) -> None:
            self.loop = FakeLoop()
            self.sidebar_state = SidebarStateStore(tmp_path)

    async def run() -> None:
        state = FakeState()
        session = state.loop.session_store.create("Chat")
        app = web.Application()
        register(app, state)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            patch_resp = await client.patch(
                "/api/sidebar-state",
                data=json.dumps({"chat_sort": "manual", "chat_order": [session["id"], "missing"]}),
            )
            assert patch_resp.status == 200
            patched = await patch_resp.json()
            assert patched["chat_sort"] == "manual"
            assert patched["chat_order"] == [session["id"]]

            get_resp = await client.get("/api/sidebar-state")
            assert get_resp.status == 200
            loaded = await get_resp.json()
            assert loaded["chat_order"] == [session["id"]]
        finally:
            await client.close()

    asyncio.run(run())


class _ProjectStore:
    def list(self) -> list[dict]:
        return []
