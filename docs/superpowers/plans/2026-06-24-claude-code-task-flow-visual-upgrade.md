# Claude Code Task Flow Visual Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` when executing runtime code changes. This plan is currently documentation-first; do not change Python, TypeScript, or Vue runtime code until the documentation phase is reviewed.

**Goal:** 在 Emperor Agent 中吸收 Claude Code 的任务执行流程设计，建立“计划步骤、工具进度、长输出治理、子代理轨迹、WebUI 执行流”的升级轨道，提升真实项目编写能力和可视化观感。

**Architecture:** 文档阶段先固化执行叙事层设计。后续代码阶段新增 `ExecutionRun / ExecutionStep / ExecutionActivity / ExecutionOutputRef`，通过 runtime event log 驱动 Vue projection，保持后端事件为事实来源。

**Tech Stack:** Markdown 文档、Python dataclasses、现有 `agent/runner.py`、`agent/tools/execution.py`、`agent/tasks/*`、`agent/runtime/events.py`、Vue 3 runtime reducer、WebSocket replay。

---

## Execution Status

- Status: documentation phase complete.
- Current phase: waiting for runtime implementation review.
- Runtime code changes: deferred.
- Quality gate for this phase: 占位内容扫描、source path scan、`git diff --check` passed.

## Source Anchors

Claude Code research inputs:

| Design area | Claude Code source | Emperor target |
|---|---|---|
| Main execution loop | `src/query.ts`, `src/QueryEngine.ts` | `agent/runner.py`, future `agent/execution_flow/*` |
| Tool lifecycle | `src/services/tools/StreamingToolExecutor.ts`, `src/services/tools/toolExecution.ts` | `agent/tools/execution.py`, `agent/tools/context.py` |
| Long output | `src/utils/task/TaskOutput.ts`, `src/utils/task/diskOutput.ts`, `src/tools/BashTool/BashTool.tsx` | `agent/tools/shell.py`, future `agent/tasks/output.py` |
| Task steps | `src/utils/tasks.ts`, `src/tools/TaskCreateTool/*`, `src/tools/TaskUpdateTool/*` | `agent/tools/todo.py`, future `agent/execution_flow/models.py` |
| Subagent runtime | `src/tools/AgentTool/AgentTool.tsx`, `src/tools/AgentTool/runAgent.ts` | `agent/tools/dispatch.py`, `agent/tasks/sidechain.py` |
| UI projection | `src/components/TaskListV2.tsx`, `src/components/messages/AssistantToolUseMessage.tsx` | `desktop/src/renderer/src/runtime/*`, `AssistantFlow.vue`, `ToolEvent.vue` |

Emperor current anchors:

- `agent/runner.py`
- `agent/tools/execution.py`
- `agent/tools/context.py`
- `agent/tools/results.py`
- `agent/tools/todo.py`
- `agent/tools/shell.py`
- `agent/runtime/events.py`
- `agent/tasks/models.py`
- `agent/tasks/manager.py`
- `agent/tasks/sidechain.py`
- `agent/tools/dispatch.py`
- `desktop/src/renderer/src/composables/useRuntime.ts`
- `desktop/src/renderer/src/components/chat/AssistantFlow.vue`
- `desktop/src/renderer/src/components/chat/ToolEvent.vue`
- `desktop/src/renderer/src/components/chat/SubagentTrail.vue`
- `desktop/src/renderer/src/runtime/handlers/tasks.ts`

## Phase 1：Documentation Only

### Task 1：新增任务执行流程分册

**Files:**

- Create `docs/claude-code-core-design/07-task-execution-flow-visual-runtime.md`

**Steps:**

- [x] 还原 Claude Code `query()` 如何把模型流、工具调用、progress、task notification 串成执行循环。
- [x] 说明 `StreamingToolExecutor` 的 `queued / executing / completed / yielded` 状态模型。
- [x] 说明 `TaskOutput` 如何拆分模型可见结果、UI progress、完整 output file。
- [x] 说明 Task v2 相比旧 Todo 的字段升级：`activeForm`、`owner`、`blocks`、`blockedBy`、`metadata`。
- [x] 说明 `AgentTool` 同步/异步子代理、sidechain transcript、background notification。
- [x] 写出 Emperor 当前文件对照和缺口。
- [x] 定义 `ExecutionRun / ExecutionStep / ExecutionActivity / ExecutionOutputRef` 草案。
- [x] 定义 runtime event 和前端 projection 协议草案。

**Acceptance:**

- 文档能单独解释 Claude Code 执行任务时为什么“有步骤、有进度、能持续推进”。
- 文档明确本阶段只做设计，不改运行时代码。

### Task 2：新增可执行升级计划

**Files:**

- Create `docs/superpowers/plans/2026-06-24-claude-code-task-flow-visual-upgrade.md`

**Steps:**

- [x] 按 Epics 拆出后续代码阶段任务。
- [x] 每个 Epic 写目标、目标文件、接口草案、迁移顺序、风险、验收。
- [x] 明确第一阶段只写文档。
- [x] 明确后续代码阶段才运行 `make check`。

