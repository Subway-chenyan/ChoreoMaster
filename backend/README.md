# CosStage AI Backend

Python + FastAPI + LangGraph backend for the intelligent formation module.

## Run locally

推荐在仓库根目录双击：

```text
start.bat
```

也可以在终端运行：

```bash
npm start
```

首次需要强制重装全部依赖时：

```bash
npm run start:setup
```

启动器会读取根目录 `.env`，检查 Node.js、Python、FFmpeg 和项目依赖，
然后同时启动：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8000`

若 `.env` 不存在，启动器会根据 `.env.example` 自动创建一份并提示填写。

也可以分别启动：

```bash
cd backend
python -m pip install -r requirements.txt
cd ..
npm run dev:backend
```

## LLM configuration

普通文本编队 Agent 由 `.env` 中的 `LLM_PROVIDER` 切换：

```dotenv
# 无外部模型，使用本地确定性规则
LLM_PROVIDER=rule

# DeepSeek
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=your-key
DEEPSEEK_MODEL=deepseek-chat

# 自定义模型网关
LLM_PROVIDER=gateway
CHOREO_AGENT_MODEL_URL=https://your-gateway.example.com/choreo-plan
CHOREO_AGENT_MODEL_TOKEN=your-token
```

音乐和草图多模态 Agent 当前由 Gemini 提供：

```dotenv
MULTIMODAL_LLM_PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_FLASH_MODEL=gemini-2.5-flash
GEMINI_PRO_MODEL=gemini-2.5-pro
```

API Key 仅保存在被 Git 忽略的 `.env` 中，不会注入前端构建产物。

## Agent access keys

前端用户只需要填写管理员发放的 Agent 访问 Key，不需要配置后端地址。
管理员在服务端 `.env` 中维护允许列表：

```dotenv
AGENT_ACCESS_KEYS=team-key-a,team-key-b
ALLOW_DEV_MEMBER_TOKEN=false
```

多个 Key 使用英文逗号分隔。生产环境应关闭 `dev-member-token`。用户点击
“打开编舞 Agent”时，前端会先调用 `/api/auth/validate` 校验 Key；缺失、
错误或过期时不会打开 Agent 弹窗。

## Test

```bash
npm run test:backend
```

## Optional model gateway

The LangGraph workflow can call your membership-backed model service before it
falls back to the deterministic rule engine. Configure it with:

```bash
set CHOREO_AGENT_MODEL_URL=https://your-gateway.example.com/choreo-plan
set CHOREO_AGENT_MODEL_TOKEN=your-service-token
```

The gateway should return either an `AIChoreoPlan` object directly or
`{"plan": AIChoreoPlan}`.

For direct DeepSeek testing, use environment variables instead of writing the
API key into the repository:

```bash
set CHOREO_AGENT_PROVIDER=deepseek
set DEEPSEEK_API_BASE=https://api.deepseek.com
set DEEPSEEK_API_KEY=your-key
set DEEPSEEK_MODEL=deepseek-v4-flash
npm run test:backend
```

## API

- `POST /api/ai/choreo-plan`
  - Production-facing endpoint for the Web and Electron clients.
  - Requires `Authorization: Bearer <member-token>`.
- `POST /api/agent/choreo/debug`
  - Agent debug endpoint.
  - Returns every LangGraph node step plus the final `AIChoreoPlan`.

The current implementation includes a deterministic rule-based fallback so the
API and tests can run even when the real model gateway is not configured.

## Gemini multimodal test session

Set the Gemini key only in the current shell, then run the independent session
test against local audio and sketch files:

```bash
set GEMINI_API_KEY=your-key
cd backend
python scripts/run_multimodal_session.py ^
  --audio "../public/your-music.mp3" ^
  --sketch "../public/test.jpg" ^
  --start-ms 0 ^
  --end-ms 30000
```

The test uses Gemini 2.5 Flash for audio/sketch analysis and refinement, Gemini
2.5 Pro for the design summary and final plan, and SQLite-backed LangGraph
checkpoints for the two human approval interrupts.

The production-facing multimodal UI uses multipart uploads and resumable
sessions:

- `POST /api/choreo/sessions`
- `POST /api/choreo/sessions/{id}/run`
- `POST /api/choreo/sessions/{id}/resume`
- `GET /api/choreo/sessions/{id}`

The frontend polls the session endpoint while the graph runs so each completed
node is reflected as visible progress. LangGraph interrupts are rendered as
structured actor/prop mapping and final approval forms.
