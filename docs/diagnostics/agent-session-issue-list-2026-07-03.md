# Emperor Agent 会话问题清单与处理状态（2026-07-03）

项目根目录：`/Users/anhuike/Documents/workspace/emperor-agent`

本文用于交接给其他 AI 或后续排障者。每个问题都写明：现象、证据路径、相关源码、当前是否已解决；已解决的问题附解决方式和验证证据，未解决的问题明确标注后续缺口。

## 证据范围

- 当前问题会话：`/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a`
- 空 Default 会话：`/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/cbdb05112b1a4dc2`
- 会话索引：`/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/index.json`
- 近期截图证据：
  - `/Users/anhuike/Desktop/截屏2026-07-03 下午5.01.25.png`
  - `/Users/anhuike/Desktop/截屏2026-07-03 下午4.16.22.png`
  - `/Users/anhuike/Desktop/截屏2026-07-03 上午9.38.21.png`
  - `/Users/anhuike/Desktop/截屏2026-07-03 上午9.40.31.png`

当前磁盘状态摘要：

- `.emperor/sessions/index.json` 中有 2 个会话：一个非空 build 会话 `96b48b393aa7464a`，一个空 chat 会话 `cbdb05112b1a4dc2`。
- `96b48b393aa7464a/history.jsonl` 有 90 行。
- `96b48b393aa7464a/runtime/events.jsonl` 有 4797 行。
- 旧历史不会自动迁移或清洗；因此旧红卡、旧 max_turns、旧 runtime 事件仍然会作为历史证据存在。

## 状态总览

| 编号 | 问题 | 状态 |
| --- | --- | --- |
| P0-1 | `update_todos` 被 Plan evidence gate 拒绝，导致红色工具卡和循环 | 已解决（当前工作树） |
| P0-2 | Plan incomplete followup 反复注入，触发 `max_turns=20` | 核心循环已解决；最终收尾策略未解决 |
| P1-1 | 重启后 composer 保持运行中 UI，但 Core 没有活跃任务 | 已解决（当前工作树） |
| P1-2 | 工具卡默认展开、旧工具输出缺失像渲染失败 | 已解决（当前工作树）；旧历史只降级展示 |
| P1-3 | Plan / ask 后回复线条中断 | 未解决 |
| P1-4 | 命令安全策略拒绝 `python3 -c` 后模型仍反复尝试 | 未解决 |
| P1-5 | 会话 replay 数据量偏大，影响恢复和 UI 性能 | 未解决 |
| P1-6 | 项目多 session 与 session 懒创建 | 待实施 |
| P1-7 | session 行运行状态与后台完成提醒 | 待实施 |
| P2-1 | Agent 有实现能力，但收尾和最终汇报弱 | 未解决 |

## P0-1：`update_todos` 被 Plan evidence gate 拒绝，导致红色工具卡和执行循环

状态：已解决（当前工作树）。旧会话中的红卡不迁移、不清洗。

症状：

- `update_todos` 在用户已经完成或验证某一步后仍然失败。
- 错误为 `PLAN_EVIDENCE_REQUIRED`，把任务清单更新当成了计划验证裁判。
- 模型随后尝试绕过或重复验证，造成执行线被拖长，甚至达到 `max_turns=20`。

旧历史证据：

- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl:3472`
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl:3516`
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl:3588`
  - 三处都是 `update_todos` 的 `PLAN_EVIDENCE_REQUIRED` 错误。

历史根因：

- 旧实现把 `update_todos` 和 PlanStep 状态同步、PlanEvidence 验证绑定在一起。
- 这不同于 Claude Code `TaskUpdate/TodoWrite` 设计。Claude Code 中 todo/task 更新只维护清单；验证是 nudge、hook 或独立 reviewer，不是 todo 写入数据库的内置前置条件。

解决方式：

- 切断 runner 主路径里的 `update_todos -> syncPlanFromTodos()` 耦合。
- `update_todos` 现在只维护 session todo list，并把 `todos` 附在 `tool_result` 上供 UI 展示。
- `PlanEvidenceError` 不再由新主链路正常触发；legacy API 保留兼容旧数据。
- `UpdateTodos` 工具描述改成 Claude Code 风格：复杂任务用清单；简单任务不用；完成后更新；工具本身不验证实现正确性，也不裁决 PlanStep。

解决证据路径：

- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/agent/runner.ts:993`
  - 当前 `emitToolResult()` 只把 `TodoStore` 中的 todos 附到 `tool_result`。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/tools/builtin.ts:262`
  - `UpdateTodos` 描述明确“只维护清单，不验证实现正确性，也不裁决计划步骤”。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/control/plan-execution.ts`
  - legacy `syncPlanFromTodos()` 仍保留，但不应进入 runner 主路径裁决 todo。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/agent/runner.test.ts`
  - 覆盖 `update_todos updates the session checklist without mutating approved plan steps`。

验证证据：

- `npm test --workspace @emperor/core -- runner.test.ts control.test.ts tools.test.ts`
  - 结果：3 个测试文件通过，85 个测试通过。

剩余注意：

- 旧 session 中已有 `PLAN_EVIDENCE_REQUIRED` 的红卡仍会按历史事件展示。不要用旧历史判断新代码仍在拒绝 `update_todos`。

## P0-2：Plan incomplete followup 反复注入，触发 `max_turns=20`

状态：核心循环已解决；`max_turns` 时的最终总结策略未解决。

症状：

- 会话多次以“达到 max_turns=20 上限，未办妥”结束。
- Agent 在已经做了大量代码和测试后仍继续尝试推进计划，不产出清晰最终交付。
- 截图中表现为回复线继续生成、计划/ask 之后线条中断或流程不自然。

旧历史证据：

- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/history.jsonl:31`
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/history.jsonl:68`
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/history.jsonl:90`
  - 三次 assistant 结果都是 `（达到 max_turns=20 上限，未办妥；history 中已有部分进展）`。
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl:3212`
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl:4271`
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl:4796`
  - 三次 `turn_phase: max_turns`。

历史根因：

- 旧 `planCompletionFollowup()` 会在 PlanRecord 仍有 active/pending/failed/blocked step 时，把 `[PLAN_INCOMPLETE]` 当作新的 `role:user` 消息注入。
- 如果模型短答或 todo/plan 状态没有被正确推进，就会继续触发 followup，直到 `max_turns=20`。

解决方式：

- 当前工作树停用 Plan incomplete followup：`planCompletionFollowup()` 直接返回 `null`。
- runner 中仍保留兼容分支和 repeated followup degraded 保护，但正常路径不会再由 Plan incomplete 反复注入 user 消息。
- 非平凡变更的质量门仍保留在 independent verification followup，而不是 Plan incomplete loop。

解决证据路径：

- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/control/plan-verification.ts:79`
  - `planCompletionFollowup(): Record<string, unknown> | null { return null }`
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/control/manager.ts:546`
  - manager 仍代理到 verification，但 verification 当前返回 null。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/agent/runner.ts:489`
  - runner 保留兼容分支；如果未来重新启用 followup，同一 turn 重复 followup 会产生 `record_degraded(kind: "plan_followup_loop")` 并停止继续循环。

验证证据：

- `npm test --workspace @emperor/core -- runner.test.ts control.test.ts tools.test.ts`
  - 结果：3 个测试文件通过，85 个测试通过。

未解决部分：

- `max_turns` 到达时仍缺少高质量最终总结策略。应该输出已完成、未完成、失败原因、恢复入口和验证命令，而不是只写“未办妥”。

## P1-1：重启后 composer 保持运行中 UI，但 Core 没有活跃任务

状态：已解决（当前工作树）。

症状：

- 进入旧工程后发送按钮保持运行中的旋转 UI。
- 点击停止时提示“当前没有可停止的任务”或“没有正在运行的任务”，但输入框仍显示“正在生成回复...”。
- 用户截图：`/Users/anhuike/Desktop/截屏2026-07-03 下午5.01.25.png`。

根因：

- runtime replay 或本地 snapshot 可以恢复出 `assistant.streaming = true`。
- 但 Electron main / Core 的 `activeTasks` 已经为空。
- renderer 原先只看 replay 的 streaming 状态，把 UI 置为 busy；`stopRuntime` 返回空取消列表后没有把 stale streaming assistant 收口。

解决方式：