**Acceptance:**

- 后续 agent 可以直接按 checkbox 执行。
- 不需要再重新决策“要改哪些模块”和“先后顺序”。

### Task 3：更新资料库 README

**Files:**

- Modify `docs/claude-code-core-design/README.md`

**Steps:**

- [x] 在阅读顺序中加入 `07-task-execution-flow-visual-runtime.md`。
- [x] 在可执行计划列表中加入本计划文件。
- [x] 在核心结论中补充“执行叙事层”重要性。

**Acceptance:**

- 新分册能从 README 入口找到。
- 用户能区分深度底层升级计划和本次执行流可视化升级计划。

### Task 4：更新升级路线图

**Files:**

- Modify `docs/claude-code-core-design/06-emperor-upgrade-roadmap.md`

**Steps:**

- [x] 加入“任务执行流程与可视化升级”章节。
- [x] 明确该升级基于已有 ToolExecutionEngine、Task Framework、Runtime replay。
- [x] 写出 `Execution Flow` 后续实现的 Epics。
- [x] 写出不立即照搬内容和优先吸收内容。

**Acceptance:**

- 路线图能说明本次新分册和既有 Epics 的关系。
- 不会让后续实现误以为要重写已有 runner 或前端。

### Task 5：文档验收

**Commands:**

```bash
rg -n "TB[D]|TO[D]O|待[定]|待[补]|placeholde[r]" docs/claude-code-core-design docs/superpowers/plans
rg -n "/Users/anhuike/Documents/workspace/claude-code-source-code/src" docs/claude-code-core-design
git diff --check
```

**Expected:**

- 第一条命令不命中新写文档中的占位内容。
- 第二条命令只出现刻意保留的源码根目录引用，不出现源码 dump。
- `git diff --check` 无 trailing whitespace 或 Markdown 空白错误。

## Phase 2：Execution Flow Backend

后续进入代码实现时执行。本阶段不实施。

### Epic 1：Execution Flow Domain

**Goal:** 建立 turn 级执行叙事模型。

**Target files:**

- Add `agent/execution_flow/__init__.py`
- Add `agent/execution_flow/models.py`
- Add `agent/execution_flow/store.py`
- Add `agent/execution_flow/manager.py`
- Modify `agent/runtime/events.py`
- Modify `agent/web/services/mainline_turn.py`
- Modify `agent/runner.py`

**Interfaces:**

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
    summary: str = ""
    current_step_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
```

**Migration order:**

- [ ] Add pure dataclasses and unit tests.
- [ ] Add manager that can start/update/finish a run in memory.
- [ ] Add runtime event constructors.
- [ ] Create an `ExecutionRun` when `MainlineTurnService.submit()` starts.
- [ ] Mark run completed, paused, failed, or cancelled from runner/control paths.

**Risks:**

- Existing runtime replay must remain compatible.
- A paused Ask/Plan turn is not failed; it is `paused`.

**Acceptance:**

- A chat turn emits run started and terminal run event.
- Cancelling a turn emits `cancelled`.
- Ask/Plan pause emits `paused`.

### Epic 2：Plan/Todo to Task Step v2

**Goal:** 将 `update_todos` 升级为执行步骤协议，同时兼容旧 schema。

**Target files:**

- Modify `agent/tools/todo.py`
- Modify `agent/runner.py`
- Modify `agent/runtime/events.py`
- Add `tests/unit/test_execution_steps.py`

**Interfaces:**

```python
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
```

**Migration order:**

- [ ] Add new optional fields to `update_todos` parameters.
- [ ] Keep old `{id, content, status}` accepted.
- [ ] Normalize old todos into step v2.
- [ ] Emit `execution_step_updated`.
- [ ] Update runner continuation logic to handle `blocked` and `failed`.

**Risks:**

- Over-planning simple answers.
- Infinite continuation if all remaining steps are blocked.

**Acceptance:**

- Existing todo tests pass.
- New blocked/failed statuses are preserved.
- Final reply cannot occur with non-terminal unblocked steps.

### Epic 3：Tool Progress and Output Ref

**Goal:** 工具运行中可见，长输出不污染上下文。

**Target files:**

- Modify `agent/tools/context.py`
- Modify `agent/tools/results.py`
- Modify `agent/tools/execution.py`
- Modify `agent/tools/shell.py`
- Add `agent/tasks/output.py`
- Add `tests/unit/test_tool_progress.py`
- Add `tests/unit/test_shell_output_streaming.py`

**Interfaces:**

```python
@dataclass
class ExecutionOutputRef:
    path: str
    kind: str
    bytes: int
    lines: int
    offset: int = 0
    preview: str = ""
    truncated: bool = False
