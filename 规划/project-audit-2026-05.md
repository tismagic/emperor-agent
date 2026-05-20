# Emperor Agent 整体工程审核报告 · 2026-05

## 1. 审核结论

本轮审核覆盖逻辑正确性、代码质量、复用性、扩展性、运行期数据、安全边界、前端一致性与测试验证。结论是：项目当前已经从 demo 形态进入了“可持续本地 Agent 平台”的工程形态，核心子系统分层基本清晰，测试覆盖也覆盖了 Agent Team、Ask/Plan、权限、Scheduler、Watchlist、Runtime、Token、Memory 等关键路径。

当前没有发现 P0 级别的“无法启动 / 大面积数据丢失 / 明显权限全局绕过”问题。全量后端测试、前端构建和主要 API smoke 均通过。

但项目已经进入复杂系统阶段，主要风险从“功能有没有”转为“长期运行是否稳定、边界是否一致、模块是否继续膨胀”。本轮识别出 3 个 P1、8 个 P2 和若干 P3 收口项。

## 2. 验证结果

- `git status --short --branch`：`main...origin/main`，工作区干净。
- `git diff --check`：通过。
- 后端重点分组测试：通过。
  - `tests/unit/test_control.py tests/unit/test_permissions.py`
  - `tests/unit/test_runtime_events.py tests/unit/test_active_tasks.py`
  - `tests/unit/test_scheduler_store.py test_scheduler_service.py test_scheduler_api.py test_scheduler_tool.py test_scheduler_executor.py`
  - `tests/unit/test_team.py test_watchlist.py test_model_router.py test_token_usage.py`
- `.venv/bin/python -m pytest`：`154 passed in 121.15s`。
- `cd webui && npm run build`：通过。
  - 仍有既有 warning：`../../assets/textures/texture-seal.png ... didn't resolve at build time`，未导致失败。
- Web smoke：启动 `python webui.py` 后以下接口均返回 200：
  - `/api/bootstrap`
  - `/api/control`
  - `/api/scheduler`
  - `/api/team`
  - `/api/memory`
  - `/api/tokens`
  - `/api/model-config`
  - `/api/watchlist`
  - `/ws?last_seq=0` 返回 `ready`。
- 质量门禁缺口：`pyproject.toml` 配置了 Ruff，但当前 `.venv` 未安装 `ruff`，`python -m ruff check agent tests` 无法运行。

## 3. 当前架构地图

后端主链路：

```text
WebSocket / CLI
  -> AgentLoop
  -> AgentRunner
  -> ModelCaller / provider
  -> ToolRegistry / Tool
  -> MemoryStore / HistoryLog / RuntimeEventStore
  -> WebUI runtime replay
```

主要子系统：

- `agent/control/`：Ask / Plan pending interaction、模式状态、暂停恢复。
- `agent/permissions/`：`ask_before_edit` / `auto` / `plan` 三模式权限判断。
- `agent/runtime/`：WebUI 行为事件冷记录与刷新重放。
- `agent/team/`：持久 teammate、inbox、thread、checkpoint、MessageBus。
- `agent/scheduler/`：本地长期任务、timer service、protected system jobs、scheduler tool。
- `agent/watchlist/`：长期关注项，周期判断 `skip/run`。
- `agent/web/`：aiohttp app、routes、services。
- `webui/src/runtime/`：目前只有轻量 replay/selectors/persistence，核心归约仍主要留在 `useRuntime.ts`。

## 4. P1 问题

### P1-1 `/api/memory/episode` 可写入非日期记忆文件

证据：

