# Emperor Agent 代码审计报告

> 审计日期：2026-07-13（Asia/Shanghai）  
> 审计模式：Standard / Repository / Local Context / Review  
> 审计快照：`main@53a54aaa495f449e78d5d4db996f50db950362a0`  
> 修复复核：2026-07-13，`codex/fix-audit-findings`，提交 `152892c0` 至 `0d2a8317`
> 审计方式：只读静态追踪、跨层传播分析、TDD 修复、全量门禁与打包烟测

## 1. 执行摘要

本次审计发现 5 个需要处理的问题；修复复核已全部关闭：

| 严重度 | 数量 | 修复状态 | 结论                                                      |
| ------ | ---: | -------- | --------------------------------------------------------- |
| P0     |    1 | Fixed    | 外部页面可继承完整 Core IPC，并通过 MCP 配置启动本地进程  |
| P1     |    1 | Fixed    | AUTO 模式可通过脚本间接执行绕过高风险命令审批             |
| P2     |    3 | Fixed    | Scheduler 重复副作用、WebFetch SSRF、启动配置非原子持久化 |
| P3     |    0 | —        | 无                                                        |

最高优先级风险位于 Electron renderer 信任边界：在原审计快照中，普通 Markdown 外链可以把主窗口导航到远端页面，而 preload 和 Core IPC 权限会继续暴露给该页面。修复后，主窗口导航、重定向、弹窗与所有 privileged IPC 共用同一可信 renderer 策略；不可信调用在到达 CoreApi 前即被拒绝。

建议修复顺序：

1. 封闭 Electron 导航并在 IPC 层认证 sender。
2. 修复 AUTO 模式的脚本间接执行审批绕过。
3. 修复 Scheduler 同任务并发启动问题。
4. 统一 WebFetch 与环境下载器的网络边界校验。
5. 将 Model/MCP 配置迁移到原子写与损坏恢复协议。

## 2. 范围与快照

审计覆盖：

- Electron main、preload、renderer 与 Core IPC 边界。
- Agent runner、Control、Permission、工具注册与执行。
- MCP 配置、连接与 stdio transport。
- Scheduler、ActiveTaskRegistry、Team wake 传播链。
- Model/MCP 配置持久化与启动恢复。
- WebFetch 与环境下载器的网络策略。
- Session history、checkpoint、runtime event replay。
- Environment catalog/download/install 与 release 发布门禁。

明确排除：

- 未读取 `.env`、`~/.emperor-agent`、`memory/`、`sessions/` 或其他私有运行数据。
- 未访问真实模型账号、MCP server、远端 CI 设置或分支保护配置。
- 未执行真实 SSRF、恶意进程启动、破坏性命令或断电模拟。

审计期间外部工作流将初始 `codex/cross-platform-release-v2@8a6d56e` 的 58 个工作区改动提交到了 `main@53a54aaa`。原始 finding 证据均针对该快照；修复证据位于 `codex/fix-audit-findings` 的五个独立修复提交，并在 `0d2a8317` 之后的当前工作树重新执行完整门禁与打包烟测。

## 3. 系统边界与安全不变量

### 3.1 关键边界

| 边界                                | 高价值资产                            | 主要入口                                      |
| ----------------------------------- | ------------------------------------- | --------------------------------------------- |
| Renderer → preload → Electron main  | CoreApi、文件系统、桌面能力、私有状态 | `window.emperor`、Core IPC                    |
| Model output → tool runner          | 用户文件、shell、网络、外部系统       | tool calls、Control mode、Permission pipeline |
| Core config → MCP transport         | 本地进程执行、MCP tools               | `mcp.saveConfig`、stdio server command/args   |
| Scheduler → Agent/Team/System       | 自动化任务、持久 inbox、外部副作用    | timer、手动 run、team wake                    |
| Network tool → local/public network | 本地服务、云元数据、模型上下文        | `web_fetch`、redirect、DNS                    |
| State store → startup               | 模型配置、MCP 配置、可启动性          | JSON save/load、CoreHost 初始化               |

