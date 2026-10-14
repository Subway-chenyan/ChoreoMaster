# Journal - codex (Part 1)

> AI development session journal
> Started: 2026-06-13

---



## Session 1: 完善过渡路径与道具旋转

**Date**: 2026-06-25
**Task**: 完善过渡路径与道具旋转
**Branch**: `codex/fix-transition-review`

### Summary

完成多对象过渡轨迹展示、贝塞尔路径编辑、每帧目标角度、普通道具旋转轴点与轴点切换自动换算，并通过构建、项目测试及浏览器端验证。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a81c614` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: 跨项目复制演员与队形

**Date**: 2026-07-06
**Task**: 跨项目复制演员与队形
**Branch**: `codex/project-save-reliability`

### Summary

实现跨项目复制选中演员和完整队形，保留坐标、旋转、分组、隐藏对象与便携贴图，并补充回归测试和前端状态契约。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `30ec30f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: 项目模板与导入导出整合

**Date**: 2026-07-17
**Task**: 项目模板与导入导出整合
**Branch**: `main`

### Summary

新增 ChinaJoy 可信按需下载模板与缓存校验，合并导入导出入口，移除旧 JSON 导入，并补齐 COS 发布验证、文档和全量测试。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c138239` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: 修复长视频导出稳定性与性能

**Date**: 2026-07-21
**Task**: 修复长视频导出稳定性与性能
**Branch**: `main`

### Summary

桌面长视频改为流式写盘，导出进度更新节流至每秒约四次，并用 28 分钟项目验证 WebCodecs 吞吐。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `b3b9867` | (see git log) |
| `13e2dcb` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: 演员与道具批量删除和全队形显示

**Date**: 2026-07-21
**Task**: 演员与道具批量删除和全队形显示
**Branch**: `main`

### Summary

为演员、道具和分组增加全队形显示；统一删除确认并支持多选批量删除；删除操作接入 Ctrl/Cmd+Z 撤销和重做；补充单元测试、桌面回归测试和前端规范。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `3d1868a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: 演员道具与分组全局锁定

**Date**: 2026-07-21
**Task**: 演员道具与分组全局锁定
**Branch**: `main`

### Summary

为演员、道具和分组增加跨队形持久锁定；侧栏提供锁定、右键解除和双击锁图标解除；统一保护 2D、3D、过渡路径、队形显隐、分组和删除等编辑入口，并补充单元测试、桌面回归测试和前端规范。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f6dd029` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: Android mobile editor and desktop project interchange

**Date**: 2026-10-12
**Task**: Android mobile editor and desktop project interchange
**Branch**: `main`

### Summary

Implemented offline mobile project library, touch stage gestures, formation/actor/music editing, shared desktop package parser, atomic autosave and portable ZIP round trips. Added Capacitor Android project and APK CI. Full npm test passed (release 102 plus 2 skipped, backend 22, project 27, desktop 149, mobile 6); 4 Playwright scenarios passed; Android sync passed. APK build blocked by missing JDK/SDK; no Android device or remote build verified. See docs/mobile/VALIDATION.md.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `12f5362` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: 手机横屏工作台与精确触控优化

**Date**: 2026-10-13
**Task**: 手机横屏工作台与精确触控优化
**Branch**: `main`

### Summary

实现横屏左工具栏、可收起队形栏、右侧属性抽屉和选择快捷操作；新增按米微调与整组边界约束，修复轻点或抖动触发网格吸附。类型检查、7 项移动核心、149 项桌面回归、8 项浏览器交互、生产构建及 Android 资源同步通过。已更新截图和文档；APK 与真机行为未验证。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `427d85a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: 团员只读排练模式

**Date**: 2026-10-13
**Task**: 团员只读排练模式
**Branch**: `main`

### Summary

