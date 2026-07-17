import { useCallback } from 'react';
import type { ProjectLoadResult } from '../types';

interface UseProjectTransfersOptions {
  currentProjectId: string | null;
  saveBeforeProjectOperation: () => Promise<boolean>;
  applyLoadedProject: (projectId: string, result: ProjectLoadResult) => Promise<void>;
  setMessages: (messages: string[]) => void;
}

interface ProjectTransfers {
  importProjectPackage: () => Promise<void>;
  importChoreography: () => Promise<void>;
  exportProjectPackage: () => Promise<boolean>;
  exportChoreography: () => Promise<boolean>;
  restoreRecoverySnapshot: (snapshotId: string) => Promise<boolean>;
}

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

export function useProjectTransfers({
  currentProjectId,
  saveBeforeProjectOperation,
  applyLoadedProject,
  setMessages,
}: UseProjectTransfersOptions): ProjectTransfers {
  const importProjectPackage = useCallback(async (): Promise<void> => {
    if (!window.electronAPI?.isElectron) return;
    if (!await saveBeforeProjectOperation()) return;
    try {
      const result = await window.electronAPI.project.importPackage();
      if (result) await applyLoadedProject(result.projectId, result);
    } catch (error) {
      console.error('Project package import failed:', error);
      setMessages(['项目包导入失败，文件可能损坏或格式不受支持']);
    }
  }, [applyLoadedProject, saveBeforeProjectOperation, setMessages]);

  const importChoreography = useCallback(async (): Promise<void> => {
    if (!window.electronAPI?.isElectron) return;
    if (!await saveBeforeProjectOperation()) return;
    try {
      const result = await window.electronAPI.project.importChoreography();
      if (result) await applyLoadedProject(result.projectId, result);
    } catch (error) {
      console.error('Choreography JSON import failed:', error);
      setMessages(['编排 JSON 导入失败，请确认文件由 CosStage 编排导出功能生成']);
    }
  }, [applyLoadedProject, saveBeforeProjectOperation, setMessages]);

  const exportProjectPackage = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI?.isElectron || !currentProjectId) {
      setMessages(['请先创建或打开桌面项目，再导出完整项目包']);
      return false;
    }
    try {
      if (!await saveBeforeProjectOperation()) return false;
      const exportedPath = await window.electronAPI.project.exportPackage(currentProjectId);
      if (!exportedPath) return false;
      setMessages([`完整项目包已导出：${exportedPath}`]);
      return true;
    } catch (error) {
      console.error('Project package export failed:', error);
      setMessages([`完整项目包导出失败：${errorMessage(error)}`]);
      return false;
    }
  }, [currentProjectId, saveBeforeProjectOperation, setMessages]);

  const exportChoreography = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI?.isElectron || !currentProjectId) {
      setMessages(['请先创建或打开桌面项目，再导出编排 JSON']);
      return false;
    }
    try {
      if (!await saveBeforeProjectOperation()) return false;
      const exportedPath = await window.electronAPI.project.exportChoreography(currentProjectId);
      if (!exportedPath) return false;
      setMessages([`编排 JSON 已导出：${exportedPath}`]);
      return true;
    } catch (error) {
      console.error('Choreography export failed:', error);
      setMessages([`编排 JSON 导出失败：${errorMessage(error)}`]);
      return false;
    }
  }, [currentProjectId, saveBeforeProjectOperation, setMessages]);

  const restoreRecoverySnapshot = useCallback(async (snapshotId: string): Promise<boolean> => {
    if (!window.electronAPI?.isElectron) return false;
    if (!await saveBeforeProjectOperation()) return false;
    try {
      const result = await window.electronAPI.project.restoreRecoverySnapshot(snapshotId);
      await applyLoadedProject(result.projectId, result);
      setMessages(['恢复版本已作为新项目打开，原项目未被修改']);
      return true;
    } catch (error) {
      console.error('Project recovery failed:', error);
      setMessages([`项目恢复失败：${errorMessage(error)}`]);
      return false;
    }
  }, [applyLoadedProject, saveBeforeProjectOperation, setMessages]);

  return {
    importProjectPackage,
    importChoreography,
    exportProjectPackage,
    exportChoreography,
    restoreRecoverySnapshot,
  };
}
