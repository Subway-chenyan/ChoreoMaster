# CosStage 版本管理与桌面发布设计

状态：已批准
日期：2026-07-16
范围：Windows x64 稳定通道、产品版本历史、应用内更新、腾讯云 COS 发布与回滚

## 1. 背景

CosStage 当前将 `package.json` 固定为 `1.0.0`，Electron Builder 因此持续生成同一版本的安装包。仓库没有版本 tag 或 `CHANGELOG.md`，现有 CI 在每次 `main` push 时同时发布 Web 和桌面端，并用固定文件名覆盖安装包。

现有桌面更新链路还有三个发布风险：CI 手工生成 `latest.yml` 并写入十六进制 SHA-512，而不是原样发布 Electron Builder 生成的更新元数据；Windows 安装包未进行 Authenticode 签名；已发布的 `1.0.0` 存在 preload 失效，渲染进程无法可靠调用更新 IPC。因此，`1.0.0` 不能依赖应用内更新完成自愈。

本设计建立一套可审计、可重试、可回滚的聚合发布体系。每个用户可见变更都声明版本影响，但实际版本号只在人工批准的 Release PR 中统一计算。成功发布后，安装包、更新元数据、产品指南、Git tag 和变更记录使用同一版本。

## 2. 目标与非目标

### 2.1 目标

- 每个用户可见变更都声明 `major`、`minor` 或 `patch`，内部变更显式声明 `none`。
- 多项变更聚合为 Release PR，经人工确认合并后生成一个新版本。
- 自动维护 `package.json`、`package-lock.json`、`CHANGELOG.md` 和结构化版本历史。
- 产品指南展示当前版本、历史版本、变更内容和迁移说明。
- Major 更新使用专用提示，用户明确确认后才下载和覆盖安装。
- Electron Builder 产物经过签名、校验，并以原子顺序发布到腾讯云 COS。
- 发布可以安全重试；失败不会让客户端看到不完整的新版本。
- 历史安装包永久保留，支持人工切换稳定指针和发布更高版本的紧急修复。

### 2.2 非目标

- 首期不发布 macOS 或 Linux 安装包。
- 首期不实现 Beta、Nightly、分批灰度或多通道更新。
- 不实现客户端自动降级；已安装坏版本通过发布更高版本的修复包恢复。
- 不引入应用商店分发或独立发布后台。

## 3. 核心决策

### 3.1 版本工具

采用 Changesets + Release PR。Release Please 能从 Conventional Commits 推导版本，但不能像 Changesets 一样在变更发生时保存独立、可审核的用户说明；Semantic Release 会在合并后直接发布，缺少本项目当前需要的人工门禁。

项目为私有单包仓库，Changesets 配置启用私有包升版但禁用其自动打 tag：

- `privatePackages.version = true`
- `privatePackages.tag = false`
- `baseBranch = main`
- Changesets 只负责变更聚合、版本计算和 changelog；COS 发布成功后由桌面发布工作流创建 `vX.Y.Z` tag。

### 3.2 发布节奏

采用聚合发布。普通功能 PR 不直接修改 `package.json` 版本号：

- 用户可见变更必须添加 `.changeset/*.md`。
- 内部重构、测试或纯文档变更必须添加 `release:none` PR 标签。
- CI 要求二者至少满足其一；同时存在时移除 `release:none`。
- 多个 Changeset 聚合时取最高影响级别：`major > minor > patch`。
- Release PR 合并就是人工发布确认，合并后自动进入受保护的生产发布任务。

这个定义满足“每次修改都记录版本变化”，同时避免多个功能分支并行编辑同一个版本字段造成冲突。

### 3.3 第一个受治理版本

第一个受治理版本固定为 `1.1.0`。它包含 preload 修复、正确的更新元数据和新的版本治理能力。现有 `1.0.0` 用户需要从官网下载一次安装包并覆盖安装；从 `1.1.0` 开始才承诺应用内更新。

