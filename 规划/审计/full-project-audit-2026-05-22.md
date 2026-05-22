# Emperor Agent 全量工程审计报告

审计日期：2026-05-22
审计对象：当前工作区，包括未提交变更与新增文件。
审计方式：非破坏性检查、源码阅读、质量命令复核。未做格式化、未自动修复、未清理缓存。

## Executive Summary

当前项目已经超过“Demo Agent”阶段，具备完整个人 Agent 工程雏形：多 Provider、工具调用、子代理、Team、Scheduler、Ask/Plan 控制流、Runtime 事件持久化、Vue WebUI、附件和桌宠入口都已经存在。测试基线也不错：`.venv/bin/python -m pytest -q` 当前通过，结果为 `209 passed in 121.36s`。

总体健康度：中等偏上，但处在结构性风险拐点。核心能力能跑，局部模块也有清晰抽象；最大问题不是“缺功能”，而是组合根、运行时状态和质量门禁正在膨胀。如果继续直接往 `AgentLoop`、`WebUIState`、`useRuntime`、`App.vue` 里塞能力，项目会快速滑向难维护状态。

最大风险：

- `WebUIState` 与 `AgentLoop` 已经变成过重的服务定位器和装配中心，新增 Scheduler、External、Desktop Pet、Team、MCP 后，边界开始互相泄漏。
- Runtime 事件方向正确，但前端 reducer 还没有真正独立，`useRuntime.ts` 仍承担 WebSocket、事件规约、消息结构变更、UI pending 状态和 Team/Scheduler 分发。
- 静态质量门禁当前失效：`ruff check agent tests` 返回 `595 errors`，其中 `S101` 测试断言噪音占 `479` 个，真实生产问题被淹没。
- External Bridge 文档定位为 inbox/outbox 状态基础设施，但当前实现是进程内内存队列，重启会丢 pending、dedupe 与 outbox 状态。
- 当前工作区有大量未提交新增模块，尤其 `desktop-pet/` 和 `agent/desktop_pet/`，应作为未完成变更风险单独治理后再进入稳定主线。

是否适合继续扩展：可以继续扩展，但必须先做结构性收敛。下一阶段不建议继续堆功能，应优先把组合根、运行时事件 reducer、质量门禁、持久化边界和可选模块隔离做实。拒绝用零散 `if/try` 修补当前问题。

## Severity Findings

### P0

未发现已确认的 P0。

说明：本次审计没有发现明确会立即导致私密文件提交、主流程完全无法启动、危险命令无保护执行或已确认数据丢失的缺陷。.gitignore 覆盖了 `memory/`、`.team/`、`model_config.json`、`emperor.local.json`、`templates/USER.local.md`、`webui/dist/`、`webui/node_modules/`、`desktop-pet/node_modules/` 等关键产物。

### P1-1: `WebUIState` 成为服务定位器，Web 层边界继续扩展会失控

影响：新增能力会越来越倾向于把状态、服务、HTTP handler、WebSocket 广播、附件读取、桌宠控制都挂在同一个对象上。短期方便，长期会导致测试困难、生命周期耦合、并发状态不清晰，也会让外部桥接、Scheduler、Team、Desktop Pet 互相依赖具体实现。

证据：

- `agent/web/state.py:42` 定义 `WebUIState`。
- `agent/web/state.py:53-88` 在构造函数里同时装配 logging、`AgentLoop`、MCP、`MainlineTurnService`、`ExternalBridgeService`、`ChatService`、`MemoryService`、`ModelService`、`TeamService`、`SchedulerWebService`、`SchedulerJobExecutor`、`DesktopPetManager`、`AttachmentStore`、`RuntimeEventStore`、`WatchlistService`、active tasks 与 scheduler callbacks。
- `agent/web/state.py:90-107` 的 `bootstrap()` 直接拼接 tools、skills、memory、modelConfig、team、scheduler、control、desktopPet、runtime。
- `agent/web/state.py:109-136` 处理附件上传与 raw 文件响应。
- `agent/web/state.py:142-175` 处理 runtime event 记录和广播。
- `agent/web/state.py:188-230` 处理 active task stop 和 desktop pet 控制。

根因：`WebUIState` 同时承担 composition root、service locator、controller helper、事件总线、runtime state container。随着模块增加，缺少一个明确的 Web application service boundary。

整改方向：

- 保留 `agent/web/app.py` 为 aiohttp composition root，但拆出 `WebContainer` 或 `AppServices`，只负责依赖组装和生命周期。
- `WebUIState` 拆成窄接口：`RuntimeBus`、`AttachmentService`、`BootstrapService`、`TaskControlService`、`FeatureServices`。
- route handler 不再直接调用大型 state 方法，而依赖对应 service interface。
- 新增模块必须注册自己的 service、route、bootstrap payload producer、lifecycle hook，禁止继续向 `WebUIState` 添加业务 handler。

验证方式：

- `WebUIState` 构造函数不再直接实例化所有业务服务。
- 每个 `agent/web/routes/*.py` 只依赖一个窄 service。
- 新增单测覆盖 bootstrap payload 聚合、runtime bus 广播、desktop pet lifecycle。

