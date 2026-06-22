from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from aiohttp import web

from ...mcp.config import load_mcp_config, save_mcp_config

if TYPE_CHECKING:
    from ..state import WebUIState


class ConfigService:
    def __init__(self, state: WebUIState):
        self.state = state

    async def get_config(self, request: web.Request) -> web.Response:
        return self.state._json(self.read_user_config())

    async def post_config(self, request: web.Request) -> web.Response:
        body = await self.state._body(request)
        data = self.write_user_config(str(body.get("content") or ""))
        return self.state._json(data)

    async def get_mcp_config(self, request: web.Request) -> web.Response:
        config = load_mcp_config(self.state.root)
        raw: dict[str, Any] = {"servers": {}, "defaults": config.defaults}
        for name, server in config.servers.items():
            raw["servers"][name] = {
                "transport": server.transport,
                "command": server.command,
                "args": list(server.args),
                "env": server.env,
                "url": server.url,
                "headers": server.headers,
                "enabled": server.enabled,
                "tool_overrides": server.tool_overrides,
            }
        return self.state._json(raw)

    async def post_mcp_config(self, request: web.Request) -> web.Response:
        body = await self.state._body(request)
        if not isinstance(body.get("servers"), dict):
            raise web.HTTPBadRequest(reason="mcp_config: 'servers' must be an object")
        save_mcp_config(self.state.root, body)
        self.state.loop.close_mcp()
        self.state.loop.registry.unregister_mcp_tools()
        self.state.loop.init_mcp()
        return self.state._json({"saved": True})

    def read_user_config(self) -> dict[str, str]:
        path = user_config_path(self.state.root)
        return {"path": "templates/USER.local.md", "content": path.read_text(encoding="utf-8")}

    def write_user_config(self, content: str) -> dict[str, str]:
        path = user_config_path(self.state.root)
        path.write_text(content.rstrip() + "\n", encoding="utf-8")
        self.state.loop.refresh_runtime_context()
        return self.read_user_config()


def ensure_tool_config(root: Path) -> None:
    path = root / "templates" / "TOOL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return
    path.write_text(
        "# 工具配置\n\n"
        "记录工具使用偏好、权限边界和默认工作方式。\n\n"
        "## 默认原则\n\n"
        "- 优先使用最小权限工具。\n"
        "- 简单检索优先使用 `grep` / `glob`。\n"
        "- 修改文件前先确认目标和影响范围。\n"
        "- 子代理适合独立、可并行、上下文较重的差事。\n",
        encoding="utf-8",
    )


def user_config_path(root: Path) -> Path:
    template = root / "templates" / "init" / "USER.md"
    local = root / "templates" / "USER.local.md"
    if not local.exists() and template.exists():
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_text(template.read_text(encoding="utf-8"), encoding="utf-8")
    return local