- `agent/web/services/memory_service.py:35-55`
- `get_memory_episode()` / `post_memory_episode()` 只检查 `date` 是否为空、是否包含 `..`、`/`、`\`。
- 路径拼接为 `memory/{date}.md`。

影响：

- 调用 `POST /api/memory/episode` 且 `date=MEMORY.local` 时，目标会变成 `memory/MEMORY.local.md`，可绕过长期记忆专用接口写入长期记忆文件。
- `date=watchlist` 等也会写入非情景记忆语义的文件。
- 这属于运行期数据边界错误，未来如果接入更多本地 API 或自动任务，容易造成误写。

建议修复：

- 把 episode date 校验收敛为统一函数，例如 `validate_episode_date(date) -> YYYY-MM-DD`。
- `GET/POST /api/memory/episode` 只接受 `^\d{4}-\d{2}-\d{2}$`。
- `MemoryService.memory()` 枚举 episodes 时也只返回 `YYYY-MM-DD.md`。
- 对 `MEMORY.local.md`、`watchlist.md`、`versions/` 等非 episode 文件做明确排除。

建议测试：

- `GET /api/memory/episode?date=2026-05-20` 成功或 404。
- `POST /api/memory/episode date=MEMORY.local` 返回 400，且不修改长期记忆。
- `date=../x`、`date=watchlist`、`date=2026-5-1` 均返回 400。

### P1-2 Scheduler timer 执行多任务时，执行结果只在批次结束后保存

证据：

- `agent/scheduler/service.py:280-299`
- `_on_timer()` 找到所有 due jobs 后循环执行，直到所有 due job 完成后才 `self.store.save(data)`。
- `_execute_job()` 内会执行真实 job 并更新内存中的 `job.state`，但不立即持久化。

影响：

- 如果进程在某个 job 已经产生副作用后、批次保存前崩溃，`lastRunAtMs`、`nextRunAtMs`、`runHistory` 没有落盘。
- 重启后该 job 仍可能被认为到期，从而重复执行。
- 对 `agent_turn`、`team_wake` 这类有副作用任务来说，这是长期自主性系统的可靠性风险。

建议修复：

- `_execute_job()` 开始前先写入 `running` 或 `started` 状态，完成一个 job 立即保存一次。
- `_on_timer()` 不要等整个 due 批次结束才保存。
- 对同一 job 增加 in-flight 标记或 lease，启动时把 stale running 标记为 `error/offline/retryable`。
- protected system job 可继续低风险处理，但 user-created job 应避免重复副作用。

建议测试：

- fake store 在第一个 due job 执行后抛异常，验证第一个 job 的 run history 已保存。
- 重启后已执行 job 不会立即重复执行。
- 对 `at + deleteAfterRun` job 验证执行后删除状态可在崩溃点前后保持一致。

### P1-3 `memory/runtime/events.jsonl` 无轮转，且 replay/stats 都会全量扫描

证据：

- `agent/runtime/store.py:38-64`
- `replay_after()`、`recent()`、`events_for_turns()`、`stats()` 都通过 `_iter_events()` 从头扫描整个 `events.jsonl`。
- `RuntimeEventStore.append()` 永久 append，没有热/冷分层、索引、归档或上限。

影响：

- Chat 行为持久化是刷新恢复的关键能力，但长期使用后 `events.jsonl` 会持续增长。
- `/api/bootstrap.runtime.events`、Memory 页 runtime stats、WebSocket reconnect replay 都会越来越慢。
- 历史压缩已治理 `history.jsonl`，但 runtime 冷记录仍会成为下一个启动/刷新性能瓶颈。

建议修复：

- 复用 `HistoryLog` 的热/冷思路：`memory/runtime/events.jsonl` 保留活跃 turn，旧事件归档到 `memory/runtime/archive/YYYY-MM.jsonl.gz`。
- 增加 `memory/runtime/index.json`，记录 latest seq、活跃 turn、归档文件和大小。
- `events_for_turns()` 改为先按 active turn id 索引过滤，避免全量扫描。
- 保留“审计历史”能力，但不要让 Chat 首屏依赖全量 runtime log。

建议测试：

- 旧 runtime log 迁移后 latest seq 不回退。
- bootstrap 只返回未压缩 turn 的事件。
- 损坏 JSONL 行被跳过并计入 stats。
- 大量事件下 replay 只读取热段。

## 5. P2 问题

### P2-1 Scheduler `deliver` 字段被 UI/API 保存，但执行器完全忽略

证据：

- `agent/scheduler/models.py:86-114` 定义 `SchedulerPayload.deliver`。
- `webui/src/components/panels/SchedulerPanel.vue:287` 和 `:352` 暴露 “deliver result to runtime”。
- `agent/web/services/scheduler_executor.py:45-87` 对 `agent_turn` 总是写 history、广播 user_message 并进入 Chat runtime。
- `agent/web/services/scheduler_executor.py:89-109` 对 `team_wake` 也总是广播 team 事件。

影响：

- 用户以为可以关闭投递，但实际仍会出现在 Chat / runtime。
- 这会破坏长期任务的可预期性，尤其是后台维护、周期检查、低噪声 watchlist。

建议修复：

- 明确定义 `deliver=false` 的语义：不在 Chat 插入可见 user message，但仍记录 scheduler run history。
- `agent_turn` 若不投递，应走独立后台结果记录或只写 Scheduler run summary。
- `team_wake` 若不投递，应仍执行 MessageBus，但 WebUI 只更新 Scheduler job，不把队友回禀挂进当前 Chat timeline。

建议测试：

- 创建 `deliver=false` 的 agent_turn，手动 run 后 Chat runtime 不新增 user_message。
- Scheduler run history 仍记录 ok/error。
- UI checkbox 与实际行为一致。

### P2-2 直接 HTTP mutation route 没有统一经过权限/审批层

证据：

- `agent/web/services/team_service.py:26-75` 可直接 spawn/message/wake/shutdown teammate。
- `agent/web/services/scheduler_service.py:18-94` 可直接 create/update/run/pause/resume/delete scheduler job。
- `agent/web/state.py:247-256` 只限制切换 control mode 时 active/pending，不限制其他 mutation API。

影响：

- Agent 工具路径受到 `agent/permissions/` 约束，但 WebUI/API 手动路径是另一套规则。
- 如果未来引入外部 channel 或自动化调用这些 HTTP API，Plan 模式的“禁止 Team 写操作 / durable job 变更”容易被绕过。
- 当前本地单用户 WebUI 下风险较低，但工程语义不统一。

建议修复：

- 新增 Web mutation guard，例如 `WebMutationPolicy` 或复用 `PermissionPolicy`。
- 手动 WebUI 明确用户点击可直接执行，但需要把行为定义清楚：是“用户直接操作，不受 agent mode 约束”，还是“所有写操作都遵循当前 mode”。
- 若选择统一遵循 mode：Plan 模式下禁用 Team/Scheduler 写按钮，或者弹出 Ask/approval。

建议测试：

- Plan 模式下 POST scheduler create 的预期行为有明确测试。
- Plan 模式下 Team wake 的预期行为有明确测试。
- ask_before_edit 下 WebUI 高风险手动操作是否需要二次确认有一致规则。

### P2-3 `model_config.json` 保存不是原子写，且与视觉标记存在竞态窗口

证据：

- `agent/model_config.py:161-168` 使用 `path.write_text(...)`。
- `agent/model_config.py:171-187` 的 `mark_entry_vision()` 读取 raw 后再 `save_model_config()`。
- WebUI 保存入口虽然有 `state.lock`，但 model test 标记视觉和其他入口未统一走同一文件锁。

影响：

- 进程中断或并发保存时可能产生半写文件或覆盖较新的配置。
- 模型配置是启动关键文件，损坏后会影响整个服务。

建议修复：

- 引入 `ModelConfigStore` 或在 `save_model_config()` 内部使用唯一临时文件 + `replace()`。
- 使用进程内 `RLock`，如需要支持多入口再补 `filelock`。
- `mark_entry_vision()` 走同一 store 的 compare/update/save 流程。

建议测试：

- monkeypatch 写入中断，原 `model_config.json` 保持可读。
- 并发保存不同字段，不丢已有 entry。
- 视觉测试标记不覆盖用户刚保存的 secondary model id。

### P2-4 `write_file` / `edit_file` 直接覆盖文件，缺少原子写和备份策略

证据：

- `agent/tools/filesystem.py:118-123` 直接 `write_text`。
- `agent/tools/filesystem.py:240-285` 读 bytes 后直接 `write_bytes`。

影响：

- 如果进程中断、磁盘错误或编码异常发生在写入期间，目标文件可能被破坏。
- 这与项目其他运行期 store 的“临时文件 + replace”风格不一致。

建议修复：

- 为写入型文件工具增加 atomic write helper。
- `edit_file` 在替换前可生成短期 `.bak` 或 MemoryVersion 风格快照，至少对 tracked source 文件可恢复。
- 保留当前语义，不额外做大范围格式化。

建议测试：

- 写入中断时原文件不变。
- CRLF 文件 edit 后仍保持 CRLF。
- `replace_all=false` 多匹配仍不写入。

### P2-5 Watchlist 手动检查不进入 ActiveTaskRegistry，不能被统一 stop/cancel

证据：

- `agent/web/services/memory_service.py:102-108`
- `post_watchlist_check()` 直接 `await self.state.watchlist_service.check()`。
- `agent/runtime/active.py` 已经提供统一 active task registry，但此路径未接入。

影响：

- Watchlist check 可能发起次模型调用，当前 Chat 停止按钮和 `/api/runtime/stop` 不能取消它。
- UI 上也无法知道它是 active task。

建议修复：

- 手动 watchlist check 使用 `active_tasks.run(kind="scheduler" 或 "watchlist")`。
- 运行中广播轻量 runtime event，Memory 页按钮显示 loading / cancellable。

建议测试：

- 手动 check 期间 `/api/runtime/stop` 能取消。
- 取消后 Watchlist state 不写入误导性的成功决策。

### P2-6 Slash command / mode 切换的异步错误没有统一展示

证据：

- `webui/src/App.vue:102-134` 中 `submitFromComposer()` 对 `executeSlashCommand()` 使用 `void`，未 catch。
- `webui/src/App.vue:136-222` 中 `executeSlashCommand()` 自身不 catch，`setControlMode()` 409 等错误会成为未处理 promise rejection。
- `webui/src/views/ChatView.vue:32` 直接绑定 `@set-mode="ctx.setControlMode"`，没有 `runSafely` 包裹。

影响：

- 当 active turn 或 pending Ask/Plan 时切换 mode，后端会返回 409，但用户可能只看到控制台错误，没有 toast 或本地命令回执。
- 交互层不够产品化，尤其是权限模式这种高频控制。

建议修复：

- `submitFromComposer()` 中 `void executeSlashCommand(...).catch(showToast)`。
- `Composer @set-mode` 走 `runSafely(() => setControlMode(mode))`。
- `/mode`、`/plan` 出错时生成本地命令回执，而不只是 toast。

建议测试：

- active turn 下点击模式菜单，显示明确错误。
- pending Ask/Plan 下 `/mode auto` 有本地回执。

### P2-7 Runtime 前端 reducer 仍是空壳，`useRuntime.ts` 继续承担过多状态归约

证据：

- `webui/src/runtime/reducer.ts:8-13` 只排序并 dispatch。
- `webui/src/composables/useRuntime.ts` 约 1098 行，仍包含 tool/subagent/team/scheduler/control/user message 的主要处理逻辑。

影响：

- 新增 runtime event 时容易继续往 composable 里堆分支。
- 刷新恢复、WebSocket live event、本地缓存三条路径难以独立测试。
- 未来 Scheduler/Watchlist/Team 事件增多后，前端状态机维护成本会快速升高。

建议修复：

- 将 handler 拆到 `webui/src/runtime/handlers/`：
  - `chat.ts`
  - `tools.ts`
  - `subagents.ts`
  - `team.ts`
  - `control.ts`
  - `scheduler.ts`
- `useRuntime.ts` 只保留 WS 生命周期、发送、pending glue、localStorage。
- reducer 产出纯函数状态变更，live/replay 共用同一入口。

建议测试：

- 给 reducer 加纯 TS 用例或最小 vitest 脚本。
- 用同一事件序列分别走 replay 和 live，最终 message state 一致。

### P2-8 Runtime / Team unread 在 replay 时可能重复计数

证据：

- `webui/src/composables/useRuntime.ts:706-840`
- `team_message` 事件 replay 时会调用 `updateTeamBootstrap()`。
- `updateTeamBootstrap()` 对 lead/team unread 使用 `+1`，而 bootstrap 本身已经包含当前 unread 统计。

影响：

- 刷新后 runtime replay 可能把历史 `team_message` 再加一遍 unread。
- 这类错误不会影响底层 `.team` cursor，但 UI badge 会漂移，用户会误判未读状态。

建议修复：

- replay 阶段不要对 bootstrap unread 做增量，或按 message id 去重后重算 unread。
- 区分 `rehydrating` 下的 timeline 重建和 live event 下的实时增量。

建议测试：

- bootstrap 初始 `leadUnread=1`，runtime replay 包含同一条 team_message，刷新后仍为 1。
- live 收到新 team_message 时才 +1。

## 6. P3 收口项

### P3-1 前端样式文件继续偏大

证据：

- `webui/src/styles/panels.css` 约 1708 行。
- `webui/src/styles/activity.css` 约 924 行。

建议：

- 按 panel 拆分为 `styles/panels/model.css`、`tokens.css`、`team.css`、`memory.css`、`scheduler.css`。
- 第一轮只搬迁，不重设计。

### P3-2 `ModelPanel.vue` 仍然过大

证据：

- `webui/src/components/panels/ModelPanel.vue` 约 732 行。

建议：

- 拆成 `ModelEntryList.vue`、`ModelEntryEditor.vue`、`ModelTestPanel.vue`。
- 保持现有视觉与 API 不变。

### P3-3 `WebUIState` 已拆 service，但仍保留过多业务入口

证据：

- `agent/web/state.py` 约 561 行。
- 仍包含 attachment、control、model config、compact、static、skill import/delete 等多个业务入口。

建议：

- 后续继续把 attachment、control、skills/configs 的业务逻辑迁入对应 service。
- `WebUIState` 保持依赖容器、广播、json/body helper、startup glue。

### P3-4 Ruff 配置存在但工具未纳入依赖

证据：

- `pyproject.toml` 有 `[tool.ruff]`。
- `.venv/bin/python -m ruff check agent tests` 失败：`No module named ruff`。

建议：

- 新增 dev requirements，例如 `requirements-dev.txt`，包含 `pytest`、`ruff`。
- CI/本地 quality gate 明确区分 runtime deps 与 dev deps。

### P3-5 Vite 构建存在既有 texture 解析 warning

证据：

- `npm run build` 输出：`../../assets/textures/texture-seal.png ... didn't resolve at build time`。

