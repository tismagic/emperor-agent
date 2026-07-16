# Tools、Skills 与 MCP

> 文档状态：Active<br>
> 面向读者：希望扩展 Agent 能力的用户<br>
> 最后核验：2026-07-16<br>
> 事实源：ToolRegistry、SkillManager、MCP config/client、插件页

“插件”页面分成 Skills、Tools 和 MCP 三个标签。三者作用不同：Tool 是可执行接口，Skill 是按需加载的工作说明和资源包，MCP 把外部 server 暴露的工具接入当前 ToolRegistry。

## Tools

内建工具主要分为：

- 文件与搜索：`read_file`、`write_file`、`edit_file`、`glob`、`grep`；
- 命令与网页：`run_command`、`web_search`、`web_fetch`；
- 控制与计划：`ask_user`、`propose_plan`、`request_plan_mode`、`update_todos`；
- 长任务与协作：Goal tools、Scheduler、subagent 和 Team tools；
- 上下文：`load_skill`、用户档案和其他受控管理工具。

实际可用列表取决于会话类型、Goal 状态、已加载 MCP 和权限模式。输入 `/tools` 或打开“插件 → 工具”查看当前注册结果。

只读、可并发和是否需要确认由 Core 决定。工具卡显示的是执行投影，不能替代实际 store、command receipt 或 Goal evidence。

## Skills

Skill 至少包含一个带 frontmatter 的 `SKILL.md`，可以附带 `scripts/`、`references/` 和 `assets/`。

加载优先级：

1. Build 项目的 `<project>/.emperor/skills`；
2. 用户全局 `stateRoot/skills`；
3. 应用内置 `runtimeRoot/skills`。

同名时高优先级覆盖低优先级。项目和内置 Skill 是只读来源；插件页的新建、编辑、删除默认作用于用户全局 Skill。

### 调用 Skill

- 在 Composer 的能力选择器中选择；
- 输入 `/<skill-name> 任务内容`；
- 让 Agent 在需要时调用 `load_skill`。

Blocked 或 invalid Skill 不会出现在可调用快捷方式中。

### 安装 Skill

插件页支持本地 `.zip` / `.skill`，以及公开 GitHub repo/tree 或 HTTPS `.zip` / `.skill` 链接。安装采用两步流程：

1. 预览来源、候选目录、文件摘要、依赖和脚本风险；
2. 用户确认精确候选和 digest 后安装。

缺少 binary、runtime 或环境变量的 Skill 会以 `blocked` 状态安装，依赖满足并刷新后才能激活。安装 Skill 不等于自动执行其中的脚本。

## MCP

MCP 配置保存在 `stateRoot/mcp_config.json`。入口是“插件 → MCP”；旧 `/mcp` 和设置页 integrations 路径会重定向到这里。

当前支持：

- `stdio`：启动本地命令作为 MCP server；
- `sse`：连接远程 SSE server；
- `enabled`：按 server 启停；
- `${ENV_NAME}`：从执行环境展开环境变量；
- `tool_overrides` 和 defaults：补充只读、独占等工具属性。

保存配置后，Core 重新解析 server 并把发现的工具注册为 MCP 来源。配置 JSON 能解析不代表命令、网络或认证一定可用；插件页会分别显示 server 与已加载工具。

## 安全边界

- MCP server 名称、命令和 URL 来自用户配置，不接受模型动态改写。
- `stdio` server 可以启动本地进程，应像命令执行一样审查来源和参数。
- 远程 MCP、网页和 Skill 下载内容都按不可信输入处理。
- MCP 工具仍经过 schema、权限和 workspace policy；它不能因为来自 server 就绕过 Core deny。
- 不要把 API Key 直接写进可提交的项目文件。MCP header 可以引用环境变量。

需要排查加载问题时，先检查配置 JSON、执行环境、server 日志和“设置 → 诊断”。