```

**Migration order:**

- [ ] Extend `ToolExecutionContext` with async progress emitter.
- [ ] Let engine accept progress events from v2 tools.
- [ ] Add `tool_run_progress` and `tool_output_delta`.
- [ ] Rework `RunCommand` to stream to output file.
- [ ] Final result returns model-safe summary plus output ref.

**Risks:**

- Blocking subprocess calls cannot stream; shell must use async process.
- Output files must remain under ignored `memory/`.
- Cancellation must terminate child process reliably.

**Acceptance:**

- Long-running shell command produces progress before completion.
- Model history receives capped result only.
- UI event contains output path and tail.

### Epic 4：Subagent and Team Activity Projection

**Goal:** 子代理和队友运行成为父执行流的一部分。

**Target files:**

- Modify `agent/tools/dispatch.py`
- Modify `agent/tasks/sidechain.py`
- Modify `agent/tasks/manager.py`
- Modify `agent/team/manager.py`
- Modify `agent/runtime/events.py`
- Add `tests/unit/test_subagent_execution_flow.py`

**Migration order:**

- [ ] Create `ExecutionActivity(kind="subagent")` for every dispatch.
- [ ] Write subagent intermediate events to sidechain.
- [ ] Bind subagent tool calls to parent tool call id.
- [ ] Map Team wake to `ExecutionActivity(kind="team")`.
- [ ] Keep Team roster and inbox in `.team`.

**Risks:**

- Sidechain may grow quickly.
- Team identity and task run must not be confused.

**Acceptance:**

- Parent tool card can display subagent last activity.
- Sidechain read API can return paged transcript.
- Team wake has activity record without changing `.team` semantics.

## Phase 3：WebUI Visualization

### Epic 5：Execution Flow Projection

**Goal:** 前端通过 runtime replay 重建执行流。

**Target files:**

- Modify `desktop/src/renderer/src/types.ts`
- Modify `desktop/src/renderer/src/composables/useRuntime.ts`
- Add `desktop/src/renderer/src/runtime/handlers/executionFlow.ts`
- Add `desktop/src/renderer/src/runtime/executionFlowProjection.test.ts`

**Migration order:**

- [ ] Define execution event union types.
- [ ] Implement reducer for run, step, activity, output delta.
- [ ] Replay bootstrap events into projection.
- [ ] Keep large output chunks out of long-lived reactive arrays.

**Risks:**

- Runtime replay ordering must be stable.
- Large output delta can slow Vue if retained fully.

**Acceptance:**

- Vitest confirms replay reconstructs run and step states.
- Refresh does not lose active run.

### Epic 6：Chat and Panel UI

**Goal:** Chat 展示紧凑流程，侧栏展示完整执行流。

**Target files:**

- Add `desktop/src/renderer/src/components/chat/ExecutionPlanStrip.vue`
- Add `desktop/src/renderer/src/components/panels/ExecutionFlowPanel.vue`
- Modify `desktop/src/renderer/src/components/chat/AssistantFlow.vue`
- Modify `desktop/src/renderer/src/components/chat/ToolEvent.vue`
- Modify `desktop/src/renderer/src/components/chat/SubagentTrail.vue`

**Migration order:**

- [ ] Add compact plan strip to assistant timeline.
- [ ] Enhance `ToolEvent` for running progress and output ref.
- [ ] Enhance `SubagentTrail` with task id, last activity, duration.
- [ ] Add side panel for full run detail.
- [ ] Verify desktop and narrow viewports.

**Risks:**

- UI can become too noisy if every event is shown inline.
- Nested cards should be avoided; use timeline rows and compact bands.

**Acceptance:**

- Complex coding task shows current step in Chat.
- Long tool output shows tail and path, not full dump.
- Subagent activity is visible without opening raw transcript.

## Phase 4：Prompt and Behavior Contract

### Epic 7：Planning Discipline and Verification Closure

**Goal:** 让模型稳定使用执行步骤，不在未验证时提前总结。

**Target files:**

- Modify `templates/agent/identity.md`
- Modify `templates/TOOL.md`
- Modify `agent/control/manager.py` if Plan approval resume message needs stronger guidance.
- Add behavior tests where feasible.

**Migration order:**

- [ ] Update contract: multi-step coding tasks create steps first.
- [ ] Require `in_progress` before edit-heavy step.
- [ ] Require evidence before `completed`.
- [ ] Require verification step for non-trivial code changes.
- [ ] On blocked/failed, report blocker instead of pretending completion.

**Risks:**

- Too much process for trivial questions.
- Verification should be proportional, not always full `make check`.

**Acceptance:**

- Simple Q&A remains direct.
- Multi-file coding task uses steps.
- Final reply references actual verification or explains why not run.

## Non-Goals

- Do not port React/Ink.
- Do not add Anthropic-only request headers or beta features to core.
- Do not implement remote agents.
- Do not implement main-session backgrounding in v1.
- Do not store committed runtime data under `memory/` or `.team/`.

## Verification

Documentation phase:

```bash
rg -n "TB[D]|TO[D]O|待[定]|待[补]|placeholde[r]" docs/claude-code-core-design docs/superpowers/plans
rg -n "/Users/anhuike/Documents/workspace/claude-code-source-code/src" docs/claude-code-core-design
git diff --check
```

Runtime implementation phase:

```bash
make check
```