建议：

- 检查 CSS 中对 `../../assets/textures/texture-seal.png` 的引用方式。
- 统一通过 `webui/src/assets.ts` import 或把静态文件放入 Vite public 可解析路径。

## 7. 当前优势

- 后端测试面已明显成型，本轮全量 154 个测试通过。
- Scheduler、Watchlist、Team、Control、Permissions 都有独立模块和 unit tests。
- `HistoryLog` 已把 `history.jsonl` 从永久 append-only 改为热/冷分层，这是正确方向。
- 双模型路由集中在 `ModelRouter`，没有散落到工具内部。
- Web 后端已经开始 routes/services 分层，未来可继续瘦身。
- 前端已经有 `webui/src/runtime/` 目录，虽然 reducer 仍薄，但扩展方向已经预留。
- WebUI 构建稳定，主要页面都有类型覆盖。

## 8. 建议修复路线

### Phase 1：数据安全与长期运行可靠性

目标：先修 P1，避免长期使用后出现隐性数据损坏或重复副作用。

建议 commits：

1. `fix(memory): validate episode dates strictly`
   - 收紧 `/api/memory/episode` date 校验。
   - episodes 枚举只包含 `YYYY-MM-DD.md`。
   - 增加 API/service 单测。

2. `fix(scheduler): persist job run state per execution`
   - 每个 job 执行前/后即时保存状态。
   - 增加 stale running / duplicate prevention 测试。

