from __future__ import annotations

from pathlib import Path

from agent.tools.filesystem import ReadFileTool
from agent.tools.shell import RunCommand
from agent.workspace import WorkspaceContext


def test_workspace_context_retargets_file_tools_and_blocks_parent_escape(tmp_path: Path) -> None:
    default_root = tmp_path / "default"
    project_root = tmp_path / "project"
    default_root.mkdir()
    project_root.mkdir()
    (default_root / "note.txt").write_text("default workspace", encoding="utf-8")
    (project_root / "note.txt").write_text("project workspace", encoding="utf-8")

    workspace = WorkspaceContext(default_root)
    tool = ReadFileTool(workspace)

    assert "default workspace" in tool.execute("note.txt")

    workspace.set(project_root)

    assert "project workspace" in tool.execute("note.txt")
    assert "Path outside workspace" in tool.execute("../default/note.txt")


def test_workspace_context_retargets_shell_cwd(tmp_path: Path) -> None:
    default_root = tmp_path / "default"
    project_root = tmp_path / "project"
    default_root.mkdir()
    project_root.mkdir()
    workspace = WorkspaceContext(default_root)
    tool = RunCommand(workspace)

    assert tool.execute("pwd") == str(default_root)

    workspace.set(project_root)

    assert tool.execute("pwd") == str(project_root)
