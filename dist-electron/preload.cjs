"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Sandboxed Electron preloads must compile as a standalone CommonJS entry.
const electron_1 = require("electron");
function requireIdentifier(value, label) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff-]{0,159}$/u.test(value)) {
        throw new Error(`${label}无效`);
    }
    return value;
}
function requireObject(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label}无效`);
    }
    return value;
}
async function invokeModelAsset(channel, ...args) {
    const result = await electron_1.ipcRenderer.invoke(channel, ...args);
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
        const error = new Error('3D 资产服务返回了无效响应');
        error.code = 'IO_ERROR';
        throw error;
    }
    if (result.ok === true)
        return result.value;
    const error = new Error(result.error.message);
    error.code = result.error.code;
    throw error;
}
const electronAPI = {
    // Dialog operations
    saveTextFile: (defaultName, content, filters) => electron_1.ipcRenderer.invoke('dialog:saveTextFile', defaultName, content, filters),
    saveBinaryFile: (defaultName, content, filters) => electron_1.ipcRenderer.invoke('dialog:saveBinaryFile', defaultName, content, filters),
    beginBinaryFile: (defaultName, filters) => electron_1.ipcRenderer.invoke('dialog:beginBinaryFile', defaultName, filters),
    writeBinaryFileChunk: (sessionId, content, position) => electron_1.ipcRenderer.invoke('dialog:writeBinaryFileChunk', sessionId, content, position),
    closeBinaryFile: (sessionId) => electron_1.ipcRenderer.invoke('dialog:closeBinaryFile', sessionId),
    abortBinaryFile: (sessionId) => electron_1.ipcRenderer.invoke('dialog:abortBinaryFile', sessionId),
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
        listTemplates: () => electron_1.ipcRenderer.invoke('project:listTemplates'),
        createFromTemplate: (templateId, projectName) => (electron_1.ipcRenderer.invoke('project:createFromTemplate', templateId, projectName)),
        listRecoverySnapshots: (projectId) => electron_1.ipcRenderer.invoke('project:listRecoverySnapshots', projectId),
        restoreRecoverySnapshot: (snapshotId) => electron_1.ipcRenderer.invoke('project:restoreRecoverySnapshot', snapshotId),
        delete: (projectId) => electron_1.ipcRenderer.invoke('project:delete', projectId),
        openInExplorer: (projectId) => electron_1.ipcRenderer.invoke('project:openInExplorer', projectId),
        openStorageFolder: () => electron_1.ipcRenderer.invoke('project:openStorageFolder'),
        rename: (projectId, newName) => electron_1.ipcRenderer.invoke('project:rename', projectId, newName),
        duplicate: (projectId) => electron_1.ipcRenderer.invoke('project:duplicate', projectId),
    },
    modelAssets: {
        list: () => invokeModelAsset('modelAssets:list'),
        get: (assetId) => invokeModelAsset('modelAssets:get', requireIdentifier(assetId, '资产 ID')),
        saveParametric: (input) => invokeModelAsset('modelAssets:saveParametric', requireObject(input, '模型数据')),
        updateMetadata: (input) => invokeModelAsset('modelAssets:updateMetadata', requireObject(input, '资产信息')),
        updateThumbnail: (input) => invokeModelAsset('modelAssets:updateThumbnail', requireObject(input, '资产预览图')),
        beginGlbImport: () => invokeModelAsset('modelAssets:beginGlbImport'),
        commitGlbImport: (sessionId, input) => invokeModelAsset('modelAssets:commitGlbImport', requireIdentifier(sessionId, '导入会话 ID'), requireObject(input, 'GLB 校准数据')),
        cancelGlbImport: (sessionId) => invokeModelAsset('modelAssets:cancelGlbImport', requireIdentifier(sessionId, '导入会话 ID')),
        duplicate: (assetId) => invokeModelAsset('modelAssets:duplicate', requireIdentifier(assetId, '资产 ID')),
        delete: (assetId) => invokeModelAsset('modelAssets:delete', requireIdentifier(assetId, '资产 ID')),
        materialize: (projectId, assetId, expectedRevision) => invokeModelAsset('modelAssets:materialize', requireIdentifier(projectId, '项目 ID'), requireIdentifier(assetId, '资产 ID'), expectedRevision),
        transferProjectAssets: (sourceProjectId, targetProjectId, assets) => invokeModelAsset('modelAssets:transferProjectAssets', requireIdentifier(sourceProjectId, '源项目 ID'), requireIdentifier(targetProjectId, '目标项目 ID'), requireObject(assets, '项目模型资产')),
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
    getAppVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
};
// Expose API to renderer process
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
