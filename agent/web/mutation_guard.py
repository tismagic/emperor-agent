from __future__ import annotations

from typing import Any

from aiohttp import web

from ..control import ControlMode


def assert_web_mutation_allowed(
    control: dict[str, Any],
    *,
    area: str,
    action: str,
) -> None:
    """Apply WebUI mutation semantics that sit outside agent tool approvals."""
    pending = control.get("pending") if isinstance(control.get("pending"), dict) else None
    if pending:
        raise web.HTTPConflict(
            reason=(
                f"Cannot {action} {area} while Ask / Plan is pending; "
                "answer, approve or cancel the pending interaction first."
            )
        )
    if str(control.get("mode") or "") == ControlMode.PLAN.value:
        raise web.HTTPForbidden(
            reason=(
                f"Cannot {action} {area} in plan mode; approve or leave Plan mode "
                "before executing mutations."
            )
        )
