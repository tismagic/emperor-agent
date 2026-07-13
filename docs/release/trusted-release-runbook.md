# Emperor Agent 可信 Release 运维手册

## 1. 发布边界

正式 Release 必须由 `.github/workflows/release.yml` 在 `v*` tag 上生成，不接受本地上传或平台 job 直接发布。一次 Release 必须同时包含：

- macOS arm64/x64 的签名、公证、staple、Gatekeeper、DMG mount 和 packaged smoke receipt。
- Windows x64 NSIS 的 Azure Artifact Signing、安装器/已安装程序/卸载器 Authenticode、安装、smoke 和卸载 receipt。
- Ubuntu x64 AppImage 与 DEB，以及 Ubuntu 22.04/24.04 的启动、安装和移除 receipt。
- 七个正式 artifact、两级 SHA-256 manifest、`release-manifest.json`、CycloneDX 1.6 SBOM、provenance 与 SBOM attestations。

任一输入缺失、commit 不一致、摘要不匹配或 receipt 失败时，聚合 job 必须失败。不得改用 unsigned 包、跳过平台或手工补传 artifact。

支持范围：macOS 14+ arm64/x64、Windows 10 22H2+ x64、Ubuntu 22.04/24.04 x64。Windows ARM64、其他 Linux 发行版和自动更新不在当前正式支持范围。

## 2. 凭据

GitHub Actions repository/environment secrets 必须配置：

| 平台    | Secrets                                                                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS   | `MACOS_CERTIFICATE`、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_API_KEY_BASE64`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`APPLE_TEAM_ID`                                         |
| Windows | `WINDOWS_SIGNING_ENDPOINT`、`WINDOWS_SIGNING_PROFILE`、`WINDOWS_SIGNING_ACCOUNT`、`WINDOWS_SIGNING_PUBLISHER`、`AZURE_TENANT_ID`、`AZURE_CLIENT_ID`、`AZURE_CLIENT_SECRET` |

规则：

1. 凭据只存 GitHub Secrets 或受控签名服务，不写入仓库、artifact、日志、issue 或 receipt。
2. `WINDOWS_SIGNING_PUBLISHER` 必须是证书 Simple Name 的精确值；更换 publisher 视为安全边界变更。
3. Apple API key 文件只在 runner 临时目录解码，job 结束后由 runner 销毁。
4. 轮换时先创建新 key/secret、更新 GitHub Secrets，再用计划发布 tag 验证完整候选链；成功后撤销旧凭据。验证失败时恢复 secret 指向，不得放宽签名门禁。
5. 凭据泄露时立即撤销，停止 tag 发布，保留 Actions 审计记录，并重新签发受影响版本；不能只删除本地文件。

## 3. 发布前检查

1. 确认工作树干净，目标 commit 已在受保护主分支并通过 `make check`。
2. `desktop/package.json` 的 version 必须与待创建 tag 完全一致，例如 `0.1.0` 对应 `v0.1.0`。
3. 审核 `packages/core/src/environment/tool-catalog.json`；如有变化，完成 `tool-catalog-review.md`。
4. 确认 Apple Developer ID、notarization API 与 Azure Artifact Signing 凭据未过期。
5. 确认 GitHub Actions 支持 `macos-15`、`macos-15-intel`、`windows-2022`、`ubuntu-22.04`、`ubuntu-24.04`。
6. 创建并推送 annotated tag。不要预先创建同名 GitHub Release。

## 4. Workflow 验收

平台 jobs 只上传保留 7 天的 candidate。`release-aggregate` 必须等待四个依赖 job 全部成功，然后：

1. 下载候选与 Linux 生命周期 receipts。
2. `assemble-release-bundle.mjs` 校验 artifact 数量、名称、摘要、commit、签名结果、安装结果和 packaged smoke。
3. 分别从根与 Desktop lockfile 生成可复现 CycloneDX 1.6 BOM，并合并 Core 依赖图。
4. 对正式 artifact 生成 SBOM attestation，对完整 bundle 生成 provenance attestation。
5. 用 `gh attestation verify` 重新验证两类 attestation。

`publish-release` 再次校验完整 SHA-256 与 provenance，创建 draft、上传全部文件、比较本地/远端 asset inventory，最后才将 draft 改为公开。任何上传或 inventory 检查失败都会删除 draft；已有同名 Release 时脚本拒绝覆盖。

## 5. 发布后验证

下载 Release 全部 assets 后执行：

```bash
sha256sum --check SHA256SUMS.txt
gh attestation verify Emperor-Agent-<version>-<platform>-<arch>.<ext> \
  --repo TheSyart/emperor-agent \
  --signer-workflow TheSyart/emperor-agent/.github/workflows/release.yml \
  --source-ref refs/tags/v<version>
gh attestation verify Emperor-Agent-<version>-<platform>-<arch>.<ext> \
  --repo TheSyart/emperor-agent \
  --predicate-type https://cyclonedx.org/bom
