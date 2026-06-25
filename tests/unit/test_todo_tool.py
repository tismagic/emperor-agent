from __future__ import annotations

from agent.runner_helpers import _render_todos
from agent.tools.todo import TodoStore, UpdateTodosTool


def test_todo_store_preserves_active_form_and_renders_it_for_in_progress() -> None:
    store = TodoStore()

    result = store.update([
        {
            "id": 1,
            "content": "运行测试",
            "active_form": "正在运行测试",
            "status": "in_progress",
        },
        {"id": 2, "content": "整理结果", "status": "pending"},
    ])

    assert store.todos[0]["active_form"] == "正在运行测试"
    assert "[~] 1. 正在运行测试" in result
    assert "[ ] 2. 整理结果" in result


def test_todo_store_uses_content_for_completed_even_with_active_form() -> None:
    store = TodoStore()

    result = store.update([
        {
            "id": 1,
            "content": "运行测试",
            "active_form": "正在运行测试",
            "status": "completed",
        },
    ])

    assert "[x] 1. 运行测试" in result
    assert "正在运行测试" not in result


def test_todo_tool_schema_accepts_active_form() -> None:
    tool = UpdateTodosTool(TodoStore())

    item_schema = tool.parameters["properties"]["todos"]["items"]

    assert "active_form" in item_schema["properties"]
    assert item_schema["properties"]["active_form"]["type"] == ["string", "null"]


def test_todo_store_rejects_multiple_in_progress_with_active_form() -> None:
    store = TodoStore()

    result = store.update([
        {"id": 1, "content": "A", "active_form": "Doing A", "status": "in_progress"},
        {"id": 2, "content": "B", "active_form": "Doing B", "status": "in_progress"},
    ])

    assert "Error: 同一时间只能有一个 in_progress" in result


def test_runner_todo_render_uses_active_form_for_in_progress() -> None:
    assert "[~] 1. 正在运行测试" in _render_todos([
        {
            "id": 1,
            "content": "运行测试",
            "active_form": "正在运行测试",
            "status": "in_progress",
        }
    ])
