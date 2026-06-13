# Agent 服务集成

## 架构边界

CosStage 的桌面端和 Web 端都把 Agent 视为独立 HTTP 服务：

1. Electron 只负责窗口、项目文件和本地资源协议。
2. React 编辑器通过 `services/choreoAgentService.ts` 调用 Agent API。
3. Python/FastAPI 后端独立部署，负责 LangGraph、模型调用、会话检查点和多模态处理。

Electron 不再启动 Python 子进程，也不再包含 Agent 可执行文件、Python 依赖或 FFmpeg。这样桌面安装包和 Agent 服务可以独立发布与扩缩容。

## 客户端配置

桌面端和 Web 端使用相同配置：

```dotenv
VITE_AI_BACKEND_URL=https://agent.example.com
VITE_MEMBER_TOKEN=
```

用户也可以在应用的 Agent 设置中填写服务地址和访问 Key。设置保存在当前客户端的 `localStorage`，不会写入项目包。

生产环境建议：

- Agent 服务必须使用 HTTPS。
- 通过 `AGENT_ACCESS_KEYS` 发放和轮换访问 Key。
- 设置 `ALLOW_DEV_MEMBER_TOKEN=false`。
- 在网关或服务端配置允许桌面端和 Web 端来源访问的 CORS 策略。

## 后端运行

本地开发：

```powershell
npm run dev:backend
```

或者直接运行 FastAPI：

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`npm start` 仍可用于本地同时启动 Web 前端和后端，但这只是开发编排，不代表后端会进入 Electron 安装包。

## Electron 构建

```powershell
npm run build:electron
```

构建链只包含：

1. Electron 主进程和 preload。
2. React/Vite 前端。
3. Electron Builder 安装包。

Windows 产物位于 `release/`，解包目录位于 `release/win-unpacked/`。其中不应出现 `resources/agent-backend` 或 `resources/ffmpeg`。

## 服务接口

主要接口：

- `GET /health`
- `POST /api/auth/validate`
- `POST /api/ai/choreo-plan`
- `POST /api/choreo/sessions`
- `POST /api/choreo/sessions/{id}/run`
- `POST /api/choreo/sessions/{id}/resume`
- `GET /api/choreo/sessions/{id}`

除健康检查外，业务接口使用 `Authorization: Bearer <member-token>`。
