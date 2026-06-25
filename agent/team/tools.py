from __future__ import annotations

from typing import Any

from ..tools.base import Tool

_BOOLEAN = {"type": "boolean", "description": "是否立即唤醒目标队友执行"}


class _TeamTool(Tool):
    requires_runtime_context = True

    def __init__(self, manager, *, sender: str = "lead", actor: str = "lead",
                 allow_wake: bool = True):
        self.manager = manager
        self.sender = sender
        self.actor = actor
        self.allow_wake = allow_wake


class TeamSpawnTool(_TeamTool):
    name = "spawn_teammate"
    description = (
        "创建或唤回一个持久队友。队友会写入 .team/config.json，并拥有独立收件箱和会话；"
        "仅当用户需要长期协作角色时使用，短期探索优先 dispatch_subagent。"
    )
    exclusive = True

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "队友名称，例如 alice"},
                "role": {"type": "string", "description": "队友角色，例如 coder/reviewer/researcher"},
                "task": {"type": ["string", "null"], "description": "初始任务；为空则只创建队友"},
                "agent_type": {"type": ["string", "null"], "description": "可选子代理身份覆盖"},
            },
            "required": ["name", "role"],
        }

    def execute(self, name: str, role: str, task: str | None = None,
                agent_type: str | None = None, emit=None, loop=None,
                parent_call_id=None) -> str:
        return self.manager.spawn_teammate(
            name=name,
            role=role,
            task=task,
            agent_type=agent_type,
            sender=self.sender,
            emit=emit,
            loop=loop,
            parent_call_id=parent_call_id,
        )


class TeamListTool(_TeamTool):
    name = "list_teammates"
    description = "列出当前队友成员、运行状态、未读消息与最近回禀。只用于查看持久队友状态，不会唤醒或修改队友。"
    read_only = True
    requires_runtime_context = False

    @property
    def parameters(self) -> dict[str, Any]:
        return {"type": "object", "properties": {}, "required": []}

    def execute(self) -> str:
        return self.manager.list_teammates()


class TeamSendMessageTool(_TeamTool):
    name = "send_message"
    description = (
        "向主控或队友发送一条收件箱消息。主控可设置 wake=true 立即唤醒目标队友；"
        "队友发送消息时不会递归唤醒其他队友。仅用于持久 Team 协作，不要替代普通用户回复。"
    )
    exclusive = True

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "接收者：lead 或队友名称"},
                "content": {"type": "string", "description": "消息内容"},
                "wake": _BOOLEAN,
            },
            "required": ["to", "content"],
        }

    def execute(self, to: str, content: str, wake: bool = True, emit=None,
                loop=None, parent_call_id=None) -> str:
        return self.manager.send_message(
            to=to,
            content=content,
            sender=self.sender,
            wake=bool(wake and self.allow_wake),
            emit=emit,
            loop=loop,
            parent_call_id=parent_call_id,
        )


class TeamReadInboxTool(_TeamTool):
    name = "read_inbox"
    description = "读取当前角色的队友收件箱。主控读取主控收件箱，队友读取自己的收件箱；只读查看消息，不应代替 send_message 发送回复。"
    exclusive = True
    requires_runtime_context = False

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "最多读取多少条未读消息，默认 20；0 表示读取全部未读",
                    "minimum": 0,
                    "maximum": 100,
                },
                "mark_read": {
                    "type": "boolean",
                    "description": "是否把读取到的消息标记为已读，默认 true",
                },
            },
            "required": [],
        }

    def execute(self, limit: int = 20, mark_read: bool = True) -> str:
        return self.manager.read_inbox(actor=self.actor, limit=limit, mark_read=mark_read)


class TeamBroadcastTool(_TeamTool):
    name = "broadcast"
    description = "向多个队友广播消息；默认发送给所有未停用队友，并可逐个唤醒执行。仅用于需要多名持久队友同步上下文的任务，不要代替普通子代理派遣。"
    exclusive = True

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "广播内容"},
                "recipients": {
                    "type": ["array", "null"],
                    "description": "队友名称列表；为空则发给所有可用队友",
                    "items": {"type": "string"},
                },
                "wake": _BOOLEAN,
            },
            "required": ["content"],
        }

    def execute(self, content: str, recipients: list[str] | None = None,
                wake: bool = True, emit=None, loop=None, parent_call_id=None) -> str:
        return self.manager.broadcast(
            content=content,
            recipients=recipients,
            wake=wake,
            emit=emit,
            loop=loop,
            parent_call_id=parent_call_id,
        )


class TeamShutdownTool(_TeamTool):
    name = "shutdown_teammate"
    description = "停用一个队友。记录会保留，但该队友不再接收新任务；属于持久状态变更，除非用户明确要求或计划批准，不要随意调用。"
    exclusive = True

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "队友名称"},
            },
            "required": ["name"],
        }

    def execute(self, name: str, emit=None, loop=None, parent_call_id=None) -> str:
        return self.manager.shutdown_teammate(name=name, emit=emit, loop=loop)
