import { createReadStream, createWriteStream, promises as fs } from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import * as archiver from 'archiver';
import unzipper from 'unzipper';
import { normalizeFrames, normalizePerformers, normalizeTransitions } from './project-contract.js';
import type {
  AudioMarker,
  FaceTexture,
  Performer,
  ProjectAssetKind,
  ProjectAssetResult,
  ProjectDocument,
  ProjectImportResult,
  ProjectLoadResult,
  ProjectWarning,
  StageConfig,
} from './project-contract.js';

const PROJECT_VERSION = '3.0';
const PROJECT_FILE_NAME = 'project.json';
const ASSET_DIRECTORIES: Record<ProjectAssetKind, string> = {
  audio: 'assets/audio',
  background: 'assets/backgrounds',
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeName(value: string): string {
  const safe = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ');
  return safe || 'CosStage Project';
}

function parseAudioMarkers(value: unknown): AudioMarker[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    if (!isRecord(item) || typeof item.timeMs !== 'number' || !Number.isFinite(item.timeMs)) {
      return [];
    }
    const label = typeof item.label === 'string' ? item.label.trim().slice(0, 80) : '';
    const color = typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)
      ? item.color
      : '#3b82f6';
    const timeMs = Math.max(0, Math.round(item.timeMs));
    const id = typeof item.id === 'string' && item.id.trim()
      ? item.id.trim().slice(0, 120)
      : `marker-${index}-${timeMs}`;
    return [{
      id,
      label: label || `标记 ${index + 1}`,
      timeMs,
      color,
    }];
  }).sort((a, b) => a.timeMs - b.timeMs);
}

function createProjectId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'project'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

function resolveInside(basePath: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) throw new Error(`Invalid project asset path: ${relativePath}`);
  const base = path.resolve(basePath);
  const resolved = path.resolve(base, normalized);
  const relative = path.relative(base, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Project path escapes its root: ${relativePath}`);
  }
  return resolved;
}

function parseProjectDocument(value: unknown, fallbackName: string): ProjectDocument {
  if (!isRecord(value)) throw new Error('Project file must contain an object');
  if (!Array.isArray(value.performers) || !Array.isArray(value.frames)) {
    throw new Error('Project file is missing performers or frames');
  }
  const rawStageConfig = isRecord(value.stageConfig) ? value.stageConfig : {};
  const stageConfig: StageConfig = {
    width: typeof rawStageConfig.width === 'number' ? rawStageConfig.width : 20,
    depth: typeof rawStageConfig.depth === 'number' ? rawStageConfig.depth : 11.25,
    wingWidth: typeof rawStageConfig.wingWidth === 'number' ? rawStageConfig.wingWidth : undefined,
    ledWidth: typeof rawStageConfig.ledWidth === 'number' ? rawStageConfig.ledWidth : undefined,
    ledHeight: typeof rawStageConfig.ledHeight === 'number' ? rawStageConfig.ledHeight : 6,
    ledContent: isRecord(rawStageConfig.ledContent)
      ? rawStageConfig.ledContent as unknown as StageConfig['ledContent']
      : { type: 'none' },
  };
  return {
    version: typeof value.version === 'string' ? value.version : '1.0',
    name: sanitizeName(typeof value.name === 'string' ? value.name : fallbackName),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
    musicName: typeof value.musicName === 'string' ? value.musicName : null,
    musicAsset: typeof value.musicAsset === 'string' ? value.musicAsset : null,
    performers: normalizePerformers(value.performers),
    performerGroups: Array.isArray(value.performerGroups)
      ? value.performerGroups as ProjectDocument['performerGroups']
      : [],
    frames: normalizeFrames(value.frames),
    transitions: normalizeTransitions(value.transitions),
    audioMarkers: parseAudioMarkers(value.audioMarkers),
    stageConfig,
  };
}

function decodeDataUrl(dataUrl: string): { extension: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const extensionByMime: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  const extension = extensionByMime[match[1] || ''] || '.bin';
  const buffer = match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  return { extension, buffer };
}

async function persistFaceTexture(
  projectDir: string,
  performerId: string,
  slot: string,
  texture: FaceTexture | undefined,
): Promise<FaceTexture | undefined> {
  if (!texture?.dataUrl?.startsWith('data:')) return texture;
  const decoded = decodeDataUrl(texture.dataUrl);
  if (!decoded) return texture;
  const relativePath = `assets/props/${performerId}-${slot}-${Date.now()}${decoded.extension}`;
  const targetPath = resolveInside(projectDir, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, decoded.buffer);
  return { assetPath: relativePath, fileName: texture.fileName };
}

async function externalizePerformerTextures(projectDir: string, performer: Performer): Promise<Performer> {
  const next: Performer = { ...performer };
  if (next.textureDataUrl?.startsWith('data:')) {
    const decoded = decodeDataUrl(next.textureDataUrl);
    if (decoded) {
      const relativePath = `assets/props/${next.id}-legacy-${Date.now()}${decoded.extension}`;
      const targetPath = resolveInside(projectDir, relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, decoded.buffer);
      next.textureAssetPath = relativePath;
      delete next.textureDataUrl;
    }
  }
  if (next.boxTextures) {
    const entries = await Promise.all(Object.entries(next.boxTextures).map(async ([slot, texture]) => [
      slot,
      await persistFaceTexture(projectDir, next.id, slot, texture),
    ] as const));
    next.boxTextures = Object.fromEntries(entries);
  }
  if (next.extrudedTextures) {
    const entries = await Promise.all(Object.entries(next.extrudedTextures).map(async ([slot, texture]) => [
      slot,
      await persistFaceTexture(projectDir, next.id, slot, texture),
    ] as const));
    next.extrudedTextures = Object.fromEntries(entries);
  }
  return next;
}

function assetUrl(projectId: string, relativePath: string): string {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  return `choreo-asset://asset/${encodeURIComponent(projectId)}/${encodedPath}`;
}

