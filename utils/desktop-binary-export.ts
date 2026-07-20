export type DesktopBinaryExportStream = {
  enqueue: (data: Uint8Array, position: number) => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
};

export async function createDesktopBinaryExportStream(
  defaultName: string,
  extension: 'mp4' | 'webm',
): Promise<DesktopBinaryExportStream | null> {
  const sessionId = await window.electronAPI.beginBinaryFile(defaultName, [
    { name: extension === 'mp4' ? 'MP4 Video' : 'WebM Video', extensions: [extension] },
    { name: 'All Files', extensions: ['*'] },
  ]);
  if (!sessionId) return null;

  let writeChain = Promise.resolve();
  let isFinished = false;

  const enqueue = (data: Uint8Array, position: number): void => {
    if (isFinished) throw new Error('导出文件已经关闭');
    const ownedData = data.slice();
    writeChain = writeChain.then(() => window.electronAPI.writeBinaryFileChunk(sessionId, ownedData, position));
  };

  const flush = async (): Promise<void> => {
    await writeChain;
  };

  const abort = async (): Promise<void> => {
    if (isFinished) return;
    isFinished = true;
    await writeChain.catch(() => undefined);
    await window.electronAPI.abortBinaryFile(sessionId);
  };

  const close = async (): Promise<void> => {
    if (isFinished) return;
    try {
      await flush();
      await window.electronAPI.closeBinaryFile(sessionId);
      isFinished = true;
    } catch (error) {
      await abort();
      throw error;
    }
  };

  return { enqueue, flush, close, abort };
}
