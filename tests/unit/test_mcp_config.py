"""Tests for MCP config loading and saving."""

import json
from pathlib import Path

import pytest

from agent.mcp.client import MCPClient
from agent.mcp.config import (
    DEFAULT_MCP_CONFIG,
    MCPConfig,
    ServerConfig,
    load_mcp_config,
    save_mcp_config,
)
from agent.tools.registry import ToolRegistry


class TestLoadMcpConfig:
    """Verify MCP config loading behavior."""

    def test_empty_config(self, tmp_path: Path) -> None:
        config = load_mcp_config(tmp_path)
        assert isinstance(config, MCPConfig)
        assert config.servers == {}
        assert config.defaults == DEFAULT_MCP_CONFIG["defaults"]

    def test_load_stdio_server(self, tmp_path: Path) -> None:
        raw = {
            "servers": {
                "fetch": {
                    "transport": "stdio",
                    "command": "uvx",
                    "args": ["mcp-server-fetch"],
                    "enabled": True,
                    "tool_overrides": {"fetch": {"read_only": True, "max_result_chars": 4096}},
                }
            },
            "defaults": {"read_only": False, "exclusive": False},
        }
        (tmp_path / "mcp_config.json").write_text(json.dumps(raw))
        config = load_mcp_config(tmp_path)
        assert "fetch" in config.servers
        server = config.servers["fetch"]
        assert server.transport == "stdio"
        assert server.command == "uvx"
        assert server.args == ("mcp-server-fetch",)
        assert server.enabled is True
        assert server.tool_overrides == {"fetch": {"read_only": True, "max_result_chars": 4096}}

    def test_load_sse_server(self, tmp_path: Path) -> None:
        raw = {
            "servers": {
                "remote": {
                    "transport": "sse",
                    "url": "http://localhost:3001/sse",
                    "headers": {"Authorization": "Bearer token"},
                    "enabled": False,
                }
            },
        }
        (tmp_path / "mcp_config.json").write_text(json.dumps(raw))
        config = load_mcp_config(tmp_path)
        server = config.servers["remote"]
        assert server.transport == "sse"
        assert server.url == "http://localhost:3001/sse"
        assert server.headers == {"Authorization": "Bearer token"}
        assert server.enabled is False

    def test_env_interpolation(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TEST_MCP_VAR", "interpolated_value")
        raw = {
            "servers": {
                "test": {
                    "transport": "stdio",
                    "command": "echo",
                    "env": {"MY_VAR": "${TEST_MCP_VAR}"},
                    "enabled": True,
                }
            },
        }
        (tmp_path / "mcp_config.json").write_text(json.dumps(raw))
        config = load_mcp_config(tmp_path)
        assert config.servers["test"].env["MY_VAR"] == "interpolated_value"

    def test_missing_env_fallback(self, tmp_path: Path) -> None:
        raw = {
            "servers": {
                "test": {
                    "transport": "stdio",
                    "command": "echo",
                    "env": {"MY_VAR": "${NONEXISTENT_VAR}"},
                    "enabled": True,
                }
            },
        }
        (tmp_path / "mcp_config.json").write_text(json.dumps(raw))
        config = load_mcp_config(tmp_path)
        assert config.servers["test"].env["MY_VAR"] == "${NONEXISTENT_VAR}"


class TestSaveMcpConfig:
    """Verify MCP config saving behavior."""

    def test_save_and_reload(self, tmp_path: Path) -> None:
        raw = {
            "servers": {
                "filesystem": {
                    "transport": "stdio",
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", str(tmp_path)],
                    "enabled": True,
                }
            },
            "defaults": {"read_only": True, "exclusive": False},
        }
        save_mcp_config(tmp_path, raw)
        config = load_mcp_config(tmp_path)
        assert "filesystem" in config.servers
        assert config.defaults["read_only"] is True

    def test_save_invalid_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="servers.*must be an object"):
            save_mcp_config(tmp_path, {"defaults": {}})


class TestDefaults:
    """Verify default values are applied correctly."""

    def test_server_defaults_to_enabled(self, tmp_path: Path) -> None:
        raw = {
            "servers": {"test": {"transport": "stdio", "command": "echo"}}
        }
        (tmp_path / "mcp_config.json").write_text(json.dumps(raw))
        config = load_mcp_config(tmp_path)
        assert config.servers["test"].enabled is True

    def test_server_defaults_to_stdio(self, tmp_path: Path) -> None:
        raw = {"servers": {"test": {"command": "echo"}}}
        (tmp_path / "mcp_config.json").write_text(json.dumps(raw))
        config = load_mcp_config(tmp_path)
        assert config.servers["test"].transport == "stdio"


class FakeConnection:
    connected = True

    async def connect(self) -> bool:
        return True

    async def list_tools(self) -> list[dict]:
        return [
            {
                "name": "search",
                "description": "Search",
                "inputSchema": {"type": "object", "properties": {}},
            },
            {
                "name": "summarize",
                "description": "Summarize",
                "inputSchema": {"type": "object", "properties": {}},
            },
        ]

    async def disconnect(self) -> None:
        self.connected = False

    async def call_tool(self, tool_name: str, arguments: dict) -> str:
        return f"{tool_name}:{arguments}"


class FakeMCPClient(MCPClient):
    def _create_connection(self, cfg: ServerConfig):  # type: ignore[override]
        return FakeConnection()


@pytest.mark.anyio
async def test_mcp_tool_result_budget_overrides_flow_to_registry(tmp_path: Path) -> None:
    raw = {
        "servers": {
            "alpha": {
                "transport": "stdio",
                "command": "fake",
                "enabled": True,
                "tool_overrides": {
                    "search": {
                        "read_only": True,
                        "max_result_chars": 1234,
                    }
                },
            }
        },
        "defaults": {
            "read_only": False,
            "exclusive": False,
            "max_result_chars": 9000,
        },
    }
    (tmp_path / "mcp_config.json").write_text(json.dumps(raw), encoding="utf-8")
    client = FakeMCPClient(tmp_path)
    registry = ToolRegistry()

    await client.initialize()
    for tool in client.get_tools():
        registry.register(tool)

    search = registry.get("mcp_alpha_search")
    summarize = registry.get("mcp_alpha_summarize")

    assert search is not None
    assert summarize is not None
    assert search.read_only is True
    assert search.max_result_chars == 1234
    assert summarize.max_result_chars == 9000
    assert registry.tool_result_limits() == {
        "mcp_alpha_search": 1234,
        "mcp_alpha_summarize": 9000,
    }
