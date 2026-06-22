from __future__ import annotations

import zipfile
from pathlib import Path

import pytest


def _zip(path: Path, entries: dict[str, str]) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        for name, content in entries.items():
            zf.writestr(name, content)
    return path


def _install_skill_archive(archive: Path, skills_dir: Path) -> str:
    from agent.web.services.skill_service import install_skill_archive

    return install_skill_archive(archive, skills_dir)


def test_install_skill_archive_accepts_single_safe_skill_root(tmp_path: Path) -> None:
    archive = _zip(
        tmp_path / "skill.zip",
        {
            "summarize/SKILL.md": "# Summarize\n",
            "summarize/scripts/run.py": "print('ok')\n",
        },
    )

    imported = _install_skill_archive(archive, tmp_path / "skills")

    assert imported == "summarize"
    assert (tmp_path / "skills" / "summarize" / "SKILL.md").read_text(encoding="utf-8") == "# Summarize\n"
    assert (tmp_path / "skills" / "summarize" / "scripts" / "run.py").is_file()


@pytest.mark.parametrize(
    ("entries", "message"),
    [
        ({"../evil/SKILL.md": "# bad\n"}, "unsafe path"),
        ({"/evil/SKILL.md": "# bad\n"}, "unsafe path"),
        ({"one/SKILL.md": "# one\n", "two/SKILL.md": "# two\n"}, "single root"),
        ({"summarize/README.md": "# missing\n"}, "Missing SKILL.md"),
    ],
)
def test_install_skill_archive_rejects_unsafe_or_invalid_archives(
    tmp_path: Path,
    entries: dict[str, str],
    message: str,
) -> None:
    archive = _zip(tmp_path / "skill.zip", entries)

    with pytest.raises(ValueError, match=message):
        _install_skill_archive(archive, tmp_path / "skills")

    assert not (tmp_path / "evil").exists()
    assert not (tmp_path / "skills" / "one").exists()
    assert not (tmp_path / "skills" / "two").exists()
