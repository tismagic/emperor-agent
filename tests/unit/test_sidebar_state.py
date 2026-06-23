from __future__ import annotations

from pathlib import Path

from agent.sidebar_state import SidebarStateStore


def test_sidebar_state_defaults_to_codex_layout(tmp_path: Path) -> None:
    store = SidebarStateStore(tmp_path)

    state = store.load()

    assert state["section_order"] == ["projects", "chats"]
    assert state["project_sort"] == "updated_at"
    assert state["chat_sort"] == "updated_at"
    assert state["project_order"] == []
    assert state["chat_order"] == []
    assert state["project_session_order"] == {}
    assert state["collapsed_project_ids"] == []
    assert (tmp_path / "memory" / "ui" / "sidebar-state.json").exists()


def test_sidebar_state_patch_merges_and_prunes_missing_ids(tmp_path: Path) -> None:
    store = SidebarStateStore(tmp_path)

    state = store.patch(
        {
            "project_sort": "manual",
            "chat_sort": "manual",
            "project_order": ["missing-project", "project-1"],
            "chat_order": ["chat-2", "missing-chat", "chat-1"],
            "project_session_order": {
                "project-1": ["build-2", "missing-build", "build-1"],
                "missing-project": ["build-1"],
            },
            "collapsed_project_ids": ["project-1", "missing-project"],
        },
        valid_project_ids={"project-1"},
        valid_session_ids={"chat-1", "chat-2", "build-1", "build-2"},
    )

    assert state["project_sort"] == "manual"
    assert state["chat_sort"] == "manual"
    assert state["project_order"] == ["project-1"]
    assert state["chat_order"] == ["chat-2", "chat-1"]
    assert state["project_session_order"] == {"project-1": ["build-2", "build-1"]}
    assert state["collapsed_project_ids"] == ["project-1"]
