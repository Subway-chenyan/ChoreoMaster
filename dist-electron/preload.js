import { contextBridge, ipcRenderer } from 'electron';
const electronAPI = {
    // Dialog operations
    saveTextFile: (defaultName, content, filters) => ipcRenderer.invoke('dialog:saveTextFile', defaultName, content, filters),
    saveBinaryFile: (defaultName, content, filters) => ipcRenderer.invoke('dialog:saveBinaryFile', defaultName, content, filters),
    openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
    openMultipleFiles: (filters) => ipcRenderer.invoke('dialog:openMultipleFiles', filters),
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
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
        exportChoreography: (projectId) => ipcRenderer.invoke('project:exportChoreography', projectId),
        importChoreography: () => ipcRenderer.invoke('project:importChoreography'),
        importLegacy: () => ipcRenderer.invoke('project:importLegacy'),
        listRecoverySnapshots: (projectId) => ipcRenderer.invoke('project:listRecoverySnapshots', projectId),
        restoreRecoverySnapshot: (snapshotId) => ipcRenderer.invoke('project:restoreRecoverySnapshot', snapshotId),
        delete: (projectId) => ipcRenderer.invoke('project:delete', projectId),
        openInExplorer: (projectId) => ipcRenderer.invoke('project:openInExplorer', projectId),
        openStorageFolder: () => ipcRenderer.invoke('project:openStorageFolder'),
        rename: (projectId, newName) => ipcRenderer.invoke('project:rename', projectId, newName),
        duplicate: (projectId) => ipcRenderer.invoke('project:duplicate', projectId),
    },
    // Update operations
    update: {
        getState: () => ipcRenderer.invoke('update:getState'),
        check: () => ipcRenderer.invoke('update:check'),
        download: () => ipcRenderer.invoke('update:download'),
        install: () => ipcRenderer.invoke('update:install'),
        onStateChanged: (callback) => {
            const handler = (_event, state) => callback(state);
            ipcRenderer.on('update:stateChanged', handler);
            return () => ipcRenderer.removeListener('update:stateChanged', handler);
        },
    },
    // System information
    isElectron: true,
    platform: process.platform,
    version: process.versions.electron || 'unknown',
};
// Expose API to renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