### P1-2: `AgentLoop` 是过大的后端组合根，模型刷新采用原地 mutation，扩展风险高

影响：主 Agent、子代理、Team、Scheduler、MCP、Control、Memory、Tools、ModelRouter 都由 `AgentLoop` 直接装配；模型配置刷新通过修改已有 runner 字段完成。这种结构在热切换模型、子代理路由、Team runner、记忆压缩一起变化时容易产生状态不一致。

证据：

- `agent/loop.py:56-121` 构造函数完成 dotenv、logging、MemoryStore、TokenTracker、SchedulerStore/Service、Skills、ContextBuilder、ToolRegistry、ControlManager、TodoStore、SubagentRegistry、Team、MCP、ModelConfig、checkpoint/history 恢复。
- `agent/loop.py:152-231` 的 `refresh_model_config()` 先构造 `ModelRouter`、provider snapshot、compactor，再在非初始化路径上逐字段修改 `self.runner`。
- `agent/loop.py:479-513` 内联 `_make_subagent_runner()` 并注册 `DispatchSubagentTool`。
- `agent/loop.py:515-563` 内联 `_make_team_runner()` 并注册 Team tools。

根因：历史上 `AgentLoop` 从“主循环”演化成了所有能力的装配中心。缺少 `AgentRuntime`、`ToolingRuntime`、`CollaborationRuntime`、`ModelRuntime` 等中间层。

整改方向：

- 把模型相关状态收敛到 `ModelRuntime`，提供 `current_main_runner_config()`、`runner_factory(role, context)`、`refresh()`，避免散落字段 mutation。
- 把工具注册迁移到 `ToolingModule`，子代理/Team 通过同一 `RunnerFactory` 创建 runner，删除重复构造逻辑。
- `AgentLoop` 只保留 turn-level orchestration：history、runner、memory checkpoint、CLI display。
- 模型刷新采用“构造新 runner 或 immutable config swap”，不要逐字段改 runner。

验证方式：

- 热保存 `/api/model-config` 后，主 Agent、subagent、team、compactor 都通过同一 route 快照生成。
- 单测覆盖 model refresh 后 runner/provider/model/token role 一致性。
- `AgentLoop.__init__` 行数和直接依赖数量明显下降。

### P1-3: External Bridge 当前不是持久状态，重启会丢入站队列、去重和出站状态

影响：README/AGENTS 把 External Bridge 描述为外部平台接入基础设施，包含入站去重、inbox/outbox 状态。但当前实现全部在内存中。WebUI 重启、进程崩溃或系统重启后，pending 外部消息、seen dedupe、outbox recent 与 recent errors 都会丢失。后续接入飞书/Slack/Telegram 时，这会直接造成重复处理或消息丢失。

证据：

- `agent/external/service.py:37-43` 定义 `_seen`、`_inbox`、`_pending`、`_outbox`、`_recent_errors`，全部是内存结构。
- `agent/external/service.py:61-99` 入站消息只 append 到内存 `_inbox` / `_pending`。
- `agent/external/service.py:100-112` `drain_pending()` 从内存队列读取。
- `agent/external/service.py:114-152` 出站队列只写内存 `_outbox`。
- `agent/external/service.py:154-167` payload 也只从内存结构导出。

根因：External Bridge 基础层先实现了 service API，但没有落地 durable store。文档承诺和实际持久化级别不一致。

整改方向：

- 新增 `agent/external/store.py`，采用 append-only JSONL + index 或 SQLite，持久化 inbound、pending、dedupe keys、outbox、delivery status。
- `ExternalBridgeService` 不直接持有 deque/OrderedDict 作为事实源，只保留短缓存。
- 明确重启恢复策略：pending 入站如何重放、dedupe TTL、outbox 失败如何展示。
- 当前未接入真实平台前，也应把文档里的“状态”限定为 process-local，或完成持久 store 后再宣称 durable。

验证方式：

- 单测模拟 ingest 后重建 service，pending/seen/outbox 仍可恢复。
- 重启 WebUI 后 `/api/external` 能看到最近状态。
- runtime event 与 external store 的 turn_id 可互相追踪。

### P1-4: Ruff 门禁失效，595 个问题导致真实风险被噪音淹没

影响：质量门禁不可用时，团队会跳过 lint，真实问题如未记录异常、`zip()` 长度假设、未使用 import、安全规则风险会被测试断言噪音掩盖。长期会让“工程质量”无法靠自动化维持。

证据：

- 命令：`.venv/bin/python -m ruff check agent tests` 返回 `595 errors`。
- 统计：`S101=479`、`I001=47`、`UP037=31`、`E701=19`、`F401=9`、`B905=4`、`S110=2`、`S112=1`、`S108=1`。
- `pyproject.toml:42-47` 当前 select `E/F/I/B/UP/S`，但只有 `__init__.py` 忽略 `F401`，没有 test-specific `S101` 放宽。
- 真实生产样例包括：`agent/runner.py:488` 的 `zip()` 缺少 `strict=`，`agent/scheduler/store.py:188` 的 `except Exception: continue`，`agent/memory.py:154` / `171` 的 `try-except-pass`，多个未使用 import。

