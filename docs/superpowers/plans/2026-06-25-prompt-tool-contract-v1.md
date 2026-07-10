# Prompt and Tool Contract v1 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参考 Claude Code 的系统提示词与工具设计，把 Emperor Agent 的提示词和内建工具说明升级为更强的任务执行契约。

**Architecture:** 本轮采用 Prompt+Tool v1：只改系统提示词模板、内建工具描述、Todo 字段与相关测试；不重构 Tool Protocol v2，不改前后端事件协议。Claude Code 文档只作为设计参考，输出采用本项目中文契约和现有架构。

**Tech Stack:** Python 3.13、pytest、Markdown prompt templates、Emperor Agent Tool abstraction。

---

## Tasks

### Task 1: 保存计划文件

**Files:**

- Create: `docs/superpowers/plans/2026-06-25-prompt-tool-contract-v1.md`

- [ ] 写入本计划文件。
- [ ] 运行：
  ```bash
  rg -n "TB[D]|TO[D]O|待[定]|待[补]|place(holder)" docs/superpowers/plans/2026-06-25-prompt-tool-contract-v1.md
  git diff --check
  ```
- [ ] 预期：无占位符命中，无空白错误。

### Task 2: Prompt 合同测试与模板升级

**Files:**

- Modify: `tests/unit/test_agent_prompt_contracts.py`
- Modify: `templates/agent/identity.md`
- Modify: `templates/TOOL.md`

- [ ] 在 `test_system_prompt_uses_code_backed_skill_and_subagent_contracts` 中增加断言：系统提示词包含 `专用工具优先`、`提示注入`、`失败后诊断`、`验证后完成`、`风险操作先确认`、`不要展示隐藏推理`、`同一时间只许一项 in_progress`。
- [ ] 运行：
  ```bash
  .venv/bin/python -m pytest -q tests/unit/test_agent_prompt_contracts.py
  ```
- [ ] 预期：新增断言失败。
- [ ] 修改 `templates/agent/identity.md` 与 `templates/TOOL.md`，补齐任务执行、谨慎操作、专用工具优先、Todo 生命周期、失败诊断、提示注入识别、验证后再完成、输出效率规则。
- [ ] 重新运行同一测试，预期通过。

### Task 3: Todo active_form 字段

**Files:**

- Create: `tests/unit/test_todo_tool.py`
- Modify: `agent/tools/todo.py`

- [ ] 新增测试：`active_form` 被保存；`in_progress` 渲染优先使用 `active_form`；两个 `in_progress` 仍返回错误。
- [ ] 运行：
  ```bash
  .venv/bin/python -m pytest -q tests/unit/test_todo_tool.py
  ```
- [ ] 预期：`active_form` 相关断言失败。
- [ ] 修改 `agent/tools/todo.py`：schema 增加 nullable `active_form`；`TodoStore.update()` 清洗并保存；`_render()` 在 `in_progress` 时优先展示 `active_form`。
- [ ] 重新运行同一测试，预期通过。

### Task 4: 工具描述升级

**Files:**

- Modify: `tests/unit/test_tool_descriptions.py`
- Modify: `agent/tools/filesystem.py`
- Modify: `agent/tools/search.py`
- Modify: `agent/tools/shell.py`
- Modify: `agent/tools/todo.py`
- Modify: `agent/tools/dispatch.py`
- Modify: `agent/tools/skills.py`
- Modify: `agent/tools/web.py`
- Modify: `agent/control/tools.py`
- Modify: `agent/scheduler/tools.py`
- Modify: `agent/team/tools.py`

- [ ] 更新 `EXPECTED_BUILTIN_TOOL_DESCRIPTIONS` 为新的规范中文描述。
- [ ] 增加关键短语检查，至少覆盖 `run_command/read_file/edit_file/grep/update_todos/dispatch_subagent/ask_user/propose_plan/scheduler/load_skill`。
- [ ] 运行：
  ```bash
  .venv/bin/python -m pytest -q tests/unit/test_tool_descriptions.py
  ```
- [ ] 预期：工具描述测试失败。
- [ ] 更新内建工具 description 与必要参数说明，体现何时用、何时不用、专用工具优先、失败后不要盲目重试、权限/破坏性边界。
- [ ] 重新运行同一测试，预期通过。

### Task 5: Verification

- [ ] 运行目标测试：
  ```bash
  .venv/bin/python -m pytest -q tests/unit/test_agent_prompt_contracts.py tests/unit/test_tool_descriptions.py tests/unit/test_todo_tool.py
  ```
- [ ] 运行回归测试：
  ```bash
  .venv/bin/python -m pytest -q tests/unit/test_plan_runtime.py tests/unit/test_runner_state.py tests/unit/test_skill_requests.py
  ```
- [ ] 运行仓库检查：
  ```bash
  git diff --check
  ```
- [ ] 运行全量门禁：
  ```bash
  make check
  ```

## Acceptance

- 系统提示词包含明确任务执行契约，且不混入 Claude Code 私有产品指令。
- 内建工具描述保持中文规范，并包含足够使用边界。
- `active_form` 向后兼容，不破坏旧 `update_todos` 调用。
- 指定测试、回归测试、`git diff --check` 和 `make check` 通过。

## Assumptions

- 本轮不做 Tool Protocol v2。
- 本轮不新增后端事件，不改 WebUI 展示协议。
- `active_form` 是可选字段，旧调用不传也保持原行为。
