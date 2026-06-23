from __future__ import annotations

from typing import TYPE_CHECKING, Any

from aiohttp import web

if TYPE_CHECKING:
    from ..state import WebUIState


class TeamService:
    def __init__(self, state: WebUIState):
        self.state = state

    async def get_team(self, request: web.Request) -> web.Response:
        return self.state._json(self.team())

    async def get_team_member(self, request: web.Request) -> web.Response:
        name = request.match_info.get("name", "")
        manager = getattr(self.state.loop, "team_manager", None)
        if manager is None:
            return self.state._json({"error": "Team is only available inside Build project sessions"}, status=404)
        try:
            return self.state._json(manager.member_payload(name))
        except ValueError as exc:
            return self.state._json({"error": str(exc)}, status=404)

    async def post_team_member(self, request: web.Request) -> web.Response:
        raise web.HTTPGone(reason="Team is managed automatically by Build project sessions")

    async def post_team_message(self, request: web.Request) -> web.Response:
        raise web.HTTPGone(reason="Team is managed automatically by Build project sessions")

    async def post_team_wake(self, request: web.Request) -> web.Response:
        raise web.HTTPGone(reason="Team is managed automatically by Build project sessions")

    async def post_team_shutdown(self, request: web.Request) -> web.Response:
        raise web.HTTPGone(reason="Team is managed automatically by Build project sessions")

    def team(self) -> dict[str, Any]:
        manager = getattr(self.state.loop, "team_manager", None)
        project_id = getattr(self.state.loop, "_active_project_id", None)
        if manager is None:
            return {
                "managed": True,
                "scope": "chat",
                "project_id": None,
                "config": {"team_name": "none", "members": []},
                "members": [],
                "leadUnread": 0,
                "leadInbox": [],
            }
        payload = manager.payload()
        payload["managed"] = True
        payload["scope"] = "project"
        payload["project_id"] = project_id
        return payload