根因：规则启用后没有分 production/test 策略，也没有先消除历史格式债，导致 lint 变成噪音源。

整改方向：

- 分阶段重建 ruff 策略：production 严格，tests 放宽 `S101`，必要时对 CLI demo 或 migration 脚本局部忽略。
- 第一阶段只启用可稳定通过且有信号的规则：`E/F/I/B`，tests 忽略 `S101`。
- 第二阶段清理生产 `S110/S112/B905/F401`，再逐步启用 `UP` 和安全规则。
- 新增 `make check` 或 `emperor-agent doctor --dev`，把 pytest、py_compile、ruff、webui build 统一成一个入口。

验证方式：

- `ruff check agent` 必须能作为 CI gate 通过。
- `ruff check tests` 单独执行，允许 test assert。
- 报告中的真实 production issue 都有对应测试或代码修复。

### P1-5: Scheduler action log 合并时静默丢弃异常，可能导致持久任务变更不可见

影响：Scheduler 是长期自动运行中枢，任务增删改是高价值状态。当前 action log 合并遇到异常行会直接 `continue`，不记录、不隔离、不暴露给 WebUI。若 action log 部分损坏，某些任务变更可能被静默丢弃，用户无法知道长期任务是否真正生效。

证据：

- `agent/scheduler/store.py:125-146` `append_action()` 把 add/update/delete 写入 `memory/scheduler/action.jsonl`。
- `agent/scheduler/store.py:166-195` `_merge_actions()` 读取 action log 并合并到 `jobs.json`。
- `agent/scheduler/store.py:176-189` catch `Exception` 后直接 `continue`。
- Ruff 也报告 `S112 / agent/scheduler/store.py:188 / try-except-continue detected`。

根因：action log 被当成容错辅助文件，而 Scheduler 的业务语义已经把它提升为跨入口写操作记录。异常策略没有随状态重要性升级。

整改方向：

- 合并失败的行必须写入 `action.corrupt-*.jsonl` 或 store diagnostics，并在 WebUI scheduler status 暴露。
- 对部分损坏采用“可合并行继续、坏行隔离、用户可见”的策略。
- 给 `SchedulerStore` 增加 corruption metrics 和测试。

验证方式：

- 单测写入一行坏 JSON + 一行合法 update，合法 update 生效，坏行被隔离且 payload 可见。
- WebUI scheduler status 出现 lastError 或 diagnostics。

### P2-1: 并发工具批次没有触发统一 pause 检查，Ask/Plan 工具结果存在行为不一致

影响：单工具路径执行后会调用 `_maybe_pause_for_control()`，但并发安全工具批量执行分支没有调用。若未来把 `ask_user`、`propose_plan` 或其他控制类/审批类工具错误标记为并发安全，或者并发批次里返回控制暂停语义，runner 可能不会在正确时机暂停。

证据：

- `agent/runner.py:481-495` 并发安全 group 使用 `asyncio.gather()` 后只记录 result 和 emit tool_result。
- `agent/runner.py:501` 单个 concurrency-safe 分支调用 `_maybe_pause_for_control()`。
- `agent/runner.py:509` 普通工具分支调用 `_maybe_pause_for_control()`。

根因：控制流暂停逻辑挂在执行路径局部，而不是“每个 tool result 回填后”的统一阶段。

整改方向：

- 把 `_maybe_pause_for_control()` 移到 tool result collector 的统一回填层。
- 明确控制类工具永远 non-concurrency-safe，并增加 registry-level invariant test。
- 并发批次中如果任意工具触发 pause，应先补齐所有 tool results，再抛 `TurnPaused`，保证 provider history 成对。

验证方式：

- Fake concurrent tool 返回 ask/plan marker 时，runner 产生完整 tool result 并进入 paused。
- 工具调用配对测试覆盖并发分支。

### P2-2: API middleware 把内部异常文本直接返回给前端

影响：本地单用户项目风险低于公网服务，但 `/api/*` 500 直接返回 `str(exc)`，可能泄露本地路径、模型 key 相关异常、命令输出片段或平台 adapter 错误细节。后续 External Bridge 或局域网访问启用时风险会上升。

证据：

- `agent/web/app.py:36-43` catch generic `Exception` 后返回 `{"error": str(exc)}`，status 500。
- `agent/web/app.py:29-34` HTTPException reason 也直接返回。

根因：调试友好和用户可见错误没有分层；缺少 error id / log correlation 机制。

整改方向：

- API 统一返回 `{error: "Internal server error", errorId}`；详细异常只写 log。
- 对已知用户错误使用 typed exception 或 `web.HTTPBadRequest` 的安全 message。
- WebUI toast 显示安全 message，开发日志可查 errorId。

验证方式：

- 单测构造 handler 抛异常，响应不包含真实 exception text，但日志含 errorId。

### P2-3: 本地配置损坏时静默回退默认值，用户可能误以为配置被系统改掉

影响：`emperor.local.json` 损坏时直接返回默认配置，会让 WebUI 端口、openBrowser、desktopPet enabled 等偏好静默消失。虽然不等同于数据删除，但用户可见行为会突然改变，排查成本高。

证据：

