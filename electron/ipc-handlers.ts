import { ipcMain, dialog, BrowserWindow, app, shell } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ProjectAssetKind, ProjectDocument } from './project-contract.js';
import {
  createManagedProject,
  exportProjectPackage,
  importLegacyProject,
  importProjectPackage,
  ingestProjectAsset,
  loadManagedProject,
  saveManagedProject,
} from './project-service.js';

// ==================== Project Storage Types ====================

interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnail?: string;
}

interface AppSettings {
  storagePath: string;
  recentProjects: string[]; // Project IDs
  maxRecentProjects: number;
}

// ==================== Default Settings ====================

const DEFAULT_STORAGE_PATH = path.join(os.homedir(), '.choreo');

function getSettingsPath(): string {
  return path.join(DEFAULT_STORAGE_PATH, 'settings.json');
}

async function ensureStorageDir(storagePath: string): Promise<void> {
  const projectsDir = path.join(storagePath, 'projects');
  await fs.mkdir(projectsDir, { recursive: true });
}

async function loadSettings(): Promise<AppSettings> {
  try {
    const settingsPath = getSettingsPath();
    const content = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    // Return default settings if file doesn't exist
    return {
      storagePath: DEFAULT_STORAGE_PATH,
      recentProjects: [],
      maxRecentProjects: 10,
    };
  }
}

export async function getProjectStoragePath(): Promise<string> {
  return (await loadSettings()).storagePath;
}

