import type { McpRuntimeContext } from './context.js';
import type { McpChangeEntry, McpChangeHistory, McpChangeSummary } from './history.js';
import { McpChangeHistory as History } from './history.js';
import { startMcpServer, type McpHttpServer } from './server.js';
import { readManagedProjectDocument, saveManagedProject } from '../project-service.js';
import type { McpStatus } from '../project-contract.js';

export type { McpStatus };

export interface McpControllerOptions {
  runtime: McpRuntimeContext;
  // 读取/写入 settings.json 中的 mcp 配置
  readConfig(): Promise<{ enabled?: boolean; port?: number; token?: string }>;
  writeConfig(config: { enabled?: boolean; port?: number; token?: string }): Promise<void>;
  // 项目文档已变更后通知渲染端（复用 runtime 的推送通道）
  onProjectChanged(change: { changeId: string; projectId: string; toolName: string; description: string; timestamp: number }): void;
}

const DEFAULT_PORT = 8765;

// MCP 服务生命周期与历史管理的统一入口。
// MCP 工具（tools.ts）与桌面端 UI（IPC）共用同一个 history 实例，因此 UI 里能看到并回退 AI 的修改。
export class McpController {
  private server: McpHttpServer | null = null;
  private lastError: string | null = null;
  private port = DEFAULT_PORT;
  private readonly history: McpChangeHistory = new History();

  constructor(private readonly options: McpControllerOptions) {}

  get changeHistory(): McpChangeHistory {
    return this.history;
  }

  // 启动时按配置自动启动
  async initialize(): Promise<void> {
    const config = await this.options.readConfig();
    this.port = config.port ?? DEFAULT_PORT;
    if (config.enabled === false) return;
    await this.start(config.token);
  }

  async start(token?: string): Promise<void> {
    if (this.server) return;
    try {
      this.server = await startMcpServer({
        port: this.port,
        token,
        runtime: this.options.runtime,
        history: this.history,
      });
      this.lastError = null;
    } catch (error) {
      this.server = null;
      this.lastError = (error as Error).message;
      console.error('[mcp] 启动失败:', error);
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      await server.close().catch(() => undefined);
    }
  }

  // UI 开关：写入 settings 并启停服务
  async setEnabled(enabled: boolean): Promise<McpStatus> {
    const config = await this.options.readConfig();
    await this.options.writeConfig({ ...config, enabled, port: this.port });
    if (enabled) {
      await this.start(config.token);
    } else {
      await this.stop();
      this.lastError = null;
    }
    return this.getStatus();
  }

  getStatus(): McpStatus {
    return {
      enabled: this.server !== null,
      running: this.server !== null,
      port: this.port,
      url: `http://127.0.0.1:${this.port}/mcp`,
      activeProjectId: this.options.runtime.getActiveProjectId(),
      error: this.lastError,
    };
  }

  // 当前项目（或指定项目）的 MCP 修改记录，最新在前
  listChanges(projectId?: string): McpChangeSummary[] {
    const id = projectId ?? this.options.runtime.getActiveProjectId();
    if (!id) return [];
    return this.history.listUndoable(id);
  }

  canUndo(projectId?: string): boolean {
    const id = projectId ?? this.options.runtime.getActiveProjectId();
    return id ? this.history.canUndo(id) : false;
  }

  // 回退到指定变更之前：撤销该变更及其之后的所有 MCP 修改
  async rollbackTo(changeId: string): Promise<{ projectId: string; undoneCount: number; description: string }> {
    const found = this.history.findUndoable(changeId);
    if (!found) {
      throw new Error('未找到该修改记录，可能已被回退');
    }
    const { entry } = found;
    const projectId = entry.projectId;
    const storagePath = await this.options.runtime.getStoragePath();

    let undoneCount = 0;
    while (true) {
      const popped = this.history.popUndo(projectId);
      if (!popped) break;
      undoneCount += 1;
      if (popped.id === changeId) break;
    }

    await saveManagedProject(storagePath, projectId, structuredClone(entry.before));
    this.options.onProjectChanged({
      changeId,
      projectId,
      toolName: 'ui_rollback',
      description: `回退 ${undoneCount} 处修改至「${entry.description}」之前`,
      timestamp: Date.now(),
    });
    return { projectId, undoneCount, description: entry.description };
  }

  // 撤销最近一次 MCP 修改
  async undoLast(projectId?: string): Promise<{ projectId: string; description: string }> {
    const id = projectId ?? this.options.runtime.getActiveProjectId();
    if (!id) throw new Error('当前没有打开的项目');
    const entry: McpChangeEntry | null = this.history.popUndo(id);
    if (!entry) throw new Error('没有可回退的修改');
    const storagePath = await this.options.runtime.getStoragePath();
    await saveManagedProject(storagePath, id, structuredClone(entry.before));
    this.options.onProjectChanged({
      changeId: entry.id,
      projectId: id,
      toolName: 'ui_undo',
      description: `撤销「${entry.description}」`,
      timestamp: Date.now(),
    });
    return { projectId: id, description: entry.description };
  }

  // 供测试/调试：读取回退目标文档
  async readDocument(projectId: string) {
    return readManagedProjectDocument(await this.options.runtime.getStoragePath(), projectId);
  }
}