- `agent/local_config.py:31-39` `load_local_config()` 对 `json.JSONDecodeError` / `OSError` 直接 `return LocalConfig()`。
- `agent/local_config.py:68-85` 保存时采用 temp + replace，这是好点，但读取损坏没有提示或备份。

根因：读取失败策略只考虑不中断启动，没有把“配置损坏”作为可观察事件。

整改方向：

- 损坏文件重命名为 `emperor.local.json.corrupt-*`，返回默认值并记录 warning。
- `/api/bootstrap` 或 `emperor-agent doctor` 暴露 local config diagnostics。
- 保存继续保持原子替换。

验证方式：

- 单测写入坏 JSON，load 返回默认值，同时 corrupt 备份存在且日志/doctor 有提示。

### P2-4: 模型配置加载宽松、保存严格，默认空 `models[]` 与 UI 严格校验之间需要更明确的迁移策略

影响：代码为了兼容旧配置允许启动，但 WebUI 保存要求每条 entry 同时有 `mainModelId` 与 `secondaryModelId`。如果默认 `model_config.json` 自动生成空 `models[]`，或者旧用户配置只有 `id`，用户可能在 UI 保存时遇到和启动行为不一致的错误。

证据：

- `agent/model_config.py:129-136` 缺失时自动写 `DEFAULT_MODEL_CONFIG`。
- `agent/model_config.py:148-158` load 时 deep merge 默认配置并 parse。
- `agent/model_config.py:330-354` WebUI 保存时 `validate_complete_model_entries()` 强制至少一个模型条目，并要求 Main/Secondary Model ID。
- `agent/model_config.py:390-416` `_parse_entry()` 对缺字段宽松，甚至 main 缺失时用 name 兜底。
- `agent/model_config.py:435-455` provider auto 最终 fallback 到 `deepseek`。

根因：boot compatibility 和 user-save schema 没有被显式分成 migration 阶段；默认配置、example、init 向导、WebUI 保存规则之间缺少一条清晰状态机。

整改方向：

- 定义 model config schema version 和 migration result。
- load 返回 diagnostics：`validForRuntime`、`validForSave`、`migrationRequired`。
- init/WebUI 对旧字段自动生成 `secondaryModelId` 候选，但让用户确认。
- 默认 `model_config.example.json` 与 README 保持同一 schema，不再让“空 models”作为长期有效形态。

验证方式：

- 旧 schema、空 config、新 schema 分别有单测。
- WebUI 展示 migration prompt，不在保存时才失败。

### P2-5: 前端 runtime reducer 还没有真正承担状态转换，`useRuntime.ts` 仍是大而全状态机

影响：前端已有 `webui/src/runtime/` 目录，但 `reducer.ts` 目前只排序并回放事件，真正的事件到消息结构转换仍集中在 `useRuntime.ts`。新增事件时仍要改一个超长 composable，容易产生刷新恢复、实时流、localStorage snapshot 三条路径不一致。

证据：

- `webui/src/runtime/reducer.ts:8-13` 只实现 `replayRuntimeEvents()`。
- `webui/src/composables/useRuntime.ts:376-553` `handleSocketEvent()` 分发 `ready`、`user_message`、`message_delta`、`context_usage`、tool、assistant、control、team、scheduler、external、subagent。
- `webui/src/composables/useRuntime.ts:686-867` 继续处理 subagent/team 结构更新。
- `webui/src/composables/useRuntime.ts:981-1007` 同文件还负责 localStorage snapshot。

根因：Vue 重构时创建了 runtime 目录，但 reducer 仍停留在 replay helper，没有完成“事件 -> state”的纯函数抽象。

整改方向：

- 定义 `RuntimeState`，把 message list、currentAssistantId、lastSeq、busy inference、pending interaction 都纳入 reducer 输出。
- `useRuntime.ts` 只负责 WebSocket 生命周期、send payload、调用 reducer、触发副作用。
- Team/Scheduler/bootstrap 局部更新也走 handler + reducer，不在 composable 中直接写 boot。
- 对每类事件建立 reducer 单测，尤其是 replay 与实时接收一致性。

验证方式：

- 同一批 runtime events 经 replay 和实时 apply 得到相同 `RuntimeState`。
- 新增事件只需要改 types + reducer + UI 组件，不改 WebSocket glue。

### P2-6: `App.vue` 聚合过多 slash command 和全局行为，页面壳开始承担业务命令层

影响：`App.vue` 同时初始化 bootstrap、runtime、tokens、slash commands、control mode、memory restore、compact、router 切换和 provider context。继续扩展命令会让入口组件成为第二个 service locator。

证据：

- `webui/src/App.vue:24-76` 初始化 bootstrap、runtime、tokens 并展开大量方法。
- `webui/src/App.vue:103-135` 处理 composer payload、slash command 和 skill command。
- `webui/src/App.vue:137-223` `executeSlashCommand()` 内联处理 `/help`、`/status`、`/model`、`/tokens`、`/tools`、`/skills`、`/config`、`/memory`、`/memory-log`、`/memory-restore`、`/plan`、`/mode`、`/stop`、`/compact`、`/clear`、`/reload`。

根因：斜杠命令缺少 command registry / command handler 层，直接写在 App shell 中。

整改方向：

