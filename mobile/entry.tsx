import React, { lazy, Suspense } from 'react';
import { Capacitor } from '@capacitor/core';
const DesktopApp = lazy(() => import('../App'));
const MobileApp = lazy(() => import('../components/mobile/MobileApp'));

// 一次启动只选择一个编辑器，旋转屏幕不会卸载正在编辑的项目。
const mobile =
  !window.electronAPI?.isElectron &&
  (Capacitor.isNativePlatform() ||
    new URLSearchParams(window.location.search).get('mobile') === '1' ||
    (window.matchMedia('(pointer: coarse)').matches &&
      Math.min(window.innerWidth, window.innerHeight) <= 900));
export function AppEntry() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: '#94a3b8' }}>正在打开 CosStage…</div>}>
      {mobile ? <MobileApp /> : <DesktopApp />}
    </Suspense>
  );
}
