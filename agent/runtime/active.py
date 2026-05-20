from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Any, Literal


ActiveTaskKind = Literal["turn", "scheduler", "team", "watchlist"]


@dataclass
class ActiveTaskInfo:
    id: str
    kind: ActiveTaskKind
    label: str
    started_at: float
    turn_id: str | None = None
    job_id: str | None = None
    cancelled: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "label": self.label,
            "startedAt": self.started_at,
            "turnId": self.turn_id,
            "jobId": self.job_id,
            "cancelled": self.cancelled,
        }


@dataclass
class _ActiveTask:
    info: ActiveTaskInfo
    task: asyncio.Task


class ActiveTaskRegistry:
    """Process-local registry for user-visible work that can be cancelled."""

    def __init__(self) -> None:
        self._tasks: dict[str, _ActiveTask] = {}
        self._lock = asyncio.Lock()

    async def run(
        self,
        *,
        task_id: str,
        kind: ActiveTaskKind,
        label: str,
        awaitable: Awaitable[Any],
        turn_id: str | None = None,
        job_id: str | None = None,
    ) -> Any:
        info = ActiveTaskInfo(
            id=task_id,
            kind=kind,
            label=label,
            started_at=time.time(),
            turn_id=turn_id,
            job_id=job_id,
        )
        async with self._lock:
            if task_id in self._tasks:
                if hasattr(awaitable, "close"):
                    awaitable.close()  # type: ignore[attr-defined]
                raise RuntimeError(f"active task already exists: {task_id}")
            task = asyncio.create_task(awaitable)
            self._tasks[task_id] = _ActiveTask(info=info, task=task)
        try:
            return await task
        finally:
            async with self._lock:
                current = self._tasks.get(task_id)
                if current and current.task is task:
                    self._tasks.pop(task_id, None)

    async def update(self, task_id: str, **fields: Any) -> ActiveTaskInfo | None:
        async with self._lock:
            active = self._tasks.get(task_id)
            if not active:
                return None
            for key, value in fields.items():
                if hasattr(active.info, key):
                    setattr(active.info, key, value)
            return active.info

    async def cancel(
        self,
        *,
        task_id: str | None = None,
        kind: ActiveTaskKind | None = None,
    ) -> list[ActiveTaskInfo]:
        async with self._lock:
            selected = [
                active
                for active in self._tasks.values()
                if (not task_id or active.info.id == task_id)
                and (not kind or active.info.kind == kind)
            ]
            for active in selected:
                active.info.cancelled = True
                active.task.cancel()
            return [active.info for active in selected]

    async def list(self) -> list[ActiveTaskInfo]:
        async with self._lock:
            return [active.info for active in self._tasks.values()]

    async def has_active(self) -> bool:
        async with self._lock:
            return bool(self._tasks)