- 新增 `webui/src/commands/handlers.ts`，每个命令是 `{name, execute(ctx,args)}`。
- `App.vue` 只提供 context 和路由壳，不承载业务命令实现。
- Slash skill picker 与系统命令共用 parser，但执行逻辑分开。

验证方式：

- `/status`、`/compact`、`/mode plan` 等命令有独立单测或轻量 vitest。
- App.vue 行数下降，新增命令不修改 App shell。

### P2-7: Desktop Pet 是新增可选模块，但当前体量和生命周期边界需要稳定化后再合入

影响：桌宠能力本身可选且设计上不应影响主服务，但当前工作区新增了 Python manager、Web API route、WebUI config card、Electron app、资产、测试和 `desktop-pet/node_modules/`。虽然 node_modules 被 ignore，但模块进入主线前需要明确依赖安装、进程生命周期、错误暴露、安全策略和包体边界。

证据：

- `git status --short --ignored` 显示 `agent/desktop_pet/`、`agent/web/routes/desktop_pet.py`、`assets/desktop-pet/`、`desktop-pet/`、`tests/unit/test_desktop_pet.py`、`tests/unit/test_desktop_pet_api.py` 均为 untracked。
- `du -sh desktop-pet` 当前为 `294M`，主要来自 ignored `desktop-pet/node_modules/`。
- `agent/desktop_pet/manager.py:80-136` 通过 `subprocess.Popen` 启动 Electron。
- `agent/desktop_pet/manager.py:138-155` 通过 pid 文件 stop/stop_if_owned。
- `desktop-pet/main.js:65-74` Electron 配置已关闭 nodeIntegration 并开启 contextIsolation，这是好点。
- `desktop-pet/renderer.js:148-202` 自己维护 WebSocket 重连与 `lastSeq`。

根因：桌宠作为 companion process 被快速接进 WebUI 生命周期，但还没有形成独立 feature module 和安全/测试门禁。

整改方向：

- 把桌宠列为 optional feature，明确“不安装 Electron 也不能影响主 WebUI 启动”。
- Python manager 使用窄接口接入 Web lifecycle，不要继续扩展 `WebUIState`。
- 进程状态写入 runtime diagnostics，pid stale、Electron missing、WebSocket disconnected 都可见。
- `desktop-pet` 建立自己的 `npm test` 和依赖审计入口，但不纳入主 `npm --prefix webui run build`。

验证方式：

- 没有 `desktop-pet/node_modules` 时，`emperor-agent web` 正常启动且 WebUI 显示可安装提示。
- `node --test desktop-pet/test/*.test.js` 通过。
- stop/restart 不杀非 owned pid，pid stale 可恢复。

### P2-8: 构建期资源 warning 说明 CSS asset URL 仍有路径解析问题

影响：前端构建通过，但 warning 表示某个图片 URL 没被 Vite 解析，运行时依赖原路径是否存在。部署或移动 dist 时可能丢纹理资源。

证据：

- 命令：`npm --prefix webui run build` 通过，但输出 warning：`../../assets/textures/texture-seal.png referenced in ../../assets/textures/texture-seal.png didn't resolve at build time, it will remain unchanged to be resolved at runtime`。
- `webui/src/styles.css:56-57` 使用 `url('../../assets/textures/texture-seal.png')`。
- `webui/src/styles/layout.css:36` 也引用 `url('../../assets/textures/texture-seal.png')`。
- `webui/src/assets.ts` 对其他图标采用 `new URL('../../assets/...', import.meta.url).href`。

根因：CSS 中相对路径跨出 Vite src root，和 assets.ts 的模块化资源引用策略不一致。

整改方向：

- 纹理资源纳入 `webui/src/assets.ts` 或复制到 `webui/src/assets/` / `public/` 并统一路径策略。
- 不要让生产 dist 依赖仓库外相对路径。

验证方式：

- `npm --prefix webui run build` 无 warning。
- 构建后的 `webui/dist/assets/*.css` 中不出现未解析的 `../../assets/`。

### P2-9: 依赖来源仍不完全一致，`requirements.txt` 与 `pyproject.toml` 有 drift

影响：README 推荐 `pip install -r requirements.txt` 再 `pip install -e .`。只按 requirements 或某些部署脚本只装 requirements 时，`mcp` 依赖会缺失；长期会导致“本地能跑、CI/新机器不能跑”。

证据：

- `pyproject.toml:12-29` 包含 `mcp>=1.0.0`。
- `requirements.txt:1-15` 没有 `mcp`。
- `requirements.txt` 与 `pyproject.toml` 对部分依赖采用不同 pin 策略，例如 `httpx`、`jinja2`、`python-dotenv`、`pyyaml`。

根因：存在两个 runtime dependency source，没有自动同步或明确谁是权威来源。

整改方向：

- 明确 `pyproject.toml` 为 package truth，`requirements.txt` 由脚本生成或只作为 lock/constraints。
- 或反过来，用 `requirements.in` + compiled lock，并让 `pyproject` 引用相同范围。
- `doctor --dev` 检查当前环境是否包含 pyproject runtime deps。

验证方式：

- 新 venv 只执行 README 快速开始后，`emperor-agent doctor` 不报缺依赖。
- CI 增加 fresh install smoke。