3. `feat(runtime): rotate event log into hot and archive segments`
   - 增加 runtime index 与 archive。
   - bootstrap/replay 只读热段。
   - Memory 页保留冷记录 stats。

验证：

```bash
git diff --check
.venv/bin/python -m pytest tests/unit/test_history_log.py tests/unit/test_memory_versions.py -q
.venv/bin/python -m pytest tests/unit/test_scheduler_service.py tests/unit/test_scheduler_executor.py -q
.venv/bin/python -m pytest tests/unit/test_runtime_events.py -q
cd webui && npm run build
```

### Phase 2：权限与手动 mutation 语义统一

目标：让 Agent 工具路径、WebUI 手动路径、未来外部 channel 对写操作的规则一致。

建议 commits：

1. `feat(web): centralize mutation guard semantics`
   - 定义 Web mutation 是否受 control mode 约束。
   - 如果受约束，Team/Scheduler mutation routes 调用统一 policy。
   - 如果不受约束，也在 README/AGENTS 明确“用户直接操作”语义。

2. `fix(scheduler): honor deliver flag`
   - `deliver=false` 不污染 Chat timeline。
   - Scheduler run history 仍记录结果。

3. `fix(watchlist): register manual checks as cancellable tasks`
   - 手动 check 接入 ActiveTaskRegistry。
   - Stop API 可取消。

