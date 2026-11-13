import { ipcMain } from 'electron';
import type { McpController, McpStatus } from './controller.js';
import type { McpChangeSummary } from './history.js';

export interface McpIpcRollbackResult {
  projectId: string;
  undoneCount: number;
  description: string;
}

// 桌面端「AI 配置」页使用的 MCP IPC：
// - mcp:getStatus     查询服务状态（是否运行 / 端口 / URL / 错误）
// - mcp:setEnabled    开关服务（持久化到 settings.json）
// - mcp:listChanges   读取当前项目的 MCP 修改记录
// - mcp:rollbackTo    回退到某条修改之前
// - mcp:undoLast      撤销最近一次 MCP 修改
export function registerMcpIpcHandlers(controller: McpController): void {
  ipcMain.handle('mcp:getStatus', async (): Promise<McpStatus> => controller.getStatus());

  ipcMain.handle('mcp:setEnabled', async (_, enabled: boolean): Promise<McpStatus> => {
    return controller.setEnabled(enabled);
  });

  ipcMain.handle('mcp:listChanges', async (_, projectId?: string): Promise<McpChangeSummary[]> => {
    return controller.listChanges(projectId);
  });

  ipcMain.handle('mcp:rollbackTo', async (_, changeId: string): Promise<McpIpcRollbackResult> => {
    return controller.rollbackTo(changeId);
  });

  ipcMain.handle('mcp:undoLast', async (_, projectId?: string): Promise<{ projectId: string; description: string }> => {
    return controller.undoLast(projectId);
  });
}
