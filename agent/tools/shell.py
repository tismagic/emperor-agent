from __future__ import annotations
import subprocess
from pathlib import Path

from loguru import logger

from .base import Tool, tool_parameters
from .schema import StringSchema, tool_parameters_schema

_DENY_PREFIXES = (
    "rm -rf /",
    "rm -rf /*",
    "mkfs.",
    "dd if=",
    "dd if=/",
    ":(){",
    "> /dev/sda",
    "> /dev/nvme",
    "curl ",
    "wget ",
)


@tool_parameters(tool_parameters_schema(
    command=StringSchema("要执行的 shell 命令"),
))
class RunCommand(Tool):
    name = "run_command"
    description = "在终端执行一条 shell 命令并返回输出"
    exclusive = True

    def __init__(self, workspace: Path | None = None):
        self._workspace = workspace

    def execute(self, command: str) -> str:
        logger.info(f"[执行命令]: {command}")

        stripped = command.lstrip()
        for prefix in _DENY_PREFIXES:
            if stripped.startswith(prefix):
                logger.warning(f"Blocked dangerous command: {command[:120]}")
                return f"Error: command refused by safety policy (matches dangerous prefix: {prefix!r})"

        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=120,
                cwd=str(self._workspace) if self._workspace else None,
            )
            output = (result.stdout or result.stderr).strip()
            logger.info(f"[命令输出]: {output[:500]}")
            return output
        except subprocess.TimeoutExpired:
            logger.warning(f"Command timed out (>120s): {command[:80]}")
            return "Error: command timed out after 120 seconds"
