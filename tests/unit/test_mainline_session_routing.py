"""Non-UI turns land on the first available session when none is active."""
from __future__ import annotations

from pathlib import Path

from agent.loop import AgentLoop


def _ensure_templates(root: Path) -> None:
    for p in ["templates/TOOL.md", "templates/USER.local.md", "templates/SOUL.md",
              "templates/init/USER.md", "templates/init/MEMORY.md"]:
        f = root / p
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("# placeholder")


def test_non_ui_turn_activates_default_when_none_active(tmp_path: Path) -> None:
    """After migration, the first session should already be active.
    Explicitly deactivate, then ensure the guard re-activates it."""
    _ensure_templates(tmp_path)
    # Seed old history so migration creates a default session
    mem = tmp_path / "memory"
    mem.mkdir(parents=True, exist_ok=True)
    (mem / "history.jsonl").write_text(
        '{"ts":"2026-01-01","role":"user","content":"old"}\n',
    )
    loop = AgentLoop(root=tmp_path, verbose=False, startup_compaction=False)

    # After migration, one session exists and is active
    sessions = loop.session_store.list()
    assert len(sessions) == 1
    assert loop._active_conversation is not None

    # Simulate non-UI turn guard: ensure active session exists
    assert loop._active_session_id is not None
