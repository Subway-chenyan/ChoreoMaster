import type {
  AppSettings,
  McpChangeSummary,
  McpProjectChange,
  McpRollbackResult,
  McpStatus,
  ProjectAssetKind,
  ProjectAssetResult,
  ProjectDocument,
  ProjectImportResult,
  ProjectLoadResult,
  ProjectMeta,
  ProjectRecoverySnapshot,
  ProjectTemplateSummary,
} from './electron/project-contract';
import type { UpdateState } from './electron/update-contract.js';
import type {
  GlbImportCommitInput,
  GlbImportSession,
  ModelAssetManifest,
  ModelAssetMetadataUpdateInput,
  ModelAssetThumbnailUpdateInput,
  ModelAssetSummary,
  ParametricAssetSaveInput,
  ProjectModelAsset,
  ProjectModelAssetTransferResult,
} from './electron/model-asset-contract';

export interface McpFlushRequest {
  requestId: string;
  projectId: string;
}

declare global {
  interface Window {
    electronAPI: {
      getAndroidRelease?: () => Promise<{ version: string; url: string } | null>;
      // Dialog operations
      saveTextFile: (defaultName: string, content: string, filters?: Electron.FileFilter[]) => Promise<string | null>;
      saveBinaryFile: (defaultName: string, content: Uint8Array, filters?: Electron.FileFilter[]) => Promise<string | null>;
      beginBinaryFile: (defaultName: string, filters?: Electron.FileFilter[]) => Promise<string | null>;
      writeBinaryFileChunk: (sessionId: string, content: Uint8Array, position: number) => Promise<void>;
      closeBinaryFile: (sessionId: string) => Promise<void>;
      abortBinaryFile: (sessionId: string) => Promise<void>;
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

      modelAssets: {
        list: () => Promise<ModelAssetSummary[]>;
        get: (assetId: string) => Promise<ModelAssetManifest>;
        saveParametric: (input: ParametricAssetSaveInput) => Promise<ModelAssetManifest>;
        updateMetadata: (input: ModelAssetMetadataUpdateInput) => Promise<ModelAssetManifest>;
        updateThumbnail: (input: ModelAssetThumbnailUpdateInput) => Promise<ModelAssetManifest>;
        beginGlbImport: () => Promise<GlbImportSession | null>;
        commitGlbImport: (sessionId: string, input: GlbImportCommitInput) => Promise<ModelAssetManifest>;
        cancelGlbImport: (sessionId: string) => Promise<void>;
        duplicate: (assetId: string) => Promise<ModelAssetManifest>;
        delete: (assetId: string) => Promise<void>;
        materialize: (projectId: string, assetId: string, expectedRevision?: number) => Promise<ProjectModelAsset>;
        transferProjectAssets: (
          sourceProjectId: string,
          targetProjectId: string,
          assets: Record<string, ProjectModelAsset>,
        ) => Promise<ProjectModelAssetTransferResult>;
      };

      // Update operations
      update: {
        getState: () => Promise<UpdateState>;
        check: () => Promise<void>;
        download: () => Promise<void>;
        install: () => Promise<void>;
        onStateChanged: (callback: (state: UpdateState) => void) => () => void;
      };

      // MCP service events（内嵌 MCP 服务的推送通道 + 配置面板能力）
      mcp: {
        onProjectUpdated: (callback: (change: McpProjectChange) => void) => () => void;
        onOpenProject: (callback: (projectId: string) => void) => () => void;
        onFlushRequest: (callback: (request: McpFlushRequest) => void) => () => void;
        ackFlush: (requestId: string, ok: boolean) => Promise<void>;
        getStatus: () => Promise<McpStatus>;
        setEnabled: (enabled: boolean) => Promise<McpStatus>;
        listChanges: (projectId?: string) => Promise<McpChangeSummary[]>;
        rollbackTo: (changeId: string) => Promise<McpRollbackResult>;
        undoLast: (projectId?: string) => Promise<{ projectId: string; description: string }>;
      };

      // System information
      isElectron: boolean;
      platform: string;
      getAppVersion: () => Promise<string>;
    };
  }
}

export {};
