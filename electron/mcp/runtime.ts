import { ipcMain, type BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import type { McpRuntimeContext } from './context.js';

export interface ElectronRuntimeDeps {
  getStoragePath(): Promise<string>;
  getMainWindow(): BrowserWindow | null;
}

const FLUSH_TIMEOUT_MS = 1500;

// Electron 侧 McpRuntimeContext 实现：
// - 活动项目 id 由主进程在项目打开/创建等 IPC 成功后记录（见 ipc-handlers.ts）
// - flush 通过 webContents.send('mcp:flushRequest') + 渲染端 invoke('mcp:flushAck') 应答，超时降级
// - 项目更新 / 打开项目通过 webContents 事件推送给渲染端
export function createElectronRuntimeContext(deps: ElectronRuntimeDeps): McpRuntimeContext {
  let activeProjectId: string | null = null;
  const flushWaiters = new Map<string, (ok: boolean) => void>();

  ipcMain.handle('mcp:flushAck', (_, requestId: string, ok: boolean) => {
    const waiter = flushWaiters.get(requestId);
    if (waiter) {
      flushWaiters.delete(requestId);
      waiter(ok);
    }
  });

  return {
    getStoragePath: deps.getStoragePath,
    getActiveProjectId: () => activeProjectId,
    setActiveProjectId: (projectId) => {
      activeProjectId = projectId;
    },
    clearActiveProjectId: (projectId) => {
      if (activeProjectId === projectId) activeProjectId = null;
    },
    async flushRendererEdits(projectId) {
      const win = deps.getMainWindow();
      if (!win || win.isDestroyed()) return false;
      // 渲染端不在此项目上时无需 flush
      if (activeProjectId !== projectId) return true;
      const requestId = randomUUID();
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          flushWaiters.delete(requestId);
          resolve(false);
        }, FLUSH_TIMEOUT_MS);
        flushWaiters.set(requestId, (ok) => {
          clearTimeout(timer);
          resolve(ok);
        });
        try {
          win.webContents.send('mcp:flushRequest', { requestId, projectId });
        } catch {
          clearTimeout(timer);
          flushWaiters.delete(requestId);
          resolve(false);
        }
      });
    },
    notifyProjectUpdated(change) {
      const win = deps.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('mcp:projectUpdated', change);
      }
    },
    notifyOpenProject(projectId) {
      const win = deps.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('mcp:openProject', projectId);
      }
    },
  };
}