## 4. 版本规则

采用 Semantic Versioning：

- `major`：不兼容的项目格式、数据迁移、IPC 契约或核心工作流变化。
- `minor`：向后兼容的新功能或显著产品能力。
- `patch`：向后兼容的缺陷修复、性能改进和小型体验优化。
- `none`：不改变产品行为的测试、重构、构建维护和文档修改。

Major Changeset 正文必须包含“重大变化”和“迁移说明”两个 Markdown 小节；版本校验脚本缺少任一小节时失败。Minor 和 Patch Changeset 使用一段面向用户的中文摘要，不允许只写内部实现细节。

已发布版本不可重用、不可覆盖、不可删除。紧急修复始终生成更高版本号。

## 5. 版本数据模型

### 5.1 数据源

版本信息按阶段划分权威来源：

- 未发布阶段：`.changeset/*.md` 是版本影响和用户说明的来源。
- Release PR 阶段：`package.json` 是待发布应用版本，`data/release-history.json` 和 `CHANGELOG.md` 由同一次版本脚本生成。
- 已发布阶段：`vX.Y.Z` tag、COS 版本化制品与 COS `releases.json` 共同证明该版本已发布。

禁止人工分别维护这些出口。`npm run version-packages` 在 Changesets 升版前读取待发布 Changeset，随后一次性更新包版本、锁文件、 changelog、当前版本发布说明和结构化版本历史。

### 5.2 结构化版本历史

`data/release-history.json` 使用带 schema 版本的稳定结构：

```json
{
  "schemaVersion": 1,
  "currentVersion": "1.1.0",
  "releases": [
    {
      "version": "1.1.0",
      "date": "2026-07-16",
      "kind": "minor",
      "title": "桌面更新链路与版本管理",
      "summary": "建立可恢复的桌面版本发布与在线更新流程。",
      "changes": [
        { "kind": "minor", "text": "新增版本历史与应用内更新。" }
      ],
      "breakingChanges": [],
      "migrationSteps": [
        "1.0.0 用户需要从官网下载并覆盖安装一次。"
      ]
    }
  ]
}
```

版本生成脚本使用 schema 校验该文件。`currentVersion` 必须等于 `package.json.version`，版本数组必须严格倒序、无重复版本。Major 记录必须包含非空 `breakingChanges` 和 `migrationSteps`。

### 5.3 发布说明

版本脚本从当前版本记录生成 `build/release-notes.md`，Electron Builder 通过 `releaseInfo.releaseNotesFile` 将其写入原生 `latest.yml`。产品指南读取同一个 JSON，COS 发布流程再从它生成只包含已成功发布版本的 `releases.json`。三种界面不再复制手写说明。

## 6. 日常开发与 Release PR

### 6.1 用户可见变更

1. 开发者运行 `npm run changeset`。
2. 选择 `major`、`minor` 或 `patch` 并填写中文用户摘要。
3. PR CI 校验 Changeset 格式和 Major 迁移说明。
4. PR 合并后，Changesets Action 把记录累积到 Release PR。

### 6.2 内部变更

内部变更不创建空 Changeset，改用 `release:none` PR 标签。CI 仍留下明确审计记录，同时不会生成没有产品内容的版本。

### 6.3 Release PR

Changesets Action 维护唯一 Release PR。自定义版本命令依次执行：

1. 读取并暂存全部未发布 Changeset。
2. 计算下一个版本并运行 Changesets version。
3. 同步 `package-lock.json`。
4. 更新 `data/release-history.json` 和 `CHANGELOG.md`。
5. 生成当前版本发布说明。
6. 运行版本一致性校验、类型检查和完整测试。

人工评审重点是版本级别、用户说明、Major 迁移内容和发布范围。合并后普通开发者不再手工改版本。

## 7. CI 工作流架构

