import type { ProjectDocument } from '../types';
import { getMissingAssets, type PortableProject } from './project-package';

export interface MobileProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  actors: number;
  formations: number;
}
interface StoredProject extends MobileProjectMeta {
  document: ProjectDocument;
}
const DB_NAME = 'cosstage-mobile';
let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('projects', { keyPath: 'id' });
        request.result.createObjectStore('assets');
      };
      request.onerror = () => {
        connection = undefined;
        reject(request.error);
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          connection = undefined;
        };
        resolve(request.result);
      };
    });
  return connection;
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('本机存储写入失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('本机存储操作已取消'));
  });
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
export async function saveMobileProject(
  id: string,
  document: ProjectDocument,
  assets?: Record<string, Blob>
): Promise<void> {
  const db = await database();
  const transaction = db.transaction(assets ? ['projects', 'assets'] : ['projects'], 'readwrite');
  const done = completed(transaction);
  const value: StoredProject = {
    id,
    name: document.name,
    updatedAt: Date.now(),
    actors: document.performers.length,
    formations: document.frames.length,
    document,
  };
  try {
    transaction.objectStore('projects').put(value);
    if (assets) transaction.objectStore('assets').put(assets, id);
  } catch (error) {
    transaction.abort();
    await done.catch(() => undefined);
    throw error;
  }
  await done;
}
export async function listMobileProjects(): Promise<MobileProjectMeta[]> {
  const db = await database();
  const entries = await result<StoredProject[]>(db.transaction('projects').objectStore('projects').getAll());
  return entries.map(({ document: _, ...meta }) => meta).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function loadMobileProject(id: string): Promise<PortableProject> {
  const db = await database();
  const transaction = db.transaction(['projects', 'assets']);
  const [entry, assets] = await Promise.all([
    result<StoredProject | undefined>(transaction.objectStore('projects').get(id)),
    result<Record<string, Blob> | undefined>(transaction.objectStore('assets').get(id)),
  ]);
  if (!entry) throw new Error('找不到此项目');
  return {
    document: entry.document,
    assets: assets ?? {},
    warnings: getMissingAssets(entry.document, assets ?? {}),
  };
}
export async function deleteMobileProject(id: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['projects', 'assets'], 'readwrite');
  const done = completed(transaction);
  transaction.objectStore('projects').delete(id);
  transaction.objectStore('assets').delete(id);
  await done;
}
