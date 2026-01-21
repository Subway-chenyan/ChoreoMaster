import { contextBridge, ipcRenderer } from 'electron';
const electronAPI = {
    // Dialog operations
    saveFile: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),
    openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
    openMultipleFiles: (filters) => ipcRenderer.invoke('dialog:openMultipleFiles', filters),
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
    // File system operations
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    // System information
    isElectron: true,
    platform: process.platform,
    version: process.versions.electron || 'unknown',
};
// Expose API to renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
