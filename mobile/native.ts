import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNativeAndroid = () => Capacitor.getPlatform() === 'android';
export async function shareProjectFile(blob: Blob, name: string): Promise<void> {
  const filename = `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80) || 'CosStage'}.zip`;
  if (isNativeAndroid()) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === 'string'
          ? resolve(reader.result.split(',')[1])
          : reject(new Error('无法读取项目包'));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const path = `exports/${Date.now()}-${filename}`;
    const saved = await Filesystem.writeFile({
      directory: Directory.Cache,
      path,
      data: base64,
      recursive: true,
    });
    await Share.share({ title: name, files: [saved.uri], dialogTitle: '发送项目到电脑或保存到文件' });
    // 不立即删除：接收方可能在分享面板关闭后才读取；缓存由系统清理。
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function onAndroidBack(handler: () => void): Promise<() => void> {
  if (!isNativeAndroid()) return () => undefined;
  const listener = await NativeApp.addListener('backButton', handler);
  return () => {
    void listener.remove();
  };
}

export async function minimizeAndroidApp(): Promise<void> {
  if (isNativeAndroid()) await NativeApp.minimizeApp();
}