现有 `.github/workflows/deploy-cos.yml` 拆分为五个职责单一的工作流：

| 工作流 | 触发 | 职责 |
|---|---|---|
| `ci.yml` | PR、`main` push | Changeset 门禁、类型检查、测试、构建 |
| `release-pr.yml` | `main` push | 维护 Changesets Release PR |
| `web-deploy.yml` | 普通 `main` push 或 `workflow_call` | 发布 Web，清理旧 PWA 文件，验证 CDN |
| `desktop-release.yml` | `main` push 检测到无 tag 的新版本 | 构建、签名、COS 原子发布、tag 与 GitHub Release |
| `desktop-rollback.yml` | `workflow_dispatch` | 选择历史版本并切换稳定指针 |

桌面发布使用 GitHub Production Environment。其并发组固定为 `desktop-release-stable`，`cancel-in-progress: false`，避免新提交取消正在上传的安装包。

`desktop-release.yml` 不只依赖 path filter，而是比较当前 `package.json.version`、版本历史、COS 稳定指针、`vX.Y.Z` tag 和 GitHub Release。新版本进入可重试发布；只有 COS、tag 和 GitHub Release 三方均完整且一致时才幂等退出。若原子提交点已经更新但 tag 或 GitHub Release 缺失，任务只补齐缺失的发布记录。这样失败的发布能在重新运行或后续 `main` push 时恢复。

普通 Web 提交仍可独立部署。若提交包含版本变化，`web-deploy.yml` 先检查 COS 稳定版本；桌面版本尚未发布时跳过该次 Web 部署，待 `desktop-release.yml` 成功后通过 `workflow_call` 部署同一提交。产品指南因此不会提前展示不可下载的版本。

## 8. Windows 构建与签名

Electron Builder 继续生成 NSIS x64 安装包，文件名为：

```text
CosStage-Setup-${version}-x64.exe
```

发布任务必须提供 `CSC_LINK` 与 `CSC_KEY_PASSWORD`，并启用强制签名。构建后使用 PowerShell `Get-AuthenticodeSignature` 校验：

- 状态为 `Valid`。
- 签名主体与配置的发布者一致。
- PE 文件版本与 `package.json.version` 一致。

缺少证书或任何签名检查失败时，只允许 dry-run 产物验证，不允许写入 COS 稳定通道。`appId`、产品名、安装作用域、安装目录和用户数据目录保持稳定，保证覆盖安装继承现有项目数据。

## 9. 腾讯云 COS 对象布局

```text
downloads/
  latest.yml
  releases.json
  CosStage-Setup-x64.exe
  CosStage-Setup-1.1.0-x64.exe
  CosStage-Setup-1.1.0-x64.exe.blockmap
  CosStage-Setup-1.1.0-x64.exe.sha256
  release-notes-1.1.0.md
  metadata/1.1.0/latest.yml
```

- 版本化安装包、blockmap、SHA-256 和发布说明永久保留并使用长期不可变缓存。
- `metadata/<version>/latest.yml` 保存 Electron Builder 原始更新元数据，供审计和回滚复制。
- `CosStage-Setup-x64.exe` 是网页人工下载的稳定别名，使用短缓存。
- 根目录 `latest.yml` 是 Electron stable 通道的提交指针，禁止缓存或使用极短缓存。
- `releases.json` 是已成功发布版本索引，禁止缓存或使用极短缓存。

版本化制品保持在 `downloads/` 根目录，使 Builder 生成的相对 URL 无需改写。CI 不再自行重算或替换 `latest.yml.sha512`，只额外生成供人工核验的 SHA-256 文件。

## 10. 原子发布顺序

发布步骤严格执行：