### P3-1: `python` 命令文档与实际环境有偏差

影响：当前 shell 中直接运行 `python -m pytest` / `python -m ruff` 会得到 `zsh:1: command not found: python`，需要 `.venv/bin/python` 或激活 venv。README 中仍使用 `python` 示例。这不是代码缺陷，但会制造本地验证噪音。

证据：

- 初始尝试 `python -m pytest` / `python -m ruff` 失败，环境没有 `python` 命令。
- README `README.md:36-43`、`README.md:103-105` 使用 `python`。
- 使用 `.venv/bin/python -m pytest -q`、`.venv/bin/python -m py_compile ...` 可通过。

整改方向：

- README 写明 macOS/Homebrew Python 环境优先使用 `.venv/bin/python`，或激活后确认 `python --version`。
- `make check` 内部使用 `.venv/bin/python` fallback。

### P3-2: ignored runtime/cache 产物数量较多，应避免影响审计和本地搜索

影响：`__pycache__`、`.pytest_cache`、`.ruff_cache`、`webui/dist`、`node_modules`、`desktop-pet/node_modules` 都被 ignore，但本地扫描如果不 prune 会读到大量无关文件。本次 `find` 曾把 `agent/desktop_pet/__pycache__/*.pyc` 打出来，影响审计效率。

证据：

- `git status --short --ignored` 显示大量 ignored cache/runtime 目录。
- `find` 可发现 `agent/__pycache__/*.pyc` 和 `agent/desktop_pet/__pycache__/*.pyc`。

整改方向：

- 质量命令和审计脚本统一 prune ignore dirs。
- 增加 `make clean-local` 但不默认运行，避免误删用户 runtime。

### P3-3: 资产体积较大，后续需要资产预算

影响：当前 `assets` 为 `75M`，桌宠 node_modules 为 `294M`。assets 属于仓库提交体积，后续图标/位图继续增加会影响 clone、diff、GitHub 浏览和包体。

证据：

- `du -sh assets` 输出 `75M`。
- `du -sh desktop-pet` 输出 `294M`，其中 node_modules 已 ignore，不应提交。

整改方向：

- 建立 assets budget 和压缩规则，位图统一 WebP/PNG 优化。
- 大型原始素材放外部或 Git LFS，WebUI 只引用优化后资产。

## Architecture Review

### 后端分层

优点：

- `agent/providers/`、`agent/model_router.py`、`agent/model_config.py` 已经把多 Provider、主/次模型、usage role 和 fallback 形成了相对清晰的层。
- `agent/control/` 与 `agent/permissions/` 分离，Ask/Plan/approval 没有完全散落到工具里，这是正确方向。
- `agent/runtime/` 作为 WebUI 行为事件冷记录层，是解决刷新恢复、WebSocket replay、工具轨迹恢复的正确基础。
- `agent/scheduler/` 已有 models/store/service/tool 分层，store 有 file lock 和 atomic write，这是好点。
- `agent/team/` 以 store/manager/tools 组织，队友持久上下文没有和主 history 混在一起。

主要问题：

- `AgentLoop` 是最大后端聚合点，不只是 loop，还负责创建所有 runtime object。
- `WebUIState` 是第二个最大聚合点，Web 服务层和业务服务层边界不够硬。
- External Bridge 当前是 service skeleton，缺少 durable store，与文档承诺不完全一致。
- Scheduler、Watchlist、Desktop Pet 都有自己的状态读写方式，但没有统一 diagnostics/error exposure 模式。

建议目标架构：

- `agent/runtime_core/` 或类似层：统一 turn orchestration、runner factory、model runtime、task registry。
- `agent/web/services/` 只做 HTTP/WebSocket application service，不直接装配底层所有对象。
- 每个可选能力实现 `FeatureModule`：routes、bootstrap payload、lifecycle、diagnostics、permissions。

### 前端分层

优点：

- Vue 3 + Vite + Tailwind 已经模块化，比旧静态 HTML/CSS/JS 可维护。
- `webui/src/types.ts` 集中定义 API 与 WebSocket 类型，这是必要基础。
- `webui/src/runtime/handlers/team.ts`、`scheduler.ts` 已经开始把部分事件处理抽出去。
- `localStorage` snapshot + 后端 runtime events 的组合可覆盖刷新恢复。

主要问题：

- `useRuntime.ts` 仍然是实际 reducer，`runtime/reducer.ts` 目前只是 replay loop。
- `App.vue` 承担太多 slash command 业务逻辑。
- `useBootstrap.ts` 是 API client + state mutator + toast 副作用集合，后续 configs/desktop pet/MCP/scheduler 增长会继续变厚。
- `useAppContext.ts` 暴露了非常宽的上下文接口，任何 view 都能调用大量 mutation，边界不够清晰。

建议目标架构：

- `runtime/reducer.ts` 成为纯状态转换核心。
- `useRuntime.ts` 只处理 WebSocket、send、reconnect 和副作用触发。
- Slash commands 独立为 command registry。
- API client 与 UI store 分离：`api/*.ts` 只请求，`composables` 负责 state。

### 运行时状态

当前有多类状态源：

