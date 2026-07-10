# Agent Time Task Flow Output Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Emperor Agent 的 Chat 输出升级为 Claude Code 风格的执行叙事流：总耗时准确、计划步骤可扫读、工具批次紧凑、长输出可治理、子代理和验证过程能被看见。

**Architecture:** 分两层推进。第一层不改后端协议，基于现有 `AssistantMessage.segments` 做前端投影、时间语义和视觉压缩；第二层引入后端 `ExecutionRun / ExecutionStep / ExecutionActivity / ExecutionOutputRef`，把计划、工具、子代理、长输出和验证闭环变成可回放事件。

**Tech Stack:** Vue 3、TypeScript、Vitest、Electron Vite、Python dataclasses、aiohttp WebSocket runtime events、现有 `agent/runner.py` 与 `agent/tools/execution.py`。

---

## Source Evidence

- Emperor screenshot gap: current Chat 主线仍出现工具卡片堆叠、`update_todos` 展开 JSON、多个阶段耗时误读为总耗时、任务步骤和工具执行混杂。
- Claude Code reference: `src/components/messages/AssistantToolUseMessage.tsx` 将 queued/running/resolved/error 渲染为一行工具状态；`src/components/TaskListV2.tsx` 只展示最近完成、进行中、待处理的有限任务；`src/utils/task/TaskOutput.ts` 将 Bash 长输出拆为进度 tail、模型可见摘要、完整 output file。
- Emperor current base: `assistantFlowProjection.ts` 已有 raw segments 到 UI blocks 的投影；`ToolGroup.vue` 已能合并连续工具；`useRuntime.ts` 已处理 message/tool/control/subagent/team/task runtime 事件。

## File Structure

- `desktop/src/renderer/src/types.ts`：给 `AssistantMessage` 增加 turn 级 `startedAt / endedAt / durationMs`，后续增加 execution event 类型。
- `desktop/src/renderer/src/composables/useRuntime.ts`：记录 assistant 总耗时，后续接入 execution runtime reducer。
- `desktop/src/renderer/src/runtime/snapshot.ts`：刷新恢复时保留 assistant 总耗时。
- `desktop/src/renderer/src/components/chat/assistantFlowProjection.ts`：把 thought、text、tool、todo/control 投影成执行叙事 blocks。
- `desktop/src/renderer/src/components/chat/assistantFlowProjection.test.ts`：用 Vitest 固化投影规则。
- `desktop/src/renderer/src/components/chat/ThoughtEvent.vue`：区分总执行耗时和 thought 阶段耗时。
- `desktop/src/renderer/src/components/chat/ToolGroup.vue`：将连续工具显示为紧凑工具组，计划更新不再默认展开原始 JSON。
- `desktop/src/renderer/src/components/chat/ToolEvent.vue`：单工具详情保留 raw input/output，但默认只在运行、错误、子代理时展开。
- `desktop/src/renderer/src/components/chat/TodoPanel.vue`：将 todos 渲染为任务步骤条，而不是独立黄色卡片。
- `desktop/src/renderer/src/styles/chat.css`、`activity.css`、`codex-v2.css`：调整 timeline、todo、tool group、scrollbar 和 focus 视觉。
- `agent/execution_flow/models.py`：后续新增 ExecutionRun/Step/Activity/OutputRef dataclasses。
- `agent/execution_flow/manager.py`：后续新增执行流状态管理和 runtime event 生成。
- `agent/tools/execution.py`：后续给工具生命周期增加 progress、duration、output ref。
- `agent/tools/shell.py`：后续将阻塞 capture 改为异步 streaming output file。

## Tasks

### Task 1: Correct Assistant Total Execution Time

**Files:**

- Modify: `desktop/src/renderer/src/types.ts`
- Modify: `desktop/src/renderer/src/composables/useRuntime.ts`
- Modify: `desktop/src/renderer/src/runtime/snapshot.ts`
- Modify: `desktop/src/renderer/src/components/chat/assistantFlowProjection.ts`
- Modify: `desktop/src/renderer/src/components/chat/ThoughtEvent.vue`
- Test: `desktop/src/renderer/src/components/chat/assistantFlowProjection.test.ts`