async function assetExists(projectDir: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(resolveInside(projectDir, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function hydrateProject(
  projectId: string,
  projectDir: string,
  document: ProjectDocument,
): Promise<ProjectLoadResult> {
  const warnings: ProjectWarning[] = [];
  const mediaUrls: Record<string, string> = {};
  let audioUrl: string | null = null;

  if (document.musicAsset) {
    if (await assetExists(projectDir, document.musicAsset)) {
      audioUrl = assetUrl(projectId, document.musicAsset);
    } else {
      warnings.push({
        code: 'missing_asset',
        resource: document.musicAsset,
        message: `音频资源缺失：${document.musicAsset}`,
      });
    }
  } else if (document.musicName) {
    warnings.push({
      code: 'legacy_resource_missing',
      resource: document.musicName,
      message: `旧项目未包含音频文件：${document.musicName}`,
    });
  }

  const ledValue = document.stageConfig.ledContent?.value;
  if (ledValue && document.stageConfig.ledContent?.type !== 'color') {
    if (await assetExists(projectDir, ledValue)) {
      mediaUrls[ledValue] = assetUrl(projectId, ledValue);
    } else {
      warnings.push({
        code: 'missing_asset',
        resource: ledValue,
        message: `背景资源缺失：${ledValue}`,
      });
    }
  }

  const hydrateTexture = async (texture: FaceTexture | undefined): Promise<FaceTexture | undefined> => {
    if (!texture?.assetPath) return texture;
    if (await assetExists(projectDir, texture.assetPath)) {
      return { ...texture, dataUrl: assetUrl(projectId, texture.assetPath) };
    }
    warnings.push({
      code: 'missing_asset',
      resource: texture.assetPath,
      message: `道具贴图缺失：${texture.assetPath}`,
    });
    return { fileName: texture.fileName };
  };

  const performers = await Promise.all(document.performers.map(async (performer) => {
    const next: Performer = { ...performer };
    if (next.textureAssetPath) {
      if (await assetExists(projectDir, next.textureAssetPath)) {
        next.textureDataUrl = assetUrl(projectId, next.textureAssetPath);
      } else {
        warnings.push({
          code: 'missing_asset',
          resource: next.textureAssetPath,
          message: `道具贴图缺失：${next.textureAssetPath}`,
        });
      }
    }
    if (next.boxTextures) {
      const entries = await Promise.all(Object.entries(next.boxTextures).map(async ([slot, texture]) => [
        slot,
        await hydrateTexture(texture),
      ] as const));
      next.boxTextures = Object.fromEntries(entries);
    }
    if (next.extrudedTextures) {
      const entries = await Promise.all(Object.entries(next.extrudedTextures).map(async ([slot, texture]) => [
        slot,
        await hydrateTexture(texture),
      ] as const));
      next.extrudedTextures = Object.fromEntries(entries);
    }
    return next;
  }));

  return {
    data: { ...document, performers },
    projectPath: projectDir,
    audioUrl,
    mediaUrls,
    warnings,
  };
}

export async function createManagedProject(
  storagePath: string,
  name: string,
): Promise<{ id: string; path: string }> {
  const safeName = sanitizeName(name);
  const id = createProjectId(safeName);
  const projectDir = path.join(storagePath, 'projects', id);
  await fs.mkdir(path.join(projectDir, 'assets/audio'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'assets/backgrounds'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'assets/props'), { recursive: true });
  const now = new Date().toISOString();
  const project: ProjectDocument = {
    version: PROJECT_VERSION,
    name: safeName,
    createdAt: now,
    updatedAt: now,
    musicName: null,
    musicAsset: null,
    performers: [],
    performerGroups: [],
    frames: [],
    audioMarkers: [],
    stageConfig: {
      width: 20,
      depth: 11.25,
      ledHeight: 6,
      ledContent: { type: 'none' },
    },
  };
  await fs.writeFile(path.join(projectDir, PROJECT_FILE_NAME), JSON.stringify(project, null, 2), 'utf8');
  return { id, path: projectDir };
}

export async function saveManagedProject(
  storagePath: string,
  projectId: string,
  projectData: ProjectDocument,
): Promise<ProjectDocument> {
  const projectDir = path.join(storagePath, 'projects', projectId);
  const projectPath = path.join(projectDir, PROJECT_FILE_NAME);
  const existing = parseProjectDocument(JSON.parse(await fs.readFile(projectPath, 'utf8')) as unknown, projectData.name);
  const performers = await Promise.all(
    projectData.performers.map((performer) => externalizePerformerTextures(projectDir, performer)),
  );
  const document: ProjectDocument = {
    ...projectData,
    version: PROJECT_VERSION,
    name: projectData.name ? sanitizeName(projectData.name) : existing.name,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    performers,
    audioMarkers: parseAudioMarkers(projectData.audioMarkers),
  };
  await fs.writeFile(projectPath, JSON.stringify(document, null, 2), 'utf8');
  return document;
}

export async function loadManagedProject(
  storagePath: string,
  projectId: string,
): Promise<ProjectLoadResult> {
  const projectDir = path.join(storagePath, 'projects', projectId);
  const raw = JSON.parse(await fs.readFile(path.join(projectDir, PROJECT_FILE_NAME), 'utf8')) as unknown;
  return hydrateProject(projectId, projectDir, parseProjectDocument(raw, projectId));
}

export async function ingestProjectAsset(
  storagePath: string,
  projectId: string,
  sourcePath: string,
  kind: ProjectAssetKind,
): Promise<ProjectAssetResult> {
  const projectDir = path.join(storagePath, 'projects', projectId);
  const extension = path.extname(sourcePath);
  const baseName = path.basename(sourcePath, extension).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-');
  const storedName = `${baseName || kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension.toLowerCase()}`;
  const relativePath = `${ASSET_DIRECTORIES[kind]}/${storedName}`;
  const targetPath = resolveInside(projectDir, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  return {
    relativePath,
    displayName: path.basename(sourcePath),
    url: assetUrl(projectId, relativePath),
  };
}

export async function exportProjectPackage(projectDir: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const output = createWriteStream(targetPath);
  const archive = new archiver.ZipArchive({ zlib: { level: 6 } });
  const completion = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  archive.directory(projectDir, false);
  await archive.finalize();
  await completion;
}

async function extractPackage(packagePath: string, targetDir: string): Promise<void> {
  const archive = createReadStream(packagePath).pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of archive) {
    const item = entry as unzipper.Entry;
    const normalized = normalizeRelativePath(item.path);
    if (!normalized) {
      item.autodrain();
      throw new Error(`Unsafe archive entry: ${item.path}`);
    }
    const targetPath = resolveInside(targetDir, normalized);
    if (item.type === 'Directory') {
      await fs.mkdir(targetPath, { recursive: true });
      item.autodrain();
    } else {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await pipeline(item, createWriteStream(targetPath));
    }
  }
}

export async function importProjectPackage(
  storagePath: string,
  packagePath: string,
): Promise<ProjectImportResult> {
  const stagingRoot = path.join(storagePath, '.import-staging');
  await fs.mkdir(stagingRoot, { recursive: true });
  const stagingDir = await fs.mkdtemp(path.join(stagingRoot, 'project-'));
  let installedDir: string | null = null;
  try {
    await extractPackage(packagePath, stagingDir);
    const raw = JSON.parse(await fs.readFile(path.join(stagingDir, PROJECT_FILE_NAME), 'utf8')) as unknown;
    const document = parseProjectDocument(raw, path.basename(packagePath, path.extname(packagePath)));
    const id = createProjectId(document.name);
    installedDir = path.join(storagePath, 'projects', id);
    await fs.mkdir(path.dirname(installedDir), { recursive: true });
    const importedDocument: ProjectDocument = {
      ...document,
      version: PROJECT_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(stagingDir, PROJECT_FILE_NAME),
      JSON.stringify(importedDocument, null, 2),
      'utf8',
    );
    await fs.rename(stagingDir, installedDir);
    return { projectId: id, ...await hydrateProject(id, installedDir, importedDocument) };
  } catch (error) {
    if (installedDir) await fs.rm(installedDir, { recursive: true, force: true });
    throw error;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}

export async function importLegacyProject(
  storagePath: string,
  jsonPath: string,
): Promise<ProjectImportResult> {
  const raw = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as unknown;
  const document = parseProjectDocument(raw, path.basename(jsonPath, path.extname(jsonPath)));
  const created = await createManagedProject(storagePath, document.name);
  try {
    await saveManagedProject(storagePath, created.id, {
      ...document,
      version: PROJECT_VERSION,
      musicAsset: null,
    });
    return { projectId: created.id, ...await loadManagedProject(storagePath, created.id) };
  } catch (error) {
    await fs.rm(created.path, { recursive: true, force: true });
    throw error;
  }
}

export function resolveProjectAssetPath(
  storagePath: string,
  projectId: string,
  relativePath: string,
): string {
  return resolveInside(path.join(storagePath, 'projects', projectId), relativePath);
}
