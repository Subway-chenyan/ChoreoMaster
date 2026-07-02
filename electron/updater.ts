import electronUpdater from 'electron-updater';
import { BrowserWindow, app } from 'electron';
import { EventEmitter } from 'events';

const { autoUpdater } = electronUpdater;
type UpdateInfo = any;

// ==================== Update State Types ====================

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  releaseNotes?: string;
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
}

// ==================== Updater ====================

class UpdaterManager extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private state: UpdateState = { status: 'idle' };
  private checkingManually = false;

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    // Configure autoUpdater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.disableWebInstaller = false;
    autoUpdater.logger = {
      info: (msg: string) => console.log('[updater]', msg),
      warn: (msg: string) => console.warn('[updater]', msg),
      error: (msg: string) => console.error('[updater]', msg),
    } as any;

    this.registerEvents();
  }

  private registerEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setState({
        status: 'available',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      });
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.setState({ status: 'not-available', version: info.version });
      // 手动检查时才通知用户"已是最新"
      if (this.checkingManually) {
        this.checkingManually = false;
      }
    });

    autoUpdater.on('download-progress', (progress) => {
      this.setState({
        status: 'downloading',
        progress: {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        },
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.setState({
        status: 'downloaded',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      });
    });

    autoUpdater.on('error', (err: Error) => {
      this.setState({ status: 'error', error: err.message });
      this.checkingManually = false;
    });
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.mainWindow?.webContents.send('update:stateChanged', this.state);
    this.emit('stateChanged', this.state);
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  async checkForUpdates(manual = false): Promise<void> {
    try {
      this.checkingManually = manual;
      await autoUpdater.checkForUpdates();
    } catch (err: any) {
      this.setState({ status: 'error', error: err.message });
    }
  }

  async downloadUpdate(): Promise<void> {
    try {
      await autoUpdater.downloadUpdate();
    } catch (err: any) {
      this.setState({ status: 'error', error: err.message });
    }
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  getAppVersion(): string {
    return app.getVersion();
  }
}

export const updaterManager = new UpdaterManager();
