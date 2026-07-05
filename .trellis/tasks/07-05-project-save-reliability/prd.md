# Project Save Reliability

## Goal

修复桌面端保存项目时演员列表被清空的问题，并为手动保存、快捷键保存和定时自动保存提供一致、可观察且不会互相竞争的保存体验。

## Requirements

- 保存成功后不得用磁盘回读结果覆盖当前编辑中的演员、队形或其他 React 状态。
- 所有保存入口共享同一条保存管线，并串行化并发请求。
- `Ctrl+S` 与 `Cmd+S` 均可保存当前项目；存在项目但没有改动时也应给出明确的“已保存”反馈。
- 每五分钟检查一次；仅当当前项目存在未保存改动时执行自动保存。
- 设置页“保存项目”按钮点击后应显示保存中状态，成功后显示“已保存”。
- 设置页在保存按钮下方显示上次成功保存时间。
- 快捷键保存与自动保存成功时显示两秒“保存成功”提示；按钮保存也应给出明确成功反馈。
- 保存失败时保留当前编辑状态和未保存标记，并继续显示可理解的错误信息。
- 项目文件使用临时文件写入并原子替换，避免中途失败破坏已有 `project.json`。

## Acceptance Criteria

- [ ] 保存包含演员和队形的项目后，演员列表及当前队形均保持不变。
- [ ] 磁盘回读结果异常或为空时，不会清空 renderer 中已有演员。
- [ ] 连续触发按钮、快捷键与自动保存时，磁盘写入不会并发交错。
- [ ] `Ctrl/Cmd+S` 会阻止浏览器默认行为并调用最新项目状态的保存逻辑。
- [ ] 自动保存间隔为五分钟，且无改动时不写盘。
- [ ] 保存成功提示在约两秒后自动消失。
- [ ] 设置页显示保存中、已保存和上次保存时间。
- [ ] 写入失败时原项目文件仍可正常读取。
- [ ] 项目服务测试、桌面回归测试、TypeScript 检查和生产构建通过。

## Definition of Done

- 回归测试先失败、实现后通过。
- Electron 项目服务与 renderer 保存行为均有自动化覆盖。
- `npm run build:main`、相关 Node 测试与 `npm run build` 通过。
- 保存语义或相关项目规范已更新（如有可复用知识）。

## Technical Approach

将 renderer 当前状态视为编辑期间的唯一事实来源。保存管线在调用 IPC 前捕获一份完整快照，主进程持久化并返回成功结果，但 renderer 不再把回读文档写回编辑状态。通过 ref 保持快捷键和定时器始终调用最新保存函数，并用进行中的 Promise 合并或排队重复保存。主进程使用同目录临时文件写入后重命名替换正式文件。

## Decision (ADR-lite)

**Context**: 现有保存函数在 IPC 返回后调用 `setPerformers(saved.data.performers)` 等 setter，把持久化层的规范化结果反向覆盖编辑状态；快捷键 effect 也未依赖最新保存回调。项目文件则直接覆盖写入。

**Decision**: 采用单向保存快照、串行保存协调器和原子文件替换，不采用“保存后重新加载整个项目”的模式。

**Consequences**: 保存不会再意外改变 UI；并发入口行为一致；磁盘失败更安全。资源 URL 的更新仍由显式加载项目负责，保存本身不承担重新水合编辑状态。

## Out of Scope

- 云同步、跨设备同步或版本历史。
- 用户可配置的自动保存间隔。
- 恢复多个历史自动保存快照。
- 重构整个 `App.tsx` 状态架构。

## Technical Notes

- Renderer: `App.tsx`, `components/Sidebar.tsx`
- IPC: `electron/ipc-handlers.ts`, `electron/preload.ts`
- Persistence: `electron/project-service.ts`
- Tests: `tests/project-service.test.mjs`, `tests/desktop-regressions.test.mjs`
- 当前工作区存在与本任务无关的 Electron 生成文件和演员备注文档改动，必须保留且不得混入本任务提交。