- [x] Treat `执行 Ns` as a semantic change from phase latency to assistant turn total duration, not as a label replacement for `等待模型首字`.
- [x] Add failing test: a completed thought with `durationMs=400` inside an assistant message with `durationMs=5000` must project `executionDurationMs=5000`.
- [x] Add failing test: when message-level duration is missing, projection derives execution duration from earliest timed segment start and latest timed segment end.
- [x] Add failing test: a running thought inside a streaming assistant message must use assistant turn elapsed time, not its own phase duration.
- [x] Add `startedAt / endedAt / durationMs` to `AssistantMessage`.
- [x] Set assistant `startedAt` at `createStreamingAssistant()`.
- [x] Finish assistant duration on `assistant_done`, `turn_paused`, cancellation and error-abort paths.
- [x] Render `执行 5s` only when `executionDurationMs` exists; otherwise render phase duration such as `整理工具结果 · 300ms`.
- [x] Refresh streaming assistant flow with a lightweight local clock so `执行 Ns` continues to represent total elapsed time while tools/model are still running.
- [x] Run `npm run test -- assistantFlowProjection`.

### Task 2: Promote Todo Updates to Task Step Strip

**Files:**

- Modify: `desktop/src/renderer/src/components/chat/assistantFlowProjection.ts`
- Modify: `desktop/src/renderer/src/components/chat/assistantFlowProjection.test.ts`
- Modify: `desktop/src/renderer/src/components/chat/ToolGroup.vue`
- Modify: `desktop/src/renderer/src/components/chat/ToolEvent.vue`
- Modify: `desktop/src/renderer/src/components/chat/TodoPanel.vue`
- Modify: `desktop/src/renderer/src/styles/activity.css`
- Modify: `desktop/src/renderer/src/styles/codex-v2.css`

- [x] Add failing test: a `tool` segment with `todos` emits a `tool_group` block followed by a `todos` block.
- [x] Add failing test: `message.todos` fallback is not duplicated when a tool already emitted a todo strip.
- [x] Implement `latestTodos(group)` in projection and push `{ kind: "todos", id: "todos-<tool id>", todos }` immediately after the related tool group.
- [x] Change `ToolGroup.defaultOpen` so completed `update_todos` does not open raw JSON by default.
- [x] Change `ToolEvent.defaultOpen` so todos alone do not force raw input/output expansion.
- [x] Change `TodoPanel` title to `任务步骤` and render compact counts for completed, in-progress and pending steps.
- [x] Restyle `TodoPanel` as a low-noise timeline band, not a yellow warning card.
- [x] Run `npm run test -- assistantFlowProjection`.

### Task 3: Compact Tool Group Information Output

**Files:**

- Modify: `desktop/src/renderer/src/components/chat/ToolGroup.vue`
- Modify: `desktop/src/renderer/src/components/chat/ToolEvent.vue`
- Modify: `desktop/src/renderer/src/styles/activity.css`
- Modify: `desktop/src/renderer/src/styles/codex-v2.css`

- [x] Add `isTodoOnlyGroup` computed in `ToolGroup.vue`.
- [x] For done tool groups, show one summary line: tool name, purpose, completed count, duration.
- [x] For running tool groups, show current running tool names and keep details open.
- [x] For error tool groups, show failed tool count and keep details open.
- [x] For `update_todos`, hide raw input/output behind a nested `details` labeled `查看原始工具详情`.
- [x] Ensure no nested floating cards appear inside repeated tool groups; details use flat bands and hairline borders.
- [x] Run `npm run typecheck`.

### Task 4: Visual Timeline Polish

**Files:**

- Modify: `desktop/src/renderer/src/styles/chat.css`
- Modify: `desktop/src/renderer/src/styles/activity.css`
- Modify: `desktop/src/renderer/src/styles/codex-v2.css`

- [x] Restore a subtle left execution rail on desktop, matching Claude Code's line-and-dot rhythm without copying its exact React/Ink implementation.
- [x] Keep mobile layout compact by reducing rail offset and full-width cards under 760px.
- [x] Keep Chat composer and assistant prose transparent; no accent blue focus box.
- [x] Keep global scrollbar neutral dark in Chat and composer textarea.
- [x] Verify screenshot acceptance at `1620x739` and `1920x1080`.