新增独立团员排练导入与只读查看器，仅过滤解压并保存 JSON 引用音乐，保留完整 JSON；大舞台、右侧队形跳转、上下切换、进度和同步音乐、队形备注及离线重开。修复过期播放 Promise 干扰新播放。类型检查、移动核心 8 项、浏览器全套 10 项及最终排练专项 3 项通过（共 11 个场景），生产构建和 Android 同步通过。截图和契约文档已更新；APK/真机尚未验证。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ed227ab` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: Android 发布实现与本地验证，待远端签名配置

**Date**: 2026-10-14
**Task**: Android 发布实现与本地验证，待远端签名配置
**Branch**: `main`

### Summary

接入 Android preview/stable reusable build、固定签名验证、COS 不可变发布和网页/Windows 下载入口。发布回归 110 通过/2 跳过，桌面 150 通过，下载 UI 2 通过，类型检查、构建、actionlint 通过。签名私钥在仓库外；GitHub Secrets 写权限仍返回 403。未推送、未触发真实 APK 构建或生产上传，任务保持进行中等待远端启用。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7b78a3f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: Android 1.4.0 正式发布与远端真实链路验证

**Date**: 2026-10-14
**Task**: Android CI、COS 发布与下载入口（10-13-android-release）
**Branch**: `main`

### Summary

合并版本 PR #21 触发首次正式发布，stable 构建在 restore 步骤暴露真实链路缺陷：CDN 对缺失对象回退返回 200 的 SPA 首页而非 404，restore-release.mjs 解析崩溃（本地 mock 全为标准 404 语义，未覆盖）。修复为 SPA 回退/损坏 manifest 视为未发布、由 publish 不可变预检兜底，新增 3 项回归测试；以 revert + 重做版本提交保持 1.4.0 重新触发（无 force-push）。Desktop Release 全绿：固定签名 APK 构建验证、COS 不可变发布、tag v1.4.0、GitHub Release、网页部署全部成功。线上逐项验证指针、sha256、签名块、别名 APK、releases.json、Windows 指针与网页下载入口。

### Git Commits

| Hash | Message |
|------|---------|
| `cd87feb` | chore: version packages (#21)（合并触发发布） |
| `e9fdc4a` | fix(android): treat CDN SPA fallback as unpublished when restoring releases |
| `5d056e2` | Revert "chore: version packages (#21)" |
| `681bdcc` | chore: version packages（发布提交，tag v1.4.0） |

### Testing

- [OK] 发布回归 115 通过、2 跳过（含新增 restore 回退 3 项）
- [OK] Desktop Release 远端全绿（8m56s）：stable APK 签名验证、COS 发布、GitHub Release、deploy-web
- [OK] 实站验证：latest.json 指针、APK sha256 三方一致、apksigner v2/v3 签名块、网页下载入口 Playwright 指向 v1.4.0

### Status

[OK] **服务端链路全部完成**

### Next Steps

- 真机安装与升级验证（与 preview 包共存）由用户完成


## Session 12: 移动端排练显示优化与演员视角

**Date**: 2026-10-14
**Task**: 移动端排练显示优化（10-14-mobile-rehearsal-display）
**Branch**: `main`

### Summary

团员排练只读视图新增显示设置（人物缩放 50–200%、名字字体缩放 60–200%、名字显隐开关，localStorage 持久化）与演员视角/导演视角切换（默认演员视角，参考 2D 导出排练视角的 180° 点镜像，Stage 新增 flippedView，rotate 追加在 pan/zoom 变换链尾、文字用原生 rotate 属性反向保持正向）。收起态改为舞台近全屏 + 右侧悬浮胶囊仅留展开/播放/上下切换，Android 返回键收起态先展开；展开布局紧凑化（顶栏 42px、备注上限 15%）。

### Git Commits

| Hash | Message |
|------|---------|
| (see git log) | feat(mobile): add rehearsal display settings and performer view |

### Testing

- [OK] mobile-core 11 通过（新增设置持久化/钳制/缩放/字号 3 项）；mobile-ui 14 通过（排练新增设置与视角持久化用例）
- [OK] 桌面回归 150 通过；typecheck、生产构建、Android 同步通过
- [OK] 视觉验收：旋转后文字全部正向、镜像正确、收起胶囊完整；缩小+隐藏名字有效缓解密集拥挤

### Status

[OK] **Completed**（待真机验证 APK 表现）

### Next Steps

- 真机确认演员视角、显示设置与收起态的触控体验


## Session 13: 1.5.0 发布替换手机下载入口

**Date**: 2026-10-14
**Task**: 移动端排练显示优化（10-14-mobile-rehearsal-display）
**Branch**: `main`

### Summary

为让网页/Windows 下载入口提供带新功能的手机包，走正式发布链路：新增 changeset（minor），合并版本 PR #22（1.4.0→1.5.0，GITHUB_TOKEN 创建的 PR 需 owner 批准 workflow 后检查通过），Desktop Release 全绿。stable 固定签名 APK（含演员视角/显示设置/收起布局）发布至 COS 不可变目录并更新 latest.json 指针与 CosStage-Android.apk 别名。实站验证：别名=版本化 APK=sidecar=指针 sha256 一致（c2a15130…），签名块在，Windows 安装包指针同步 1.5.0，网页入口显示"下载 Android · v1.5.0"并指向不可变地址，GitHub Release v1.5.0 四项资产齐全。

### Git Commits

| Hash | Message |
|------|---------|
| `ce7d8cd` | chore(changeset): rehearsal display settings and performer view |
| `d23e9c8` | chore: version packages (#22)（发布提交，tag v1.5.0） |

### Testing

- [OK] 发布回归 115/2 跳过；PR #22 检查 build/apk 4m43s、quality 1m30s 通过
- [OK] Desktop Release v1.5.0 全绿；线上 sha256 三方一致、网页入口实测 v1.5.0

### Status

[OK] **Completed**

### Next Steps

- 真机从下载入口安装 1.5.0 验证新功能与升级路径