1. 校验版本数据和 Git 状态。
2. 运行完整 `npm test`。
3. 构建并签名安装包。
4. 校验安装包版本、签名、Builder `latest.yml`、blockmap 和发布说明。
5. 上传版本化安装包、blockmap、SHA-256、发布说明和归档元数据。
6. 从 COS 读回文件并验证长度、SHA-256 和 Builder SHA-512。
7. 若远端同名制品已存在，仅在哈希完全一致时视为幂等成功；内容不同则失败。
8. 更新网页稳定下载别名。
9. 更新只包含成功制品的 `releases.json`。
10. 最后上传根目录 `latest.yml`，这是客户端可见的原子提交点。
11. 定向刷新 `latest.yml`、`releases.json`、稳定别名和 Web `index.html`，不全量清 CDN。
12. 从公网地址再次验证版本、长度、签名下载和更新清单。
13. 创建 `vX.Y.Z` tag 和 GitHub Release；任一记录创建失败时允许对同一哈希制品幂等重试并只补齐缺失记录。
14. 通过可复用 Web 工作流部署包含新版本产品指南的 Web 构建。

任一步骤在第 10 步之前失败，旧 `latest.yml` 保持不变。第 10 步之后失败，重试任务必须识别并复用哈希一致的远端制品，补齐 tag、GitHub Release 或 Web 部署。

## 11. Electron 更新架构

### 11.1 契约

更新状态从渲染层重复定义迁移为共享契约，包含：

- `status`: `idle | checking | available | not-available | downloading | downloaded | error`
- `currentVersion` 与 `availableVersion`
- `updateKind`: `major | minor | patch`
- `releaseNotes`
- 下载进度与可恢复错误

主进程使用 `app.getVersion()` 作为应用版本，不能再把 `process.versions.electron` 暴露为产品版本。主进程比较当前版本和 `UpdateInfo.version`，计算更新级别并把规范化状态通过 preload 暴露给渲染层。

### 11.2 检查、下载与安装

- 启动后延迟检查更新；断网不影响编辑器启动。
- `autoDownload = false`，所有版本都由用户触发下载。
- Patch/Minor 使用非阻塞通知，提供查看说明和下载按钮。
- Major 使用专用模态框，必须显示重大变化、兼容性和迁移步骤；用户明确确认后才下载。
- 下载完成后，安装按钮先进入统一项目保存保护。存在未保存修改时允许保存或取消；取消后不得退出应用。
- 保存完成后调用 `quitAndInstall` 覆盖安装并重启。
- 下载或校验失败时删除损坏缓存，允许重试并提供固定人工下载链接。

用户暂缓 Major 更新时记录忽略版本。相同版本不重复强提示；用户主动检查更新或出现更高版本时再次提示。Major 更新不强制安装。

### 11.3 更新后提示

首次运行时比较 `app.getVersion()` 与本地 `lastSeenVersion`。版本提高后打开“本次更新”内容；用户确认后写入新值。失败或降级不覆盖更高的已见版本记录。

## 12. 产品指南

`components/ProductGuide.tsx` 增加“版本更新”页签：

- 显示桌面端当前应用版本或 Web 稳定版本。
- 按版本倒序展示日期、Major/Minor/Patch 标签、摘要和变更列表。
- Major 版本突出兼容性和迁移说明。
- 当前版本使用明显标识，历史版本默认折叠。
- 人工下载链接继续使用稳定别名，但旁边显示实际稳定版本。

桌面端读取随应用打包的 `data/release-history.json`，并过滤掉高于 `app.getVersion()` 的记录。Web 端以 COS `releases.json` 为已发布状态来源；网络失败时显示明确的版本信息加载失败状态，不把 Release PR 中尚未成功发布的记录冒充为稳定版本。

## 13. 回滚与恢复

`desktop-rollback.yml` 接受一个已发布版本号并执行：

1. 验证 `metadata/<version>/latest.yml`、版本化安装包、blockmap 和校验文件均存在。
2. 读回并验证哈希。
3. 将该版本安装包复制为稳定下载别名。
4. 更新 `releases.json.stableVersion`。
5. 最后把归档元数据复制为根目录 `latest.yml`。
6. 刷新三个指针对象并执行公网验证。

