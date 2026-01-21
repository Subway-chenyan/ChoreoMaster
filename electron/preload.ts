import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  // Dialog operations
  saveFile: (defaultName: string) => Promise<string | null>;
  openFile: (filters: Electron.FileFilter[]) => Promise<string | null>;
  openMultipleFiles: (filters: Electron.FileFilter[]) => Promise<string[]>;
  selectDirectory: () => Promise<string | null>;

  // File system operations
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;

  // System information
  isElectron: boolean;
  platform: string;
  version: string;
}

const electronAPI: ElectronAPI = {
  // Dialog operations
  saveFile: (defaultName: string) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName),
  openFile: (filters: Electron.FileFilter[]) =>
    ipcRenderer.invoke('dialog:openFile', filters),
  openMultipleFiles: (filters: Electron.FileFilter[]) =>
    ipcRenderer.invoke('dialog:openMultipleFiles', filters),
  selectDirectory: () =>
    ipcRenderer.invoke('dialog:selectDirectory'),

  // File system operations
  readFile: (filePath: string) =>
    ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),

  // System information
  isElectron: true,
  platform: process.platform,
  version: process.versions.electron || 'unknown',
};

// Expose API to renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for window
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
