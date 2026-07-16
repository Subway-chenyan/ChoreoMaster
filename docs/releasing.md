# CosStage 发布手册

本文说明 CosStage 桌面版本从日常变更、聚合 Release PR、Windows 签名、COS 发布到回滚的完整流程。生产发布以 GitHub Actions 中的 `production` Environment 为边界；不要在本地直接改写 COS 稳定指针、创建版本标签或发布 GitHub Release。

## 发布模型与人工授权

CosStage 采用 Changesets 聚合发布：多项日常变更先合入 `main`，`Release PR` 工作流持续创建或更新一个 `chore: version packages` PR。实现分支或普通 PR 合入 `main` 只会聚合发布信息，不会发布新的桌面版本，也不会移动桌面下载的 stable 指针。

只有发布负责人检查并人工合并 Release PR，才表示授权生产发布。版本变化提交进入 `main` 后，`Desktop Release` 才会构建、签名并发布该版本。不要自动合并 Release PR。

普通非版本提交仍可能由 `Deploy Web` 更新 Web 站点；这不等于发布新的桌面版本。

## 日常变更

每个普通 PR 必须且只能声明一种版本意图：

- 用户可见的功能、修复或行为变化：运行 `npm run changeset`，选择 `cosstage-desktop`，填写版本级别和中文摘要。
- 不影响产品版本的内部维护：不给仓库新增 Changeset，并给 PR 添加 `release:none` 标签。

Changeset 与 `release:none` 不能同时存在，二者都没有也会使 Quality 检查失败。功能分支不得手工修改 `package.json.version`、`package-lock.json` 根版本、`CHANGELOG.md` 或 `data/release-history.json.currentVersion`。

版本级别按以下规则选择：

| 级别 | 使用场景 |
| --- | --- |
| Patch | 向后兼容的缺陷修复或小幅体验改进 |
| Minor | 向后兼容的新功能 |
| Major | 不兼容变化、需要用户操作的数据或流程迁移 |

Major Changeset 必须包含清晰的“重大变化”和“迁移说明”，说明受影响用户、升级前准备、迁移步骤以及能否回退。摘要应使用面向用户的中文，避免只写内部模块名或提交号。

提交 PR 前至少运行：

```powershell
npm ci
npm run validate:release-data
npm test
```

## Release PR 审核

`.github/workflows/release-pr.yml` 在 `main` 更新后维护聚合 Release PR。发布负责人必须人工确认以下内容后再合并：

1. 聚合后的 Patch、Minor 或 Major 级别符合所有待发布 Changeset 中的最高影响级别。
2. `CHANGELOG.md` 的中文摘要完整、无重复，且能让用户理解变化。
3. Major 版本包含“重大变化”和可执行的迁移说明。
4. `package.json.version` 与 `package-lock.json` 根版本一致。
5. `data/release-history.json.currentVersion`、首条 release 版本和生成版本一致。
6. `build/release-notes.md` 标题为 `CosStage X.Y.Z`，内容与 CHANGELOG/history 一致。
7. 已聚合的 `.changeset/*.md` 被消费，没有遗漏或误消费。
8. Release PR 的 `npm run validate:release-data` 与 `npm test` 全部通过。

可在临时 clone 中预演生成结果，避免污染真实工作区：

```powershell
npm ci
npm run version-packages
npm run validate:release-data
npm test
```

预演后检查版本、CHANGELOG、结构化历史和 release notes。不要在功能分支提交预演生成物；正式生成物由 Release PR 维护。

## Production Environment 配置

在 GitHub 仓库 Settings → Environments 中创建 `production`，配置 required reviewers，并限制只有发布负责人可以批准。Deployment branches 只允许 `main` 和 Changesets Release PR 分支 `changeset-release/main`；禁止任意功能分支或临时分支进入 production。桌面构建、生产发布、Web 部署与回滚都使用该 Environment。

Environment secrets：

- `TENCENT_SECRET_ID`
- `TENCENT_SECRET_KEY`
- `CSC_LINK`
- `CSC_KEY_PASSWORD`

Environment variable：

- `WINDOWS_PUBLISHER_NAME`：必须与 Windows Authenticode 证书 Subject 中的发布者一致。

腾讯云 COS 存储桶 `beat-1317738912` 的 bucket versioning 必须为 `Closed`。所有会写入生产 COS 的工作流（`Desktop Release`、`Desktop Rollback`、`Deploy Web`）都会在首次写入前通过已认证的 COS API 检查该状态；如果无法读取或状态不是 `Closed`，工作流会 fail closed。不要为了重试临时启用或暂停 bucket versioning。

仓库还必须创建 `release:none` 标签。该标签只用于明确声明普通 PR 没有产品版本影响，不能用于跳过 Release PR 的人工审核。

