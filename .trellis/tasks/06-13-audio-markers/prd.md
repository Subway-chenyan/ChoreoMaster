# 音频时间轴标记

## Goal

为 ChoreoMaster 增加可编辑的音频段落标记，让用户在时间轴上标注主歌、副歌、间奏等音乐结构，并随项目 JSON 一同保存和恢复。

## Requirements

- 在当前播放头位置新增音频标记。
- 标记包含唯一 ID、名称、时间（毫秒）和颜色。
- 时间轴显示旗帜、名称与垂直定位线。
- 点击标记跳转到对应时间。
- 支持重命名、调整时间、改色和删除。
- 桌面项目保存、自动保存、项目切换及项目包导入导出均保留标记。
- 网页端 JSON 导入导出保留标记。
- 旧项目未包含标记字段时兼容为空数组。
- 无音频时仍允许添加标记，便于先规划结构。

## Acceptance Criteria

- [x] 用户可在播放头位置创建标记，默认名称清晰且时间正确。
- [x] 标记在时间轴中可见，点击后播放头跳转。
- [x] 用户可编辑名称、时间、颜色并删除标记。
- [x] 标记按时间排序，时间不会小于 0 或超过当前时间轴长度。
- [x] `project.json` 和手动导出的 JSON 包含 `audioMarkers`。
- [x] 保存后重新打开项目，标记内容完整恢复。
- [x] 缺少或包含无效 `audioMarkers` 的旧 JSON 可安全加载。
- [x] 类型检查、构建和相关测试通过。

## Definition of Done

- 前端交互、项目数据模型和桌面持久化完整接通。
- 增补项目服务测试和桌面回归测试。
- 通过项目质量检查。

## Technical Approach

- 在共享 `electron/project-contract.ts` 定义 `AudioMarker`，并在 `ProjectDocument` 增加可选 `audioMarkers`。
- `electron/project-service.ts` 负责在文件边界校验和规范化标记。
- `App.tsx` 持有标记状态，并纳入所有保存、加载、脏状态比较及 JSON 导入导出路径。
- `Timeline.tsx` 提供标记创建按钮、时间轴渲染和编辑浮层。
- 时间统一使用毫秒，与现有帧和播放头保持一致。

## Decision (ADR-lite)

**Context**: 标记需要同时服务桌面项目和网页 JSON，且项目已有统一的 `ProjectDocument` 保存链路。

**Decision**: 将标记直接作为 `ProjectDocument.audioMarkers` 保存，而不是建立独立文件或 IPC 接口。

**Consequences**: 数据链路简单、项目可移植性好；项目 JSON 会增加少量结构化数据，旧项目通过默认空数组兼容。

## Out of Scope

- 自动分析 BPM 或自动生成段落。
- 区间型标记、节拍网格与吸附。
- 标记单独导出为第三方 DAW 格式。

## Technical Notes

- 主要文件：`electron/project-contract.ts`、`electron/project-service.ts`、`App.tsx`、`components/Timeline.tsx`。
- 当前工作区存在用户或其他任务的未提交修改，本任务不得回退或混入无关文件。
