# 06. Emperor Agent 升级路线

本路线把 Claude Code 的核心设计转化为 Emperor Agent 可逐步实施的 Epics。每个 Epic 都应独立可测、可回滚、可上线，不要求一次性重写主循环。

## 设计原则

- 不照搬 UI：不移植 React/Ink，继续使用 Vue/Electron WebUI。
- 不绑定单 provider：不把 Anthropic 专属 header、beta、thinking signature 写入核心协议。
- 不破坏现有能力：Ask/Plan、Scheduler、Team、MCP、Runtime replay 要保持兼容。
- 先加协议，再迁移行为：先让旧工具/旧 runner 通过 adapter 运行，再逐步替换内部实现。
- 后端事件为事实来源：任何长任务、工具进度、权限等待、压缩恢复都要能被 runtime event replay。

## Epic 1：Runner State Machine 拆分

目标：把 `AgentRunner.step_async()` 从单体流程拆成可测试状态机，行为保持兼容。

目标文件：

- `agent/runner.py`
- 新增 `agent/query_state/models.py`
- 新增 `agent/query_state/state_machine.py`
- 新增 `agent/query_state/transitions.py`
- 新增 `tests/test_query_state.py`

接口草案：

```python
@dataclass
class QueryState:
    history: list[dict[str, Any]]
    turn_id: str | None
    turn_count: int
    transition: str | None
    empty_retries: int = 0
    length_retries: int = 0
    paused: bool = False

@dataclass
class QueryTransition:
    reason: str
    next_state: QueryState
    emit: list[dict[str, Any]]
```

迁移顺序：

1. 抽出 transition reason 常量，不改变逻辑。
2. 抽出空响应、截断续写、todo nudge、Plan pause 的状态更新函数。
3. 为每个状态更新写单元测试。
4. `AgentRunner.step_async()` 调用这些函数，仍保留主循环。

风险：

- 暂停恢复依赖 checkpoint，拆分时容易漏写 history。
- tool_call/tool_result 配对必须保持不变。

验收：

- 现有 tests 通过。
- 新测试覆盖 empty retry、length recovery、max_turns、plan pause、todo continuation。
- WebUI 一轮普通聊天、一次工具调用、一次 Plan pause 都能恢复。

## Epic 2：Context Pipeline

目标：把请求前上下文治理从 runner 中抽出，建立分阶段预算报告。

目标文件：

- `agent/runner.py`
- 新增 `agent/context_pipeline/models.py`
- 新增 `agent/context_pipeline/pipeline.py`
- 新增 `agent/context_pipeline/tool_results.py`
- 新增 `agent/context_pipeline/pairing.py`
- 新增 `tests/test_context_pipeline.py`

接口草案：

```python
@dataclass
class ContextProjection:
    messages: list[dict[str, Any]]
    report: dict[str, Any]

class ContextPipeline:
    def project(self, history: list[dict[str, Any]]) -> ContextProjection:
        ...
```

迁移顺序：

1. 移动 `_pair_tool_calls()` 到 `pairing.py`。
2. 移动 `_cap_tool_result()` 和 `_shrink_old_tool_results()` 到 `tool_results.py`。
3. 保持默认参数完全一致。
4. 在 `AgentRunner._ask_model()` 中调用 pipeline。
5. 增加 runtime `context_projection` 事件或扩展现有 `context_usage`。
6. 增加 replacement record 持久化，确保同一工具结果在重启前后投影一致。

风险：

- 多模态 user content 不能被误截断。
- tool_calls 缺失补齐逻辑不能改变顺序。

验收：

- 同一输入 history 的模型请求消息与迁移前等价。
- 大工具结果截断、旧工具摘要、多模态保留都有测试。
- 同一 history 连续投影两次，replacement record 与模型可见消息完全一致。

## Epic 3：Tool Protocol v2

目标：为工具引入更完整协议，同时兼容现有 `Tool.execute()`。

目标文件：

- `agent/tools/base.py`
- `agent/tools/registry.py`
- 新增 `agent/tools/protocol.py`
- 新增 `agent/tools/results.py`
- 新增 `agent/tools/context.py`
- 新增 `tests/test_tool_protocol.py`

接口草案：