密钥、证书内容和密码不得写入 `.env`、提交日志、构建产物或文档。根目录 `.env.example` 只记录本地 dry-run 开关和本地发布者名称。

## 上线前验收

在 Windows 上验证当前版本的 unsigned dry-run：

```powershell
npm ci
npm run validate:release-data
npm run test:release
npm test
npm run build:electron:win
node scripts/release/verify-builder-output.mjs 1.0.0
./scripts/release/verify-windows-signature.ps1 `
  -InstallerPath release/CosStage-Setup-1.0.0-x64.exe `
  -ExpectedVersion 1.0.0 `
  -ExpectedPublisher "$env:COSSTAGE_WINDOWS_PUBLISHER_NAME" `
  -AllowUnsigned
```

将示例中的 `1.0.0` 替换为当前工作区版本。`-AllowUnsigned` 只能用于本地 dry-run；生产工作流设置 `COSSTAGE_REQUIRE_CODE_SIGNING=true`，不允许 unsigned 安装包通过。

如需在合并 Release PR 前验证真实签名，只能在 GitHub Actions 中选择 Changesets Release PR 分支 `changeset-release/main`，再手工运行 `Desktop Release`。不得从任意功能分支或临时分支发起 production 签名预检。Windows build job 仍需 `production` reviewer 批准；`publish` 与 `repair-release` 必须因 `github.ref != 'refs/heads/main'` 显示 skipped。下载 CI artifact 后执行 `Get-AuthenticodeSignature`，确认 `Status` 为 `Valid`，且证书 Subject 包含 `WINDOWS_PUBLISHER_NAME`。不要在该分支运行回滚或任何 COS 写操作。

合并 Release PR 前，production reviewer 还必须在腾讯云控制台或经认证的 COS CLI 中确认 bucket versioning 返回 `Closed`。发布日志中的版本控制预检必须成功；状态无法确认时不得批准生产发布。

## 生产发布与成功信号

人工合并 Release PR 后，观察 `.github/workflows/desktop-release.yml` 对应的 `Desktop Release` 运行。工作流会：

1. 在 Windows runner 执行完整质量门禁并生成已签名安装包。
2. 验证 Authenticode、Builder 原始 `latest.yml`、blockmap、文件大小及校验值。
3. 先创建版本化不可变制品，再依次更新稳定安装包、`releases.json`、根 `latest.yml`。
4. 清理 CDN 缓存并按完整 SHA-256 验证公网文件。
5. 公网验证成功后创建 `vX.Y.Z` tag 和 GitHub Release。
6. 发布成功或修复 GitHub Release 后调用 `Deploy Web`。

以下信号全部满足才算发布完成：

- Windows build、`publish`（或 `repair-release`）和 `deploy-web` job 成功。
- 安装包 Authenticode 状态为 `Valid`，发布者与 `WINDOWS_PUBLISHER_NAME` 一致。
- `https://beat.cosdrama.cn/downloads/CosStage-Setup-x64.exe` 可下载且哈希与本次版本一致。
- `https://beat.cosdrama.cn/downloads/releases.json` 的 `currentVersion` 与 `stableVersion` 都是本次版本。
- `https://beat.cosdrama.cn/downloads/latest.yml` 与版本化 `downloads/metadata/X.Y.Z/latest.yml` 一致。
- `vX.Y.Z` tag 指向版本提交，GitHub Release 包含版本化安装包和 `.sha256`。
- Web 产品指南的“版本更新”能读取并显示相同的 stable 版本。

## COS 写序与失败补偿

COS 不提供覆盖多个对象的事务。发布脚本先上传版本化不可变对象，然后按以下顺序提交三个可变 pointer：

```text
downloads/CosStage-Setup-x64.exe
→ downloads/releases.json
→ downloads/latest.yml
```

根 `latest.yml` 是最后一个 COS 写入，但整个序列不是原子事务。中途失败时，三个 pointer 可能短暂不一致；不要把“最后一步尚未执行”误判为完整回滚。

Windows job 上传的已签名 artifact 只保留 1 天。一旦 `publish` job 开始，该 artifact 的哈希就是本次版本的制品身份。COS 上传、pointer 提交或公网验证失败时，只能回到原 `Desktop Release` workflow run，选择 **Re-run failed jobs**，让失败的 publish job 复用同一 artifact。不得选择 Re-run all jobs，也不得新开 workflow run 重签同一版本；Authenticode 时间戳会使新安装包产生不同哈希，并触发不可变对象冲突。

