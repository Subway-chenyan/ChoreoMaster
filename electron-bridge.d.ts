declare global {
  interface Window {
    electronAPI: {
      saveFile: (defaultName: string) => Promise<string | null>;
      openFile: (filters: Electron.FileFilter[]) => Promise<string | null>;
      openMultipleFiles: (filters: Electron.FileFilter[]) => Promise<string[]>;
      selectDirectory: () => Promise<string | null>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<void>;
      isElectron: boolean;
      platform: string;
      version: string;
    };
}

export {};
