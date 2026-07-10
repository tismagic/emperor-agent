# Emperor Agent 跨平台环境配置与 Release 设计

- 日期：2026-07-10
- 状态：已确认
- 目标平台：macOS 14+ arm64/x64、Windows 10 22H2+ x64、Ubuntu 22.04/24.04 x64
- 关联模块：Core diagnostics、工具执行、Hooks、MCP、Electron packaging、GitHub Release

## 1. 背景与目标

当前 Electron 安装包已经内置 Chromium、Node runtime、Core、模板、Skills、Assets 和桌宠资源，主程序不要求目标机安装 Node 或 Python。但干净系统上的 Coding Agent 能力仍依赖外部命令：Git、ripgrep、Node/npm、项目语言运行时、command hooks 和 stdio MCP 都可能因系统环境缺失而失败。

本设计完成三个目标：

1. Emperor Agent 在三类目标平台上可安装、可首启、可配置云模型并完成基础文件任务。
2. 诊断页能够识别基础开发环境和当前项目环境，并通过受控流程安装缺失项。
3. 正式 Release 具备匹配架构的安装包、签名/公证、供应链凭据和干净系统启动回执。

非目标：

- 不静默安装所有语言、IDE、容器、数据库或云 CLI。
- 不支持 Windows ARM64、macOS 14 以下、Windows 10 22H2 以下或 Ubuntu 以外的 Linux 发行版。
- 不让 Renderer 提交任意 shell 命令、下载 URL 或安装器参数。
- 不自动覆盖已安装但版本冲突的 Go，也不自动卸载系统工具。
- 不在本阶段建设自动更新；Release 仍由 GitHub Releases 分发。

## 2. 已确认决策

| 主题 | 决策 |
|---|---|
| 安装范围 | 基础环境 + 当前项目识别 |
| 基础环境 | Git、ripgrep、Volta、Node、npm |
| 项目生态 | Node、Python、Go、Rust |
| 安装归属 | 对当前用户全局可用，写入系统或用户 PATH，不局限于 Emperor 私有 PATH |
| 安装渠道 | 已有 Homebrew/winget/apt 时优先使用；缺失时使用固定版本、可验证的官方安装器或官方发布资产 |
| 批量交互 | 展示来源、版本、许可、提权与体积后一次确认，按依赖顺序安装 |
| 版本策略 | 项目声明优先；无声明时使用随 Emperor Release 审核的默认版本 |
| 版本隔离 | Node 使用 Volta，Python 使用 uv，Rust 使用 rustup；Go 冲突只提示 |
| Rust on Windows | MSVC Build Tools 作为大型依赖单独二次确认 |
| Linux | Ubuntu 22.04/24.04 x64，DEB 主包 + AppImage 便携包 |
| macOS | arm64 和 x64 分别发布 DMG + ZIP |
| Windows | x64 NSIS |
| 发布签名 | macOS Developer ID + notarization 硬门禁；Windows 默认 Azure Trusted Signing 硬门禁；Linux 使用签名校验和与 provenance |

签名凭据按“当前尚未准备”处理。正式 Release 在凭据缺失时必须失败；unsigned 产物只能由手动 internal workflow 生成，不得附加到正式 Release。

## 3. 总体架构

### 3.1 EnvironmentService

在 `@emperor/core` 新增长期存活的 `EnvironmentService`，由 `CoreApi` 与 `AgentLoop` 共享。服务分成五个边界：

- `ToolCatalog`：随应用发布的静态、版本化工具目录，只包含受支持工具、探测规则、安装策略、官方来源、摘要和发布者信息。
- `EnvironmentProbe`：使用无 shell 的进程调用探测命令、绝对路径和版本；结果带时间戳与项目 fingerprint。
- `ProjectEnvironmentDetector`：只读当前绑定项目根目录的声明文件，不修改项目配置。
- `InstallOrchestrator`：创建不可篡改安装计划，串行执行依赖步骤，并允许独立步骤在其他步骤失败后继续。
- `ExecutionEnvironment`：合并系统 PATH、用户 PATH、包管理器路径和版本管理器 shim，提供给 Agent 工具、Hooks 与 MCP。

基础 Glob/Grep 改为 Node 原生目录遍历和内容搜索，不再把 `ls/find/head/rg` 作为 Emperor 内部文件能力的前置条件。外部 ripgrep 仍属于基础开发环境，供用户命令和项目脚本使用。

### 3.2 数据接口