- 主对话：`AgentLoop.history` + `memory/history.jsonl` + checkpoint。
- WebUI 行为：`memory/runtime/events.jsonl` + archive + localStorage snapshot。
- 控制流：`memory/control/state.json`。
- Scheduler：`memory/scheduler/jobs.json` + `action.jsonl`。
- Team：`.team/`。
- External：当前仅内存。
- Desktop Pet：`memory/desktop_pet/*.json`。

评价：状态源分类基本合理，但 diagnostics 不统一。应建立统一的 runtime diagnostics API，用于显示每个状态源的健康度、lastError、lastUpdated、corrupt backup。

### 配置 / 记忆 / 工具 / 调度 / 外部桥接边界

- 配置：`model_config.json`、`emperor.local.json`、`templates/USER.local.md` 分离合理，但 schema migration 和损坏处理需要补强。
- 记忆：三层记忆、history archive、versions 已经比较成熟。注意不要让 WebUI 直接绕过 version/snapshot 写本地文件。
- 工具：registry + permission policy 方向正确。并发工具和控制暂停需要统一 result lifecycle。
- 调度：Scheduler store/service/tool 分层较好，但 action log corruption 策略需要升级。
- 外部桥接：抽象方向正确，唯一主线原则正确；最大缺口是持久化和 adapter 真实接入前的边界文档。

## Engineering Quality Review

### 测试

当前状态：

- `.venv/bin/python -m pytest -q` 通过：`209 passed in 121.36s`。
- `tests/unit/test_desktop_pet.py`、`tests/unit/test_desktop_pet_api.py` 是 untracked 新增测试，说明桌宠已有基础测试覆盖。

缺口：

- 缺少 WebSocket replay / reconnect 的端到端测试。
- 缺少 runtime reducer 的前端单测。
- 缺少 External Bridge restart persistence 测试，因为当前没有持久 store。
- 缺少 fresh install smoke，无法捕获 requirements/pyproject drift。

### Lint / Typecheck

当前状态：

- `.venv/bin/python -m ruff check agent tests` 失败，`595 errors`。
- `npm --prefix webui run build` 包含 `vue-tsc --noEmit`，当前通过。

建议：

- 先把 ruff 从“全量噪音”恢复成可执行 gate。
- 前端建议新增 `npm --prefix webui run typecheck` 到统一 check，但 build 已包含 typecheck。

### 打包

当前状态：

- `npm --prefix webui run build` 通过。
- 有一个 unresolved asset warning。
- `webui/dist/` 被 ignore。

建议：

- 消除 CSS asset warning。
- 对产物体积和 asset 体积设预算。

### 依赖

当前状态：

- Python runtime 依赖同时存在 `pyproject.toml` 和 `requirements.txt`。
- `requirements.txt` 缺 `mcp`，与 `pyproject.toml` 不一致。
- Desktop Pet 依赖独立在 `desktop-pet/package.json`，合理，但应保持 optional。

建议：

- 明确依赖 truth source。
- 增加 fresh env smoke。

### 文档

当前状态：

- README 内容很完整，覆盖初始化、本地文件、核心能力、附件、视觉、桌宠。
- AGENTS.md 对未来 agent 非常有帮助。

问题：

- README 对 External Bridge 持久状态的表述强于当前实现。
- README 质量命令使用 `python`，当前环境需要 `.venv/bin/python`。
- 桌宠作为 untracked 新增模块，文档已写入 README，需确保实现成熟后再提交。

### Git Hygiene

当前状态：

- 工作区 dirty，包含多处修改和新增未跟踪模块。
- `.gitignore` 对关键私密和构建产物覆盖较好。
- `desktop-pet/node_modules/` 已 ignored，但本地体积大。

建议：

- 把“审计报告”单独提交或单独 review。
- 桌宠相关改动作为独立 PR/commit，不和 WebUI/CLI 其他变更混合。
- 提交前运行 `git diff --check`、pytest、build、ruff gate。

### 运行产物隔离

当前状态：

- `memory/`、`.team/`、`model_config.json`、`emperor.local.json`、local user/memory、dist、node_modules 都被 ignore。

缺口：

- 产物虽然 ignore，但本地扫描和审计脚本需要默认 prune。
- External Bridge 若加 store，应默认放入 `memory/external/` 并保持 ignore。

## Refactor Roadmap

### Phase 0: 固定可验证基线

目标：让项目有可信质量入口，不再靠人工记忆命令。

动作：

- 新增 `make check` 或 `scripts/check.sh`，执行 `git diff --check`、`.venv/bin/python -m py_compile ...`、`.venv/bin/python -m pytest -q`、`npm --prefix webui run build`。
- 重新配置 ruff：tests 忽略 `S101`，production 先保留高信号规则。
- README 更新质量命令为 `.venv/bin/python` 或说明激活 venv 后执行。

验收：

- 本地一条命令完成 check。
- ruff 至少对 `agent` 可作为 gate 通过或只剩有意 ignore。

### Phase 1: 拆组合根，阻止继续膨胀

目标：把最容易变成屎山的两个中心对象拆开。

动作：

