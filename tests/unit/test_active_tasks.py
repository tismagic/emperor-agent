from __future__ import annotations

import asyncio

from agent.runtime.active import ActiveTaskRegistry


def test_active_task_registry_cancels_matching_task() -> None:
    async def run() -> None:
        registry = ActiveTaskRegistry()
        started = asyncio.Event()

        async def work() -> str:
            started.set()
            await asyncio.sleep(30)
            return "done"

        task = asyncio.create_task(
            registry.run(
                task_id="turn:1",
                kind="turn",
                label="Chat turn",
                awaitable=work(),
                turn_id="turn_1",
            )
        )
        await started.wait()
        cancelled = await registry.cancel(kind="turn")

        assert len(cancelled) == 1
        assert cancelled[0].id == "turn:1"
        assert cancelled[0].cancelled is True
        try:
            await task
        except asyncio.CancelledError:
            pass
        else:
            raise AssertionError("expected registry task to be cancelled")
        assert await registry.list() == []

    asyncio.run(run())


def test_active_task_registry_updates_metadata() -> None:
    async def run() -> None:
        registry = ActiveTaskRegistry()
        started = asyncio.Event()
        release = asyncio.Event()

        async def work() -> str:
            started.set()
            await release.wait()
            return "done"

        task = asyncio.create_task(
            registry.run(
                task_id="scheduler:job_1",
                kind="scheduler",
                label="Scheduler job",
                awaitable=work(),
                job_id="job_1",
            )
        )
        await started.wait()
        info = await registry.update("scheduler:job_1", turn_id="turn_scheduler")
        release.set()

        assert info is not None
        assert info.turn_id == "turn_scheduler"
        assert await task == "done"

    asyncio.run(run())


def test_active_task_registry_supports_watchlist_kind() -> None:
    async def run() -> None:
        registry = ActiveTaskRegistry()
        started = asyncio.Event()

        async def work() -> str:
            started.set()
            await asyncio.sleep(30)
            return "done"

        task = asyncio.create_task(
            registry.run(
                task_id="watchlist:manual-check",
                kind="watchlist",
                label="Watchlist manual check",
                awaitable=work(),
            )
        )
        await started.wait()
        cancelled = await registry.cancel(kind="watchlist")

        assert len(cancelled) == 1
        assert cancelled[0].kind == "watchlist"
        try:
            await task
        except asyncio.CancelledError:
            pass
        else:
            raise AssertionError("expected watchlist task to be cancelled")

    asyncio.run(run())
