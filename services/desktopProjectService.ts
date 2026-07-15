import type { ProjectDocument } from '../types';

export interface CreatedDesktopProject {
  id: string;
  path: string;
}

export async function createPersistedDesktopProject(
  name: string,
  document: ProjectDocument,
): Promise<CreatedDesktopProject> {
  if (!window.electronAPI?.isElectron) {
    throw new Error('Desktop project storage is unavailable');
  }

  const created = await window.electronAPI.project.create(name);
  try {
    await window.electronAPI.project.save(created.id, { ...document, name });
    return created;
  } catch (error) {
    try {
      await window.electronAPI.project.delete(created.id);
    } catch (cleanupError) {
      console.error('Failed to clean up incomplete desktop project:', cleanupError);
    }
    throw error;
  }
}
