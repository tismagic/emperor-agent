from __future__ import annotations

import asyncio

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from agent.plans.models import PlanRecord, PlanStatus, PlanStep
from agent.plans.store import PlanStore
from agent.web.routes import plans


class FakeContainer:
    def __init__(self, store: PlanStore) -> None:
        self.plan_store = store


def test_plan_routes_list_and_get_records(tmp_path) -> None:
    async def scenario() -> None:
        store = PlanStore(tmp_path)
        store.save(
            PlanRecord(
                id="plan_1",
                title="Build feature",
                summary="Two steps",
                status=PlanStatus.APPROVED.value,
                created_at=1.0,
                updated_at=2.0,
                steps=[PlanStep(id="step_1", title="Run tests")],
            )
        )
        app = web.Application()
        app["container"] = FakeContainer(store)
        plans.register(app, None)  # type: ignore[arg-type]
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            list_response = await client.get("/api/plans")
            list_data = await list_response.json()
            assert list_response.status == 200
            assert list_data["plans"][0]["id"] == "plan_1"

            detail_response = await client.get("/api/plans/plan_1")
            detail_data = await detail_response.json()
            assert detail_response.status == 200
            assert detail_data["plan"]["steps"][0]["title"] == "Run tests"
        finally:
            await client.close()

    asyncio.run(scenario())
