# Plugins / Scheduler UI Reform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement task-by-task.

**Goal:** 把 MCP 迁入首页“插件”，把定时任务改成列表式管理，把 Skill/Tool 卡片统一成更紧凑、美观、等高的能力卡片。

**Architecture:** 本轮只改 Electron/Vue 前端，不新增后端 API。复用现有 `skills/tools/mcp/scheduler` bootstrap 与 HTTP 接口，通过组件拆分和样式重构完成信息架构升级。

**Tech Stack:** Vue 3、TypeScript、vue-router、Tailwind CSS、Vitest、Electron Vite。

---

## Key Changes

- `插件` 页面改为三 Tab：`Skills / Tools / MCP`，MCP 从 Settings 的 `MCP / 集成` 迁入 `/plugins/mcp`。
- `/mcp` 与 `/settings/integrations` 保留兼容跳转，但主导航和设置侧栏不再展示 MCP。
- `定时任务` 改为列表优先：顶部 `刷新 + 新增任务`，新增走弹窗；点击任务进入详情抽屉/详情栏编辑。
- Skill 与 Tool 统一等高卡片网格，Skill 去掉大 logo；详情通过抽屉/侧栏进入，卡片本体不再被长描述撑高。
- 不改 Python 后端、不改 Scheduler 事件协议、不动 `memory/`、`model_config.json`、`mcp_config.json`。

## Implementation Tasks

### Task 1: 保存实施计划文档

**Files**
- Create: `docs/superpowers/plans/2026-06-24-plugin-scheduler-card-ui-reform.md`

- [ ] 写入本计划全文，作为后续代码执行依据。
- [ ] 运行：
  ```bash
  rg -n "$(printf '%s' 'TB[D]|TO[D]O|待''定|待''补|place''holder')" docs/superpowers/plans/2026-06-24-plugin-scheduler-card-ui-reform.md
  git diff --check
  ```
- [ ] 预期：无占位词命中，无 Markdown 空白错误。

### Task 2: MCP 迁入插件页

**Files**
- Modify: `desktop/src/renderer/src/views/PluginsView.vue`
- Create: `desktop/src/renderer/src/components/panels/McpPanel.vue`
- Modify: `desktop/src/renderer/src/views/McpView.vue`
- Modify: `desktop/src/renderer/src/views/SettingsView.vue`
- Modify: `desktop/src/renderer/src/router.ts`
- Modify: `desktop/src/renderer/src/router.test.ts`

- [ ] 从 `McpView.vue` 抽出纯面板 `McpPanel.vue`，保留现有 `loadMcpConfig/saveMcpConfig`、JSON 校验、格式化、MCP 工具列表。
- [ ] `PluginsView.vue` 的 `activeTab` 支持 `'skills' | 'tools' | 'mcp'`，Segmented Control 增加 `MCP`。
- [ ] `switchTab('mcp')` 跳转 `/plugins/mcp`；进入 MCP tab 时自动 `loadMcpConfig()`。
- [ ] `McpView.vue` 改成兼容壳：直接 redirect 或渲染同一个 `McpPanel`，避免两套 MCP UI。
- [ ] `SettingsView.vue` 删除 `integrations` 设置项与 `McpView` 嵌入；如用户访问 `/settings/integrations`，路由层重定向到 `/plugins/mcp`。
- [ ] 更新路由测试：断言 `/plugins/:tab?` 支持 MCP，`/mcp` 仍可访问或重定向，Settings 不再暴露 `MCP / 集成`。

### Task 3: 定时任务列表化与新增弹窗

**Files**
- Modify: `desktop/src/renderer/src/views/SchedulerView.vue`
- Modify: `desktop/src/renderer/src/components/panels/SchedulerPanel.vue`
- Optional create: `desktop/src/renderer/src/components/panels/SchedulerJobModal.vue`
- Optional create: `desktop/src/renderer/src/components/panels/SchedulerJobDrawer.vue`
- Modify: `desktop/src/renderer/src/styles/panels.css`
- Modify: `desktop/src/renderer/src/styles/responsive.css`