```ts
type EnvironmentToolId =
  | 'git' | 'ripgrep'
  | 'volta' | 'node' | 'npm'
  | 'uv' | 'python'
  | 'go'
  | 'rustup' | 'rust' | 'cargo'
  | 'msvc-build-tools'

type EnvironmentToolStatus =
  | 'ready'
  | 'missing'
  | 'version_mismatch'
  | 'installing'
  | 'awaiting_user'
  | 'failed'
  | 'unsupported'

interface EnvironmentToolState {
  id: EnvironmentToolId
  category: 'base' | 'project' | 'large-prerequisite'
  required: boolean
  reason: string
  status: EnvironmentToolStatus
  detectedVersion: string | null
  requiredVersion: string | null
  executablePath: string | null
  installStrategy: string | null
  sourceUrl: string | null
  requiresElevation: boolean
  requiresSeparateConfirmation: boolean
}

interface EnvironmentStatusPayload {
  platform: 'darwin' | 'win32' | 'linux'
  arch: 'arm64' | 'x64'
  supported: boolean
  installer: { id: 'brew' | 'winget' | 'apt' | 'official'; available: boolean }
  projectRoot: string | null
  projectFingerprint: string
  effectivePath: string[]
  tools: EnvironmentToolState[]
  activeJob: EnvironmentInstallJob | null
}

interface EnvironmentInstallPlan {
  planId: string
  catalogRevision: string
  projectFingerprint: string
  expiresAt: string
  steps: EnvironmentInstallStep[]
  acceptedLicenseIds: string[]
  warnings: string[]
}
```

`planId` 由服务端生成并在内存 registry 中保存十分钟。执行时必须同时匹配 catalog revision、项目 fingerprint 和当前工具状态；任一变化都返回 stale plan，要求重新生成。Renderer 只能提交 `planId`、确认标记和已展示的 license IDs。

### 3.3 CoreApi 与事件

新增 operations：

- `environment.getStatus`
- `environment.createInstallPlan`
- `environment.install`
- `environment.cancelInstall`
- `environment.getInstallLog`

`diagnostics.get` 同时返回环境摘要，使诊断页一次刷新即可显示状态。所有 install/cancel 操作调用现有 mutation guard；Plan 模式或待处理 Ask/Plan 时拒绝执行。

新增 runtime events：

- `environment_install_started`
- `environment_install_progress`
- `environment_install_completed`
- `environment_install_failed`
- `environment_changed`

事件只包含 job/tool/step/status/计数和脱敏错误，不包含下载 token、代理凭证或完整环境变量。

## 4. 探测与项目版本

工具探测不通过 shell 拼接命令。每个工具只允许 catalog 声明的可执行文件名和固定 `--version` 参数，并对输出实施 64 KiB 上限和五秒超时。

项目声明优先级：

| 生态 | 识别文件与优先级 | 无声明默认 |
|---|---|---|
| Node | `package.json.volta.node` → `.node-version` → `.nvmrc` → `package.json.engines.node` | Node 24 LTS |
| Python | `.python-version` → `pyproject.toml project.requires-python` → `Pipfile requires.python_version` | Python 3.12 |
| Go | `go.mod` 的 `go`/`toolchain` 指令 | catalog 审核的稳定版 |
| Rust | `rust-toolchain.toml` → `rust-toolchain` → 检测到 `Cargo.toml` 后使用 stable | stable |

只读取项目根目录声明，不递归扫描依赖目录。JSON/TOML 使用结构化解析器；版本范围使用标准 semver/PEP 440 兼容解析，不使用正则猜测完整语义。

版本行为：

- Volta 安装所需 Node 版本。Emperor 启动项目命令时使用 `volta run --node <version>` 提供当前项目版本，不写入 `package.json`。
- uv 安装所需 Python，并通过 `uv python find <version>` 得到解释器目录后注入当前项目执行环境。
- rustup 安装声明 toolchain；rustup shim 根据项目 `rust-toolchain*` 自动选择。没有声明时使用 stable。
- Go 缺失时安装；已有 Go 不满足 `go.mod` 时标记 `version_mismatch`，从批量计划排除，只提供显式升级操作。

## 5. 安装渠道与安全模型

### 5.1 平台策略

macOS：

