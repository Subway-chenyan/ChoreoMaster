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
  recentProjects: string[];
  maxRecentProjects: number;
}

declare global {
  interface Window {
    electronAPI: {
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
      
      // System information
      isElectron: boolean;
      platform: string;
      version: string;
    };
  }
}

export {};
