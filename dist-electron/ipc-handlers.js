import { ipcMain, dialog, app, net, shell } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { createManagedProject, deleteManagedProject, duplicateManagedProject, exportChoreographyDocument, exportProjectPackage, importChoreographyDocument, importProjectPackage, ingestProjectAsset, listManagedProjects, listProjectRecoverySnapshots, loadManagedProject, resolveManagedProjectPath, renameManagedProject, restoreProjectRecoverySnapshot, saveManagedProject, } from './project-service.js';
import { createProjectFromTemplate, listProjectTemplates } from './project-template-service.js';
import { updaterManager } from './updater.js';
// ==================== Default Settings ====================
const DEFAULT_STORAGE_PATH = path.join(os.homedir(), '.choreo');
function getSettingsPath() {
    return path.join(DEFAULT_STORAGE_PATH, 'settings.json');
}
async function ensureStorageDir(storagePath) {
    const projectsDir = path.join(storagePath, 'projects');
    await fs.mkdir(projectsDir, { recursive: true });
}
async function loadSettings() {
    try {
        const settingsPath = getSettingsPath();
        const content = await fs.readFile(settingsPath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        // Return default settings if file doesn't exist
        return {
            storagePath: DEFAULT_STORAGE_PATH,
            recentProjects: [],
            maxRecentProjects: 10,
        };
    }
}
export async function getProjectStoragePath() {
    return (await loadSettings()).storagePath;
}
async function saveSettings(settings) {
    await ensureStorageDir(DEFAULT_STORAGE_PATH);
    const settingsPath = getSettingsPath();
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}
export function registerIpcHandlers(mainWindow) {
    const binaryExportSessions = new Map();
    const getBinaryExportSession = (sessionId) => {
        const session = binaryExportSessions.get(sessionId);
        if (!session)
            throw new Error('导出文件会话不存在或已经结束');
        return session;
    };
    const abortBinaryExportSession = async (sessionId) => {
        const session = binaryExportSessions.get(sessionId);
        if (!session)
            return;
        binaryExportSessions.delete(sessionId);
        await session.handle.close().catch(() => undefined);
        await fs.unlink(session.filePath).catch(() => undefined);
    };
    mainWindow.once('closed', () => {
        for (const sessionId of binaryExportSessions.keys()) {
            void abortBinaryExportSession(sessionId);
        }
    });
    // ==================== Dialog Handlers ====================
    ipcMain.handle('dialog:saveFile', async (_, defaultName, filters) => {
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName,
            filters: filters && filters.length > 0 ? filters : [
                { name: 'CosStage Project', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] },
            ],
        });
        return filePath || null;
    });
    ipcMain.handle('dialog:openFile', async (_, filters) => {
        const { filePaths } = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: filters || [
                { name: 'CosStage Project', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] },
            ],
        });
        return filePaths.length > 0 ? filePaths[0] : null;
    });
    ipcMain.handle('dialog:openMultipleFiles', async (_, filters) => {
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
    ipcMain.handle('dialog:saveTextFile', async (_, defaultName, content, filters) => {
        const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName, filters });
        if (!filePath)
            return null;
        await fs.writeFile(filePath, content, 'utf-8');
        return filePath;
    });
    ipcMain.handle('dialog:saveBinaryFile', async (_, defaultName, content, filters) => {
        const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName, filters });
        if (!filePath)
            return null;
        await fs.writeFile(filePath, Buffer.from(content));
        return filePath;
    });
    ipcMain.handle('dialog:beginBinaryFile', async (_, defaultName, filters) => {
        const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName, filters });
        if (!filePath)
            return null;
        const sessionId = randomUUID();
        const handle = await fs.open(filePath, 'w');
        binaryExportSessions.set(sessionId, { filePath, handle });
        return sessionId;
    });
    ipcMain.handle('dialog:writeBinaryFileChunk', async (_, sessionId, content, position) => {
        if (!Number.isSafeInteger(position) || position < 0)
            throw new Error('导出文件写入位置无效');
        const session = getBinaryExportSession(sessionId);
        const buffer = Buffer.from(content);
        let offset = 0;
        while (offset < buffer.length) {
            const { bytesWritten } = await session.handle.write(buffer, offset, buffer.length - offset, position + offset);
            if (bytesWritten <= 0)
                throw new Error('导出文件写入失败');
            offset += bytesWritten;
        }
    });
    ipcMain.handle('dialog:closeBinaryFile', async (_, sessionId) => {
        const session = getBinaryExportSession(sessionId);
        await session.handle.close();
        binaryExportSessions.delete(sessionId);
    });
    ipcMain.handle('dialog:abortBinaryFile', async (_, sessionId) => {
        await abortBinaryExportSession(sessionId);
    });
    // ==================== Utility Handlers ====================
    ipcMain.handle('app:getVersion', async () => {
        return app.getVersion();
    });
    // ==================== Update Handlers ====================
    ipcMain.handle('update:getState', async () => {
        return updaterManager.getState();
    });
    ipcMain.handle('update:check', async () => {
        await updaterManager.checkForUpdates(true);
    });
    ipcMain.handle('update:download', async () => {
        await updaterManager.downloadUpdate();
    });
    ipcMain.handle('update:install', async () => {
        updaterManager.quitAndInstall();
    });
    // ==================== Project Storage Handlers ====================
    // Get app settings (storage path, recent projects)
    ipcMain.handle('project:getSettings', async () => {
        return loadSettings();
    });
    // Update app settings
    ipcMain.handle('project:updateSettings', async (_, updates) => {
        const settings = await loadSettings();
        const newSettings = { ...settings, ...updates };
        await saveSettings(newSettings);
        return newSettings;
    });
    // Set custom storage path
    ipcMain.handle('project:setStoragePath', async (_, newPath) => {
        const settings = await loadSettings();
        settings.storagePath = newPath;
        await ensureStorageDir(newPath);
        await saveSettings(settings);
        return settings;
    });
    // List all projects in storage
    ipcMain.handle('project:list', async () => {
        const settings = await loadSettings();
        return listManagedProjects(settings.storagePath);
    });
    // Create a new project
    ipcMain.handle('project:create', async (_, name) => {
        const settings = await loadSettings();
        await ensureStorageDir(settings.storagePath);
        const created = await createManagedProject(settings.storagePath, name);
        // Update recent projects
        settings.recentProjects = [created.id, ...settings.recentProjects.filter(p => p !== created.id)]
            .slice(0, settings.maxRecentProjects);
        await saveSettings(settings);
        return created;
    });
    // Load a project
    ipcMain.handle('project:load', async (_, projectId) => {
        const settings = await loadSettings();
        const result = await loadManagedProject(settings.storagePath, projectId);
        // Update recent projects
        settings.recentProjects = [projectId, ...settings.recentProjects.filter(p => p !== projectId)].slice(0, settings.maxRecentProjects);
        await saveSettings(settings);
        return result;
    });
    // Save a project
    ipcMain.handle('project:save', async (_, projectId, projectData) => {
        const settings = await loadSettings();
        await saveManagedProject(settings.storagePath, projectId, projectData);
        // Update recent projects
        settings.recentProjects = [projectId, ...settings.recentProjects.filter(p => p !== projectId)].slice(0, settings.maxRecentProjects);
        await saveSettings(settings);
    });
    ipcMain.handle('project:ingestAsset', async (_, projectId, sourcePath, kind) => {
        const settings = await loadSettings();
        return ingestProjectAsset(settings.storagePath, projectId, sourcePath, kind);
    });
    ipcMain.handle('project:exportPackage', async (_, projectId) => {
        const settings = await loadSettings();
        const projectDir = resolveManagedProjectPath(settings.storagePath, projectId);
        const content = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8'));
        const defaultName = `${content.name || 'CosStage-project'}.zip`;
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName,
            filters: [
                { name: '项目压缩包 (*.zip)', extensions: ['zip'] },
                { name: 'CosStage 项目包 (*.choreo)', extensions: ['choreo'] },
                { name: 'All Files', extensions: ['*'] },
            ],
        });
        if (!filePath)
            return null;
        await exportProjectPackage(projectDir, filePath);
        return filePath;
    });
    ipcMain.handle('project:importPackage', async () => {
        const { filePaths } = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [
                { name: '项目压缩包 / CosStage 项目包', extensions: ['zip', 'choreo'] },
                { name: 'All Files', extensions: ['*'] },
            ],
        });
        if (filePaths.length === 0)
            return null;
        const settings = await loadSettings();
        const result = await importProjectPackage(settings.storagePath, filePaths[0]);
        settings.recentProjects = [result.projectId, ...settings.recentProjects.filter(p => p !== result.projectId)]
            .slice(0, settings.maxRecentProjects);
        await saveSettings(settings);
        return result;
    });
    ipcMain.handle('project:exportChoreography', async (_, projectId) => {
        const settings = await loadSettings();
        const projectDir = resolveManagedProjectPath(settings.storagePath, projectId);
        const content = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8'));
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            defaultPath: `${content.name || 'CosStage-choreography'}.cosstage.json`,
            filters: [
                { name: 'CosStage 编排 JSON', extensions: ['json'] },
            ],
        });
        if (!filePath)
            return null;
        await exportChoreographyDocument(settings.storagePath, projectId, filePath);
        return filePath;
    });
    ipcMain.handle('project:importChoreography', async () => {
        const { filePaths } = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [
                { name: 'CosStage 编排 JSON', extensions: ['json'] },
            ],
        });
        if (filePaths.length === 0)
            return null;
        const settings = await loadSettings();
        const result = await importChoreographyDocument(settings.storagePath, filePaths[0]);
        settings.recentProjects = [result.projectId, ...settings.recentProjects.filter((id) => id !== result.projectId)]
            .slice(0, settings.maxRecentProjects);
        await saveSettings(settings);
        return result;
    });
    ipcMain.handle('project:listTemplates', async () => {
        return listProjectTemplates();
    });
    ipcMain.handle('project:createFromTemplate', async (_, templateId, projectName) => {
        const settings = await loadSettings();
        await ensureStorageDir(settings.storagePath);
        const result = await createProjectFromTemplate(settings.storagePath, path.join(app.getPath('userData'), 'project-template-cache'), templateId, projectName, (url) => net.fetch(url));
        settings.recentProjects = [result.projectId, ...settings.recentProjects.filter((id) => id !== result.projectId)]
            .slice(0, settings.maxRecentProjects);
        await saveSettings(settings);
        return result;
    });
    ipcMain.handle('project:listRecoverySnapshots', async (_, projectId) => {
        const settings = await loadSettings();
        return listProjectRecoverySnapshots(settings.storagePath, projectId);
    });
    ipcMain.handle('project:restoreRecoverySnapshot', async (_, snapshotId) => {
        const settings = await loadSettings();
        const result = await restoreProjectRecoverySnapshot(settings.storagePath, snapshotId);
        settings.recentProjects = [result.projectId, ...settings.recentProjects.filter((id) => id !== result.projectId)]
            .slice(0, settings.maxRecentProjects);
        await saveSettings(settings);
        return result;
    });
    // Delete a project
    ipcMain.handle('project:delete', async (_, projectId) => {
        const settings = await loadSettings();
        await deleteManagedProject(settings.storagePath, projectId);
        // Update recent projects
        settings.recentProjects = settings.recentProjects.filter(p => p !== projectId);
        await saveSettings(settings);
    });
    // Open project folder in file explorer
    ipcMain.handle('project:openInExplorer', async (_, projectId) => {
        const settings = await loadSettings();
        const projectDir = resolveManagedProjectPath(settings.storagePath, projectId);
        await shell.openPath(projectDir);
    });
    // Open storage folder in file explorer
    ipcMain.handle('project:openStorageFolder', async () => {
        const settings = await loadSettings();
        await shell.openPath(settings.storagePath);
    });
    // Rename a project
    ipcMain.handle('project:rename', async (_, projectId, newName) => {
        const settings = await loadSettings();
        await renameManagedProject(settings.storagePath, projectId, newName);
    });
    // Duplicate a project
    ipcMain.handle('project:duplicate', async (_, projectId) => {
        const settings = await loadSettings();
        return duplicateManagedProject(settings.storagePath, projectId);
    });
    console.log('IPC handlers registered successfully');
}
