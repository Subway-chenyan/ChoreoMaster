import React, { useEffect, useState, useCallback } from 'react';
import { Download, RefreshCw, CheckCircle, AlertCircle, X, ArrowUpCircle } from 'lucide-react';

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
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

export const UpdateNotification: React.FC = () => {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

  useEffect(() => {
    if (!isElectron) return;

    // Get initial state
    window.electronAPI.update.getState().then(setState);

    // Subscribe to state changes
    const unsubscribe = window.electronAPI.update.onStateChanged((newState) => {
      setState(newState);
      setDismissed(false);

      // Auto-show panel when update is available or downloaded
      if (newState.status === 'available' || newState.status === 'downloaded') {
        setShowPanel(true);
      }
    });

    return unsubscribe;
  }, [isElectron]);

  const handleCheck = useCallback(async () => {
    if (!isElectron) return;
    setDismissed(false);
    setShowPanel(true);
    await window.electronAPI.update.check();
  }, [isElectron]);

  const handleDownload = useCallback(async () => {
    if (!isElectron) return;
    await window.electronAPI.update.download();
  }, [isElectron]);

  const handleInstall = useCallback(() => {
    if (!isElectron) return;
    window.electronAPI.update.install();
  }, [isElectron]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setShowPanel(false);
  }, []);

  if (!isElectron || !state || dismissed) return null;

  // Don't show anything for idle or not-available states
  if (state.status === 'idle' || state.status === 'not-available') return null;

  const isChecking = state.status === 'checking';
  const isAvailable = state.status === 'available';
  const isDownloading = state.status === 'downloading';
  const isDownloaded = state.status === 'downloaded';
  const isError = state.status === 'error';

  return (
    <>
      {/* Floating update indicator button */}
      {(isAvailable || isDownloaded) && !showPanel && (
        <button
          onClick={() => setShowPanel(true)}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5
            bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-lg
            transition-all duration-200 hover:scale-105 active:scale-95"
        >
          <ArrowUpCircle size={18} />
          <span className="text-sm font-medium">
            {isDownloaded ? '安装更新' : '有新版本'}
          </span>
        </button>
      )}

      {/* Update panel */}
      {showPanel && (
        <div className="fixed bottom-4 right-4 z-50 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <ArrowUpCircle size={16} className="text-blue-500" />
              <span className="text-sm font-bold text-slate-800 dark:text-white">
                {isChecking ? '检查更新...' : `新版本 ${state.version || ''}`}
              </span>
            </div>
            <button
              onClick={handleDismiss}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-3">
            {/* Checking */}
            {isChecking && (
              <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
                <RefreshCw size={18} className="animate-spin text-blue-500" />
                <span className="text-sm">正在检查是否有新版本...</span>
              </div>
            )}

            {/* Available */}
            {isAvailable && (
              <>
                <div className="text-sm text-slate-600 dark:text-slate-300">
                  发现新版本 <span className="font-semibold text-blue-600 dark:text-blue-400">{state.version}</span>
                </div>
                {state.releaseNotes && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg p-3 max-h-24 overflow-y-auto">
                    {state.releaseNotes}
                  </div>
                )}
                <button
                  onClick={handleDownload}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2
                    bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg
                    transition-colors"
                >
                  <Download size={16} />
                  下载更新
                </button>
              </>
            )}

            {/* Downloading */}
            {isDownloading && state.progress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{formatSpeed(state.progress.bytesPerSecond)}</span>
                  <span>{formatBytes(state.progress.transferred)} / {formatBytes(state.progress.total)}</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${state.progress.percent}%` }}
                  />
                </div>
                <div className="text-center text-xs text-slate-500 dark:text-slate-400">
                  {Math.round(state.progress.percent)}%
                </div>
              </div>
            )}

            {/* Downloaded */}
            {isDownloaded && (
              <>
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle size={16} />
                  <span>更新已下载完成</span>
                </div>
                <button
                  onClick={handleInstall}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2
                    bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg
                    transition-colors"
                >
                  <RefreshCw size={16} />
                  重启并安装
                </button>
              </>
            )}

            {/* Error */}
            {isError && (
              <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div>更新检查失败</div>
                  {state.error && (
                    <div className="text-xs text-red-500 dark:text-red-400 mt-1">{state.error}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