```python
@dataclass
class ToolResult:
    model_content: str
    display_summary: str = ""
    raw_content: str | None = None
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

@dataclass
class ToolContext:
    root: Path
    turn_id: str | None
    abort_signal: Any | None
    emit: Callable[[dict[str, Any]], Awaitable[None]] | None
```

迁移顺序：

1. 定义 `ToolResult`，旧字符串结果通过 adapter 包装。
2. 增加 `Tool.is_read_only(args)`、`Tool.is_concurrency_safe(args)` 默认方法。
3. `ToolRegistry.prepare_call()` 返回结构化 `PreparedToolCall`。
4. 迁移 `ReadFileTool` 作为第一个 v2 工具。
5. 迁移 `RunCommand`，加入 progress 和 abort 基础。
6. 固化执行顺序：schema cast/validate -> tool validate_input -> observable input -> hook -> permission -> execute -> map_result。

风险：

- 旧 MCP tools 仍按字符串返回。
- 旧工具异常提示要保持模型可理解。

验收：

- 旧工具无需修改仍可运行。
- 新工具可返回 display_summary 与 model_content。
- WebUI tool_result 使用 summary，不展示超长原文。
- 无效参数不会触发权限 AskCard，而是返回可重试的工具输入错误。

## Epic 4：Streaming Tool Execution Engine

目标：建立工具执行器状态模型，为未来流式 tool_call 提前执行铺路。

目标文件：

- `agent/runner.py`
- 新增 `agent/tools/execution.py`
- 新增 `agent/tools/events.py`
- 新增 `tests/test_tool_execution_engine.py`

接口草案：

```python
@dataclass
class ToolRunState:
    id: str
    name: str
    status: Literal["queued", "executing", "completed", "failed", "cancelled"]
    concurrency_safe: bool
    result: ToolResult | None = None

class ToolExecutionEngine:
    async def run_batch(self, calls: list[ToolCallRequest]) -> list[dict[str, Any]]:
        ...
```

迁移顺序：

1. 复制当前 `_execute_tool_calls()` 行为到 engine，runner 只调用 engine。
2. 增加 queued/executing/completed runtime events。
3. 保持 tool message 输出顺序。
4. 加入 sibling cancellation，只先应用于 shell 类工具。
5. 为未来 partial tool_call 预留 `add_tool()` 队列接口。
6. 为 abort、fallback、TurnPaused 补 synthetic tool_result，保持 tool_use/tool_result 成对。

风险：

- 并发工具结果必须按 tool_calls 原顺序回填。
- TurnPaused 时必须为未执行工具生成 skipped tool message。

验收：

- 并发 read 工具、串行 write 工具、混合批次、工具异常、TurnPaused 都有测试。
- WebUI 不丢 `tool_call` / `tool_result`。
- provider fallback 后不会把旧 assistant/tool_use 的结果混入新一轮上下文。

## Epic 5：Permission Pipeline v2

目标：统一工具权限、模式、规则、AskCard、hooks/classifier 扩展点。

目标文件：

- `agent/permissions/models.py`
- `agent/permissions/policy.py`
- `agent/permissions/manager.py`
- 新增 `agent/permissions/pipeline.py`
- 新增 `agent/permissions/resolvers.py`
- `agent/control/manager.py`
- 新增 `tests/test_permission_pipeline.py`

接口草案：

```python
@dataclass
class PermissionRequest:
    tool_name: str
    arguments: dict[str, Any]
    tool_traits: dict[str, Any]
    mode: str

@dataclass
class PermissionDecision:
    behavior: Literal["allow", "deny", "ask"]
    reason: str = ""
    risk: str = "low"
    updated_arguments: dict[str, Any] | None = None
```

迁移顺序：

1. 保持现有 `PermissionDecision` 字段兼容，新增 `behavior`。
2. 将 shell dangerous regex 包装为 safety check reason。
3. 将 Plan 模式工具过滤与参数级 deny 都接入 pipeline。
4. WebUI/CLI resolver 仍复用 `ControlManager.create_ask()`。
5. Scheduler/Team/External 后续可使用 non-interactive resolver。
6. hook 或 classifier 的 allow 决策之后，仍执行 rule-only/safety 复查。

风险：

- Plan 模式硬门禁不能被 resolver 绕过。
- auto 模式不能自动批准 destructive safety check。

验收：

