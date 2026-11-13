# CosStage MCP 服务指南

CosStage 桌面端内嵌了一个 MCP（Model Context Protocol）服务，允许外部 AI 服务（MCP 客户端）直接创建和修改编舞项目。桌面端渲染会**实时同步** MCP 的每次修改，且每次修改都**可回退**。

## 连接

MCP 服务随桌面端启动（Electron 主进程内），通过 Streamable HTTP 监听本机回环地址：

```
http://127.0.0.1:8765/mcp
```

- 仅绑定 `127.0.0.1`，不对外网暴露；桌面端必须处于运行状态。
- 端口与开关可在 `~/.choreo/settings.json` 的 `mcp` 字段配置：

```json
{
  "mcp": {
    "enabled": true,
    "port": 8765,
    "token": "可选的 Bearer Token"
  }
}
```

设置 `token` 后，客户端请求需携带 `Authorization: Bearer <token>`。

### 各客户端配置示例

**Cursor**（`.cursor/mcp.json` 或全局配置）：

```json
{
  "mcpServers": {
    "cosstage": {
      "url": "http://127.0.0.1:8765/mcp"
    }
  }
}
```

**Claude Desktop / Claude Code**（支持远程 MCP 的版本，通过 mcp-remote 桥接）：

```json
{
  "mcpServers": {
    "cosstage": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:8765/mcp"]
    }
  }
}
```

**通用 HTTP MCP 客户端**：直接对上述 URL 发起 MCP Streamable HTTP `POST` 请求（协议版本 2025-03-26 及以上；stateless 模式，仅支持 POST，无服务端 GET SSE 流）。

### 本地调试

```bash
npx @modelcontextprotocol/inspector
# 在 Inspector 界面选择 Streamable HTTP，填入 http://127.0.0.1:8765/mcp
```

## 工具清单

| 工具 | 功能 |
|---|---|
| `choreo_get_schema` | 获取数据结构说明（坐标系、ProjectDocument、AIChoreoPlan 格式、常用队形速查）——**编排前必读** |
| `choreo_list_projects` | 列出本地全部项目 |
| `choreo_get_project` | 读取完整项目文档（缺省为活动项目） |
| `choreo_create_project` | 新建项目：可一并指定分组、演员/道具、舞台配置与初始帧；创建后自动在桌面端打开 |
| `choreo_open_project` | 打开指定项目并设为活动项目 |
| `choreo_update_frames` | 批量创建/更新/删除队形关键帧（修改指定帧队形的核心工具） |
| `choreo_update_entities` | 批量增/改/删演员与道具（新实体自动在既有帧补网格站位） |
| `choreo_update_groups` | 批量增/改/删分组 |
| `choreo_update_stage` | 修改舞台配置（宽/深/侧台/LED，单位米） |
| `choreo_update_transition` | 修改帧间转场（时长、直线/贝塞尔路径、朝向插值） |
| `choreo_apply_plan` | 一次性应用整套 AIChoreoPlan 编排计划（灵感编排推荐入口） |
| `choreo_list_changes` | 列出 MCP 变更历史（含 changeId） |
| `choreo_undo` / `choreo_redo` | 撤销 / 重做最近一次 MCP 修改 |
| `choreo_rollback_to` | 回退到指定 changeId 之前的状态 |

## 核心概念

### 活动项目
修改类工具缺省作用于桌面端**当前打开的项目**；也可在参数中显式传 `projectId`。`choreo_create_project` / `choreo_open_project` 会切换活动项目并让桌面端打开它。

### 实体定位
`positions` 的 key、帧/分组定位均支持 **id 或名称**（名称需唯一）。建议先用 `choreo_get_project` 获取真实 id。

### 坐标系
`x`/`y` 为 0-100 舞台百分比（x 左→右；y 0=台后、100=台口），`z` 为离地高度（米），时间为毫秒。详见 `choreo_get_schema`。

## 实时同步与回退

- **实时同步**：每次 MCP 修改落盘后，桌面端立即应用并重渲染（若正打开该项目）。音频未变化时不会重新解码。
- **本地编辑保护**：MCP 写入前会请求桌面端先保存未保存的本地编辑（1.5s 超时降级）；若仍有未保存编辑被覆盖，可在桌面端按 `Ctrl+Z` 找回（进入撤销栈的 `restore-document` 快照）。
- **MCP 回退**：每次修改记录 before/after 文档快照（每项目最多 50 条，内存态），`choreo_undo` / `choreo_redo` / `choreo_rollback_to` 恢复并实时同步。桌面端手动编辑不进入 MCP 历史（用桌面端自身的撤销）。
- **磁盘兜底**：每次覆盖保存自动生成恢复快照（`~/.choreo/recovery/<projectId>/`，每项目保留 5 份），可在桌面端「恢复快照」中查看。

## 灵感编排示例

对 AI 服务说：「基于当前项目的演员，编一套从一字排开到圆形再到 V 字的队形」——AI 会：

1. `choreo_get_schema` 了解数据格式（首次）
2. `choreo_get_project` 获取当前演员与帧
3. 生成三帧新队形，调用 `choreo_update_frames`（或整套 `choreo_apply_plan`）
4. 桌面端立即呈现新队形；不满意则 `choreo_undo` 回退

## 架构说明（开发者）

- 实现：`electron/mcp/`（`server.ts` HTTP 装配 / `tools.ts` 工具 / `history.ts` 历史 / `plan-apply.ts` 计划应用 / `runtime.ts` Electron 上下文 / `schema-doc.ts` 数据结构文档）
- 遵循官方 `create-mcp-app` 技能（modelcontextprotocol/ext-apps）的服务端最佳实践：MCP SDK 2.x 拆分包（`@modelcontextprotocol/server` + `@modelcontextprotocol/node`）、stateless Streamable HTTP、handler 全部在 `connect()` 前注册、工具结果始终带 text fallback、错误经 `isError` 结构化返回
- 项目读写复用 `electron/project-service.ts`（`readManagedProjectDocument` 读取原始文档，避免 hydrate 的协议 URL 回写磁盘）
- 测试：`npm run test:mcp`（真实 HTTP 服务 + 官方 MCP Client 端到端）
