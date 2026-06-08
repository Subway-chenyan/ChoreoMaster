import { contextBridge, ipcRenderer } from 'electron';

// ==================== Project Storage Types ====================

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnail?: string;
}

export interface AppSettings {
  storagePath: string;
  recentProjects: string[];
  maxRecentProjects: number;
}

export interface AgentBackendRuntime {
  state: 'starting' | 'ready' | 'stopped' | 'error';
  baseUrl: string;
  accessToken: string;
  configPath: string;
  logPath: string;
  error?: string;
}

export interface ElectronAPI {
  // Dialog operations
  saveFile: (defaultName: string) => Promise<string | null>;
  openFile: (filters: Electron.FileFilter[]) => Promise<string | null>;
  openMultipleFiles: (filters: Electron.FileFilter[]) => Promise<string[]>;
  selectDirectory: () => Promise<string | null>;

  // File system operations
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;

  // Project storage operations
  project: {
    getSettings: () => Promise<AppSettings>;
    updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>;
    setStoragePath: (newPath: string) => Promise<AppSettings>;
    list: () => Promise<ProjectMeta[]>;
    create: (name: string) => Promise<{ id: string; path: string }>;
    load: (projectId: string) => Promise<{ data: any; projectPath: string }>;
    save: (projectId: string, projectData: any) => Promise<void>;
    delete: (projectId: string) => Promise<void>;
    copyMedia: (projectId: string, sourcePath: string, mediaType: 'audio' | 'media') => Promise<string>;
    getMediaPath: (projectId: string, fileName: string, mediaType: 'audio' | 'media') => Promise<string>;
    openInExplorer: (projectId: string) => Promise<void>;
    openStorageFolder: () => Promise<void>;
    rename: (projectId: string, newName: string) => Promise<void>;
    duplicate: (projectId: string) => Promise<{ id: string; path: string }>;
  };

  agent: {
    getRuntime: () => Promise<AgentBackendRuntime>;
    restart: () => Promise<AgentBackendRuntime>;
    openConfig: () => Promise<void>;
    openLogs: () => Promise<void>;
  };

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

  // Project storage operations
  project: {
    getSettings: () => ipcRenderer.invoke('project:getSettings'),
    updateSettings: (updates) => ipcRenderer.invoke('project:updateSettings', updates),
    setStoragePath: (newPath) => ipcRenderer.invoke('project:setStoragePath', newPath),
    list: () => ipcRenderer.invoke('project:list'),
    create: (name) => ipcRenderer.invoke('project:create', name),
    load: (projectId) => ipcRenderer.invoke('project:load', projectId),
    save: (projectId, projectData) => ipcRenderer.invoke('project:save', projectId, projectData),
    delete: (projectId) => ipcRenderer.invoke('project:delete', projectId),
    copyMedia: (projectId, sourcePath, mediaType) => ipcRenderer.invoke('project:copyMedia', projectId, sourcePath, mediaType),
    getMediaPath: (projectId, fileName, mediaType) => ipcRenderer.invoke('project:getMediaPath', projectId, fileName, mediaType),
    openInExplorer: (projectId) => ipcRenderer.invoke('project:openInExplorer', projectId),
    openStorageFolder: () => ipcRenderer.invoke('project:openStorageFolder'),
    rename: (projectId, newName) => ipcRenderer.invoke('project:rename', projectId, newName),
    duplicate: (projectId) => ipcRenderer.invoke('project:duplicate', projectId),
  },

  agent: {
    getRuntime: () => ipcRenderer.invoke('agent:getRuntime'),
    restart: () => ipcRenderer.invoke('agent:restart'),
    openConfig: () => ipcRenderer.invoke('agent:openConfig'),
    openLogs: () => ipcRenderer.invoke('agent:openLogs'),
  },

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