- 探测 `/opt/homebrew/bin/brew` 与 `/usr/local/bin/brew`；存在时使用固定 formula 名称和参数数组。
- Homebrew 不存在时不自动安装 Homebrew。Git 通过 `xcode-select --install` 启动系统流程；其他工具使用 catalog 中固定版本的官方安装器或发布资产。
- 官方 `.pkg` 使用系统 Installer；归档型工具下载后校验 SHA-256 与发布者，再通过受控提权步骤写入 `/usr/local/bin` 或官方用户级 shim 目录。

Windows：

- winget 存在时使用精确 package ID、`--exact`、固定 source，并在用户确认后传递 source/package agreement 参数。
- winget 不存在时使用 catalog 固定的官方 MSI/EXE/ZIP；执行前验证 Authenticode 为 `Valid` 且 publisher 与 catalog 一致。
- 安装后重新读取 Machine/User PATH，不要求用户重启 Emperor。

Ubuntu：

- Git 与 ripgrep 使用 apt；提权只通过 `pkexec`，不读取或缓存 sudo 密码。
- Volta、uv、rustup 使用固定版本官方资产；Go 使用官方 tarball 与受控 `/usr/local/go` 安装步骤。
- DEB 作为推荐安装包；AppImage 失败时显示 FUSE/沙箱诊断，不自动修改系统。

### 5.2 供应链与执行约束

- catalog 随应用签名发布，不支持运行时远程下发新命令。
- 官方 fallback 资产必须使用 HTTPS、允许域名列表、固定版本和 SHA-256；Windows 额外校验 Authenticode，macOS 校验 pkg 签名或已知发布资产摘要。
- 禁止把远程脚本直接管道到 shell。脚本型官方安装器必须先下载、校验、落到私有临时目录，再以固定参数执行。
- package manager 与 installer 命令全部使用 `spawn(executable, args, { shell: false })`；不得拼接用户输入。
- 日志写入 `stateRoot/environment/installations/<jobId>.jsonl`，默认脱敏 HOME、用户名、token、代理凭证和 URL query。
- 同时只允许一个 job。取消会终止可取消子进程并停止后续步骤；已经进入系统 Installer/UAC 的步骤标记 `awaiting_user`，不能伪装为已取消。
- 安装失败按依赖图跳过下游步骤，但继续运行不相关步骤；最终结果允许 `partial`，并逐项展示重试入口。

## 6. 执行环境统一

`ExecutionEnvironment` 每次探测或安装完成后生成不可变 snapshot：