### 3.2 审计不变量

- **INV-001：** 只有可信的内置 renderer 可以访问 privileged preload/Core IPC；任何远端导航都不得继承 bridge。
- **INV-002：** 权限审批必须绑定真正承载副作用的输入；脚本或解释器间接执行不得绕过高风险判断。
- **INV-003：** 被拒绝或判定为重复的 Scheduler 任务不得启动任何副作用。
- **INV-004：** 网络工具只能连接经过 DNS、IP 和逐跳 redirect 校验的公共地址，并限制响应总字节数。
- **INV-005：** Boot-critical 配置写入必须原子化；单文件损坏不得阻止整个桌面应用启动。
- **INV-006：** Session history、checkpoint 与 runtime replay 应保持会话隔离和事件顺序。
- **INV-007：** 环境安装只能执行 catalog 绑定且经过完整性验证的产物。
- **INV-008：** Release 发布必须经过 candidate、receipt、SBOM、attestation 和聚合门禁。

## 4. Findings

### 4.1 [P0] 外部链接可让远端页面继承完整 Core IPC，最终执行本地进程

**置信度：** High  
**状态：** Fixed（`152892c0`）
**维度：** L1 / PR-3 / C0  
**违反不变量：** INV-001

#### FACT

- 主窗口配置了 preload、`contextIsolation:true`、`nodeIntegration:false` 和 `sandbox:false`，但没有 `will-navigate`、`will-redirect` 或 `setWindowOpenHandler` 防护：[`desktop/src/main/index.ts:178`](../../desktop/src/main/index.ts#L178)。
- Renderer HTML 没有 `navigate-to` CSP：[`desktop/src/renderer/index.html:1`](../../desktop/src/renderer/index.html#L1)。
- Markdown 使用 `html:false` 和 DOMPurify，能够阻止 HTML 注入，但正常 `https://` Markdown 链接仍会生成，并通过 `v-html` 插入页面：[`MarkdownBlock.vue:5`](../../desktop/src/renderer/src/components/chat/MarkdownBlock.vue#L5)、[`useMarkdown.ts:5`](../../desktop/src/renderer/src/composables/useMarkdown.ts#L5)。
- preload 暴露了 `selectDirectory`、`openPath` 和完整 `invokeCore()`：[`desktop/src/preload/index.ts:5`](../../desktop/src/preload/index.ts#L5)、[`desktop/src/preload/core-ipc.ts:20`](../../desktop/src/preload/core-ipc.ts#L20)。
- Main IPC 注册所有 Core operation，但 listener 忽略了 event，没有验证 sender URL、frame 或 `webContents.id`：[`desktop/src/main/ipc.ts:21`](../../desktop/src/main/ipc.ts#L21)。
- Operation schema 会验证参数形状，但不会验证调用主体：[`packages/core/src/api/operations.ts:224`](../../packages/core/src/api/operations.ts#L224)。
- 远端页面可调用 `control.setMode('auto')`；`mcp.saveConfig` 只受 mutation guard 和可选 Hook 约束，而 mutation guard 仅阻止 pending/plan 状态：[`packages/core/src/api/core-api.ts:557`](../../packages/core/src/api/core-api.ts#L557)、[`packages/core/src/api/mutation-guard.ts:11`](../../packages/core/src/api/mutation-guard.ts#L11)。
- MCP 保存后立即 reload；启用的 stdio server 会将配置中的 command/args 交给 `StdioClientTransport` 启动：[`packages/core/src/api/services/config-service.ts:73`](../../packages/core/src/api/services/config-service.ts#L73)、[`packages/core/src/mcp/client.ts:33`](../../packages/core/src/mcp/client.ts#L33)、[`packages/core/src/mcp/connection.ts:139`](../../packages/core/src/mcp/connection.ts#L139)。

#### REASONING

DOMPurify 保护的是 HTML 注入，不是 Electron 导航边界。普通外链在当前窗口导航后，BrowserWindow 的 preload 配置仍然有效，远端页面因此获得 `window.emperor`。IPC 层没有检查调用来源，参数 schema 只能阻止畸形参数，无法阻止非可信页面调用合法的高权限 operation。

#### 传播路径

```text
模型或网页内容
  → Markdown 外链
  → 用户点击
  → BrowserWindow 导航至远端页面
  → preload 暴露 window.emperor
  → 未认证的 Core IPC
  → control.setMode('auto')
  → mcp.saveConfig(stdio command/args)
  → MCP reload
  → 本地进程启动
```

#### 风险模型

- **触发：** 用户点击一次普通外链；不要求已有 AUTO 配置。
- **爆炸半径：** 当前用户账号及该账号可访问的文件、会话、记忆和本地服务。
- **可恢复性：** 取决于启动进程的行为；可能需要人工终止进程、清理配置和检查数据泄漏。

#### 影响

远程代码执行、私有会话与记忆读取、配置篡改、用户文件访问，以及借助本机凭据进一步访问外部系统。

#### 根因

系统把 renderer 视为永久可信主体，却没有维持 BrowserWindow 导航边界，也没有在 IPC 层重新认证调用来源。

#### 修复策略

1. 对主窗口添加 deny-by-default 的 `will-navigate` 和 `setWindowOpenHandler`。
2. 只允许精确的 `app://bundle` 或显式配置的开发 origin 留在窗口内。
3. HTTP(S) 链接经协议和 hostname 校验后使用 `shell.openExternal`，主窗口始终 `preventDefault()`。
4. IPC handler 校验 `event.senderFrame.url`、顶层 frame 和受信任 `webContents.id`。
5. 缩小 preload surface；不要向任何可能导航的窗口暴露通用 `invokeCore`。

#### 验证建议

- Electron 集成测试点击 Markdown 外链，断言主窗口没有导航。
- 断言远端页面无法访问 `window.emperor`。
- 断言 `target=_blank` 与 `window.open()` 被拒绝或安全转交系统浏览器。
- 断言应用内路由、附件和媒体协议仍正常。

#### 修复复核

- [`trusted-renderer.ts:22`](../../desktop/src/main/trusted-renderer.ts#L22) 集中定义可信 URL、顶层 frame 与主 `webContents` 认证；[`index.ts:210`](../../desktop/src/main/index.ts#L210) 对 navigation、redirect、popup 全部接入该策略。
- [`index.ts:71`](../../desktop/src/main/index.ts#L71) 与 [`core-host.ts:21`](../../desktop/src/main/core-host.ts#L21) 在 desktop handler 和 Core IPC 两层认证 sender，不可信调用不会进入 CoreApi。
- `trusted-renderer.test.ts`、`trusted-renderer-usage.test.ts`、`ipc.test.ts` 共 21 项聚焦测试通过；Desktop 全量 74 个文件、353 项测试通过。
- 残余边界：外部 HTTP(S) 仅转交系统浏览器；本次验证覆盖策略、接线和打包 smoke，未自动化真实鼠标点击系统浏览器的端到端交互。

### 4.2 [P1] AUTO 模式可通过脚本文件绕过高风险命令审批

**置信度：** High  
**状态：** Fixed（`6c4624d9`）
**维度：** L1 / PR-3 / C0  
**违反不变量：** INV-002

#### FACT

- AUTO 模式仅在 `isHighRiskCommand()` 识别出直接危险命令时要求审批，其余工具调用直接允许：[`packages/core/src/permissions/pipeline.ts:90`](../../packages/core/src/permissions/pipeline.ts#L90)。
- 高风险判断只解析有限命令头和子命令；`bash payload.sh`、`sh payload.sh` 不属于高风险：[`packages/core/src/tools/resolvers.ts:201`](../../packages/core/src/tools/resolvers.ts#L201)。
- `RunCommand` 使用有限正则黑名单检查外层命令；拒绝文案还建议“把代码写入临时脚本文件后执行”：[`packages/core/src/tools/builtin.ts:327`](../../packages/core/src/tools/builtin.ts#L327)。
- `write_file` 可以在工作区创建脚本：[`packages/core/src/tools/filesystem.ts:135`](../../packages/core/src/tools/filesystem.ts#L135)。
- Runner 完成 permission 判断后直接执行工具：[`packages/core/src/agent/runner.ts:1353`](../../packages/core/src/agent/runner.ts#L1353)。
- `RunCommand` 最终使用 shell `exec(command)`；cwd、最小环境变量和 120 秒超时都不是文件系统或网络沙箱：[`packages/core/src/tools/builtin.ts:371`](../../packages/core/src/tools/builtin.ts#L371)。

#### REASONING

权限系统检查的是 `bash payload.sh` 这一层命令文本，而真正的副作用存在于脚本文件内容中。AUTO 会允许 `write_file` 和未被分类为高风险的 interpreter invocation，因此脚本内的 `curl`、`rm`、外部路径读取或其他进程启动都不会触发预期审批。

#### 传播路径

```text
提示注入或模型误判
  → write_file(payload.sh, dangerous content)
  → run_command("bash payload.sh")
  → AUTO 自动允许
  → shell 以当前用户权限执行脚本
```

#### 风险模型

- **触发：** 用户开启 AUTO；模型产生两步脚本调用。
- **爆炸半径：** 当前用户账号、工作区外文件、网络与外部系统。
- **可恢复性：** 取决于脚本行为，外传、删除或发布操作可能不可逆。

#### 影响

绕过产品宣称的“高风险 shell 命令仍需审批”保护，执行任意用户级 shell 副作用。

#### 根因

审批绑定外层命令字符串，而不是最终承载副作用的代码、脚本摘要、解释器和执行目标。

#### 修复策略

1. AUTO 下所有 `run_command` 默认要求审批；或改用受 catalog 约束的 executable + argv 模型。
2. 将 shell、解释器、工作区脚本及未知 executable 视为高风险。
3. 审批绑定脚本规范化内容、摘要、argv、cwd 和环境快照；审批后脚本变化必须使授权失效。
4. 删除建议通过临时脚本执行被安全策略拒绝内容的提示。
5. 高权限执行使用操作系统级 sandbox，而不是依赖环境变量裁剪和字符串黑名单。

#### 验证建议

- AUTO 端到端测试创建包含危险内容的脚本，再执行 `bash script.sh`，必须暂停或拒绝。
- 审批后修改脚本，必须重新审批。
- 增加 `sh`、`zsh`、PowerShell、工作区 executable 和脚本嵌套调用测试。

#### 修复复核

- [`pipeline.ts:95`](../../packages/core/src/permissions/pipeline.ts#L95) 在 AUTO 下仅自动放行正向识别的只读命令；所有其他 `run_command` 均进入 high-risk approval，规则为 `mode.auto.command_approval`。
- `RunCommand` 拒绝文案不再建议用临时脚本绕过；仍保留只读诊断命令的 AUTO 兼容性。
- `permissions.test.ts` 与相关 runner/tool 测试覆盖脚本、解释器、未知 executable 和只读命令；Core 全量门禁通过。
- 残余边界：用户明确批准后仍可执行任意 shell，这是产品授权能力；修复目标是消除无审批 AUTO 绕过，而不是提供 OS sandbox。

### 4.3 [P2] Scheduler 重复任务被拒绝后，副作用 Promise 仍会执行

**置信度：** High  
**状态：** Fixed（`b721f7ba`）
**维度：** L1 / PR-3 / C0  
**违反不变量：** INV-003

#### FACT

- 手动运行与 timer 路径没有 per-job mutex：[`packages/core/src/scheduler/service.ts:198`](../../packages/core/src/scheduler/service.ts#L198)。
- Executor 在调用 `ActiveTaskRegistry.run()` 前已经通过 `Promise.resolve().then()` 调度 `dispatch()`：[`packages/core/src/scheduler/executor.ts:71`](../../packages/core/src/scheduler/executor.ts#L71)。
- Registry 检测重复 taskId 后抛错，但无法撤销已经排入微任务队列的 dispatch：[`packages/core/src/runtime/active.ts:38`](../../packages/core/src/runtime/active.ts#L38)。
- `team_wake` 调用 `sendMessage()`：[`packages/core/src/scheduler/executor.ts:157`](../../packages/core/src/scheduler/executor.ts#L157)。
- TeamManager 先持久化消息，之后才检查 teammate 是否正在工作：[`packages/core/src/team/manager.ts:208`](../../packages/core/src/team/manager.ts#L208)。

#### REASONING

第二次调用虽然会因重复 `scheduler:<jobId>` 被 Registry 拒绝，但它的 dispatch Promise 已经启动。Registry 只能阻止跟踪和等待，不能阻止该 Promise 继续发送 Team 消息或产生其他系统副作用。

#### 传播路径

```text
双击运行或手动/timer 碰撞
  → 两个 executeJob
  → 两个 dispatch Promise 已排队
  → Registry 拒绝第二个 taskId
  → 第二个 dispatch 仍执行
  → 重复消息或未跟踪副作用
```

#### 风险模型

- **触发：** 同一 job 的并发手动运行，或 timer 与手动运行竞争。
- **爆炸半径：** 当前 Scheduler job、目标 teammate，以及该任务后续调用的工具和外部系统。
- **可恢复性：** 重复 inbox 消息会持久化；外部副作用可能需要人工回滚。

#### 影响

Scheduler 状态可能记录第二次执行失败，但实际副作用已经发生，破坏 at-most-once 语义和审计一致性。

#### 根因

ActiveTaskRegistry 接收已经启动的 Promise，而不是成功注册唯一任务后才调用的惰性 thunk。

#### 修复策略

1. 将 Registry API 改为 `execute: () => Promise<T>`，成功注册后才调用。
2. SchedulerService 增加 per-job in-flight lease 或 mutex。
3. 重复调用应明确返回 busy/conflict，不创建 task record，不改变 job 运行状态。

#### 验证建议

- 用 deferred Promise 并发运行同一 `team_wake` 两次，断言 `sendMessage` 只调用一次。
- 覆盖手动/手动与手动/timer 两种竞争。
- 断言第二次调用不产生持久消息、task record 或错误运行记录。

#### 修复复核

- [`active.ts:38`](../../packages/core/src/runtime/active.ts#L38) 改为成功注册唯一 task 后才调用惰性 `execute` thunk，重复 task 不会创建 Promise 或副作用。
- [`service.ts:48`](../../packages/core/src/scheduler/service.ts#L48) 增加 per-job in-flight lease，在运行状态、事件和 executor dispatch 之前拒绝竞争调用。
- `runtime.test.ts`、`executor.test.ts`、`scheduler.test.ts` 直接断言重复请求只 dispatch 一次，且不创建第二个 task record。
- 残余边界：该保证是单进程内 at-most-once；当前产品为本地单 CoreHost 架构，未来若支持多进程共享 stateRoot，需要跨进程 lease。

### 4.4 [P2] WebFetch 的 SSRF 防护可被 IPv6、DNS 和重定向绕过

**置信度：** High  
**状态：** Fixed（`c47b3ab1`）
**维度：** L1 / PR-3 / C1  
**违反不变量：** INV-004

#### FACT

- WebFetch 只比较少量 hostname 字符串，没有 DNS 解析、完整网段判断或 redirect 逐跳校验：[`packages/core/src/tools/builtin.ts:22`](../../packages/core/src/tools/builtin.ts#L22)。
- 当前 Node 中 `new URL('http://[::1]').hostname` 返回 `[::1]`，代码比较的是 `::1`，IPv6 loopback 可直接通过。
- `127.0.0.2`、`169.254.169.254`、`0.0.0.0` 和解析到私网的域名也没有被覆盖。
- `fetch()` 未设置 `redirect:'manual'`，会跟随重定向；响应先完整执行 `resp.text()`，之后才截取 30,000 字符。
- 仓库已有 DNS、IP BlockList、redirect 逐跳校验和大小限制实现，但 WebFetch 未复用：[`packages/core/src/environment/download.ts:63`](../../packages/core/src/environment/download.ts#L63)、[`packages/core/src/environment/download.ts:202`](../../packages/core/src/environment/download.ts#L202)。

#### REASONING

字符串级 hostname 检查既不知道域名最终解析地址，也无法控制重定向后的目的地。输出字符截断发生在完整响应进入内存之后，不能形成传输大小边界。

#### 传播路径

```text
用户内容或提示注入
  → web_fetch(私网地址或公共重定向)
  → 本地服务/云元数据响应
  → Agent 上下文
  → 云端模型或 UI
```

#### 风险模型

- **触发：** 模型调用 `web_fetch` 访问特制 URL。
- **爆炸半径：** 本地无认证服务、云元数据、开发服务及模型上下文。
- **可恢复性：** 数据泄漏不可撤销；超大响应造成的内存压力通常可通过重启恢复。

#### 影响

本地服务与元数据泄露、提示注入传播，以及通过无界响应造成内存压力。

#### 根因

把 URL 字符串过滤当成实际网络连接边界，没有校验解析地址和每次重定向。

#### 修复策略

1. 复用 hardened downloader 的公共地址解析和 BlockList。
2. 每个 redirect hop 重新解析并校验，连接时固定到已验证地址。
3. 禁止 loopback、private、link-local、CGNAT、multicast、IPv4-mapped IPv6 和 `.local`。
4. 使用流式读取及硬字节上限；不要先完整 `resp.text()`。

#### 验证建议

- 增加 `[::1]`、`127.0.0.2`、`169.254.169.254`、私网 DNS 与 IPv4-mapped IPv6 测试。
- 增加公共地址跳转至私网、相对 redirect 与 DNS rebinding 测试。
- 增加无 `content-length` 超大流和声明长度超限测试。

#### 修复复核

- [`public-http.ts:83`](../../packages/core/src/network/public-http.ts#L83) 对每一跳重新解析 DNS，拒绝任一非公网答案，并把实际连接固定到已验证地址，同时保留原 hostname 用于 TLS SNI/Host。
- [`web-fetch.ts:17`](../../packages/core/src/tools/web-fetch.ts#L17) 通过共享客户端读取，响应硬上限为 1 MiB，model-visible 输出仍限制为 30,000 字符；错误映射不泄露内部异常。
- 环境下载器复用同一网络策略并保持 HTTPS-only、完整流式上限和原子目标文件写入。
- `public-http.test.ts` 覆盖 IPv4/IPv6、mapped IPv6、混合 DNS、逐跳 redirect、声明/实际大小及取消；WebFetch 与 environment download 兼容测试通过。
- 残余边界：未提供私网 allowlist、代理、cookie 或认证请求，这些均为明确排除项。

### 4.5 [P2] Model/MCP 配置非原子覆盖，损坏后会阻断桌面端启动

**置信度：** High  
**状态：** Fixed（`0d2a8317`）
**维度：** L1 / PR-3 / C0  
**违反不变量：** INV-005

#### FACT

- `model_config.json` 直接写最终文件，读取时直接 `JSON.parse`：[`packages/core/src/config/model-config.ts:462`](../../packages/core/src/config/model-config.ts#L462)。
- `mcp_config.json` 使用 `writeFileSync` 覆盖最终文件，读取时也没有损坏隔离：[`packages/core/src/mcp/config.ts:35`](../../packages/core/src/mcp/config.ts#L35)。
- 两个文件都位于 AgentLoop 启动关键路径：[`packages/core/src/agent/loop.ts:430`](../../packages/core/src/agent/loop.ts#L430)。
- CoreHost 初始化失败后桌面应用显示错误并退出：[`desktop/src/main/index.ts:337`](../../desktop/src/main/index.ts#L337)。
- 仓库已有临时文件加 rename、损坏隔离与 fallback 实现：[`packages/core/src/store/atomic-json.ts:55`](../../packages/core/src/store/atomic-json.ts#L55)。

#### REASONING

直接覆盖最终文件时，进程终止、断电或存储错误可能留下空文件或截断 JSON。下一次启动会在构建 ModelRouter 或初始化 MCP 时抛错，错误传播到 Electron startup 并退出整个应用。

#### 传播路径

```text
配置保存
  → 进程终止/断电/磁盘错误
  → 最终 JSON 截断
  → 下次启动 JSON.parse 抛错
  → CoreHost 初始化失败
  → 桌面应用退出
```

#### 风险模型

- **触发：** 配置保存期间进程崩溃、系统断电、磁盘写失败或空间耗尽。
- **爆炸半径：** 当前 Emperor Agent 实例及其全部会话入口。
- **可恢复性：** 数据仍在本地，但通常需要用户手工定位、修复或删除私有配置。

#### 影响

持久性启动拒绝服务，并可能丢失模型或 MCP 配置。

#### 根因

Boot-critical 状态没有统一使用仓库已有的原子存储和损坏恢复协议。

#### 修复策略

1. 使用同目录临时文件、必要的 flush/fsync 和 rename 替换。
2. 保留 last-known-good 或轮换备份。
3. 读取失败时隔离损坏文件，记录 diagnostics，并进入“需要重新配置”状态，而不是退出应用。
4. 保持包含 API key 的模型配置文件权限不被放宽。

#### 验证建议

- 在临时写入后、rename 前注入异常，旧配置必须保持完整可读。
- 使用截断 JSON 启动 CoreApi，应用应成功进入恢复状态并生成明确诊断。
- 验证损坏文件被隔离、默认值正确加载、旧 secret 文件权限保持不变。

#### 修复复核

- [`atomic-json.ts:73`](../../packages/core/src/store/atomic-json.ts#L73) 使用同目录独占 temp、完整写入、`fsync`、关闭、权限设置与原子 rename；失败只清理 temp，不覆盖旧目标。
- [`model-config.ts:454`](../../packages/core/src/config/model-config.ts#L454) 与 [`mcp/config.ts:41`](../../packages/core/src/mcp/config.ts#L41) 使用 `0600` 原子写，并把 JSON/schema 无效原文件移动到唯一 `.corrupt-*` 后加载默认值。
- MCP load/save 及所有 caller 已异步化；ConfigService 会等待落盘完成后再 reload MCP。
- [`core-api.test.ts:124`](../../packages/core/src/api/core-api.test.ts#L124) 同时放置两份截断配置，证明 `CoreApi.create()` 仍进入可重新配置状态且保留两份损坏备份。
- 残余边界：本次用异常与截断输入验证失败语义，未执行真实断电、ENOSPC 或文件系统损坏实验。

## 5. 关键路径覆盖

| ID     | 关键路径                                           | 关键级别 | 覆盖状态 | 结果                   |
| ------ | -------------------------------------------------- | -------- | -------- | ---------------------- |
| CP-001 | Renderer → preload → IPC → Core/MCP                | C0       | Complete | Finding 4.1            |
| CP-002 | Agent turn → Permission → filesystem/shell         | C0       | Complete | Finding 4.2            |
| CP-003 | Scheduler manual/timer → Team/Agent/System         | C0       | Complete | Finding 4.3            |
| CP-004 | WebFetch → network → model context                 | C1       | Complete | Finding 4.4            |
| CP-005 | Config save → stateRoot → startup                  | C0       | Complete | Finding 4.5            |
| CP-006 | Session history/checkpoint/runtime replay          | C0/C1    | Complete | 未确认新问题           |
| CP-007 | Environment catalog/download/install               | C0       | Complete | 未确认新问题           |
| CP-008 | Release candidate/receipt/SBOM/attestation/publish | C0       | Partial  | 未核对远端 CI/分支保护 |

C0/C1 覆盖率：7/8 Complete，1/8 Partial。

“未确认新问题”仅表示本次审计没有形成满足证据门槛的 finding，不代表该路径经过形式化证明或不存在其他缺陷。

## 6. 验证记录

### 6.1 初始审计基线

以下命令曾在 `main@53a54aaa` 上执行并通过：

```bash
npm test --workspace @emperor/core
npm run typecheck --workspace @emperor/core
npm run lint --workspace @emperor/core

npm --prefix desktop run test
npm --prefix desktop run typecheck
npm --prefix desktop run lint

npm run format:check
git diff --check
```

初始结果为 Core 108 个测试文件、912 项测试与 Desktop 72 个测试文件、343 项测试通过。该结果证明原始快照可构建，但不覆盖五个 finding 的回归场景。

### 6.2 修复后门禁

以下命令在 `codex/fix-audit-findings@0d2a8317` 之后的修复工作树重新执行：

```bash
# 五组 finding 相关文件，不使用 test-name filter
npm test --workspace @emperor/core -- \
  src/permissions/permissions.test.ts src/tools.test.ts \
  src/runtime/runtime.test.ts src/scheduler/executor.test.ts \
  src/scheduler/scheduler.test.ts src/network/public-http.test.ts \
  src/environment/download.test.ts src/store/atomic-json.test.ts \
  src/config/model-config.test.ts src/mcp/mcp.test.ts \
  src/compat/python-runtime-compat.test.ts src/api/core-api.test.ts

npm --prefix desktop test -- \
  src/main/trusted-renderer.test.ts \
  src/main/trusted-renderer-usage.test.ts src/main/ipc.test.ts

make check
npm --prefix desktop run package:verify
```

修复后结果：

- Finding 聚焦回归：Core 12 个文件、190 项；Desktop 3 个文件、21 项，全部通过。
- `make check`：migration parity 覆盖 84 个冻结 Python 测试文件并引用 53 个 TS/JS 测试文件；Core 109 个文件、952 项；Desktop 74 个文件、353 项，全部通过。
- Core/Desktop typecheck、test typecheck、ESLint、Prettier、`git diff --check` 与 Electron production build 通过。
- `package:verify` 完成 Darwin arm64 目录打包，packaged smoke 通过并生成本地 receipt。
- 打包日志明确提示本机无有效 Developer ID；该结果只证明非签名目录包可启动，不替代正式 release candidate、签名或 notarization 门禁。

修复新增测试已覆盖：

- Electron trusted-origin、导航/弹窗策略和 IPC sender 隔离。
- AUTO 模式下脚本/解释器等 effectful 命令的审批。
- ActiveTaskRegistry 与同 Scheduler job 的并发抑制。
- WebFetch IPv6、DNS、redirect、固定连接地址与响应大小边界。
- Model/MCP 原子写、`0600` 权限、JSON/schema 损坏隔离及 CoreApi 启动恢复。

## 7. 未执行项与不确定性

本次没有执行：

- screenshots 与真实鼠标点击外链的 Electron 端到端交互测试。
- 正式签名、notarization、多平台 candidate 聚合与发布。
- 真实私网 SSRF 或云元数据访问。
- 真实恶意 MCP process、shell payload 或外部写操作。
- 断电、磁盘耗尽或进程 kill 故障注入。
- GitHub 远端 required checks、environment approval 和 branch protection 核对。

因此，本报告将五个本地代码 finding 标记为 Fixed，但不对上述真实破坏场景、正式发布签名或远端治理配置作通过声明。

## 8. 修复验收结论

以下门禁均已落实并通过：

1. Electron trusted-origin、导航和 IPC sender 回归测试。
2. AUTO effectful command 审批回归测试。
3. Scheduler same-job concurrency 与无副作用拒绝测试。
4. WebFetch SSRF、逐跳 DNS/IP 与流式大小限制测试。
5. Model/MCP atomic-write、损坏隔离与启动恢复测试。
6. 完整 `make check` 与打包后 smoke。

结论：INV-001 至 INV-005 的本次确认缺陷均有生产修复和直接回归证据；5/5 findings 状态为 Fixed。INV-006 至 INV-008 未形成新 finding，原报告中的远端 CI/发布治理不确定性保持不变。
