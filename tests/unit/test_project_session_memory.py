from __future__ import annotations

from pathlib import Path

from agent.memory import MemoryStore
from agent.projects.store import ProjectStore
from agent.sessions.conversation import ConversationStore, ProjectSessionMemoryStore


def test_project_session_memory_writes_project_agents_without_touching_global_memory(tmp_path: Path) -> None:
    user_file = tmp_path / "templates" / "USER.local.md"
    user_file.parent.mkdir(parents=True)
    user_file.write_text("# User\n\nOriginal user preference", encoding="utf-8")
    shared = MemoryStore(tmp_path / "memory", user_file)
    shared.write_memory("# Global\n\nOriginal global memory")
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    project_store = ProjectStore(tmp_path)
    project = project_store.resolve(project_dir)
    conversation = ConversationStore(tmp_path / "sessions" / "s1")
    scoped = ProjectSessionMemoryStore(shared, conversation, project_store, project["project_id"])

    scoped.write_memory("## 项目情况\n\n- 项目使用 Electron + Vue。")
    scoped.write_user("# User\n\nShould not overwrite")
    scoped.append_episode("Should not create global episode")

    assert "Original global memory" in shared.read_memory()
    assert "Should not overwrite" not in user_file.read_text(encoding="utf-8")
    assert not list((tmp_path / "memory").glob("20*.md"))
    agents = project_dir / "AGENTS.md"
    assert "项目使用 Electron + Vue" in agents.read_text(encoding="utf-8")