- macOS 补入 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.volta/bin`、`~/.local/bin`、`~/.cargo/bin`。
- Windows 重新读取 Machine/User PATH，并补入 Volta、uv、Cargo 的标准 shim 路径。
- Ubuntu 补入 `/usr/local/go/bin` 和三个版本管理器的标准路径。

`RunCommand`、command hooks、stdio MCP 和受限 agent handler 都从同一 snapshot 获取 PATH。现有环境变量白名单保持不变；统一 PATH 不能扩大 secret 透传范围。切换项目后创建带项目版本选择的新 snapshot，同一 turn 内保持稳定。

## 7. 诊断页交互

诊断页新增“开发环境”分区，沿用设置页标准行布局，不增加独立安装页面。

展示顺序：

1. 安装器能力与目标平台支持状态。
2. 基础开发环境。
3. 当前项目检测结果与声明来源。
4. 大型依赖和版本冲突。

每行展示状态、检测版本、要求版本、可执行路径与原因。缺失项提供单项“安装”；顶部提供“安装所需环境”。批量按钮生成计划后打开确认 modal，展示步骤、来源、许可、预估体积、提权和不可取消步骤。

运行期间显示当前工具、步骤计数、实时状态和取消按钮。失败后显示脱敏摘要，并允许打开本次日志。MSVC Build Tools 不进入普通批量确认，只有用户点击该行并完成第二次确认后才安装。

无网络、代理失败、磁盘不足、用户拒绝 UAC/Installer、package manager source 不可用、校验失败和安装后仍探测不到工具，都必须给出不同错误码和可执行恢复动作。

## 8. Release 与平台验收

### 8.1 产物

- macOS arm64：DMG + ZIP
- macOS x64：DMG + ZIP
- Windows x64：NSIS EXE
- Ubuntu x64：DEB + AppImage
- 全平台：SHA-256 清单、CycloneDX SBOM、GitHub artifact provenance

macOS 配置 `minimumSystemVersion: 14.0`、Hardened Runtime、主/子进程 entitlements、Developer ID 签名、notarization 与 stapling。CI 使用 App Store Connect API key，不使用 Apple ID 密码。

Windows 使用 Azure Trusted Signing；electron-builder 启用 `forceCodeSigning`。凭据或签名验证失败时 release job 失败。

Linux 没有等价的系统级 Authenticode，使用 SHA-256 清单、keyless provenance 和 GitHub Release immutable artifact 作为验证链。

### 8.2 CI 矩阵

- macOS arm64：GitHub 标准 arm64 runner。
- macOS x64：GitHub Intel runner。
- Windows x64：`windows-2022` 或后续受支持 x64 runner。
- Ubuntu x64：`ubuntu-22.04` 与 `ubuntu-24.04` 启动验收。

Release workflow 删除已经失效的独立 `desktop-pet/` install/test 步骤，桌宠测试并入 desktop workspace。正式发布 job 只接受 tag，并在所有产物验收通过后统一上传。

新增 packaged smoke mode：使用临时 stateRoot 启动已打包应用，初始化 CoreApi，验证 bootstrap、runtime defaults、诊断与环境探测，然后写 receipt 并退出。该模式不创建窗口、不请求模型凭证、不安装环境。

平台 gate：

- macOS：`codesign --verify --deep --strict`、`spctl --assess`、`stapler validate`、packaged smoke。
- Windows：验证 NSIS EXE 的 Authenticode publisher，静默安装到临时 runner，执行 packaged smoke，再卸载。
- Ubuntu：安装 DEB 后执行 packaged smoke；AppImage 使用 `xvfb-run` 启动并验证 receipt。

internal unsigned workflow 必须通过 `workflow_dispatch` 明确触发，artifact 名含 `UNSIGNED-INTERNAL`，保留期不超过七天，且不调用 GitHub Release publish。

## 9. 测试与验收标准

Core 单元/集成测试覆盖：

- 三平台 PATH 合并、命令探测、版本解析和状态归类。
- Node/Python/Go/Rust 项目声明优先级与冲突处理。
- install plan 过期、fingerprint/catalog stale、重复 job、取消和 partial result。
- 固定命令参数、无 shell、域名限制、摘要/签名失败拒绝执行、日志脱敏。
- mutation guard、turn snapshot 稳定性，以及 RunCommand/Hooks/MCP 使用同一 PATH。
- Node 原生 Glob/Grep 在 macOS/Windows 路径、Unicode、二进制文件和大文件上的行为。

Desktop 测试覆盖：

- 新 CoreApi operations、IPC contract、preload 与 renderer types。
- 诊断环境分区、汇总确认、单项安装、进度、取消、partial、日志和 MSVC 二次确认。
- 390px 窄屏无横向溢出、按钮/路径不重叠，诊断页保持可滚动。

Release 必须满足：

- 三平台目标架构全部产生产物，包内包含 `app.asar`、runtime defaults 和桌宠资源。
- 干净 runner 未预装项目 Node/Python 时 packaged smoke 仍通过。
- 正式 macOS/Windows 产物均通过系统签名校验；Ubuntu 产物有可验证的摘要、SBOM 与 provenance。
- 安装环境功能只能在支持平台和用户确认后执行，不会在测试、smoke mode 或首次启动时自动修改系统。
- `make check`、desktop Playwright、package smoke 和 release verification 全绿后才允许发布。

## 10. 外部前置与默认值

- 需要加入 Apple Developer Program，并准备 Developer ID Application 证书与 App Store Connect API key。
- Windows 默认申请 Azure Trusted Signing；若账号地区或组织资格不可用，改用可导出的 OV PFX，但仍保持 `forceCodeSigning`，不得退回 unsigned 正式包。
- 默认 catalog 使用 Node 24 LTS、Python 3.12、Rust stable；Go 按项目最低版本安装 catalog 支持的最新兼容版本。
- Homebrew、winget、apt 的 package identifiers 属于发布时审核数据；每次升级 catalog 都必须经过安装计划 golden tests 和三平台 internal workflow。

参考资料：

- [Homebrew Installation](https://docs.brew.sh/Installation)
- [WinGet install](https://learn.microsoft.com/en-us/windows/package-manager/winget/install)
- [Volta Getting Started](https://docs.volta.sh/guide/getting-started)
- [uv Installation](https://docs.astral.sh/uv/getting-started/installation/)
- [rustup Installation](https://rust-lang.github.io/rustup/installation/)
- [electron-builder Code Signing](https://www.electron.build/docs/features/code-signing/)
- [electron-builder macOS Notarization](https://www.electron.build/docs/notarization/)