回滚只影响尚未更新的客户端和网页稳定下载，不尝试让已安装高版本自动降级。如果某版本已进入用户机器，恢复方式是发布更高的 Patch 版本。

## 14. `1.0.0` 迁移

由于 `1.0.0` 的 preload 和更新元数据均不可靠，第一阶段不能依赖应用内提示：

- Web 端下载入口和产品指南展示“需要手工覆盖安装 1.1.0”的修复说明。
- 稳定别名指向签名后的 `1.1.0` 安装包。
- NSIS 使用相同 `appId` 和安装目录进行覆盖，不删除用户项目或设置。
- `1.1.0` 首次启动显示迁移成功和更新机制说明。
- 只有 `1.1.0` 及更高版本进入自动更新支持范围。

## 15. 安全与权限

- COS 凭据、签名证书和密码只存放在 GitHub Production Environment Secrets。
- PR CI 不接触生产 secrets。
- Release PR 合并权限和 Production Environment 批准权限分离。
- 发布脚本不输出证书内容、密码或完整云密钥。
- 上传路径由校验后的 SemVer 和固定模板生成，禁止任意用户输入路径。
- 版本化对象发现不同内容时立即停止，禁止静默覆盖供应链制品。

后续可以把长期 COS 密钥迁移为 GitHub OIDC 临时凭据，但不作为首期完成条件。

## 16. 测试与可观测性

### 16.1 自动测试

- Changeset 门禁：有记录、`release:none`、二者冲突、Major 缺迁移说明。
- 版本计算：Patch、Minor、Major 聚合和版本排序。
- 发布历史 schema、唯一性、倒序和版本一致性。
- 更新级别比较和主进程状态转换。
- 产品指南当前版本过滤和 Major 内容展示。
- 更新通知的下载、失败、重试、暂缓和完成状态。
- 安装前项目保存成功、失败和取消分支。
- 发布脚本 dry-run、远端同哈希重试和不同哈希拒绝。
- 桌面打包回归：preload、更新 IPC、`app.getVersion()` 和安装包命名。

### 16.2 发布验证

- 每次发布保存构建摘要：版本、commit、安装包大小、SHA-256、签名主体和 COS URL。
- 上传后从公网重新下载小范围元数据，并对安装包执行 HEAD、长度和抽样/完整哈希校验。
- 工作流 summary 提供稳定下载、版本化安装包、更新元数据和 GitHub Release 链接。
- dry-run 完成所有本地构建与一致性验证，但不读取生产 secrets、不上传、不打 tag。

## 17. 完成标准

- 任一用户可见 PR 缺少 Changeset 时 CI 失败，内部 PR 有明确 `release:none` 记录。
- Release PR 能从多个变更生成唯一下一版本及中文 changelog。
- `package.json`、锁文件、安装包、运行时版本、版本历史、Builder `latest.yml` 和 tag 完全一致。
- 产品指南同时支持桌面当前版本和 Web 已发布版本历史。
- Patch/Minor 可在应用内下载并覆盖安装；Major 必须确认并展示迁移说明。
- 未保存项目能够阻止退出安装。
- 无签名、坏哈希或远端同名不同内容都不能推进稳定指针。
- 任一步骤失败不会暴露半成品版本，重跑可以安全补齐发布。
- 人工回滚能切换稳定指针，且不会删除历史制品。
- `1.0.0` 用户有明确的一次性人工覆盖迁移路径。

## 18. 实施边界

该设计作为一个版本治理项目实施，但应拆成小批次提交：版本元数据与 Changesets、产品指南、Electron 更新契约与 UX、CI/COS 原子发布、签名与迁移验证。每一批都必须保持现有 Web 与桌面构建可运行；生产发布工作流只有在签名证书和 COS 环境门禁配置完成后才启用。