async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureStorageDir(DEFAULT_STORAGE_PATH);
  const settingsPath = getSettingsPath();
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ==================== Dialog Handlers ====================

  ipcMain.handle('dialog:saveFile', async (_, defaultName: string, filters?: Electron.FileFilter[]) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: filters && filters.length > 0 ? filters : [
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

  ipcMain.handle('fs:writeBinaryFile', async (_, filePath: string, content: Uint8Array): Promise<void> => {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, Buffer.from(content));
    } catch (error) {
      console.error('Failed to write binary file:', error);
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

  // ==================== Project Storage Handlers ====================

  // Get app settings (storage path, recent projects)
  ipcMain.handle('project:getSettings', async (): Promise<AppSettings> => {
    return loadSettings();
  });

  // Update app settings
  ipcMain.handle('project:updateSettings', async (_, updates: Partial<AppSettings>): Promise<AppSettings> => {
    const settings = await loadSettings();
    const newSettings = { ...settings, ...updates };
    await saveSettings(newSettings);
    return newSettings;
  });

  // Set custom storage path
  ipcMain.handle('project:setStoragePath', async (_, newPath: string): Promise<AppSettings> => {
    const settings = await loadSettings();
    settings.storagePath = newPath;
    await ensureStorageDir(newPath);
    await saveSettings(settings);
    return settings;
  });

  // List all projects in storage
  ipcMain.handle('project:list', async (): Promise<ProjectMeta[]> => {
    const settings = await loadSettings();
    const projectsDir = path.join(settings.storagePath, 'projects');
    
    try {
      await ensureStorageDir(settings.storagePath);
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });
      const projects: ProjectMeta[] = [];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(projectsDir, entry.name, 'project.json');
          try {
            const content = await fs.readFile(metaPath, 'utf-8');
            const data = JSON.parse(content);
            projects.push({
              id: entry.name,
              name: data.name || entry.name,
              createdAt: data.createdAt || new Date().toISOString(),
              updatedAt: data.updatedAt || new Date().toISOString(),
              thumbnail: data.thumbnail,
            });
          } catch {
            // Skip invalid project folders
          }
        }
      }
      
      // Sort by updatedAt descending
      projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return projects;
    } catch {
      return [];
    }
  });

  // Create a new project
  ipcMain.handle('project:create', async (_, name: string): Promise<{ id: string; path: string }> => {
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
  ipcMain.handle('project:load', async (_, projectId: string) => {
    const settings = await loadSettings();
    const result = await loadManagedProject(settings.storagePath, projectId);
    
    // Update recent projects
    settings.recentProjects = [projectId, ...settings.recentProjects.filter(p => p !== projectId)].slice(0, settings.maxRecentProjects);
    await saveSettings(settings);
    
    return result;
  });

  // Save a project
  ipcMain.handle('project:save', async (_, projectId: string, projectData: ProjectDocument) => {
    const settings = await loadSettings();
    await saveManagedProject(settings.storagePath, projectId, projectData);
    
    // Update recent projects
    settings.recentProjects = [projectId, ...settings.recentProjects.filter(p => p !== projectId)].slice(0, settings.maxRecentProjects);
    await saveSettings(settings);
    return loadManagedProject(settings.storagePath, projectId);
  });

  ipcMain.handle(
    'project:ingestAsset',
    async (_, projectId: string, sourcePath: string, kind: ProjectAssetKind) => {
      const settings = await loadSettings();
      return ingestProjectAsset(settings.storagePath, projectId, sourcePath, kind);
    },
  );

  ipcMain.handle('project:exportPackage', async (_, projectId: string): Promise<string | null> => {
    const settings = await loadSettings();
    const projectDir = path.join(settings.storagePath, 'projects', projectId);
    const content = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8')) as { name?: string };
    const defaultName = `${content.name || 'choreomaster-project'}.choreo`;
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [
        { name: 'ChoreoMaster Project Package', extensions: ['choreo'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (!filePath) return null;
    await exportProjectPackage(projectDir, filePath);
    return filePath;
  });

  ipcMain.handle('project:importPackage', async () => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'ChoreoMaster Project Package', extensions: ['choreo'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (filePaths.length === 0) return null;
    const settings = await loadSettings();
    const result = await importProjectPackage(settings.storagePath, filePaths[0]);
    settings.recentProjects = [result.projectId, ...settings.recentProjects.filter(p => p !== result.projectId)]
      .slice(0, settings.maxRecentProjects);
    await saveSettings(settings);
    return result;
  });

  ipcMain.handle('project:importLegacy', async () => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Legacy ChoreoMaster JSON', extensions: ['json'] },
        { name: 'JSON Files', extensions: ['json'] },
      ],
    });
    if (filePaths.length === 0) return null;
    const settings = await loadSettings();
    const result = await importLegacyProject(settings.storagePath, filePaths[0]);
    settings.recentProjects = [result.projectId, ...settings.recentProjects.filter(p => p !== result.projectId)]
      .slice(0, settings.maxRecentProjects);
    await saveSettings(settings);
    return result;
  });

  // Delete a project
  ipcMain.handle('project:delete', async (_, projectId: string): Promise<void> => {
    const settings = await loadSettings();
    const projectDir = path.join(settings.storagePath, 'projects', projectId);
    
    // Remove directory recursively
    await fs.rm(projectDir, { recursive: true, force: true });
    
    // Update recent projects
    settings.recentProjects = settings.recentProjects.filter(p => p !== projectId);
    await saveSettings(settings);
  });

  // Copy media file to project
  ipcMain.handle('project:copyMedia', async (_, projectId: string, sourcePath: string, mediaType: 'audio' | 'media'): Promise<string> => {
    const settings = await loadSettings();
    const projectDir = path.join(settings.storagePath, 'projects', projectId);
    const targetDir = path.join(projectDir, mediaType);
    
    await fs.mkdir(targetDir, { recursive: true });
    
    const fileName = path.basename(sourcePath);
    const targetPath = path.join(targetDir, fileName);
    
    await fs.copyFile(sourcePath, targetPath);
    
    return targetPath;
  });

  // Get media file path for project
  ipcMain.handle('project:getMediaPath', async (_, projectId: string, fileName: string, mediaType: 'audio' | 'media'): Promise<string> => {
    const settings = await loadSettings();
    return path.join(settings.storagePath, 'projects', projectId, mediaType, fileName);
  });

  // Open project folder in file explorer
  ipcMain.handle('project:openInExplorer', async (_, projectId: string): Promise<void> => {
    const settings = await loadSettings();
    const projectDir = path.join(settings.storagePath, 'projects', projectId);
    await shell.openPath(projectDir);
  });

  // Open storage folder in file explorer
  ipcMain.handle('project:openStorageFolder', async (): Promise<void> => {
    const settings = await loadSettings();
    await shell.openPath(settings.storagePath);
  });

  // Rename a project
  ipcMain.handle('project:rename', async (_, projectId: string, newName: string): Promise<void> => {
    const settings = await loadSettings();
    const projectDir = path.join(settings.storagePath, 'projects', projectId);
    const projectPath = path.join(projectDir, 'project.json');
    
    const content = await fs.readFile(projectPath, 'utf-8');
    const data = JSON.parse(content);
    data.name = newName;
    data.updatedAt = new Date().toISOString();
    
    await fs.writeFile(projectPath, JSON.stringify(data, null, 2), 'utf-8');
  });

  // Duplicate a project
  ipcMain.handle('project:duplicate', async (_, projectId: string): Promise<{ id: string; path: string }> => {
    const settings = await loadSettings();
    const sourceDir = path.join(settings.storagePath, 'projects', projectId);
    
    // Load source project to get name
    const sourceContent = await fs.readFile(path.join(sourceDir, 'project.json'), 'utf-8');
    const sourceData = JSON.parse(sourceContent);
    
    // Create new project
    const newName = `${sourceData.name} (Copy)`;
    const slug = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const newId = `${slug}-${Date.now()}`;
    const newDir = path.join(settings.storagePath, 'projects', newId);
    
    // Copy entire directory
    await copyDir(sourceDir, newDir);
    
    // Update project.json with new name and timestamps
    const newProjectPath = path.join(newDir, 'project.json');
    const newData = JSON.parse(await fs.readFile(newProjectPath, 'utf-8'));
    newData.name = newName;
    newData.createdAt = new Date().toISOString();
    newData.updatedAt = new Date().toISOString();
    await fs.writeFile(newProjectPath, JSON.stringify(newData, null, 2), 'utf-8');
    
    return { id: newId, path: newDir };
  });

  console.log('IPC handlers registered successfully');
}

// Helper function to copy directory recursively
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
