import { contextBridge, ipcRenderer } from 'electron';
import type {
  ProjectAssetKind,
  ProjectAssetResult,
  ProjectDocument,
  ProjectImportResult,
  ProjectLoadResult,
} from './project-contract.js';

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

// ==================== Update Types ====================

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  releaseNotes?: string;
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
}

export interface ElectronAPI {
  // Dialog operations
  saveFile: (defaultName: string, filters?: Electron.FileFilter[]) => Promise<string | null>;
  openFile: (filters: Electron.FileFilter[]) => Promise<string | null>;
  openMultipleFiles: (filters: Electron.FileFilter[]) => Promise<string[]>;
  selectDirectory: () => Promise<string | null>;

  // File system operations
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  writeBinaryFile: (filePath: string, content: Uint8Array) => Promise<void>;

  // Project storage operations
  project: {
    getSettings: () => Promise<AppSettings>;
    updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>;
    setStoragePath: (newPath: string) => Promise<AppSettings>;
    list: () => Promise<ProjectMeta[]>;
    create: (name: string) => Promise<{ id: string; path: string }>;
    load: (projectId: string) => Promise<ProjectLoadResult>;
    save: (projectId: string, projectData: ProjectDocument) => Promise<void>;
    ingestAsset: (projectId: string, sourcePath: string, kind: ProjectAssetKind) => Promise<ProjectAssetResult>;
    exportPackage: (projectId: string) => Promise<string | null>;
    importPackage: () => Promise<ProjectImportResult | null>;
    importLegacy: () => Promise<ProjectImportResult | null>;
    delete: (projectId: string) => Promise<void>;
    copyMedia: (projectId: string, sourcePath: string, mediaType: 'audio' | 'media') => Promise<string>;
    getMediaPath: (projectId: string, fileName: string, mediaType: 'audio' | 'media') => Promise<string>;
    openInExplorer: (projectId: string) => Promise<void>;
    openStorageFolder: () => Promise<void>;
    rename: (projectId: string, newName: string) => Promise<void>;
    duplicate: (projectId: string) => Promise<{ id: string; path: string }>;
  };

  // Update operations
  update: {
    getState: () => Promise<UpdateState>;
    check: () => Promise<void>;
    download: () => Promise<void>;
    install: () => Promise<void>;
    onStateChanged: (callback: (state: UpdateState) => void) => () => void;
  };

  // System information
  isElectron: boolean;
  platform: string;
  version: string;
}

const electronAPI: ElectronAPI = {
  // Dialog operations
  saveFile: (defaultName: string, filters?: Electron.FileFilter[]) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, filters),
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
  writeBinaryFile: (filePath: string, content: Uint8Array) =>
    ipcRenderer.invoke('fs:writeBinaryFile', filePath, content),

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

  // Update operations
  update: {
    getState: () => ipcRenderer.invoke('update:getState'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStateChanged: (callback: (state: UpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
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

// Type declaration for window
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
