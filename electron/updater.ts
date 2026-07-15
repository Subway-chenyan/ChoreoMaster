import electronUpdater from 'electron-updater';
import type { Logger, UpdateInfo } from 'electron-updater';
import { BrowserWindow, app } from 'electron';
import { EventEmitter } from 'events';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  assertUpdateCachePendingPath,
  classifyUpdate,
  normalizeReleaseNotes,
  shouldClearUpdateCache,
  type UpdateState,
} from './update-contract.js';

const { autoUpdater } = electronUpdater;

const updaterLogger: Logger = {
  info: (message?: unknown) => console.log('[updater]', message),
  warn: (message?: unknown) => console.warn('[updater]', message),
  error: (message?: unknown) => console.error('[updater]', message),
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type UpdaterOperationKind = 'check' | 'download';

const OPERATION_IN_PROGRESS_ERROR = '已有另一更新操作进行中';

// ==================== Updater ====================

class UpdaterManager extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private state: UpdateState = { status: 'idle', currentVersion: '0.0.0' };
  private checkingManually = false;
  private eventsRegistered = false;
  private nextOperationId = 0;
  private activeOperationId: number | null = null;
  private activeOperationKind: UpdaterOperationKind | null = null;
  private activeOperationPromise: Promise<void> | null = null;
  private handledOperationErrors = new Set<number>();

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.state = { status: 'idle', currentVersion: app.getVersion() };

    // Configure autoUpdater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.disableWebInstaller = false;
    autoUpdater.logger = updaterLogger;

    if (!this.eventsRegistered) {
      this.eventsRegistered = true;
      this.registerEvents();
    }
  }

  private registerEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking', currentVersion: app.getVersion() });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setState(this.createVersionState('available', info));
    });

    autoUpdater.on('update-not-available', () => {
      this.setState({ status: 'not-available', currentVersion: app.getVersion() });
      // 手动检查时才通知用户"已是最新"
      if (this.checkingManually) {
        this.checkingManually = false;
      }
    });

    autoUpdater.on('download-progress', (progress) => {
      const availableVersion = this.state.availableVersion;
      const updateKind = this.state.updateKind;
      const releaseNotes = this.state.releaseNotes;
      this.setState({
        status: 'downloading',
        currentVersion: app.getVersion(),
        ...(availableVersion && updateKind ? { availableVersion, updateKind } : {}),
        ...(releaseNotes ? { releaseNotes } : {}),
        progress: {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        },
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.setState(this.createVersionState('downloaded', info));
    });

    autoUpdater.on('error', (error: Error) => {
      const operationId = this.activeOperationId;
      if (operationId === null) {
        this.reportUnscopedError(error.message);
        return;
      }
      this.reportOperationError(operationId, error.message);
    });
  }

  private createVersionState(status: 'available' | 'downloaded', info: UpdateInfo): UpdateState {
    const currentVersion = app.getVersion();
    const releaseNotes = normalizeReleaseNotes(info.releaseNotes);
    return {
      status,
      currentVersion,
      availableVersion: info.version,
      updateKind: classifyUpdate(currentVersion, info.version),
      ...(releaseNotes ? { releaseNotes } : {}),
    };
  }

  private setState(state: UpdateState): void {
    this.state = state;
    this.mainWindow?.webContents.send('update:stateChanged', this.state);
    this.emit('stateChanged', this.state);
  }

  private async clearCorruptDownload(message: string): Promise<void> {
    if (!shouldClearUpdateCache(message)) return;
    const localAppData = process.platform === 'win32' ? process.env.LOCALAPPDATA : undefined;
    if (!localAppData) return;
    const cacheRoot = path.resolve(localAppData, 'cosstage-desktop-updater');
    const pending = path.resolve(cacheRoot, 'pending');
    const verifiedPending = assertUpdateCachePendingPath(localAppData, pending);
    await rm(verifiedPending, { recursive: true, force: true });
  }

  private reportError(message: string): void {
    this.checkingManually = false;
    this.setState({ status: 'error', currentVersion: app.getVersion(), error: message });
    void this.clearCorruptDownload(message).catch((cleanupError: unknown) => {
      console.warn('[updater] 更新缓存清理失败', getErrorMessage(cleanupError));
    });
  }

  private reportUnscopedError(message: string): void {
    if (this.state.status === 'error' && this.state.error === message) return;
    this.reportError(message);
  }

  private reportOperationError(operationId: number, message: string): void {
    if (this.handledOperationErrors.has(operationId)) return;
    this.handledOperationErrors.add(operationId);
    this.reportError(message);
  }

  private startOperation(
    kind: UpdaterOperationKind,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    const operationId = ++this.nextOperationId;
    this.activeOperationId = operationId;
    this.activeOperationKind = kind;
    let completeOperation: (() => void) | undefined;
    const operationPromise = new Promise<void>((resolve) => {
      completeOperation = resolve;
    });
    if (!completeOperation) throw new Error('无法创建更新操作 Promise');
    this.activeOperationPromise = operationPromise;
    void this.runOperation(operationId, operation).then(completeOperation);
    return operationPromise;
  }

  private async runOperation(
    operationId: number,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error: unknown) {
      this.reportOperationError(operationId, getErrorMessage(error));
    } finally {
      this.finishOperation(operationId);
    }
  }

  private finishOperation(operationId: number): void {
    this.handledOperationErrors.delete(operationId);
    if (this.activeOperationId !== operationId) return;
    this.activeOperationId = null;
    this.activeOperationKind = null;
    this.activeOperationPromise = null;
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  checkForUpdates(manual = false): Promise<void> {
    const activeOperation = this.activeOperationPromise;
    if (activeOperation) {
      if (this.activeOperationKind !== 'check') {
        return Promise.reject(new Error(OPERATION_IN_PROGRESS_ERROR));
      }
      if (manual) this.checkingManually = true;
      return activeOperation;
    }
    this.checkingManually = manual;
    return this.startOperation('check', () => autoUpdater.checkForUpdates());
  }

  downloadUpdate(): Promise<void> {
    const activeOperation = this.activeOperationPromise;
    if (activeOperation) {
      if (this.activeOperationKind !== 'download') {
        return Promise.reject(new Error(OPERATION_IN_PROGRESS_ERROR));
      }
      return activeOperation;
    }
    return this.startOperation('download', () => autoUpdater.downloadUpdate());
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true);
  }
}

export const updaterManager = new UpdaterManager();
