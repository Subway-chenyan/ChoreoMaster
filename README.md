# CosStage

CosStage 是面向舞台表演的桌面队形编排工具，提供时间轴、2D/3D 舞台预览、演员与道具编排、项目管理以及视频导出。前端使用 React + Vite，后端使用 FastAPI，桌面端由 Electron 封装。

## 环境要求

- Node.js 22（CI 使用的版本）与 npm
- Python 3.11+
- FFmpeg（多模态 Agent 的音频切片需要）
- Windows 桌面打包建议在 Windows 环境执行

首次启动前复制 `.env.example` 为 `.env`。只体验基础编排时可保留 `LLM_PROVIDER=rule`，无需配置模型 API Key。

## 快速开始

```powershell
npm install
npm start
```

`npm start` 会同时启动 Vite 前端和 FastAPI 后端。仅开发桌面壳时可使用 `npm run dev:electron`。

## 常用命令

| 任务 | 命令 |
| --- | --- |
| 完整开发环境 | `npm start` |
| 首次安装依赖并启动 | `npm run start:setup` |
| 仅启动前端 | `npm run dev` |
| 仅启动后端 | `npm run dev:backend` |
| Electron 联调 | `npm run dev:electron` |
| 前端生产构建 | `npm run build` |
| Windows 桌面构建 | `npm run build:electron:win` |
| 类型检查 | `npm run typecheck` |
| 后端测试 | `npm run test:backend` |
| 项目服务测试 | `npm run test:project` |
| 桌面回归测试 | `npm run test:desktop` |
| 发布流程测试 | `npm run test:release` |
| 完整质量门禁 | `npm test` |

`test:project` 依赖 Electron 主进程编译结果；命令本身会先执行 `build:main`。完整 `npm test` 会按正确顺序执行类型检查、发布测试、后端/项目/桌面测试与 Vite 构建。

## 目录概览

- `App.tsx`、`components/`、`3d_components/`：编辑器与舞台界面
- `electron/`：Electron 主进程、preload、IPC 与本地项目服务
- `backend/`：FastAPI 与编排 Agent
- `scripts/release/`：版本、制品验证和 COS 发布脚本
- `.github/workflows/`：质量、Release PR、桌面发布、回滚与 Web 部署

桌面版本、签名、发布、失败补偿和回滚流程见 [发布手册](docs/releasing.md)。