- ask_before_edit 下高风险命令仍触发 AskCard。
- plan 下写工具不可用，scheduler 仅 list。
- 用户允许后同参只放行一次。
- 用户拒绝后同参只拒绝一次。
- Scheduler/Team/External 在不可交互场景不会永久挂起，无法确认时明确 deny 或 paused。

## Epic 6：Task Framework

目标：统一长期运行单元的状态、进度、输出、停止、通知和 transcript。

目标文件：

- 新增 `agent/tasks/models.py`
- 新增 `agent/tasks/store.py`
- 新增 `agent/tasks/manager.py`
- `agent/runtime/active.py`
- `agent/subagents/*`
- `agent/team/manager.py`
- `agent/scheduler/service.py`
- `desktop/src/renderer/src/runtime/*`

接口草案：

```python
@dataclass
class TaskRecord:
    id: str
    type: str
    status: str
    title: str
    source: str
    turn_id: str | None
    started_at: float
    ended_at: float | None = None
    output_path: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
```

迁移顺序：

1. 先让 active task registry 同步写 `TaskRecord`。
2. Scheduler run 创建 task，完成后更新状态。
3. Subagent dispatch 创建 task 和 transcript。
4. Team wake 创建 task，但 member/thread 仍由 TeamStore 管理。
5. WebUI 新增 task projection，不改变 Chat timeline。
6. 抽出 `run_local_agent(...)`，让 subagent、Team wake 和未来 background main session 共享上下文派生、sidechain 写入和 cleanup。

风险：

- 不要把 `.team` 长期身份迁入 task store。
- task transcript 可能很大，必须支持按 offset/page 读取。

验收：

- `/api/runtime/stop` 返回 task ids。
- WebUI 刷新后仍能看到未完成 task。
- Scheduler/Team/Subagent 完成事件都有统一 task lifecycle。
- 主 history 只保存任务通知和最终摘要，完整子代理工具流可通过 task transcript 懒加载。

## Epic 7：Runtime Replay 收敛

目标：后端 runtime event log 成为所有可见行为事实来源，localStorage 只做缓存。

目标文件：

- `agent/runtime/events.py`
- `agent/runtime/store.py`
- `agent/web/routes/*`
- `desktop/src/renderer/src/types.ts`
- `desktop/src/renderer/src/runtime/*`
- `desktop/src/renderer/src/composables/useRuntime.ts`

迁移顺序：

1. 为 tool execution engine 增加结构化事件。
2. 为 context pipeline 增加预算事件。
3. 为 task framework 增加 lifecycle 事件。
4. 前端 reducer 只消费事件，不从 WebSocket 分支里拼过多业务逻辑。
5. snapshot 仅保存最近投影，重连后以后端 replay 修正。

风险：

- 事件 schema 变动必须兼容旧 hot log。
- WebUI reducer 需要对未知事件宽容。

验收：

- 后端重启后 Chat 未压缩 turn 能恢复工具、任务、Ask/Plan 状态。
- localStorage 清空后仍可从 backend replay 重建当前活跃 timeline。

## Epic 8：任务执行流程与可视化运行时

目标：在既有 runner、ToolExecutionEngine、Task Framework 和 Runtime replay 之上，新增一层执行叙事模型，让复杂代码任务呈现为可计划、可推进、可恢复、可视化的 `ExecutionRun`。

这个 Epic 的设计依据见 `07-task-execution-flow-visual-runtime.md`。它不重写前面 Epics，而是把它们串成用户可见的任务执行体验。

目标文件：

- 新增 `agent/execution_flow/models.py`
- 新增 `agent/execution_flow/manager.py`
- 新增 `agent/execution_flow/store.py`
- `agent/runner.py`
- `agent/tools/todo.py`
- `agent/tools/execution.py`
- `agent/tools/shell.py`
- `agent/tools/dispatch.py`
- `agent/tasks/sidechain.py`
- `agent/runtime/events.py`
- `desktop/src/renderer/src/types.ts`
- `desktop/src/renderer/src/runtime/handlers/executionFlow.ts`
- `desktop/src/renderer/src/composables/useRuntime.ts`
- `desktop/src/renderer/src/components/chat/AssistantFlow.vue`
- `desktop/src/renderer/src/components/chat/ToolEvent.vue`
- `desktop/src/renderer/src/components/chat/SubagentTrail.vue`
- 新增 `desktop/src/renderer/src/components/chat/ExecutionPlanStrip.vue`
- 新增 `desktop/src/renderer/src/components/panels/ExecutionFlowPanel.vue`

