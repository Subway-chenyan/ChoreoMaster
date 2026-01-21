import { ipcMain, dialog, BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ==================== Dialog Handlers ====================

  ipcMain.handle('dialog:saveFile', async (_, defaultName: string) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [
        { name: 'ChoreoMaster Project', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return filePath || null;
  });

  ipcMain.handle('dialog:openFile', async (_, filters: Electron.FileFilter[]) => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters || [
        { name: 'ChoreoMaster Project', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return filePaths.length > 0 ? filePaths[0] : null;
  });

  ipcMain.handle('dialog:openMultipleFiles', async (_, filters: Electron.FileFilter[]) => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: filters || [
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return filePaths;
  });

  ipcMain.handle('dialog:selectDirectory', async () => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return filePaths.length > 0 ? filePaths[0] : null;
  });

  // ==================== File System Handlers ====================

  ipcMain.handle('fs:readFile', async (_, filePath: string): Promise<string> => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      console.error('Failed to read file:', error);
      throw error;
    }
  });

  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string): Promise<void> => {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      console.error('Failed to write file:', error);
      throw error;
    }
  });

  ipcMain.handle('fs:fileExists', async (_, filePath: string): Promise<boolean> => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // ==================== Utility Handlers ====================

  ipcMain.handle('app:getVersion', async () => {
    return '1.0.0';
  });

  console.log('IPC handlers registered successfully');
}
