from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from agent.projects.store import PROJECT_MEMORY_END, PROJECT_MEMORY_START, ProjectStore


def test_project_store_resolves_path_and_creates_agents_block(tmp_path: Path) -> None:
    project_dir = tmp_path / "demo-project"
    project_dir.mkdir()
    store = ProjectStore(tmp_path)

    entry = store.resolve(project_dir)

    expected_id = hashlib.sha256(str(project_dir.resolve()).encode("utf-8")).hexdigest()[:16]
    assert entry["project_id"] == expected_id
    assert entry["project_path"] == str(project_dir.resolve())
    assert entry["project_name"] == "demo-project"
    assert entry["summary"] == ""

    agents = project_dir / "AGENTS.md"
    text = agents.read_text(encoding="utf-8")
    assert PROJECT_MEMORY_START in text
    assert PROJECT_MEMORY_END in text

    index = json.loads((tmp_path / "memory" / "projects" / "index.json").read_text(encoding="utf-8"))
    assert index[0]["project_id"] == expected_id


def test_project_store_preserves_existing_agents_content_and_updates_managed_block(tmp_path: Path) -> None:
    project_dir = tmp_path / "existing"
    project_dir.mkdir()
    agents = project_dir / "AGENTS.md"
    agents.write_text("# Existing Rules\n\n- keep this line\n", encoding="utf-8")
    store = ProjectStore(tmp_path)
    entry = store.resolve(project_dir)

    updated = store.update_memory(
        entry["project_id"],
        "## 项目情况\n\n- 使用 Vue + Python。\n- 最近在做 Build 模式。",
    )

    text = agents.read_text(encoding="utf-8")
    assert "# Existing Rules" in text
    assert "- keep this line" in text
    assert "使用 Vue + Python" in text
    assert text.count(PROJECT_MEMORY_START) == 1
    assert text.count(PROJECT_MEMORY_END) == 1
    assert updated["summary"] == "使用 Vue + Python；最近在做 Build 模式"


def test_project_store_rejects_missing_directory(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)

    with pytest.raises(ValueError, match="project path must be an existing directory"):
        store.resolve(tmp_path / "missing")
