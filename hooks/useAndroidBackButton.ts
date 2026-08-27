import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { useEffect } from 'react';

type AndroidBackButtonOptions = {
  enabled: boolean;
  hasHistoryLayer: boolean;
};

export function useAndroidBackButton({ enabled, hasHistoryLayer }: AndroidBackButtonOptions): void {
  useEffect(() => {
    if (!enabled || Capacitor.getPlatform() !== 'android') return;

    let isActive = true;
    let listener: PluginListenerHandle | null = null;
    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (hasHistoryLayer || canGoBack) {
        window.history.back();
        return;
      }
      void CapacitorApp.minimizeApp();
    }).then((handle) => {
      if (!isActive) {
        void handle.remove();
        return;
      }
      listener = handle;
    });

    return () => {
      isActive = false;
      if (listener) void listener.remove();
    };
  }, [enabled, hasHistoryLayer]);
}
