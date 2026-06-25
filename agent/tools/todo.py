from __future__ import annotations

from loguru import logger

from .base import Tool
from .schema import (
    ArraySchema,
    IntegerSchema,
    ObjectSchema,
    StringSchema,
    tool_parameters_schema,
)

_VALID_STATUS = ("pending", "in_progress", "completed", "blocked")
_STATUS_ICON = {"pending": "[ ]", "in_progress": "[~]", "completed": "[x]", "blocked": "[!]"}


def _render(todos: list[dict]) -> str:
    if not todos:
        return "(当前无待办事项)"
    lines = []
    for t in todos:
        icon = _STATUS_ICON.get(t.get("status", "pending"), "[?]")
        label = t.get("content", "")
        if t.get("status") == "in_progress" and t.get("active_form"):
            label = t.get("active_form", "")
        lines.append(f"  {icon} {t.get('id')}. {label}")
    return "\n".join(lines)


class TodoStore:
    """跨用户回合存活的待办列表。不进入 history, compactor 不会丢失。"""

    def __init__(self):
        self.todos: list[dict] = []

    def update(self, items: list[dict]) -> str:
        cleaned: list[dict] = []
        for i, t in enumerate(items, start=1):
            content = (t.get("content") or "").strip()
            if not content:
                continue
            status = t.get("status", "pending")
            if status not in _VALID_STATUS:
                status = "pending"
            item = {
                "id": t.get("id", i),
                "content": content,
                "status": status,
            }
            plan_step_id = str(t.get("plan_step_id") or "").strip()
            if plan_step_id:
                item["plan_step_id"] = plan_step_id[:64]
            active_form = str(t.get("active_form") or "").strip()
            if active_form:
                item["active_form"] = active_form[:240]
            blocked_reason = str(t.get("blocked_reason") or "").strip()
            if blocked_reason:
                item["blocked_reason"] = blocked_reason[:1000]
            cleaned.append(item)

        in_progress_count = sum(1 for t in cleaned if t["status"] == "in_progress")
        if in_progress_count > 1:
            return "Error: 同一时间只能有一个 in_progress 任务，请重新规划。"

        self.todos = cleaned
        logger.info(f"\n[计划已更新]\n{_render(self.todos)}\n")

        completed = sum(1 for t in self.todos if t["status"] == "completed")
        pending = sum(1 for t in self.todos if t["status"] == "pending")
        summary = (
            f"todos updated: total={len(self.todos)}, completed={completed}, "
            f"in_progress={in_progress_count}, pending={pending}"
        )
        return summary + "\n\n当前列表：\n" + _render(self.todos)

    def sync_from_plan_steps(self, steps: list[dict]) -> str:
        status_map = {
            "pending": "pending",
            "active": "in_progress",
            "done": "completed",
            "failed": "pending",
            "blocked": "pending",
            "skipped": "completed",
        }
        todos: list[dict] = []
        for index, step in enumerate(steps, start=1):
            title = str(step.get("title") or "").strip()
            if not title:
                continue
            todos.append({
                "id": index,
                "plan_step_id": str(step.get("id") or "").strip() or None,
                "content": title,
                "status": status_map.get(str(step.get("status") or "pending"), "pending"),
                **(
                    {"blocked_reason": str(step.get("blocked_reason") or "").strip()}
                    if step.get("blocked_reason")
                    else {}
                ),
            })
        return self.update(todos)

    def render(self) -> str:
        return _render(self.todos)


class UpdateTodosTool(Tool):
    name = "update_todos"
    description = (
        "创建或更新当前任务清单。"
        "每次传入完整 todos 数组并全量覆盖，用于拆解多步骤任务和推进状态；"
        "同一时间最多只能有一个 in_progress 项。"
        "复杂任务开始前先建清单，开始步骤前标记 in_progress 并可填写 active_form，完成后立即标记 completed；"
        "验证失败或阻塞时不要标 completed。"
    )

    def __init__(self, store: TodoStore):
        self._store = store

    @property
    def parameters(self) -> dict:
        return tool_parameters_schema(
            todos=ArraySchema(
                "完整的 todo 列表，按执行顺序排列",
                items=ObjectSchema(
                    "单条待办",
                    properties={
                        "id": IntegerSchema("序号，从 1 开始"),
                        "plan_step_id": StringSchema(
                            "可选 PlanStep id，用于与批准计划中的步骤精确对齐",
                            max_length=64,
                            nullable=True,
                        ),
                        "content": StringSchema("这一步要做什么"),
                        "active_form": StringSchema(
                            "可选正在执行态文案，例如 '正在运行测试'；status=in_progress 时用于展示当前动作",
                            max_length=240,
                            nullable=True,
                        ),
                        "status": StringSchema(
                            "状态",
                            enum=list(_VALID_STATUS),
                        ),
                        "blocked_reason": StringSchema(
                            "当 status=blocked 时必填，说明等待的输入、权限、成本或外部条件",
                            max_length=1000,
                            nullable=True,
                        ),
                    },
                    required=["id", "content", "status"],
                ),
            ),
        )

    def execute(self, todos: list[dict]) -> str:
        return self._store.update(todos)