- [ ] `SchedulerView.vue` 顶部右侧改为 `刷新` + `新增任务`，新增按钮控制 `SchedulerPanel` 的创建弹窗。
- [ ] `SchedulerPanel.vue` 去掉左下角常驻创建表单，改为任务列表主视图。
- [ ] 列表行字段固定为：任务名、计划、载荷类型、启用状态、下次运行、上次状态、受保护标记。
- [ ] 点击任务打开详情抽屉/右侧详情栏，展示并允许修改：名称、任务内容、是否投递到当前对话、启用/暂停、运行、删除。
- [ ] 创建弹窗复用现有字段：名称、内容、`at/every/cron`、时区、`deliver`、`deleteAfterRun`。
- [ ] 运行历史移动到详情内，不再作为中间大列常驻展示。
- [ ] 受保护任务保持不可删除；系统任务仍可运行、暂停/恢复，按钮状态要清晰。
- [ ] 窄屏下列表全宽，详情改为覆盖式 drawer，弹窗不溢出视口。

### Task 4: Skill / Tool 等高卡片与详情入口

**Files**
- Modify: `desktop/src/renderer/src/components/panels/SkillsPanel.vue`
- Modify: `desktop/src/renderer/src/components/panels/ToolsPanel.vue`
- Optional create: `desktop/src/renderer/src/components/panels/CapabilityDetailDrawer.vue`
- Modify: `desktop/src/renderer/src/styles/panels.css`

- [ ] Skills 从“左列表 + 右空详情区”改为卡片网格；Skill 卡片去掉大 logo，仅保留名称、短描述、标签、路径。
- [ ] Tools 使用同一套卡片尺寸、间距、标题层级；长描述用 line clamp，不撑开卡片。
- [ ] Skill/Tool 卡片高度固定或使用统一 `min-height + max-height`，Footer badge 固定在底部。
- [ ] 点击 Skill 打开编辑/预览详情抽屉，保留保存、删除、导入 zip、新增 Skill 功能。
- [ ] 点击 Tool 打开参数详情抽屉；卡片上只显示参数数量，不在卡片内展开参数列表。
- [ ] 空态保留但不占半屏；整体视觉保持深色、紧凑、适合长列表浏览。

### Task 5: 样式收敛与视觉验收

**Files**
- Modify: `desktop/src/renderer/src/styles/panels.css`
- Modify: `desktop/src/renderer/src/styles/codex-v2.css` only if global controls need adjustment
- Modify: `desktop/src/renderer/src/styles/responsive.css`

- [ ] 新增共享能力卡样式，例如 `.capability-card-grid`、`.capability-card`、`.capability-card-desc`、`.capability-detail-drawer`。
- [ ] Scheduler 新样式使用列表密度，不再出现三列大卡片同时抢空间。
- [ ] MCP 面板在插件页内采用左右布局：左 JSON 配置，右 MCP 工具摘要；窄屏改为上下堆叠。
- [ ] 保持之前已修好的 Chat 蓝框、滚动条、工具单层展示不回退。

### Task 6: Verification

- [ ] 前端路由/组件测试：
  ```bash
  cd /Users/anhuike/Documents/workspace/emperor-agent/desktop
  npm run test -- router
  ```
- [ ] 全量前端测试：
  ```bash
  cd /Users/anhuike/Documents/workspace/emperor-agent/desktop
  npm run test
  ```
- [ ] 类型检查：
  ```bash
  cd /Users/anhuike/Documents/workspace/emperor-agent/desktop
  npm run typecheck
  ```
- [ ] 构建：
  ```bash
  cd /Users/anhuike/Documents/workspace/emperor-agent/desktop
  npm run build
  ```
- [ ] 仓库检查：
  ```bash
  cd /Users/anhuike/Documents/workspace/emperor-agent
  git diff --check
  ```
- [ ] 手工验收：
  - `/plugins/skills`：Skill 卡片无大 logo，等高，描述不撑高。
  - `/plugins/tools`：Tool 卡片与 Skill 视觉尺寸一致。
  - `/plugins/mcp`：能加载、格式化、保存 MCP 配置，能看到 MCP 工具。
  - `/settings`：不再展示 `MCP / 集成`。
  - `/scheduler`：默认是任务列表；刷新旁有新增按钮；新增弹窗可创建任务；点击任务可编辑详情。
  - 1620×739 与 1920×1080 下无重叠、无横向溢出。

## Assumptions

- 本轮只做前端体验改革，不新增后端接口。
- `mcp_config.json` 仍由现有 `/api/mcp-config` 读写。
- Scheduler 创建、保存、运行、暂停、恢复、删除继续使用现有 `/api/scheduler` 系列接口。
- 当前工作区有一个未跟踪文件 `CODE_SYSTEM_AUDIT_PROMPT.md`，实施时不要纳入本次提交，除非用户另行确认。
- 代码必须落在 `/Users/anhuike/Documents/workspace/emperor-agent`，不能写入 `.codex/worktrees` 或缓存目录。
