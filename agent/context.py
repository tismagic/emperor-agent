from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from jinja2 import Environment, FileSystemLoader, select_autoescape
from loguru import logger

from .skills import SkillsLoader

if TYPE_CHECKING:
    from .memory import MemoryStore


_DEFAULT_MEMORY_BUDGET_CHARS = 12_000


@dataclass(frozen=True)
class ContextSection:
    name: str
    content: str
    source: str
    priority: int
    budget_chars: int | None = None
    version: str | None = None


class ContextBuilder:
    _BOOTSTRAP_FILES = ["SOUL.md", "TOOL.md", "USER.md"]

    def __init__(
        self,
        docs_dir: Path,
        skills_loader: SkillsLoader,
        memory: MemoryStore | None = None,
        *,
        memory_budget_chars: int = _DEFAULT_MEMORY_BUDGET_CHARS,
    ):
        self.docs_dir = docs_dir
        self.skills = skills_loader
        self.memory = memory
        self.memory_budget_chars = memory_budget_chars
        self.subagent_registry = None
        self._env = Environment(
            loader=FileSystemLoader(docs_dir / "agent"),
            autoescape=select_autoescape(enabled_extensions=("html",)),
        )

    def set_subagent_registry(self, subagent_registry) -> None:
        self.subagent_registry = subagent_registry

    def render_template(self, name: str, **kwargs) -> str:
        try:
            template = self._env.get_template(name)
            return template.render(**kwargs)
        except Exception:
            logger.warning(f"Template render failed: {name}")
            return ""

    def build_system_prompt(self) -> str:
        return "\n\n---\n\n".join(section.content for section in self.build_sections())

    def build_sections(self) -> list[ContextSection]:
        sections: list[ContextSection] = []

        bootstrap_parts = []
        versions = []
        for name in self._BOOTSTRAP_FILES:
            path = self._bootstrap_path(name)
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8").strip()
            bootstrap_parts.append(text)
            if version := _prompt_version(text):
                versions.append(f"{name}:{version}")
        bootstrap = "\n\n".join(bootstrap_parts)
        if bootstrap:
            sections.append(ContextSection(
                name="bootstrap",
                content=bootstrap,
                source="templates/SOUL.md+TOOL.md+USER.md",
                priority=100,
                version=", ".join(versions) or None,
            ))

        identity = self.render_template(
            "identity.md",
            workspace=str(self.docs_dir.parent),
            subagents_summary=self._subagents_summary(),
        )
        if identity:
            sections.append(ContextSection(
                name="identity",
                content=identity,
                source="templates/agent/identity.md",
                priority=90,
                version=_prompt_version(identity),
            ))

        if self.memory:
            memory = self.memory.read_memory().strip()
            if memory:
                budgeted = _clip_text(memory, self.memory_budget_chars, label="Long-term Memory")
                sections.append(ContextSection(
                    name="long_term_memory",
                    content=f"# Long-term Memory\n\n{budgeted}",
                    source=str(getattr(self.memory, "memory_file", "memory")),
                    priority=80,
                    budget_chars=self.memory_budget_chars,
                ))

        always_skills = self.skills.get_always_skills()
        if always_skills:
            always_content = self.skills.load_skills_for_context(always_skills)
            if always_content:
                sections.append(ContextSection(
                    name="active_skills",
                    content=f"# Active Skills\n\n{always_content}",
                    source="skills/*/SKILL.md",
                    priority=70,
                ))

        skills_summary = self.skills.build_skills_summary(exclude=set(always_skills))
        if skills_summary:
            skills_section = self.render_template("skills_section.md", skills_summary=skills_summary)
            sections.append(ContextSection(
                name="skills_summary",
                content=skills_section,
                source="templates/agent/skills_section.md",
                priority=60,
                version=_prompt_version(skills_section),
            ))

        return sections

    def _bootstrap_path(self, name: str) -> Path:
        if name == "USER.md":
            local = self.docs_dir / "USER.local.md"
            if local.exists():
                return local
            init = self.docs_dir / "init" / "USER.md"
            if init.exists():
                return init
        return self.docs_dir / name

    def _subagents_summary(self) -> str:
        if self.subagent_registry is None:
            return "(subagent registry not yet attached)"
        return self.subagent_registry.describe()


def _prompt_version(text: str) -> str | None:
    match = re.search(r"^Prompt-Version:\s*(.+)$", text, flags=re.MULTILINE)
    return match.group(1).strip() if match else None


def _clip_text(text: str, budget_chars: int, *, label: str) -> str:
    if budget_chars <= 0 or len(text) <= budget_chars:
        return text
    head_budget = max(1, int(budget_chars * 0.68))
    tail_budget = max(1, budget_chars - head_budget)
    omitted = len(text) - head_budget - tail_budget
    return (
        f"{text[:head_budget].rstrip()}\n\n"
        f"[{label} clipped by ContextBuilder: {omitted} chars omitted]\n\n"
        f"{text[-tail_budget:].lstrip()}"
    )