- Core bootstrap runtime payload 增加 `busy`，以 `activeTasks.hasActive()` 作为后端真实忙碌状态。
- renderer replay 后如果发现 assistant 仍 streaming，但 bootstrap `runtime.busy === false`，调用 `settleStaleStreamingAssistant()` 收口。
- ready event 中如果连接恢复但后端 `busy=false`，也收口 stale streaming。
- stopRuntime 返回空取消列表时，不再让 UI 永远保持 busy，而是把 stale assistant 标记为中断。

解决证据路径：

- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/api/core-api.ts:232`
  - bootstrap runtime payload 包含 `busy: this.loop.activeTasks.hasActive()`。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/api/core-api.ts:264`
  - `chat.stopRuntime()` 返回 `{ cancelled, active }`。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/types.ts`
  - `RuntimeReplayPayload` / ready event 类型包含 `busy?: boolean`。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.ts:598`
  - replay 后 `runtime.busy === false` 时调用 stale settle。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.ts:1050`
  - ready event 后端不忙时收口 stale streaming。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.ts:1578`
  - `settleStaleStreamingAssistant()` 结束 running thought/tool，补中断文案，清 `busy`。

验证证据：

- `npm --prefix desktop run test -- useRuntime.test.ts toolGroupModel.test.ts assistantFlowProjection.test.ts toolDisplay.test.ts`
  - 结果：4 个测试文件通过，53 个测试通过。
- 关键测试在 `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.test.ts`
  - 覆盖 stale runtime replay + bootstrap busy=false。
  - 覆盖 stopRuntime 返回空取消列表时清理 stale streaming。

剩余注意：

- 仍建议用真实 Electron 重启 + 旧 session replay 做人工复查，因为 localStorage snapshot、runtime events、ready event 到达顺序会影响表现。

## P1-2：工具卡默认展开，旧工具输出缺失像渲染失败

状态：已解决（当前工作树）；旧历史只做降级展示。

症状：

- 工具卡片默认展开，长 IN/OUT 或 todos 会占据整屏。
- 旧版 `tool_result/tool_run_completed` 只保存 summary 时，刷新后 OUT 只能显示摘要，用户容易理解为“卡片渲染失败”。

旧历史证据：

- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl`
  - 当前会话有 136 条 `tool_result`、120 条 `tool_run_completed`、15 条 `tool_run_failed`。

解决方式：

- 所有工具卡默认闭合，用户点击后展开。
- runtime `tool_result` / `tool_run_completed` 保存压缩后的 `output`，前端 OUT 优先显示 `output`。
- 旧事件没有 `output` 时显示“历史事件仅保存摘要”，避免空白或伪装成完整 OUT。

解决证据路径：

- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/toolGroupModel.ts:4`
  - `toolCardDefaultOpen()` 返回 `false`。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/ToolGroup.vue:15`
  - 分组工具卡默认展开状态来自 `toolCardDefaultOpen()`。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/ToolEvent.vue:12`
  - 单个工具卡默认展开状态也来自 `toolCardDefaultOpen()`。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/agent/runner.ts:984`
  - `emitToolResult()` 将 `ToolResultObj.modelContent` 经过 compact 后写入 runtime `output`。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/tools/execution.ts:207`
  - tool execution 层的 `tool_run_completed` 携带 compact output。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/runtime/chatProjection.ts:107`
  - replay `tool_result` 时投影 `summary/output/metadata/todos`。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/ToolDetailBody.vue:19`
  - OUT 优先显示 `output`；旧事件缺 `output` 时显示“历史事件仅保存摘要”。

验证证据：

- `npm --prefix desktop run test -- useRuntime.test.ts toolGroupModel.test.ts assistantFlowProjection.test.ts toolDisplay.test.ts`
  - 结果：4 个测试文件通过，53 个测试通过。
- 关键测试在 `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/toolGroupModel.test.ts`
  - 覆盖 running、error、subagent 工具卡默认闭合。

剩余注意：

- 旧历史不会补写完整工具输出。旧 session 刷新后只能显示降级摘要。

## P1-3：Plan / ask 之后回复线条中断

状态：未解决。

症状：