接口草案：

```python
@dataclass
class ExecutionRun:
    id: str
    turn_id: str | None
    session_id: str | None
    source: str
    status: str
    title: str
    started_at: float
    ended_at: float | None = None
    current_step_id: str | None = None
    summary: str = ""

@dataclass
class ExecutionStep:
    id: str
    run_id: str
    title: str
    description: str
    active_form: str
    status: str
    owner: str | None = None
    blocked_by: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    related_tool_call_ids: list[str] = field(default_factory=list)

@dataclass
class ExecutionActivity:
    id: str
    run_id: str
    step_id: str | None
    kind: str
    status: str
    title: str
    tool_call_id: str | None = None
    task_id: str | None = None
    parent_activity_id: str | None = None
    output_ref: dict[str, Any] | None = None
```

runtime event 草案：

- `execution_run_started`
- `execution_run_updated`
- `execution_run_completed`
- `execution_step_updated`
- `execution_activity_started`
- `execution_activity_progress`
- `execution_activity_completed`
- `execution_activity_failed`
- `tool_run_progress`
- `tool_output_delta`

迁移顺序：

1. 新增纯模型和事件构造函数，不改变 runner 行为。
2. Chat turn 开始时创建 `ExecutionRun`，完成、暂停、失败、取消时写终态。
3. 扩展 `update_todos` 为 Task Step v2，兼容旧 `{id, content, status}` 输入。
4. `ToolExecutionEngine` 绑定 activity id，增加 progress、duration、output ref。
5. `RunCommand` 改为异步进程和 output file，模型只收截断摘要，UI 收 tail。
6. `dispatch_subagent` 和 Team wake 映射为 `ExecutionActivity`，中间事件进入 sidechain。
7. 前端新增 execution flow reducer，通过 runtime replay 重建 run、step、activity。
8. Chat 内显示紧凑步骤条，侧栏显示完整执行面板。
9. 更新 `templates/agent/identity.md`，约束复杂代码任务先建步骤、完成前验证。

风险：

- 不能把 execution flow 做成第二套 history；模型事实仍以 history/checkpoint 为准，可视事实以后端 runtime event 为准。
- 不能把长 output delta 全部塞进前端 reactive 状态，必须只保留 tail 和引用。
- `blocked`/`failed` 步骤不能触发无限继续执行。
- Team 长期身份仍属于 `.team`，execution activity 只表示某次 wake/run。

验收：

- 一个多步骤代码任务能在 Chat 中显示当前步骤、工具运行、验证结果。
- 页面刷新后，从 runtime event replay 恢复执行流投影。
- 长命令运行中能显示 progress，最终模型上下文不包含完整日志。
- 子代理过程在父工具下可见，完整细节可从 sidechain 懒加载。
- 简单问答不被强制显示执行步骤。

## 优先级建议

第一阶段：低风险结构化

1. Context Pipeline 抽出。
2. Tool Protocol v2 adapter。
3. ToolExecutionEngine 复刻当前行为。

第二阶段：用户可见能力增强

1. Tool progress event。
2. ExecutionRun 和 ExecutionStep 基础事件。
3. Permission Pipeline v2。
4. Runtime replay event schema 扩展。

第三阶段：长期任务与子代理升级

1. Task Framework。
2. Subagent sidechain transcript。
3. Team wake task 化。
4. 子代理和 Team activity 投影。

第四阶段：高级上下文恢复

1. ToolResultStore。
2. Microcompact。
3. Reactive compact。
4. 主会话后台化。

第五阶段：执行流体验打磨

1. Chat 内 `ExecutionPlanStrip`。
2. 侧栏 `ExecutionFlowPanel`。
3. Prompt 行为约束与验证闭环。

## 不立即做的事

- 不重写整个 runner。
- 不移植 Ink。
- 不做 Anthropic-only request beta。
- 不引入无法解释的自动权限 classifier。
- 不让 Scheduler、Team、External 绕过 control/permission。
- 不把长期记忆更新和上下文压缩继续强绑定。
- 不在第一版执行流中实现 remote agent 或主会话后台化。
