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
