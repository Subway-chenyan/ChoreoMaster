# Android APK 发布

Android 与网页、Windows 沿用同一个 `package.json` / Changesets 版本。网页和 Windows 的顶部工具栏、产品指南显示 Android 正式下载入口；未发布时显示“安卓版待发布”，请求失败显示暂不可用，不提供预览包作为正式下载。

## 触发与依赖

| 事件 | 结果 | COS |
| --- | --- | --- |
| 手机相关 PR | Android preview 调用 reusable build，测试后产出 debug APK artifact | 不上传，无签名/COS Secrets |
| main 手机相关提交，或在 main 手动运行 Android preview | 同上 | 上传独立 commit / run / attempt 预览路径 |
| 合并 Changesets 版本 PR | Desktop Release 检测版本改变，并行构建 Windows 和固定签名 Android | 两端构建成功后先发布 Android，再继续既有 Windows/GitHub Release/网页发布 |
| 重试正式版本发布 | 从 COS 恢复相同版本、相同源提交的 APK，并再次检查哈希、证书与原生包信息 | 相同字节幂等；不同内容拒绝覆盖 |
| GitHub Release 附件丢失 | 既有 repair-release 从不可变 COS 对象修复 EXE/APK 及校验文件 | 不修改稳定指针；旧 Windows-only 标签保持兼容 |

手机路径包含 `mobile/**`、`components/mobile/**`、共享 Stage / utils / 类型 / 舞台配置、Android 工程、依赖、构建配置和移动测试。PR 不接触云端凭据；普通开发分支需创建 PR 才触发预览构建。

正式构建直接通过 `workflow_call` 调用，不依赖机器人创建 tag / Release 后再触发另一个 workflow。GitHub 对 `GITHUB_TOKEN` 产生的新事件存在防递归触发限制，参见 [GitHub 官方说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。

## 固定签名与首次配置

正式包 ID 为 `com.cosstage.mobile`，预览 debug 包 ID 为 `com.cosstage.mobile.preview`。正式发布使用固定 PKCS12 密钥和仓库中 `data/android-signing.json` 的 SHA-256 证书指纹；缺少签名、包名/版本不匹配、证书不一致、APK 可调试都会失败。

本次经授权首次生成的密钥备份位于当前开发机：

```text
/home/chenyan/.local/share/cosstage/android-signing/
  cosstage-release.p12
  store-password.txt
  release-certificate.pem
```

目录权限 700，密钥与口令权限 600；密钥不在仓库内。请将整个目录备份到安全位置，后续升级必须沿用这份密钥。不要提交、上传 artifact 或发送到聊天中。生成的新密钥指纹固定在 `data/android-signing.json`，更换密钥会破坏覆盖升级能力。[Android 官方签名说明](https://developer.android.com/studio/publish/app-signing)。

GitHub repository secrets：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`（本次为 `cosstage`）
- `ANDROID_KEY_PASSWORD`

在当前机器安装 GitHub CLI，并以具备此仓库 **Secrets: read and write** 权限的账号/令牌登录后，从仓库根目录执行：

```bash
gh auth login
bash scripts/android/configure-signing.sh
```

脚本会检查证书指纹并直接把密钥、口令通过 stdin 写入 Secrets，不打印内容。重复执行沿用同一密钥。2026-10-14 用户执行配置后，已通过 GitHub API 确认四项 Secrets 均存在；实际密钥内容由首次正式构建中的证书和 APK 校验验证。

COS 沿用已经存在的 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`，桶 `beat-1317738912`、广州区域和域名 `https://beat.cosdrama.cn/`。发布前要求 COS bucket versioning 为 Closed，与现有发布约束一致。

## 版本和对象

`versionName = package.json.version`，`versionCode = major × 1,000,000 + minor × 1,000 + patch`；minor/patch 最大 999，最终值不超过 Android 的 2,100,000,000。不使用 workflow run number 作为正式版本，避免重试改变升级序号。debug 的版本名附加 `-preview`。

```text
downloads/android/releases/<version>/CosStage-<version>.apk
downloads/android/releases/<version>/CosStage-<version>.apk.sha256
downloads/android/releases/<version>/manifest.json

downloads/android/preview/<commit>/<run-id>-<attempt>/CosStage-preview.apk
… /CosStage-preview.apk.sha256
… /manifest.json

downloads/android/latest.json          # 正式下载信息
downloads/CosStage-Android.apk          # 固定正式下载地址
```

manifest 包含 schemaVersion、channel、version、versionCode、applicationId、commit、name、path、url、sha256 和 size。不可变对象先预检、禁止覆盖上传并回读校验；公开 APK 校验成功后才写正式指针。正式指针拒绝降级或同版本不同内容。预览只写独立对象，不改变正式入口。

不可变 APK 缓存一年，`latest.json` 和固定 APK 地址为 no-cache；发布会刷新 CDN 并重新下载验证。GitHub Release 附带 APK 和 SHA256。网页实际使用经过验证的版本化 URL，避免稳定别名更新过程中下载到不同版本；Windows 通过固定 IPC 获取官方 manifest，避免 file:// 下的 CORS 问题，系统浏览器只允许打开官方 APK 下载链接。

COS 上传中断后优先选择 **Re-run failed jobs**，保留同一次构建 artifact。完整重跑会优先恢复已发布 manifest 对应 APK。如果仅 APK 上传成功而 manifest 未写入，完整重跑可能因新构建字节不同被拒绝；应恢复原 build artifact 重试发布，不能删除或覆盖已存在对象来绕过校验。

## 验证和边界

- `npm run test:release`：包含版本换算、工作流触发/凭据隔离、mock COS 上传、不可变冲突、重试、校验失败和降级保护。
- `npm run test:desktop`：包括下载 manifest 与链接白名单。
- `npm run test:mobile:ui -- tests/mobile-ui/android-download.spec.ts`：网页顶部和产品指南入口、未发布状态。
- `npm run typecheck` / `npm run build`。
- GitHub Ubuntu runner 安装 JDK 21 / SDK 36，运行移动核心和浏览器测试，Gradle 构建后使用 apksigner 和 aapt 检查真实 APK。

本次本机 Linux ARM64 没有 JDK/SDK，未执行真实 Gradle/APK 构建；签名 Secrets 已配置，代码尚未推送、未触发新工作流、未上传 APK 到生产 COS。本地 mock 发布通过不代表云端已发布。推送代码并合并版本 PR 后，首次正式工作流仍需确认 APK 下载、签名安装及覆盖升级。

预览 APK 使用 runner debug 签名，只适合测试，不保证不同构建之间覆盖升级。首次安装正式版后应保持固定签名。Windows 回滚流程不回滚 Android 下载指针；Android 需要修复并发布更高版本，不降低 versionCode。
