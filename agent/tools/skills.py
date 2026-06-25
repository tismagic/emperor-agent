from __future__ import annotations

from loguru import logger

from .base import Tool
from .schema import StringSchema, tool_parameters_schema


class LoadSkill(Tool):
    name = "load_skill"
    description = (
        "按名称加载指定 Skill 的详细知识内容。用户显式选择 Skill 或任务明显匹配某个 Skill 时先调用；不要绕过本工具直接 read_file 读取 SKILL.md。"
        "加载失败时报告缺失或名称不匹配，不要编造 Skill 内容。"
    )
    read_only = True

    def __init__(self, skills_loader):
        self._loader = skills_loader

    @property
    def parameters(self) -> dict:
        return tool_parameters_schema(
            skill_name=StringSchema(
                "技能名称，必须是系统提示中列出的可用技能之一"
            ),
        )

    def execute(self, skill_name: str) -> str:
        logger.info(f"[加载技能]: {skill_name}")
        return self._loader.get_content(skill_name)
