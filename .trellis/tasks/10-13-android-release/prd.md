# Android 发布和 CI

复用 GitHub Actions / Changesets / COS。手机相关 PR 和 main 提交构建隔离的 preview APK；main 提交上传按 commit/run 隔离的 COS 预览路径。正式版本发布构建固定签名 release APK，验证包名、版本、证书、SHA256，存 COS 不可变版本目录并更新正式下载指针。正式发布直接调用 reusable build，不能依赖 GITHUB_TOKEN 创建 tag 再触发另一个工作流。修复发布需携带 APK；普通网页和 Windows 产品界面提供正式下载入口，未发布时显示待发布。

首次签名由用户授权新建；密钥存仓库外，GitHub encrypted secrets 存配置。不把密钥提交或输出。版本名跟随 package.json；preview 包名与正式隔离。

验证：版本换算、发布脚本 mock COS 完整性/重试/拒绝覆盖、workflow 触发及 secret 隔离、下载入口、类型检查、现有 release 回归。远端触发与真实签名打包按可用权限验证，不将本地模拟称为线上成功。

## 实施与验证（2026-10-14）

- 已实现 reusable Android build、PR/main 预览、正式版本固定签名构建、COS 不可变对象与下载指针、GitHub Release 附件及修复流程。
- 已生成仓库外固定签名备份，仓库仅存公开指纹；提供 configure-signing.sh 写入四项 GitHub Secrets。
- 已实现网页/Windows 下载入口及固定 manifest IPC、外链白名单。
- 发布回归 110 通过、2 跳过；桌面回归 150 通过；下载界面 Playwright 2 通过；typecheck、production build、actionlint 与 shell 语法检查通过。
- 2026-10-14 用户在本机执行签名配置，已通过 gh secret list 确认四项 Android Secrets 存在；原写权限障碍已解除，内容由首次正式构建验证。聊天中收到的令牌未使用。
- 未推送、未触发工作流、未上传生产 APK；本机无 JDK/Android SDK，真实构建、安装与升级需远端和真机验证。保留任务待远端启用。

## 远端真实链路验证（2026-10-14 续）

- 合并版本 PR #21 触发 Desktop Release：stable 构建在 restore 步骤失败——beat.cosdrama.cn 是 SPA 静态站，对象缺失时回退返回 200 的 index.html 而非 404，restore-release.mjs 的 `.json()` 解析崩溃；本地 mock 均为标准 404 语义，未覆盖该回退。
- 修复：restore-release.mjs 重构为导出函数 + CLI 入口，SPA 回退或损坏 manifest 一律视为未发布，误判由 publish 的不可变预检兜底；新增 3 项回归测试。发布回归 115 通过、2 跳过。
- 通过 revert + 重做版本提交重新满足“发布必须发生在版本变更提交”的约束（HEAD 681bdcc，保持 1.4.0，未改写历史，未 force-push）。
- Desktop Release 全绿（detect/build-windows/build-android/publish/deploy-web）：固定签名 stable APK 构建并通过 verify-apk.sh，COS 不可变发布与 CDN 读回验证通过，tag v1.4.0 与 GitHub Release（含 APK、安装包及各自 sha256）创建成功。
- 线上验证：latest.json 指针返回 v1.4.0（versionCode 1004000、commit 681bdcc、正式包名）；CDN 下载 APK sha256 与指针/sidecar/GitHub 资产一致；别名 CosStage-Android.apk 字节一致；APK 含 apksigner v2/v3 签名块；releases.json 索引 currentVersion 1.4.0；Windows 安装包指针指向 v1.4.0；网页下载入口 Playwright 实站验证指向不可变 v1.4.0 地址，新前端包已部署。
- 剩余：真机安装与升级验证（含与 preview 包 com.cosstage.mobile.preview 共存）由用户在设备上完成。