- 用户在 ask 或 plan 之后看到回复线条断裂。
- plan card、ask card、后续工具调用、assistant 文本之间的 timeline 关系不稳定。
- 截图证据：
  - `/Users/anhuike/Desktop/截屏2026-07-03 上午9.38.21.png`
  - `/Users/anhuike/Desktop/截屏2026-07-03 上午9.40.31.png`

相关数据：

- 当前 runtime 中 `plan_draft_delta` 有 2213 条，是最大事件类型。
- 这说明 plan 草稿流式事件对 replay 和 timeline projection 压力很大。

相关源码路径：

- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/control/manager.ts:596`
  - control interaction emit `ask_request` 或 `plan_draft`。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/agent/runner-helpers.ts`
  - ask / plan runtime event helper。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/runtime/chatProjection.ts:150`
  - replay `ask_request` / `plan_draft`。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/runtime/chatProjection.ts:158`
  - replay `plan_draft_delta`。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.ts:812`
  - live `ask_request` / `plan_draft` 处理。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.ts:817`
  - live `plan_draft_delta` 处理。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/assistantFlowProjection.ts`
  - 最终 timeline block 分组和线条投影。

未解决原因：

- 目前还没有为 ask -> answer -> continuation、plan_draft_delta -> plan_draft -> approved -> tool call 建立完整 replay fixture。
- 尚未证明断线是 CSS、projection block 分组、runtime event 顺序，还是 virtual scroller remount 导致。

后续建议：

- 先用旧 session 事件截取最小 fixture，写 `chatProjection` 和 `assistantFlowProjection` 回放测试。
- 确认事件序列正确后再改组件样式；不要直接用 CSS 遮盖。
- `plan_draft_delta` 应合并成一个 plan draft block，不应在 UI 形成大量历史节点。

## P1-4：命令安全策略拒绝 `python3 -c` 后模型仍反复尝试

状态：未解决。

症状：

- 旧会话中多次调用 `python3 -c`，被安全策略拒绝。
- 模型没有及时改用允许的脚本文件或普通 test 命令，浪费 turns。

旧历史证据：

- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl:2851`
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl:3021`
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl:3412`
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl:4506`
  - 都是 `Error: command refused by safety policy (matches dangerous pattern: /\bpython3?\s+-c\b/)`。

相关源码路径：

- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/tools/builtin.ts:287`
  - `DENY_PATTERNS` 列表。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/tools/builtin.ts:326`
  - `RunCommand.execute()` 逐项匹配 deny pattern。

未解决原因：

- 安全策略本身合理，没有计划移除 `python3 -c` 禁止规则。
- 还没有实现“同类 safety refusal 重复出现时，对模型注入替代策略 nudge”的 runner 逻辑。

后续建议：

- 工具错误摘要中附带可执行替代建议，例如“请写临时脚本文件或使用现有 test 文件，不要使用 python -c/node -e”。
- runner 统计同一 turn 内相同 deny pattern 的重复次数，达到阈值后提示模型换策略。

## P1-5：会话 replay 数据量偏大，影响恢复稳定性和 UI 性能

状态：未解决。

症状：

- 单个 session runtime events 达到 4797 行，其中 `plan_draft_delta` 2213 条。
- 长 session replay 容易放大 UI 恢复、工具卡状态、timeline 断裂、busy 状态误判等问题。

证据路径：

- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/events.jsonl`
- `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a/runtime/index.json`

相关源码路径：

- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/runtime/events.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/agent/runtime-events.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/runtime/chatProjection.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.ts:573`

未解决原因：

- 当前逻辑仍主要是 replay 全量事件后投影。
- 对 `plan_draft_delta` 这类高频中间态事件，还没有 runtime compaction 或 checkpoint。

后续建议：

- runtime store 层增加按 turn 的 replay compaction：只保留最后的 `plan_draft`，压缩历史 `plan_draft_delta`。
- 增加 per-session runtime stats UI，用户可以看到异常大 session。
- replay 应恢复最终 UI 状态，不应把所有无用中间 delta 重放到组件层。

## P1-6：项目多 session 与 session 懒创建

状态：待实施。

目标行为：

- 同一个 build project 支持多个 session，并在项目分组下展示多个会话条。
- 用户点击“新对话/新建项目会话”后，只进入一个隐藏 draft；侧边栏不出现会话条，也不落盘。
- 用户发送第一条消息时才创建真实 session，初始标题为“新会话”。
- 首条消息落盘后只调用一次 AI 标题生成；收到 `session_title_updated` 后替换标题。

当前实现观察：

- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/runtime/sidebarModel.ts`
  - 已经按 `project_id/project_path` 聚合 build session，模型上具备“一个项目多 session”的侧边栏基础。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/runtime/sessionDrafts.ts`
  - 已有 draft session helper，以及 `session_created/client_draft_id` 的前端替换入口。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useSession.ts`
  - 当前 `create()` 仍会立即调用后端创建真实 session，并插入侧边栏；不符合“未发言不展示、不落盘”的目标。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.ts`
  - 当前 `sendMessageViaCore()` 对 draft session 的处理还不是完整首条消息提交链路。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/api/chat-service.ts`
  - 当前 `chat.submit` 需要真实 session；draft submit 需要在 Core 侧创建真实 session 后再进入 turn。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/sessions/title.ts`
  - 已有 `SessionTitleService`，但尚未作为“首条消息后一次性生成标题”的完整流程接入。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/sessions/store.ts`
  - 已支持 `title_status` 和 `setGeneratedTitle()`，可复用为 `pending -> generated/manual` 状态流。

计划修改：

- 改 `useSession.create()`：创建本地隐藏 draft 并激活，但不写入 `sessions.value`；`load()` 空列表时也创建隐藏 draft，不 POST 后端。
- 改 `sendMessageViaCore()`：允许 draft submit，把 draft id、mode、project metadata 传给 Core。
- Core 在 `MainlineTurnService` 识别 draft submit：创建真实 session，标题为“新会话”，`title_status: pending`，emit `session_created(client_draft_id)`，再提交 turn。
- 首条消息写入后触发 `SessionTitleService.generate(firstMessage)`；成功或 fallback 后调用 `setGeneratedTitle()`，并 emit `session_title_updated`。
- 项目行增加“新建该项目会话”入口：创建隐藏 build draft，继承 project id/path/name；发送首条消息后成为该项目分组下的新 session。

验收标准：

- 点击新对话后，侧边栏不新增行，`activeId` 为 `draft:*`，聊天区为空且可输入。
- draft 首条发送后，Core 创建真实 session，前端用真实 session 替换 `activeId`，并将 session 插入侧边栏。
- 同一个 project 下可以创建并展示多个 build sessions。
- 首条消息后标题先显示“新会话”，随后被 AI 生成标题或 fallback 标题替换。
- 未发消息的 draft 不写入 `.emperor/sessions`。

## P1-7：session 行运行状态与后台完成提醒

状态：待实施。

目标行为：

- session 条左侧展示 transient 状态：运行中显示旋转圈。
- 如果该 session 后台运行完成且用户当前不在此 session，显示提醒小点。
- 用户进入该 session 后，小点消失。
- 已有 ask 等待回答和 plan 待确认标签保持现状，不纳入本次重构。

当前实现观察：

- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/layout/SessionSidebar.vue`
  - 目前主要展示 active 样式、control pending tag、标题和 preview，没有 per-session running/attention 状态槽。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/runtime/sidebarModel.ts`
  - 当前投影 ask/plan pending tag，但没有 runtime running/attention 状态。
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.ts`
  - 已能收到 runtime event，并按 `session_id` 过滤/投影当前聊天；可扩展本地 `sessionRuntimeState`。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/runtime/active.ts`
  - 当前 `ActiveTaskInfo` 没有 `session_id`，bootstrap active task 不能直接定位运行归属。
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/agent/loop.ts`
  - `runUserTurn()` 注册 active task 时需要传入当前 session id，供 renderer 恢复运行归属。

计划修改：

- 扩展 `ActiveTaskInfo` 增加 `session_id`，并在 `AgentLoop.runUserTurn()` 注册 active task 时写入当前 session id。
- renderer 新增本地瞬态状态：`sessionRuntimeState[sessionId] = { running, attention }`，不落盘。
- 收到本 session 的 `user_message/message_delta/tool_*` 或 bootstrap active task 时标记 `running=true`。
- 收到 `assistant_done/turn_paused/turn_cancelled/turn_error` 等终态时清 `running`；如果 owner session 不是当前 active session，则 `attention=true`。
- `activateAndEmit(id)` 成功后清除该 session 的 `attention`。
- 展示优先级：running spinner > ask/plan pending tag > attention dot。
- CSS 使用左侧固定 8-10px 状态槽，spinner 不挤压标题，小点使用轻量醒目色。

验收标准：

- 当前 session 运行中：该 session 行左侧显示 spinner。
- 用户切到其他 session 后，原 session 继续运行：原 session 行保持 spinner。
- 原 session 后台完成：spinner 消失，attention dot 出现。
- 用户进入该 session：attention dot 消失。
- 用户一直停留在当前 session 时，完成后不出现 attention dot。
- ask/plan pending tag 行为保持不变。

## P2-1：Agent 有实现能力，但收尾能力和最终汇报弱

状态：未解决。

评价范围：

- 当前实际有内容的 session 是 `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/96b48b393aa7464a`。
- 另一个 Default session `/Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/cbdb05112b1a4dc2` 是空会话。
- 因此本节能力评价只基于 `96b48b393aa7464a` 这个 build session。

结论：

- 这个 agent 的“写代码能力”还可以，但“工程编排/收束能力”明显不合格。
- 它能把一个创意项目做出可运行雏形，但会在计划、验证、状态同步和最终汇报上反复失控。
- 当前 agent 已经具备“能做事”的底层能力，但还不是可靠的 coding agent。

它做成了什么：

- 用户要求“随意打造一个东西”，agent 选择做 `Terminal Dreamscape`：纯 Python 标准库终端动画工坊。
- 实际产物在 `/Users/anhuike/Desktop/emperor/terminal-dreamscape/main.py`。
- 产物包含：
  - `main.py`
  - `engine/terminal.py`
  - `engine/framebuffer.py`
  - `scenes/donut.py`
  - `scenes/life.py`
  - `scenes/mandelbrot.py`
  - `scenes/matrix.py`
  - `scenes/fireworks.py`
  - 5 个测试文件
- 现有验证全部通过：
  - `python3 tests/test_engine.py`
  - `python3 tests/test_step2.py`
  - `python3 tests/test_donut.py`
  - `python3 tests/test_framebuffer.py`
  - `python3 tests/test_all_scenes.py`
  - `python3 -m py_compile main.py engine/*.py scenes/*.py tests/*.py`
- 它不是完全空转：确实产出了约 1447 行 Python 代码，并且基础 smoke test 通过。

主要问题：

- 历史工作区绑定仍然可疑：该 session 绑定的是 `/Users/anhuike/Desktop/emperor`，不是用户后续明确要求长期使用的 `/Users/anhuike/Documents/workspace/emperor-agent/`。本点只作为该历史 session 的观察记录，不在本文重新设为独立问题项。
- 计划执行失控：该 session 三次触发 `max_turns=20`，最终回复都是“（达到 max_turns=20 上限，未办妥；history 中已有部分进展）”。这说明 agent 没有能力在完成大部分工作后主动收束、总结、交付。
- 旧 PlanEvidence gate 造成循环：日志里有 3 次 `PLAN_EVIDENCE_REQUIRED`，都发生在 `update_todos`。这是旧设计问题，已在 P0-1 记录并修复：todo 曾被当成验证裁判，导致完成状态无法推进。
- 工具调用噪音过大：runtime 有 4797 条事件，约 12.3MB；其中 `plan_draft_delta` 有 2213 条，工具事件也非常多。UI 和认知负担都太重。
- 错误恢复一般：工具统计里 `run_command` 29 成功 / 4 失败，`read_file` 53 成功 / 8 失败，`tool_run_failed` 15 次。失败包括安全策略拒绝 `python3 -c`，以及多次读取不存在文件。它后面能绕过去，但没有快速建立稳定验证路径。
- 交付质量有瑕疵：例如 `/Users/anhuike/Desktop/emperor/terminal-dreamscape/main.py:7` 文档写 `1-7 Select a scene`，实际只有 1-5；`Keyboard` 类 docstring 重复。不是致命问题，但说明最后没有做干净的人工级 polish。

能力评分：

- 代码生成能力：7/10。能产出结构化项目，能写多个模块，能补测试，最终 smoke test 通过。
- 工程推进能力：5/10。会拆计划，也会执行，但容易陷入工具链和计划状态机，不能稳定判断“已经够交付了”。
- 会话/状态管理：3/10。旧 session 中存在 `max_turns`、`PlanEvidence`、UI 卡死、工具卡片展开、旧状态复活等问题。当前工作树已经修了一部分，但这条 session 暴露的问题很典型。
- 用户体验：4/10。用户看到的是“继续、继续、继续、max_turns”，而不是“我已完成 X，验证 Y，通过 Z，剩余风险是 W”。这点对 agent 产品来说很伤。

未解决原因：

- runner 还没有“接近 max_turns 自动收尾”的策略。
- 最终答复前还没有统一检查 todo list、active task、control pending、runtime running tools 四类状态并给出一致结论。
- 系统仍缺少明确的“完成判定”和“最终交付报告”机制：当代码与测试已经足够时，应停止扩展任务，而不是继续被隐藏 followup、plan 状态或工具失败牵引。

后续建议：

- 在 runner 层建立“接近 max_turns 的收尾策略”：停止继续扩展，实现状态总结和可恢复 checklist。
- 对已完成但未汇报的工作，自动生成 concise delivery report，而不是继续进入下一轮隐藏 followup。
- `max_turns` 触发时输出结构化结果：已完成、未完成、失败原因、可恢复命令、下一步建议。
- 最终答复前做一次轻量收束检查：产物路径、变更摘要、验证命令与结果、已知瑕疵、后续建议。

## 本次文档更新时重新跑过的验证

在 `/Users/anhuike/Documents/workspace/emperor-agent` 下执行：

```bash
npm test --workspace @emperor/core -- runner.test.ts control.test.ts tools.test.ts
```

结果：

- `src/tools.test.ts` 通过。
- `src/control/control.test.ts` 通过。
- `src/agent/runner.test.ts` 通过。
- 合计：3 个测试文件通过，85 个测试通过。

在 `/Users/anhuike/Documents/workspace/emperor-agent` 下执行：

```bash
npm --prefix desktop run test -- useRuntime.test.ts toolGroupModel.test.ts assistantFlowProjection.test.ts toolDisplay.test.ts
```

结果：

- `src/renderer/src/components/chat/toolGroupModel.test.ts` 通过。
- `src/renderer/src/components/chat/toolDisplay.test.ts` 通过。
- `src/renderer/src/components/chat/assistantFlowProjection.test.ts` 通过。
- `src/renderer/src/composables/useRuntime.test.ts` 通过。
- 合计：4 个测试文件通过，53 个测试通过。

## 建议给后续 AI 的处理顺序

1. 先跑 session 诊断，不要直接清洗旧 session：
   - `cat /Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/index.json`
   - `wc -l /Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/*/history.jsonl`
   - `wc -l /Users/anhuike/Documents/workspace/emperor-agent/.emperor/sessions/*/runtime/events.jsonl`
2. 如果排查 UI，先用 fixture 复现 replay，再改组件。
3. 如果排查 runner，先看是否有 hidden followup 注入，再看模型输出本身。
4. 不要把旧 session 中的 `PLAN_EVIDENCE_REQUIRED` 当成新代码仍在复发；必须开新 session 验证。
5. 每次修复后至少跑：
   - `npm test --workspace @emperor/core`
   - `npm run typecheck --workspace @emperor/core`
   - `npm --prefix desktop run test`
   - `npm --prefix desktop run typecheck`

## 当前工作树中与这些问题相关的未提交文件

以下文件在当前工作树中与本问题清单直接相关，后续提交或审查时应重点看：

- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/agent/runner.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/agent/runner.test.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/api/core-api.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/control/manager.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/control/plan-execution.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/control/plan-verification.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/control/control.test.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/tools/builtin.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/packages/core/src/tools.test.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/composables/useRuntime.test.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/toolGroupModel.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/toolGroupModel.test.ts`
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/ToolGroup.vue`
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/components/chat/ToolEvent.vue`
- `/Users/anhuike/Documents/workspace/emperor-agent/desktop/src/renderer/src/types.ts`
