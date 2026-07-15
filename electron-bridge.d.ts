// ==================== Update Types ====================

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

interface UpdateState {
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

import type {
  AppSettings,
  ProjectAssetKind,
  ProjectAssetResult,
  ProjectDocument,
  ProjectImportResult,
  ProjectLoadResult,
  ProjectMeta,
  ProjectRecoverySnapshot,
} from './electron/project-contract';

declare global {
  interface Window {
    electronAPI: {
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
        importLegacy: () => Promise<ProjectImportResult | null>;
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
      version: string;
    };
  }
}

export {};
