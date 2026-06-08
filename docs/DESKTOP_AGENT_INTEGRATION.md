# 桌面端多智能体集成

## 架构

桌面端采用三进程结构：

1. Electron 主进程负责窗口、项目文件和本地 Agent 服务生命周期。
2. React 渲染进程负责编辑器与人机审批界面。
3. Python Agent 进程运行 FastAPI、LangGraph、模型适配器和 SQLite 检查点。

React 不直接启动 Python，也不接触文件系统。Electron 启动 Agent 后端后，通过
preload 暴露受控的运行时 URL、会话令牌、重启和日志入口。业务请求继续使用 HTTP，
因此 Web 端和桌面端可以复用同一套 `choreoAgentService`。

## 多智能体如何合入

多智能体编排保留在 `backend/app/agent`：

- 文本编排图负责意图识别、上下文构建、方案生成和结果校验。
- 多模态编排图负责音频分析、草图分析、设计汇总、方案细化和人工审批。
- LangGraph checkpoint 保存可恢复会话，React 轮询会话并渲染每个节点的进度。
- Electron 只管理 Agent 服务，不把编排逻辑搬入主进程或渲染进程。

后续新增灯光、服装、镜头等 Agent 节点时，不需要修改桌面进程协议；只需扩展后端图
状态、API 响应类型和对应的 React 展示。

## 开发运行

```powershell
npm run dev:electron
```

Electron 会自动读取仓库根目录 `.env`，选择空闲回环端口并启动 Uvicorn。渲染进程
通过 IPC 获取实际地址，不依赖固定的 `8000` 端口。

## 构建 Windows 安装包

首次构建先安装 Python 构建依赖：

```powershell
python -m pip install -r backend/requirements-desktop.txt
```

然后运行：

```powershell
npm run build:electron
```

构建链会依次：

1. 用 PyInstaller 生成 `build/agent-backend/choreomaster-agent`。
2. 编译 Electron 主进程和 React 前端。
3. 将 Agent 后端与 FFmpeg 放入 Electron `resources`。
4. 在 `release` 目录生成 Windows x64 NSIS 安装包。

## 运行时配置

首次启动安装版时会创建：

```text
%APPDATA%\choreomaster-desktop\agent.env
```

默认文本编排使用本地规则模式。启用 Gemini 多模态 Agent 时，在该文件填写
`GEMINI_API_KEY` 后重启应用或调用 Agent 重启接口。运行日志位于：

```text
%APPDATA%\choreomaster-desktop\logs\agent-backend.log
```

主进程每次启动生成随机本地访问令牌，仅绑定 `127.0.0.1`，并在桌面程序退出时回收
Agent 子进程。模型 API Key 不进入前端构建产物。