```

macOS 额外检查 `codesign --verify --deep --strict`、`spctl --assess` 和 `xcrun stapler validate`。Windows 使用 `Get-AuthenticodeSignature` 检查安装器及已安装 executable 的状态和 publisher。Linux 检查 DEB metadata，并分别启动 AppImage 与安装后的 DEB executable。

在 Actions run summary 中保存平台 receipt artifact 名、`release-manifest.json` 摘要和公开 Release URL。Receipt 不得包含 HOME、用户名、token、完整 PATH 或凭据。

## 6. Unsigned Internal

`.github/workflows/release-internal.yml` 只用于验证 packaged runtime：

- 仅 `workflow_dispatch`，没有 `contents: write`。
- artifact 必须包含 `UNSIGNED-INTERNAL.txt`，名称包含 `UNSIGNED-INTERNAL`，保留期为 7 天。
- 不得重命名、转发给最终用户、附加到 GitHub Release 或用作正式 candidate。
- 发现内部包进入聚合输入时，`assemble-release-bundle.mjs` 必须立即失败。

## 7. 失败恢复

| 故障                             | 处理                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| 缺少或过期凭据                   | 停止发布，轮换 secret 后重新运行完整 tag workflow；不得只重跑 publish job           |
| 平台签名或 smoke 失败            | 查看对应 job 的脱敏日志，修复后创建新 commit/tag；旧 candidate 不可与新 commit 混用 |
| receipt、checksum 或 SBOM 不一致 | 视为构建完整性失败，废弃整批候选，不手工编辑 receipt                                |
| attestation API 暂时不可用       | workflow 会有限重试；持续失败时保留候选并重新运行完整 workflow                      |
| draft 上传失败                   | 发布脚本自动删除 draft；确认不存在同名 Release 后重跑完整聚合/发布链                |
| 已公开版本发现安全问题           | 撤销相关凭据，停止后续 tag，发布安全公告与修复版本；保留原 attestation 审计记录     |

当前首个正式版本仍被 Apple/Azure 凭据和三平台真实 receipt 阻塞。在这些证据完成前，Release 任务不得标记为 done。

## 8. UNSIGNED-PREVIEW 公开预览版

Preview 是独立分发通道，不是 Stable 的降级模式。`.github/workflows/release-preview.yml` 只接受 `v*-preview.*`，不读取 Apple/Azure 签名凭据；`.github/workflows/release.yml` 排除全部 prerelease tag。首个目标是 `v0.1.0-preview.1`。

### 8.1 发布前门禁

1. 目标 commit 必须已进入并可从 GitHub 默认分支到达，且通过 `make check` 和三平台普通 CI。
2. 确认不存在同名 tag 和 GitHub Release；Preview publisher 不覆盖已有 Release。
3. 从默认分支 commit 创建并推送 annotated tag，例如 `git tag -a v0.1.0-preview.1 -m "Emperor Agent v0.1.0-preview.1 UNSIGNED-PREVIEW"`。
4. 确认 Preview workflow 是唯一匹配者，Stable workflow 没有 candidate run。
5. 不要手工创建 Release；workflow 会先创建 draft，核对 inventory 后再公开为 Pre-release。

### 8.2 候选与聚合

同一 workflow run 必须产出以下七个带 `UNSIGNED-PREVIEW` 的产品文件：macOS arm64/x64 各一份 DMG 和 ZIP、Windows x64 NSIS EXE、Linux x64 AppImage 和 DEB。每个平台 candidate receipt 必须声明 `channel: preview`、`signingStatus: unsigned`、tag、commit、run ID、平台、架构、artifact SHA-256、resource inspection 和 packaged smoke；Ubuntu 22.04/24.04 还必须各有一份安装生命周期 receipt。

`preview-aggregate` 严格拒绝 Stable、`UNSIGNED-INTERNAL`、跨 commit/run、缺失/重复文件和摘要不一致输入。聚合后生成 `preview-release-manifest.json`、`UNSIGNED-PREVIEW.json`、`UNSIGNED-PREVIEW-NOTICE.md`、`ARTIFACT-SHA256SUMS.txt`、`SHA256SUMS.txt` 和 CycloneDX 1.6 SBOM，并对完整 bundle 与七个产品文件分别生成 provenance/SBOM attestation。Attestation 只证明 GitHub 构建来源和完整性，不代表发布者签名、公证或 Stable 信任级别。

### 8.3 发布后验证

从公开 Pre-release 重新下载全部 assets，在同一目录执行：

```bash
sha256sum --check SHA256SUMS.txt
gh attestation verify Emperor-Agent-0.1.0-preview.1-UNSIGNED-PREVIEW-<platform>-<arch>.<ext> \
  --repo TheSyart/emperor-agent
gh attestation verify Emperor-Agent-0.1.0-preview.1-UNSIGNED-PREVIEW-<platform>-<arch>.<ext> \
  --repo TheSyart/emperor-agent \
  --predicate-type https://cyclonedx.org/bom
```

macOS 预期显示未识别开发者/未公证警告。确认来源和 SHA-256 后，只使用 **System Settings → Privacy & Security → Open Anyway** 为该应用创建例外，参见 [Apple 官方说明](https://support.apple.com/en-us/102445)。Windows 预期显示 `Unknown publisher` 或 SmartScreen；确认摘要后，仅在设备策略提供该选项时选择 **More info → Run anyway**，参见 [Microsoft 官方说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/publish-first-app)。不要更改整机 Gatekeeper、Defender 或 SmartScreen 策略；组织策略不允许时应停止安装并联系管理员。

Actions run summary 必须记录公开 Pre-release URL、tag commit、run ID、七个 artifact、四个平台 candidate receipt、Ubuntu 22.04/24.04 lifecycle receipt、manifest/SBOM 摘要和 attestation verification。只有这些真实证据齐全后，`PREVIEW-QA-025` 才能标记完成；本地 unsigned package 或规划文档不能替代。
