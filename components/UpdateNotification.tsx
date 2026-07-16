import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpCircle, CheckCircle, Download, RefreshCw, X } from 'lucide-react';
import type { UpdateState } from '../electron/update-contract.js';
import {
  beforeInstallSafely,
  readUpdatePreference,
  removeUpdatePreference,
  shouldAutoOpenUpdate,
  shouldShowWhatsNew,
  writeUpdatePreference,
} from '../utils/update-preferences';
import { loadProductReleaseHistory, type ReleaseEntry } from '../utils/release-history';
import { MajorUpdateDialog } from './MajorUpdateDialog';
import { WhatsNewDialog } from './WhatsNewDialog';

interface UpdateNotificationProps {
  beforeInstall: () => Promise<boolean>;
}

const IGNORED_UPDATE_VERSION_KEY = 'cosstage:update:ignored-version';
const LAST_SEEN_VERSION_KEY = 'cosstage:update:last-seen-version';
const MANUAL_DOWNLOAD_URL = 'https://beat.cosdrama.cn/downloads/CosStage-Setup-x64.exe';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({
  beforeInstall: requestBeforeInstall,
}) => {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [showMajorDialog, setShowMajorDialog] = useState(false);
  const [installPending, setInstallPending] = useState(false);
  const [whatsNewRelease, setWhatsNewRelease] = useState<ReleaseEntry | null>(null);
  const mountedRef = useRef(true);

  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron === true;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setOperationError = useCallback((error: unknown) => {
    if (!mountedRef.current) return;
    setState((current) => ({
      ...(current ?? { currentVersion: '0.0.0' }),
      status: 'error',
      error: getErrorMessage(error),
    }));
    setDismissed(false);
    setShowPanel(true);
  }, []);

  const applyUpdateState = useCallback((newState: UpdateState) => {
    if (!mountedRef.current) return;
    setState(newState);

    const ignoredVersion = readUpdatePreference(IGNORED_UPDATE_VERSION_KEY);
    const shouldAutoOpen = shouldAutoOpenUpdate({
      status: newState.status,
      updateKind: newState.updateKind,
      availableVersion: newState.availableVersion,
      ignoredVersion,
    });

    if (shouldAutoOpen) {
      setDismissed(false);
      setShowPanel(true);
    }
    if (newState.status !== 'available') setShowMajorDialog(false);
  }, []);

  useEffect(() => {
    if (!isElectron) return undefined;
    let active = true;

    void window.electronAPI.update.getState()
      .then((initialState) => {
        if (active) applyUpdateState(initialState);
      })
      .catch((error: unknown) => {
        if (active) setOperationError(error);
      });

    const unsubscribe = window.electronAPI.update.onStateChanged((newState) => {
      if (active) applyUpdateState(newState);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applyUpdateState, isElectron, setOperationError]);

  useEffect(() => {
    if (!isElectron) return undefined;
    let active = true;

    void loadProductReleaseHistory(window.electronAPI)
      .then(({ currentVersion, history }) => {
        if (!active) return;
        const lastSeenVersion = readUpdatePreference(LAST_SEEN_VERSION_KEY);
        const showWhatsNew = shouldShowWhatsNew(currentVersion, lastSeenVersion);
        if (!showWhatsNew) {
          if (lastSeenVersion === null) {
            writeUpdatePreference(LAST_SEEN_VERSION_KEY, currentVersion);
          }
          return;
        }

        const release = history.releases.find((item) => item.version === currentVersion);
        if (release) setWhatsNewRelease(release);
      })
      .catch((error: unknown) => {
        console.error('加载本次更新说明失败:', error);
      });

    return () => {
      active = false;
    };
  }, [isElectron]);

  const beforeInstall = useCallback(
    () => beforeInstallSafely(requestBeforeInstall),
    [requestBeforeInstall],
  );

  const handleCheck = useCallback(async () => {
    if (!isElectron) return;
    removeUpdatePreference(IGNORED_UPDATE_VERSION_KEY);
    setDismissed(false);
    setShowPanel(true);
    try {
      await window.electronAPI.update.check();
    } catch (error) {
      setOperationError(error);
    }
  }, [isElectron, setOperationError]);

  const handleDownload = useCallback(async () => {
    if (!isElectron || !state?.availableVersion) return;
    if (state.updateKind === 'major') {
      setShowMajorDialog(true);
      return;
    }
    try {
      await window.electronAPI.update.download();
    } catch (error) {
      setOperationError(error);
    }
  }, [isElectron, setOperationError, state?.availableVersion, state?.updateKind]);

  const confirmMajorDownload = useCallback(async () => {
    if (!isElectron) return;
    setShowMajorDialog(false);
    try {
      await window.electronAPI.update.download();
    } catch (error) {
      setOperationError(error);
    }
  }, [isElectron, setOperationError]);

  const postponeMajor = useCallback(() => {
    if (state?.availableVersion) {
      writeUpdatePreference(IGNORED_UPDATE_VERSION_KEY, state.availableVersion);
    }
    setShowMajorDialog(false);
    setShowPanel(false);
    setDismissed(true);
  }, [state?.availableVersion]);

  const handleInstall = useCallback(async () => {
    if (!isElectron || installPending) return;
    setInstallPending(true);
    try {
      if (await beforeInstall()) await window.electronAPI.update.install();
    } catch (error) {
      setOperationError(error);
    } finally {
      if (mountedRef.current) setInstallPending(false);
    }
  }, [beforeInstall, installPending, isElectron, setOperationError]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setShowPanel(false);
  }, []);

  const handleOpenPanel = useCallback(() => {
    setDismissed(false);
    setShowPanel(true);
  }, []);

  const handleWhatsNewAcknowledge = useCallback(() => {
    if (!whatsNewRelease) return;
    writeUpdatePreference(LAST_SEEN_VERSION_KEY, whatsNewRelease.version);
    setWhatsNewRelease(null);
  }, [whatsNewRelease]);

  const isChecking = state?.status === 'checking';
  const isAvailable = state?.status === 'available';
  const isDownloading = state?.status === 'downloading';
  const isDownloaded = state?.status === 'downloaded';
  const isError = state?.status === 'error';
  const showsNotification = isChecking || isAvailable || isDownloading || isDownloaded || isError;
  const visibleWhatsNewRelease = showMajorDialog ? null : whatsNewRelease;

  return (
    <>
      {isElectron && showsNotification && (
        <>
          {(isAvailable || isDownloaded || isError) && (!showPanel || dismissed) && (
            <button
              type="button"
              onClick={handleOpenPanel}
              aria-label={isDownloaded ? '打开更新安装面板' : isError ? '打开更新错误面板' : '打开新版本面板'}
              className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-white shadow-lg transition-all duration-200 hover:scale-105 hover:bg-blue-700 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
            >
              <ArrowUpCircle size={18} />
              <span className="text-sm font-medium">
                {isDownloaded ? '安装更新' : isError ? '更新失败' : '有新版本'}
              </span>
            </button>
          )}

          {showPanel && !dismissed && (
            <div className="fixed bottom-4 right-4 z-50 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-center gap-2">
                  <ArrowUpCircle size={16} className="text-blue-500" />
                  <span className="text-sm font-bold text-slate-800 dark:text-white">
                    {isChecking
                      ? '检查更新...'
                      : isError
                        ? '更新检查'
                        : `新版本 ${state?.availableVersion || ''}`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleDismiss}
                  aria-label="收起更新面板"
                  className="rounded text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 dark:hover:text-slate-300"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3 p-4">
                {isChecking && (
                  <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
                    <RefreshCw size={18} className="animate-spin text-blue-500" />
                    <span className="text-sm">正在检查是否有新版本...</span>
                  </div>
                )}

                {isAvailable && (
                  <>
                    <div className="text-sm text-slate-600 dark:text-slate-300">
                      发现新版本{' '}
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        {state?.availableVersion}
                      </span>
                    </div>
                    {state?.releaseNotes && (
                      <div
                        className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        style={{ scrollbarGutter: 'stable' }}
                      >
                        {state.releaseNotes}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                    >
                      <Download size={16} />
                      下载更新
                    </button>
                  </>
                )}

                {isDownloading && state?.progress && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>{formatSpeed(state.progress.bytesPerSecond)}</span>
                      <span>
                        {formatBytes(state.progress.transferred)} / {formatBytes(state.progress.total)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${state.progress.percent}%` }}
                      />
                    </div>
                    <div className="text-center text-xs text-slate-500 dark:text-slate-400">
                      {Math.round(state.progress.percent)}%
                    </div>
                  </div>
                )}

                {isDownloaded && (
                  <>
                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                      <CheckCircle size={16} />
                      <span>更新已下载完成</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleInstall}
                      disabled={installPending}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400 disabled:cursor-wait disabled:opacity-70"
                    >
                      <RefreshCw size={16} className={installPending ? 'animate-spin' : ''} />
                      {installPending ? '正在保存项目…' : '重启并安装'}
                    </button>
                  </>
                )}

                {isError && (
                  <div className="space-y-3 text-sm text-red-600 dark:text-red-400">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                      <p>{state?.error || '更新检查失败'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCheck}
                        className="rounded-lg bg-slate-700 px-3 py-2 text-white hover:bg-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                      >
                        重试检查
                      </button>
                      <a
                        href={MANUAL_DOWNLOAD_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-slate-700 px-3 py-2 text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 dark:text-white dark:hover:bg-slate-800"
                      >
                        人工下载安装包
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {showMajorDialog && state?.availableVersion && (
        <MajorUpdateDialog
          version={state.availableVersion}
          releaseNotes={state.releaseNotes}
          onConfirm={confirmMajorDownload}
          onLater={postponeMajor}
        />
      )}
      {visibleWhatsNewRelease && (
        <WhatsNewDialog
          release={visibleWhatsNewRelease}
          onAcknowledge={handleWhatsNewAcknowledge}
        />
      )}
    </>
  );
};
