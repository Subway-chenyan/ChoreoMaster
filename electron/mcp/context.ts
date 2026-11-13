import type { McpProjectChange } from '../project-contract.js';

// MCP 运行时上下文：由 Electron 侧（runtime.ts）实现。
// 工具层只依赖此接口，便于在无 Electron 的纯 Node 环境中测试。
export interface McpRuntimeContext {
  getStoragePath(): Promise<string>;
  getActiveProjectId(): string | null;
  setActiveProjectId(projectId: string): void;
  clearActiveProjectId(projectId: string): void;
  // 写前 flush：请求渲染端保存该项目未保存的编辑。
  // 返回是否确认成功；无窗口 / 渲染端不在该项目 / 超时（默认 1.5s）时返回 false，调用方继续使用磁盘版本。
  flushRendererEdits(projectId: string): Promise<boolean>;
  // 项目文档已被 MCP 落盘后通知渲染进程实时应用
  notifyProjectUpdated(change: McpProjectChange): void;
  // 请求渲染进程打开指定项目
  notifyOpenProject(projectId: string): void;
}

// 工具层抛出的业务错误：handler 统一捕获后转为 isError 工具结果
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}
