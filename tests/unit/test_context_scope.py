from __future__ import annotations

from pathlib import Path

from agent.context import ContextBuilder
from agent.memory import MemoryStore
from agent.skills import SkillsLoader


def _write_templates(root: Path) -> None:
    templates = root / "templates"
    (templates / "agent").mkdir(parents=True)
    (templates / "SOUL.md").write_text("# Soul", encoding="utf-8")
    (templates / "TOOL.md").write_text("# Tool", encoding="utf-8")
    (templates / "USER.local.md").write_text("# User Preference\n\nUse Chinese.", encoding="utf-8")
    (templates / "agent" / "identity.md").write_text(
        "# Identity\n\nworkspace={{ workspace }}\n{{ subagents_summary }}",
        encoding="utf-8",
    )
    (templates / "agent" / "skills_section.md").write_text(
        "# Skills\n\n{{ skills_summary }}",
        encoding="utf-8",
    )


def test_chat_context_includes_global_memory_and_project_index_summary(tmp_path: Path) -> None:
    _write_templates(tmp_path)
    memory = MemoryStore(tmp_path / "memory", tmp_path / "templates" / "USER.local.md")
    memory.write_memory("# Global Memory\n\n- prefers compact plans")
    builder = ContextBuilder(tmp_path / "templates", SkillsLoader(tmp_path / "skills"), memory=memory)
    builder.set_session_scope(
        mode="chat",
        project_index_summary="- demo-project: last build session touched UI",
    )

    prompt = builder.build_system_prompt()

    assert "prefers compact plans" in prompt
    assert "demo-project: last build session touched UI" in prompt
    assert "Project AGENTS.md" not in prompt


def test_build_context_includes_project_agents_but_not_global_memory(tmp_path: Path) -> None:
    _write_templates(tmp_path)
    memory = MemoryStore(tmp_path / "memory", tmp_path / "templates" / "USER.local.md")
    memory.write_memory("# Global Memory\n\n- private chat fact")
    builder = ContextBuilder(tmp_path / "templates", SkillsLoader(tmp_path / "skills"), memory=memory)
    builder.set_session_scope(
        mode="build",
        project_agents="# Project Rules\n\n- Build only reads this project memory.",
        project_path=str(tmp_path / "project"),
    )

    prompt = builder.build_system_prompt()

    assert "Use Chinese." in prompt
    assert "Project AGENTS.md" in prompt
    assert "Build only reads this project memory." in prompt
    assert "private chat fact" not in prompt