### Task 5: Backend Execution Flow Domain

**Files:**

- Create: `agent/execution_flow/__init__.py`
- Create: `agent/execution_flow/models.py`
- Create: `agent/execution_flow/manager.py`
- Test: `tests/unit/test_execution_flow_models.py`

- [x] Add `ExecutionRun` dataclass with `id`, `turn_id`, `session_id`, `source`, `status`, `title`, `started_at`, `ended_at`, `summary`, `current_step_id`, `metadata`.
- [x] Add `ExecutionStep` dataclass with `id`, `run_id`, `title`, `description`, `active_form`, `status`, `owner`, `blocked_by`, `evidence`, `related_tool_call_ids`.
- [x] Add `ExecutionActivity` dataclass with `id`, `run_id`, `step_id`, `kind`, `status`, `label`, `started_at`, `ended_at`, `tool_call_id`, `parent_id`, `metadata`.
- [x] Add `ExecutionOutputRef` dataclass with `path`, `kind`, `bytes`, `lines`, `offset`, `preview`, `truncated`.
- [x] Add tests for run lifecycle, step update and activity duration.

### Task 6: Runtime Event Protocol

**Files:**

- Modify: `agent/runtime/events.py`
- Modify: `agent/web/services/mainline_turn.py`
- Modify: `agent/runner.py`
- Modify: `desktop/src/renderer/src/types.ts`
- Add: `desktop/src/renderer/src/runtime/handlers/executionFlow.ts`
- Test: `desktop/src/renderer/src/runtime/executionFlowProjection.test.ts`

- [x] Emit `execution_run_started` when a Chat mainline turn starts.
- [x] Extend `execution_run_started` to control-resume turns.
- [x] Extend `execution_run_started` to delivered scheduler/watchlist agent turns.
- [x] Emit `execution_run_finished` for Chat mainline turns with `status=completed|paused|failed|cancelled`.
- [x] Extend `execution_run_finished` to control-resume turns.
- [x] Extend `execution_run_finished` to delivered scheduler/watchlist agent turns.
- [x] Emit `execution_step_updated` when `update_todos` changes plan state.
- [x] Emit `execution_activity_started|finished` around main-agent tool activity.
- [x] Emit `execution_activity_progress` for long command output.
- [x] Emit `execution_activity_progress` for true streaming tool output.
- [x] Emit `execution_activity_started|finished` around subagent/team activity.
- [x] Replay bootstrap runtime events into frontend execution flow state.
- [x] Keep old `tool_call/tool_result/tool_error` consumers working during migration.

### Task 7: Tool Progress and Long Output

**Files:**

- Modify: `agent/tools/context.py`
- Modify: `agent/tools/results.py`
- Modify: `agent/tools/execution.py`
- Modify: `agent/tools/shell.py`
- Create: `agent/tasks/output.py`
- Test: `tests/unit/test_tool_progress.py`
- Test: `tests/unit/test_shell_output_streaming.py`

- [x] Add progress emitter to `ToolExecutionContext`.
- [x] Add `tool_run_progress` runtime event with `activity_id`, `message`, `lines`, `bytes`, `tail`, `output_ref`.
- [x] Write long `run_command` stdout/stderr capture to a file under `memory/tool_outputs/`.
- [x] Rework `run_command` from capture-after-completion to true line streaming.
- [x] Return model-safe summary from long commands and attach `ExecutionOutputRef`.
- [x] Ensure cancellation terminates the child process and emits final cancelled activity.
- [x] Confirm large outputs do not enter `history.jsonl` uncapped.

### Task 8: Verification Gates

**Files:**

- Test commands only; no production files.