验证：

```bash
.venv/bin/python -m pytest tests/unit/test_permissions.py tests/unit/test_scheduler_api.py tests/unit/test_scheduler_executor.py tests/unit/test_active_tasks.py tests/unit/test_watchlist.py -q
cd webui && npm run build
```

### Phase 3：前端 runtime 与 UI 状态机瘦身

目标：不重做视觉，只把状态流拆出可测试、可复用模块。

建议 commits：

1. `refactor(runtime-ui): move event handlers out of useRuntime`
   - 按 tool/subagent/team/control/scheduler 拆 handler。
   - live 和 replay 共用 reducer。

2. `fix(chat): surface slash and mode command errors`
   - Slash command promise 统一 catch。
   - mode menu 失败显示 toast 或本地回执。

3. `fix(team-ui): avoid unread double count during replay`
   - replay 阶段按 message id 去重或重算 unread。

验证：

```bash
cd webui && npm run build
```

手测：

- 刷新 Chat，工具卡 / Team 消息 / Scheduler 事件不重复。
- pending Ask/Plan 下切换 mode 显示明确错误。
- Team unread 不因刷新增加。

### Phase 4：工程质量门禁与低风险拆分

目标：减少继续堆大文件的趋势。

建议 commits：

1. `chore(dev): add explicit python dev requirements`
   - 增加 `requirements-dev.txt` 或等价说明。
   - 纳入 `ruff`。

2. `refactor(model-ui): split model panel components`
   - 拆 `ModelPanel.vue`。

3. `refactor(styles): split panel styles by workspace`
   - 拆 `panels.css`。

4. `refactor(web): move remaining state handlers into services`
   - `WebUIState` 继续瘦身。

验证：

```bash
git diff --check
.venv/bin/python -m pytest
cd webui && npm run build
```

## 9. 总体评价

项目方向是健康的：后端子系统边界已经比早期清晰很多，测试也能支撑继续迭代。最值得警惕的是“长期自主性”带来的隐性成本：日志增长、重复执行、后台任务投递噪声、权限语义分裂。这些不是一次功能开发能自然解决的问题，需要把它们当作平台基础设施继续打磨。

下一步不建议大爆炸重构。推荐先修 P1，再按 Phase 2/3/4 小步提交。每一步都保持：明确行为、补测试、跑 targeted + build，再进入下一步。
