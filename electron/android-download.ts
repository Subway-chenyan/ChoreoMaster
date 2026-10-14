// 网页、Windows 与 Android 发布脚本共用稳定下载域名，不能由远端数据指定任意链接。
export const ANDROID_DOWNLOAD_URL = 'https://beat.cosdrama.cn/downloads/CosStage-Android.apk';
export const ANDROID_MANIFEST_URL = 'https://beat.cosdrama.cn/downloads/android/latest.json';
export function isAndroidDownloadUrl(value: string): boolean {
  return (
    value === ANDROID_DOWNLOAD_URL ||
    /^https:\/\/beat\.cosdrama\.cn\/downloads\/android\/releases\/(\d+\.\d+\.\d+)\/CosStage-\1\.apk$/.test(
      value
    )
  );
}
export function parseAndroidDownload(value: unknown): { version: string; url: string } | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    item.schemaVersion !== 1 ||
    item.channel !== 'stable' ||
    item.applicationId !== 'com.cosstage.mobile' ||
    typeof item.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(item.version) ||
    item.url !==
      `https://beat.cosdrama.cn/downloads/android/releases/${item.version}/CosStage-${item.version}.apk` ||
    typeof item.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(item.sha256)
  )
    return null;
  return { version: item.version, url: item.url as string };
}