- [x] Run `npm run test -- assistantFlowProjection`.
- [x] Run `npm run test -- assistantFlowProjection executionFlowProjection`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [x] For backend Execution Flow domain, run `.venv/bin/python -m pytest -q tests/unit/test_execution_flow_models.py`.
- [x] For backend Execution Flow runtime v1, run `.venv/bin/python -m pytest -q tests/unit/test_runtime_events.py tests/unit/test_mainline_turn.py tests/unit/test_runner_execution_flow.py tests/unit/test_execution_flow_models.py`.
- [x] For control-resume and scheduler Execution Flow run wrappers, run `.venv/bin/python -m pytest -q tests/unit/test_mainline_turn.py tests/unit/test_scheduler_executor.py tests/unit/test_control_resume_execution_flow.py tests/unit/test_runtime_events.py tests/unit/test_runner_execution_flow.py tests/unit/test_execution_flow_models.py`.
- [x] Run `.venv/bin/python -m ruff check agent/runtime/events.py agent/web/services/mainline_turn.py agent/web/state.py agent/runner.py agent/execution_flow tests/unit/test_runtime_events.py tests/unit/test_mainline_turn.py tests/unit/test_runner_execution_flow.py tests/unit/test_execution_flow_models.py`.
- [x] Run `.venv/bin/python -m ruff check agent/web/services/execution_flow.py agent/web/services/mainline_turn.py agent/web/services/chat_service.py agent/web/services/scheduler_executor.py agent/web/state.py tests/unit/test_control_resume_execution_flow.py tests/unit/test_scheduler_executor.py tests/unit/test_mainline_turn.py`.
- [x] For backend tool progress and shell output v1, run `.venv/bin/python -m pytest -q tests/unit/test_tool_progress.py tests/unit/test_shell_output_streaming.py`.
- [x] Run `.venv/bin/python -m ruff check agent/tools/shell.py agent/runtime/events.py agent/runner.py tests/unit/test_tool_progress.py tests/unit/test_shell_output_streaming.py`.
- [x] For true shell streaming progress, run `.venv/bin/python -m pytest -q tests/unit/test_shell_output_streaming.py`.
- [x] For shell cancellation, run `.venv/bin/python -m pytest -q tests/unit/test_shell_output_streaming.py::test_run_command_cancellation_kills_process_and_emits_cancelled_activity`.
- [x] For shell command behavior regression, run `.venv/bin/python -m pytest -q tests/unit/test_shell.py::TestShellExecution::test_echo tests/unit/test_shell.py::TestShellExecution::test_cwd tests/unit/test_shell.py::TestShellExecution::test_stderr_returned tests/unit/test_shell.py::TestShellExecution::test_long_output_is_capped`.
- [x] For runner cancellation propagation, run `.venv/bin/python -m pytest -q tests/unit/test_runner_execution_flow.py::test_runner_propagates_async_cancellation_to_runtime_context_tools`.
- [x] For `ToolExecutionContext.progress()`, run `.venv/bin/python -m pytest -q tests/unit/test_tool_progress.py tests/unit/test_tool_protocol_v2.py`.
- [x] For subagent/team execution activities, run `.venv/bin/python -m pytest -q tests/unit/test_subagent_execution_flow.py tests/unit/test_team.py::test_team_wake_emits_execution_activity_events`.
- [x] Run `.venv/bin/python -m ruff check agent/tools/dispatch.py agent/team/manager.py agent/team/tools.py agent/tools/registry.py agent/runner.py agent/tools/shell.py agent/scheduler/tools.py agent/control/tools.py tests/unit/test_team.py tests/unit/test_subagent_execution_flow.py`.
- [x] For true streaming and cancellation phases, add and run dedicated streaming/cancellation tests.
- [x] Before a full runtime merge, run `make check`.

## Visual Acceptance

- The first assistant phase chip shows total execution duration once, for example `执行 14s`.
- Later thought chips show phase names, for example `整理工具结果 · 1.0s`, not another total duration.
- Todo updates appear as `任务步骤` strips with counts and compact rows; raw todo JSON is hidden by default.
- Done tool groups are one-line summaries unless opened by the user.
- Running, error, subagent and team activities remain visible without manual expansion.
- Bash output previews show concise tails and metadata after backend Task 7; full output remains in an output file.
- Chat no longer shows bright blue focus boxes or mismatched white scrollbars.

## Non-Goals

- Do not copy Claude Code React/Ink implementation.
- Do not introduce Anthropic-specific feature gates or private telemetry.
- Do not move long-lived execution output into committed files; runtime output belongs under ignored `memory/`.
- Do not replace existing `tool_call/tool_result` events in one step; migrate compatibly.
