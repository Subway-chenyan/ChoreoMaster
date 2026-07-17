// Sandboxed Electron preloads must compile as a standalone CommonJS entry.
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  ProjectAssetKind,
  ProjectAssetResult,
  ProjectDocument,
  ProjectImportResult,
  ProjectLoadResult,
  ProjectMeta,
  ProjectRecoverySnapshot,
  ProjectTemplateSummary,
} from './project-contract.js';
import type { UpdateState } from './update-contract.js';

export interface ElectronAPI {
  // Dialog operations
  saveTextFile: (defaultName: string, content: string, filters?: Electron.FileFilter[]) => Promise<string | null>;
  saveBinaryFile: (defaultName: string, content: Uint8Array, filters?: Electron.FileFilter[]) => Promise<string | null>;
  openFile: (filters: Electron.FileFilter[]) => Promise<string | null>;
  openMultipleFiles: (filters: Electron.FileFilter[]) => Promise<string[]>;
  selectDirectory: () => Promise<string | null>;

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
    exportChoreography: (projectId: string) => Promise<string | null>;
    importChoreography: () => Promise<ProjectImportResult | null>;
    listTemplates: () => Promise<ProjectTemplateSummary[]>;
    createFromTemplate: (templateId: string, projectName: string) => Promise<ProjectImportResult>;
    listRecoverySnapshots: (projectId?: string) => Promise<ProjectRecoverySnapshot[]>;
    restoreRecoverySnapshot: (snapshotId: string) => Promise<ProjectImportResult>;
    delete: (projectId: string) => Promise<void>;
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
  getAppVersion: () => Promise<string>;
}

const electronAPI: ElectronAPI = {
  // Dialog operations
  saveTextFile: (defaultName: string, content: string, filters?: Electron.FileFilter[]) =>
    ipcRenderer.invoke('dialog:saveTextFile', defaultName, content, filters),
  saveBinaryFile: (defaultName: string, content: Uint8Array, filters?: Electron.FileFilter[]) =>
    ipcRenderer.invoke('dialog:saveBinaryFile', defaultName, content, filters),
  openFile: (filters: Electron.FileFilter[]) =>
    ipcRenderer.invoke('dialog:openFile', filters),
  openMultipleFiles: (filters: Electron.FileFilter[]) =>
    ipcRenderer.invoke('dialog:openMultipleFiles', filters),
  selectDirectory: () =>
    ipcRenderer.invoke('dialog:selectDirectory'),

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
    listTemplates: () => ipcRenderer.invoke('project:listTemplates'),
    createFromTemplate: (templateId, projectName) => (
      ipcRenderer.invoke('project:createFromTemplate', templateId, projectName)
    ),
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
    onStateChanged: (callback: (state: UpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
      ipcRenderer.on('update:stateChanged', handler);
      return () => ipcRenderer.removeListener('update:stateChanged', handler);
    },
  },

  // System information
  isElectron: true,
  platform: process.platform,
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
};

// Expose API to renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for window
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
