import React, { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { ANDROID_MANIFEST_URL, parseAndroidDownload } from '../electron/android-download';

export function AndroidDownload({ compact = false }: { compact?: boolean }) {
  const [release, setRelease] = useState<ReturnType<typeof parseAndroidDownload>>(null);
  const [status, setStatus] = useState('正在检查安卓版');
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    const read = async () => {
      if (window.electronAPI?.getAndroidRelease) return window.electronAPI.getAndroidRelease();
      const response = await fetch(ANDROID_MANIFEST_URL, { cache: 'no-store', signal: controller.signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('下载服务暂时不可用');
      const result = parseAndroidDownload(await response.json());
      if (!result) throw new Error('下载信息暂不可用');
      return result;
    };
    void read()
      .then((result) => {
        if (!mounted) return;
        setRelease(result);
        setStatus(result ? `下载 Android · v${result.version}` : '安卓版待发布');
      })
      .catch(() => {
        if (mounted) setStatus('安卓版下载暂不可用');
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      mounted = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  const classes = compact
    ? 'touch-target flex items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium text-blue-500'
    : 'focus-ring inline-flex items-center gap-2 rounded-lg border border-blue-500/40 px-5 py-3 text-sm font-semibold text-blue-500';
  return release ? (
    <a
      href={release.url}
      target="_blank"
      rel="noopener noreferrer"
      className={classes}
      title={`${status} · 手机编排与团员只读排练`}
    >
      <Smartphone size={compact ? 19 : 17} />
      <span className={compact ? 'desktop-only' : undefined}>{compact ? '安卓下载' : status}</span>
    </a>
  ) : (
    <span className={`${classes} opacity-60`} title={status} aria-label={status}>
      <Smartphone size={compact ? 19 : 17} />
      <span className={compact ? 'desktop-only' : undefined}>{compact ? '安卓下载' : status}</span>
    </span>
  );
}