| 失败点 | 补偿方式 |
| --- | --- |
| Windows 构建、测试或签名在 artifact 上传完成前失败 | 修复原因后在原运行选择 **Re-run failed jobs**。此时 publish 尚未开始，不存在远端制品身份冲突。 |
| 不可变制品上传或 COS 读取失败 | 在 artifact 仍处于 1 天保留期内时，只在原运行选择 **Re-run failed jobs**。相同哈希的不可变对象会被验证后复用。 |
| 远端同名不可变对象与本地哈希不同 | 立即停止，不得覆盖、删除或绕过检查。核对版本号、签名产物、构建来源和 COS 对象，确认原因后使用新版本修复。 |
| 稳定安装包、`releases.json` 或根 `latest.yml` 更新中断 | 先确认版本化对象哈希一致，再在原运行选择 **Re-run failed jobs**。同一 publish job 会复用已签名 artifact，并重新按稳定安装包 → index → latest 写入，使半提交 pointer 收敛。 |
| COS 写入完成但公网哈希验证失败 | 检查 CDN、缓存刷新和对象内容；恢复后在原运行选择 **Re-run failed jobs**。公网验证通过前不会创建 tag 或 GitHub Release。 |
| 原运行的已签名 artifact 已超过 1 天保留期，且 tag 尚未创建 | 当前自动化不能安全重签并复现同一哈希。先确认前一 stable 已存在于 `releases.json`，且它的版本化 installer、blockmap、`.sha256` sidecar 和 metadata 四项完整；只有全部满足时，才能手工运行 `Desktop Rollback` 将三个 pointer 收敛到前一 stable，再通过新的 Changeset 和 Release PR 发布更高 Patch。若索引或任一历史制品缺失，立即停止自动操作并进入事故处置：不得覆盖或删除同版本制品，先盘点三个 pointer 的实际状态并制定人工恢复方案，最后通过更高 Patch 收敛。 |
| tag 已创建，但 GitHub Release 不存在或缺少资产 | 在 `main` 新开 `Desktop Release` workflow run，或手工 dispatch 该工作流。detect 会进入 `repair-release`，从公网版本化对象校验并补齐 Release，不重新构建、签名或改写 COS 历史制品。 |
| GitHub Release 完成，但 `deploy-web` 失败 | 排除故障后在该次 `Desktop Release` 中选择 “Re-run failed jobs”，保留 `force: true` 的可复用 Web 部署调用。 |

不要删除历史 tag、GitHub Release 或版本化 COS 对象来“重试”，也不要用 Re-run all jobs 重新签名同一版本。任何同名异哈希都表示版本不可复现或对象被篡改，必须停机调查。

## 手工回滚 stable 版本

回滚只允许选择已经存在于 `downloads/releases.json` 的版本，不重新构建、不删除历史，也不改变 `currentVersion`。

操作步骤：

1. 确认目标版本的版本化安装包、blockmap、`.sha256` 和 `downloads/metadata/X.Y.Z/latest.yml` 都存在。
2. 打开 GitHub Actions → `Desktop Rollback` → Run workflow。
3. 分支选择 `main`，输入严格的 `X.Y.Z` 版本号。
4. 由 production required reviewer 人工批准。
5. 等待历史制品验证、pointer 提交、CDN purge 和公网完整哈希验证全部成功。
6. 检查 `releases.json.stableVersion`、稳定安装包和根 `latest.yml` 都指向目标版本；`currentVersion` 应保持最新已发布版本。

回滚同样按稳定安装包 → `releases.json` → 根 `latest.yml` 写入，不是原子事务。中途失败时，在确认历史制品未变化后，以同一目标版本 rerun `Desktop Rollback` 使 pointer 收敛。

Electron updater 不会自动降级已经安装的更高版本。回滚主要保护尚未升级、重新安装或版本较低的客户端；已经安装问题版本的用户需要通过发布一个更高 Patch（例如从问题版本 `1.2.0` 发布 `1.2.1`）恢复。不要通过删除 tag 或伪造更低版本号强制降级。

## 1.0.0 到 1.1.0 的一次性迁移

1.0.0 的更新 IPC 不可靠，不能依赖应用内自动更新。1.1.0 正式发布后，1.0.0 用户需要：

1. 在应用内保存当前项目，建议再导出一个完整项目包备份。
2. 退出 CosStage，不要先卸载 1.0.0。
3. 从 `https://beat.cosdrama.cn/downloads/CosStage-Setup-x64.exe` 下载 1.1.0 安装包。
4. 直接覆盖安装并重新启动，确认项目和设置仍然存在。
5. 首次启动确认“本次更新 · 1.1.0”，完成一次性迁移提示；确认前不会提前标记为已读。
6. 在产品指南的版本信息中确认已升级到 1.1.0。此后可使用新的应用内更新流程。

CosStage 保持原有 `appId`，安装器也不会在卸载时主动删除应用数据；覆盖安装用于保留项目目录和设置。如果项目未出现，停止编辑并从迁移前导出的项目包恢复。
