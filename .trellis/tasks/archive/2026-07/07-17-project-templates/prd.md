# 项目模板与导入导出整合

## Goal

为桌面端新建项目增加可扩展的项目模板选择能力，将现有 ChinaJoy 项目制作成按需下载的预设模板；同时简化项目浏览器中的导入导出入口，移除旧 JSON 导入协议。

## Requirements

- 新建项目表单允许选择“空白项目”或预设项目模板。
- 首个预设模板使用 `C:\Users\Subway\.choreo\projects\chinajoy-1784282193529-hfkfit` 的完整项目数据和资源。
- 模板以标准 CosStage 项目 ZIP 存放在 `public/templates/`，由现有 Web 发布流程同步到 COS，并通过 `https://beat.cosdrama.cn/templates/` 按需下载。
- 桌面端主进程维护可信模板清单和下载逻辑；渲染进程只传模板 ID，不获得任意文件读写或任意 URL 下载能力。
- 模板包使用版本化文件名并缓存在 Electron `userData` 下；已有缓存可重复使用，下载失败不创建半成品项目。
- 从模板创建时复用现有安全 ZIP 导入、解压大小限制和项目数据规范化，并用用户输入的项目名称覆盖模板原名。
- 项目浏览器只显示“导入”和“导出”两个主按钮；点击后显示“项目压缩包”和“编排 JSON”选项。
- 删除“导入旧 JSON”的 UI、IPC、preload API、Hook 和项目服务入口。
- 保留 Web 端现有教学 JSON 模板与 JSON 文件导入导出回退行为。

## Acceptance Criteria

- [x] 桌面端新建项目可选择 ChinaJoy 模板并创建一个独立的可编辑项目。
- [x] 首次选择模板时从 COS/CDN 拉取 ZIP，后续可使用完整缓存；不选择模板时仍创建空白项目。
- [x] ChinaJoy 模板中实际存在的 4 个贴图资源随项目创建并能由现有资源协议加载；源项目缺失的 LED 视频保持现有缺失资源警告，不伪造内容。
- [x] 新建项目名称为空时不能提交，创建期间控件禁用且不会重复创建。
- [x] 项目浏览器仅有“导入”“导出”主入口，分别弹出压缩包/JSON 选择。
- [x] 代码中不再暴露或调用 `project:importLegacy` / `importLegacyProject`。
- [x] 项目服务测试覆盖模板名称覆盖与资源包导入；桌面回归测试覆盖新 UI 和 IPC 契约。
- [x] Electron 构建、前端构建、项目服务测试和桌面回归测试通过。
- [x] Web 构建产物包含版本化模板 ZIP，部署验证会检查公网模板对象。

## Definition of Done

- 相关单元/回归测试已更新并通过。
- TypeScript/Electron/Vite 构建通过。
- 模板 ZIP 已纳入 Web/COS 发布产物，发布后可由公网 URL 获取。
- 失败、取消、重复点击和缓存损坏路径有明确且可恢复的行为。

## Technical Approach

在 `project-contract.ts` 定义跨 IPC 的模板摘要类型；主进程用固定模板注册表返回清单，并通过版本化 CDN URL 下载到临时文件、校验为可导入项目包后原子替换缓存。`importProjectPackage` 增加可选名称覆盖参数，模板安装和普通 ZIP 导入共享同一安全边界。React 项目浏览器在新建表单中渲染模板选择，并用一个轻量弹出菜单合并导入/导出入口。

## Decision (ADR-lite)

**Context**: 模板包含约 3.9 MB 媒体资源，不应内嵌在应用 JS，也不应允许渲染进程提供任意下载 URL。

**Decision**: 使用代码内可信模板注册表 + 版本化静态 ZIP + Electron 主进程按需下载缓存；ZIP 通过现有 `public/ -> dist/ -> COS` 发布链路上传。

**Consequences**: 新增模板只需增加版本化包和注册表条目；模板内容更新必须更换文件名/版本以避免旧缓存。代码合并本身准备 COS 对象，真实上传在现有生产 Web 发布工作流执行。

## Out of Scope

- 本次不提供用户把任意现有项目发布到公共模板市场的能力。
- 本次不新增模板账号、权限、远程管理后台或动态服务端模板目录。
- 不改变项目 ZIP 与编排 JSON 的数据格式。

## Technical Notes

- 现有项目包导入已限制 500 个条目和 512 MiB 解压体积，并阻止路径穿越。
- `web-deploy.yml` 会递归同步 `dist/` 到 COS；Vite 会原样复制 `public/`。
- 源项目当前包含 `project.json` 和 4 个贴图资源文件，总大小约 3.94 MB；其 `project.json` 引用了一个本地已不存在的 LED MP4，模板忠实保留该引用并由既有加载器给出缺失资源警告。
- 影响层：React UI、App/Hook 状态、preload IPC、Electron 主进程、文件系统、CDN/COS。
- 验证：`npm test` 全量通过（2026-07-17）。
