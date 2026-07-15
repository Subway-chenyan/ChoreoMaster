"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Sandboxed Electron preloads must compile as a standalone CommonJS entry.
const electron_1 = require("electron");
const electronAPI = {
    // Dialog operations
    saveTextFile: (defaultName, content, filters) => electron_1.ipcRenderer.invoke('dialog:saveTextFile', defaultName, content, filters),
    saveBinaryFile: (defaultName, content, filters) => electron_1.ipcRenderer.invoke('dialog:saveBinaryFile', defaultName, content, filters),
    openFile: (filters) => electron_1.ipcRenderer.invoke('dialog:openFile', filters),
    openMultipleFiles: (filters) => electron_1.ipcRenderer.invoke('dialog:openMultipleFiles', filters),
    selectDirectory: () => electron_1.ipcRenderer.invoke('dialog:selectDirectory'),
    // Project storage operations
    project: {
        getSettings: () => electron_1.ipcRenderer.invoke('project:getSettings'),
        updateSettings: (updates) => electron_1.ipcRenderer.invoke('project:updateSettings', updates),
        setStoragePath: (newPath) => electron_1.ipcRenderer.invoke('project:setStoragePath', newPath),
        list: () => electron_1.ipcRenderer.invoke('project:list'),
        create: (name) => electron_1.ipcRenderer.invoke('project:create', name),
        load: (projectId) => electron_1.ipcRenderer.invoke('project:load', projectId),
        save: (projectId, projectData) => electron_1.ipcRenderer.invoke('project:save', projectId, projectData),
        ingestAsset: (projectId, sourcePath, kind) => electron_1.ipcRenderer.invoke('project:ingestAsset', projectId, sourcePath, kind),
        exportPackage: (projectId) => electron_1.ipcRenderer.invoke('project:exportPackage', projectId),
        importPackage: () => electron_1.ipcRenderer.invoke('project:importPackage'),
        exportChoreography: (projectId) => electron_1.ipcRenderer.invoke('project:exportChoreography', projectId),
        importChoreography: () => electron_1.ipcRenderer.invoke('project:importChoreography'),
        importLegacy: () => electron_1.ipcRenderer.invoke('project:importLegacy'),
        listRecoverySnapshots: (projectId) => electron_1.ipcRenderer.invoke('project:listRecoverySnapshots', projectId),
        restoreRecoverySnapshot: (snapshotId) => electron_1.ipcRenderer.invoke('project:restoreRecoverySnapshot', snapshotId),
        delete: (projectId) => electron_1.ipcRenderer.invoke('project:delete', projectId),
        openInExplorer: (projectId) => electron_1.ipcRenderer.invoke('project:openInExplorer', projectId),
        openStorageFolder: () => electron_1.ipcRenderer.invoke('project:openStorageFolder'),
        rename: (projectId, newName) => electron_1.ipcRenderer.invoke('project:rename', projectId, newName),
        duplicate: (projectId) => electron_1.ipcRenderer.invoke('project:duplicate', projectId),
    },
    // Update operations
    update: {
        getState: () => electron_1.ipcRenderer.invoke('update:getState'),
        check: () => electron_1.ipcRenderer.invoke('update:check'),
        download: () => electron_1.ipcRenderer.invoke('update:download'),
        install: () => electron_1.ipcRenderer.invoke('update:install'),
        onStateChanged: (callback) => {
            const handler = (_event, state) => callback(state);
            electron_1.ipcRenderer.on('update:stateChanged', handler);
            return () => electron_1.ipcRenderer.removeListener('update:stateChanged', handler);
        },
    },
    // System information
    isElectron: true,
    platform: process.platform,
    version: process.versions.electron || 'unknown',
};
// Expose API to renderer process
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
