import { contextBridge, ipcRenderer } from 'electron';
const electronAPI = {
    // Dialog operations
    saveFile: (defaultName, filters) => ipcRenderer.invoke('dialog:saveFile', defaultName, filters),
    openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
    openMultipleFiles: (filters) => ipcRenderer.invoke('dialog:openMultipleFiles', filters),
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
    // File system operations
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    writeBinaryFile: (filePath, content) => ipcRenderer.invoke('fs:writeBinaryFile', filePath, content),
    // Project storage operations
    project: {
        getSettings: () => ipcRenderer.invoke('project:getSettings'),
        updateSettings: (updates) => ipcRenderer.invoke('project:updateSettings', updates),
        setStoragePath: (newPath) => ipcRenderer.invoke('project:setStoragePath', newPath),
        list: () => ipcRenderer.invoke('project:list'),
        create: (name) => ipcRenderer.invoke('project:create', name),
        load: (projectId) => ipcRenderer.invoke('project:load', projectId),
        save: (projectId, projectData) => ipcRenderer.invoke('project:save', projectId, projectData),
        ingestAsset: (projectId, sourcePath, kind) => ipcRenderer.invoke('project:ingestAsset', projectId, sourcePath, kind),
        exportPackage: (projectId) => ipcRenderer.invoke('project:exportPackage', projectId),
        importPackage: () => ipcRenderer.invoke('project:importPackage'),
        importLegacy: () => ipcRenderer.invoke('project:importLegacy'),
        delete: (projectId) => ipcRenderer.invoke('project:delete', projectId),
        copyMedia: (projectId, sourcePath, mediaType) => ipcRenderer.invoke('project:copyMedia', projectId, sourcePath, mediaType),
        getMediaPath: (projectId, fileName, mediaType) => ipcRenderer.invoke('project:getMediaPath', projectId, fileName, mediaType),
        openInExplorer: (projectId) => ipcRenderer.invoke('project:openInExplorer', projectId),
        openStorageFolder: () => ipcRenderer.invoke('project:openStorageFolder'),
        rename: (projectId, newName) => ipcRenderer.invoke('project:rename', projectId, newName),
        duplicate: (projectId) => ipcRenderer.invoke('project:duplicate', projectId),
    },
    // System information
    isElectron: true,
    platform: process.platform,
    version: process.versions.electron || 'unknown',
};
// Expose API to renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