- 拆 `WebUIState`：引入 `WebContainer` / `AppServices`，每个 route 依赖对应 service。
- 拆 `AgentLoop`：引入 `ModelRuntime`、`RunnerFactory`、`ToolingModule`。
- 模型刷新改为 immutable config swap 或重建 runner。

验收：

- 新增 Web route 不需要修改 `WebUIState`。
- 新增子代理或 Team runner 不复制 runner 构造代码。
- model config 保存后所有 runner route 一致。

### Phase 2: Runtime reducer 正式化

目标：让流式 UI、刷新恢复、重连 replay 使用同一个状态机。

动作：

- 定义前端 `RuntimeState`。
- 把 `handleSocketEvent` 的状态更新迁移到 reducer。
- 为 `user_message/message_delta/tool/subagent/team/scheduler/control/assistant_done/error` 建单测。

验收：

- 同一事件序列 replay 和实时 apply 得到一致 messages。
- `useRuntime.ts` 只剩连接、发送和副作用。

### Phase 3: Durable state diagnostics

目标：长期状态源可恢复、可观测。

动作：

- External Bridge 增加 durable store。
- Scheduler action log corruption 可见化。
- Local config corrupt backup + doctor diagnostics。
- Desktop Pet state diagnostics 统一进入 bootstrap 或 `/api/diagnostics`。

验收：

- 重启不丢 external pending/outbox/dedupe。
- 损坏文件不会静默吞掉，用户可见且有备份。

### Phase 4: 安全和权限一致性

目标：工具、Web mutation、Scheduler、External、Desktop Pet 的风险判断有统一策略。

动作：

- 工具 result lifecycle 统一处理 pause/approval。
- API error response 不泄漏内部异常。
- Shell/web_fetch/MCP/external 的风险策略集中到 permissions/guard。
- Electron companion 的权限和进程生命周期文档化。

验收：

- 并发工具、Ask/Plan、Scheduler mutation 都有一致测试。
- API 500 只返回安全错误和 errorId。

### Phase 5: 资产与可选模块治理

目标：保持仓库可持续增长。

动作：

- 修复 Vite texture warning。
- 资产压缩和预算。
- Desktop Pet 独立 check/test 文档。
- 大型素材考虑 LFS 或只提交优化产物。

验收：

- WebUI build 无 warning。
- assets 体积增长可解释。
- optional modules 不影响主服务启动。

## Do Not Patch Rules

以下问题禁止用局部补丁解决：

- 不要继续往 `WebUIState` 添加业务 handler。新增能力必须有独立 service、route register、bootstrap producer 和 lifecycle hook。
- 不要继续往 `AgentLoop.__init__` 添加模块装配。新增工具、子代理、Team、Scheduler 能力必须通过模块化注册。
- 不要在 `useRuntime.ts` 里继续追加大型 `if (data.event === ...)` 分支。新增 runtime event 必须进入 reducer/handler 体系，并有 replay 测试。
- 不要用更多 `try/except/pass` 掩盖持久状态问题。损坏、跳过、降级必须可观测。
- 不要把 External Bridge 的内存队列包装一下就宣称持久可靠。必须引入 durable store 或明确标注 process-local。
- 不要为了让 ruff 变绿而全局 ignore `S`、`B`、`F`。必须分 production/test 策略，保留真实风险规则。
- 不要在 API middleware 里直接返回内部 exception text。用户可见错误和日志错误必须分层。
- 不要把桌宠作为默认强依赖。它必须保持 optional，Electron 缺失时主服务不受影响。
- 不要通过文档宣称代码没有实现的持久化、恢复或权限能力。README/AGENTS 必须跟当前代码行为一致。

## Audit Command Log

已复核命令：

```bash
.venv/bin/python -m pytest -q
# 209 passed in 121.36s

.venv/bin/python -m py_compile $(find agent -name '*.py' -not -path '*/__pycache__/*')
# passed

npm --prefix webui run build
# passed, with unresolved texture-seal.png warning

git diff --check
# passed

.venv/bin/python -m ruff check agent tests
# failed: 595 errors
```

结构扫描：

```bash
du -sh agent webui/src tests assets desktop-pet
# agent 2.0M, webui/src 512K, tests 680K, assets 75M, desktop-pet 294M

find agent webui/src tests -type f \( -name '*.py' -o -name '*.ts' -o -name '*.vue' \) | wc -l
# 191

find agent webui/src tests -type f \( -name '*.py' -o -name '*.ts' -o -name '*.vue' \) -print0 | xargs -0 wc -l | tail -1
# 28148 total
```

当前 Git 工作区关键状态：

```text
Modified: .gitignore, README.md, agent/cli.py, agent/local_config.py, agent/web/app.py,
agent/web/state.py, agent/webui.py, tests/unit/test_cli_onboarding.py,
webui/src/App.vue, webui/src/composables/useAppContext.ts,
webui/src/composables/useBootstrap.ts, webui/src/styles/panels.css,
webui/src/styles/responsive.css, webui/src/types.ts, webui/src/views/ConfigsView.vue

Untracked: agent/desktop_pet/, agent/web/routes/desktop_pet.py, assets/desktop-pet/,
desktop-pet/, tests/unit/test_desktop_pet.py, tests/unit/test_desktop_pet_api.py
```
