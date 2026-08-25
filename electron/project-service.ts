import { createReadStream, createWriteStream, promises as fs } from 'fs';
import * as path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import * as archiver from 'archiver';
import unzipper from 'unzipper';
import { normalizeFrames, normalizePerformers, normalizeTransitions } from './project-contract.js';
import type {
  AudioMarker,
  ChoreographyDocument,
  FaceTexture,
  Performer,
  PerformerNote,
  ProjectAssetKind,
  ProjectAssetResult,
  ProjectDocument,
  ProjectImportResult,
  ProjectLoadResult,
  ProjectMeta,
  ProjectRecoverySnapshot,
  ProjectWarning,
  StageBackground,
  StageConfig,
} from './project-contract.js';
import {
  DEFAULT_PERFORMER_LABEL_FONT_SIZE,
  DEFAULT_PROP_LABEL_FONT_SIZE,
  normalizeLabelFontSize,
} from './stage-defaults.js';

const PROJECT_VERSION = '3.0';
const PROJECT_FILE_NAME = 'project.json';
const MAX_PACKAGE_ENTRIES = 500;
const MAX_PACKAGE_EXTRACTED_BYTES = 512 * 1024 * 1024;
const RECOVERY_DIRECTORY_NAME = 'recovery';
const MAX_RECOVERY_SNAPSHOTS = 5;
let recoverySequence = 0;
const ASSET_DIRECTORIES: Record<ProjectAssetKind, string> = {
  audio: 'assets/audio',
  background: 'assets/backgrounds',
  'stage-background': 'assets/stage-backgrounds',
};

type UnknownRecord = Record<string, unknown>;

interface RecoverySnapshotFile extends ProjectRecoverySnapshot {
  document: ProjectDocument;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeName(value: string): string {
  const safe = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ');
  return safe || 'CosStage Project';
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const content = JSON.stringify(value, null, 2);
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
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

export function resolveManagedProjectPath(storagePath: string, projectId: string): string {
  if (!/^[a-zA-Z0-9\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff-]{0,159}$/u.test(projectId)) {
    throw new Error('Invalid project ID');
  }
  return resolveInside(path.join(storagePath, 'projects'), projectId);
}

function resolveRecoveryProjectPath(storagePath: string, projectId: string): string {
  resolveManagedProjectPath(storagePath, projectId);
  return resolveInside(path.join(storagePath, RECOVERY_DIRECTORY_NAME), projectId);
}

function hasRecoverableContent(document: ProjectDocument): boolean {
  return document.performers.length > 0
    || document.frames.length > 0
    || Boolean(document.musicAsset)
    || Boolean(document.stageConfig.background)
    || Boolean(document.stageConfig.ledContent?.value);
}

async function createRecoverySnapshot(
  storagePath: string,
  projectId: string,
  document: ProjectDocument,
): Promise<void> {
  const recoveryDir = resolveRecoveryProjectPath(storagePath, projectId);
  await fs.mkdir(recoveryDir, { recursive: true });
  const createdAt = Date.now();
  const fileName = `${Date.now()}-${String(recoverySequence++).padStart(6, '0')}.json`;
  const snapshot: RecoverySnapshotFile = {
    id: `${projectId}/${fileName}`,
    sourceProjectId: projectId,
    projectName: document.name,
    createdAt,
    document,
  };
  await writeJsonAtomically(path.join(recoveryDir, fileName), snapshot);
  const entries = (await fs.readdir(recoveryDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((a, b) => b.name.localeCompare(a.name));
  await Promise.all(entries.slice(MAX_RECOVERY_SNAPSHOTS).map((entry) => (
    fs.rm(path.join(recoveryDir, entry.name), { force: true })
  )));
}

async function readRecoverySnapshot(storagePath: string, snapshotId: string): Promise<RecoverySnapshotFile> {
  const normalized = normalizeRelativePath(snapshotId);
  const parts = normalized?.split('/') ?? [];
  if (parts.length !== 2 || !parts[1].endsWith('.json')) {
    throw new Error('Invalid recovery snapshot ID');
  }
  resolveManagedProjectPath(storagePath, parts[0]);
  const snapshotPath = resolveInside(path.join(storagePath, RECOVERY_DIRECTORY_NAME), snapshotId);
  const raw = JSON.parse(await fs.readFile(snapshotPath, 'utf8')) as unknown;
  if (!isRecord(raw)) throw new Error('Invalid recovery snapshot');
  const createdAt = typeof raw.createdAt === 'number'
    ? raw.createdAt
    : typeof raw.createdAt === 'string'
      ? Date.parse(raw.createdAt)
      : Number.NaN;
  if (raw.id !== snapshotId
    || raw.sourceProjectId !== parts[0]
    || typeof raw.projectName !== 'string'
    || !Number.isFinite(createdAt)) {
    throw new Error('Invalid recovery snapshot');
  }
  return {
    id: snapshotId,
    sourceProjectId: parts[0],
    projectName: raw.projectName,
    createdAt,
    document: parseProjectDocument(raw.document, raw.projectName),
  };
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(source, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await fs.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

function parseStageBackground(value: unknown): StageBackground | undefined {
  if (!isRecord(value) || typeof value.value !== 'string' || !value.value) return undefined;
  const pixelWidth = typeof value.pixelWidth === 'number' && Number.isFinite(value.pixelWidth) && value.pixelWidth > 0
    ? value.pixelWidth
    : 1;
  const pixelHeight = typeof value.pixelHeight === 'number' && Number.isFinite(value.pixelHeight) && value.pixelHeight > 0
    ? value.pixelHeight
    : 1;
  const opacity = typeof value.opacity === 'number' && Number.isFinite(value.opacity)
    ? Math.max(0, Math.min(1, value.opacity))
    : 0.5;
  return { value: value.value, opacity, pixelWidth, pixelHeight };
}

function parsePerformerNotes(raw: unknown): PerformerNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n: any) => n && typeof n.id === 'string' && typeof n.performerId === 'string')
    .map((n: any) => ({
      id: String(n.id),
      performerId: String(n.performerId),
      frameId: typeof n.frameId === 'string' ? n.frameId : undefined,
      content: typeof n.content === 'string' ? n.content : '',
      items: Array.isArray(n.items)
        ? n.items
            .filter((i: any) => i && typeof i.id === 'string')
            .map((i: any) => ({
              id: String(i.id),
              name: typeof i.name === 'string' ? i.name : '',
              type: i.type === 'carry' || i.type === 'handoff' || i.type === 'event'
                ? i.type
                : ('event' as const),
              description: typeof i.description === 'string' ? i.description : undefined,
              frameId: typeof i.frameId === 'string' ? i.frameId : undefined,
            }))
        : [],
      createdAt: typeof n.createdAt === 'number' ? n.createdAt : 0,
      updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : 0,
    }));
}

function parseProjectDocument(value: unknown, fallbackName: string): ProjectDocument {
  if (!isRecord(value)) throw new Error('Project file must contain an object');
  if (!Array.isArray(value.performers) || !Array.isArray(value.frames)) {
    throw new Error('Project file is missing performers or frames');
  }
  const rawStageConfig = isRecord(value.stageConfig) ? value.stageConfig : {};
  const depth = typeof rawStageConfig.depth === 'number' && Number.isFinite(rawStageConfig.depth)
    ? Math.max(1, rawStageConfig.depth)
    : 11.25;
  const ledDistanceFromBack = typeof rawStageConfig.ledDistanceFromBack === 'number'
    && Number.isFinite(rawStageConfig.ledDistanceFromBack)
    ? Math.max(0, Math.min(depth, rawStageConfig.ledDistanceFromBack))
    : 0;
  const ledBottomHeight = typeof rawStageConfig.ledBottomHeight === 'number'
    && Number.isFinite(rawStageConfig.ledBottomHeight)
    ? Math.max(0, Math.min(30, rawStageConfig.ledBottomHeight))
    : 0;
  const stageConfig: StageConfig = {
    width: typeof rawStageConfig.width === 'number' ? rawStageConfig.width : 20,
    depth,
    wingWidth: typeof rawStageConfig.wingWidth === 'number' ? rawStageConfig.wingWidth : undefined,
    ledWidth: typeof rawStageConfig.ledWidth === 'number' ? rawStageConfig.ledWidth : undefined,
    ledHeight: typeof rawStageConfig.ledHeight === 'number' ? rawStageConfig.ledHeight : 6,
    ledBottomHeight,
    ledContent: isRecord(rawStageConfig.ledContent)
      ? rawStageConfig.ledContent as unknown as StageConfig['ledContent']
      : { type: 'none' },
    background: parseStageBackground(rawStageConfig.background),
    showStageLines: rawStageConfig.showStageLines !== false,
    ledDistanceFromBack,
    performerLabelFontSize: normalizeLabelFontSize(
      typeof rawStageConfig.performerLabelFontSize === 'number'
        ? rawStageConfig.performerLabelFontSize
        : undefined,
      DEFAULT_PERFORMER_LABEL_FONT_SIZE,
    ),
    propLabelFontSize: normalizeLabelFontSize(
      typeof rawStageConfig.propLabelFontSize === 'number'
        ? rawStageConfig.propLabelFontSize
        : undefined,
      DEFAULT_PROP_LABEL_FONT_SIZE,
    ),
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
    performerNotes: parsePerformerNotes(value.performerNotes),
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

async function externalizeStageBackground(
  projectDir: string,
  background: StageBackground | undefined,
): Promise<StageBackground | undefined> {
  if (!background?.value.startsWith('data:')) return background;
  const decoded = decodeDataUrl(background.value);
  if (!decoded) return background;
  const relativePath = `assets/stage-backgrounds/stage-${Date.now()}${decoded.extension}`;
  const targetPath = resolveInside(projectDir, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, decoded.buffer);
  return { ...background, value: relativePath };
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

  const stageBackgroundValue = document.stageConfig.background?.value;
  if (stageBackgroundValue && !stageBackgroundValue.startsWith('data:')) {
    if (await assetExists(projectDir, stageBackgroundValue)) {
      mediaUrls[stageBackgroundValue] = assetUrl(projectId, stageBackgroundValue);
    } else {
      warnings.push({
        code: 'missing_asset',
        resource: stageBackgroundValue,
        message: `舞台底图资源缺失：${stageBackgroundValue}`,
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
  const projectDir = resolveManagedProjectPath(storagePath, id);
  await fs.mkdir(path.join(projectDir, 'assets/audio'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'assets/backgrounds'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'assets/stage-backgrounds'), { recursive: true });
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
      ledBottomHeight: 0,
      ledContent: { type: 'none' },
    },
  };
  await writeJsonAtomically(path.join(projectDir, PROJECT_FILE_NAME), project);
  return { id, path: projectDir };
}

export async function saveManagedProject(
  storagePath: string,
  projectId: string,
  projectData: ProjectDocument,
): Promise<ProjectDocument> {
  const projectDir = resolveManagedProjectPath(storagePath, projectId);
  const projectPath = path.join(projectDir, PROJECT_FILE_NAME);
  const existing = parseProjectDocument(JSON.parse(await fs.readFile(projectPath, 'utf8')) as unknown, projectData.name);
  if (hasRecoverableContent(existing)) {
    await createRecoverySnapshot(storagePath, projectId, existing);
  }
  const performers = await Promise.all(
    projectData.performers.map((performer) => externalizePerformerTextures(projectDir, performer)),
  );
  const background = await externalizeStageBackground(projectDir, projectData.stageConfig.background);
  const document: ProjectDocument = {
    ...projectData,
    version: PROJECT_VERSION,
    name: projectData.name ? sanitizeName(projectData.name) : existing.name,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    performers,
    audioMarkers: parseAudioMarkers(projectData.audioMarkers),
    stageConfig: {
      ...projectData.stageConfig,
      background,
      showStageLines: projectData.stageConfig.showStageLines !== false,
      ledDistanceFromBack: Math.max(0, Math.min(
        projectData.stageConfig.depth,
        projectData.stageConfig.ledDistanceFromBack ?? 0,
      )),
      ledBottomHeight: Math.max(0, Math.min(30, projectData.stageConfig.ledBottomHeight ?? 0)),
    },
  };
  await writeJsonAtomically(projectPath, document);
  return document;
}

export async function loadManagedProject(
  storagePath: string,
  projectId: string,
): Promise<ProjectLoadResult> {
  const projectDir = resolveManagedProjectPath(storagePath, projectId);
  const raw = JSON.parse(await fs.readFile(path.join(projectDir, PROJECT_FILE_NAME), 'utf8')) as unknown;
  return hydrateProject(projectId, projectDir, parseProjectDocument(raw, projectId));
}

export async function listManagedProjects(storagePath: string): Promise<ProjectMeta[]> {
  const projectsDir = path.join(storagePath, 'projects');
  await fs.mkdir(projectsDir, { recursive: true });
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const projects: ProjectMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const projectDir = resolveManagedProjectPath(storagePath, entry.name);
      const projectPath = path.join(projectDir, PROJECT_FILE_NAME);
      const raw = JSON.parse(await fs.readFile(projectPath, 'utf8')) as unknown;
      const document = parseProjectDocument(raw, entry.name);
      const stats = await fs.stat(projectPath);
      const createdAt = document.createdAt && Number.isFinite(Date.parse(document.createdAt))
        ? document.createdAt
        : stats.birthtime.toISOString();
      const updatedAt = document.updatedAt && Number.isFinite(Date.parse(document.updatedAt))
        ? document.updatedAt
        : stats.mtime.toISOString();
      projects.push({
        id: entry.name,
        name: document.name,
        createdAt,
        updatedAt,
        thumbnail: isRecord(raw) && typeof raw.thumbnail === 'string' ? raw.thumbnail : undefined,
      });
    } catch {
      // A corrupt or unrelated directory must not hide the remaining projects.
    }
  }

  return projects.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function deleteManagedProject(storagePath: string, projectId: string): Promise<void> {
  await Promise.all([
    fs.rm(resolveManagedProjectPath(storagePath, projectId), { recursive: true, force: true }),
    fs.rm(resolveRecoveryProjectPath(storagePath, projectId), { recursive: true, force: true }),
  ]);
}

export async function renameManagedProject(
  storagePath: string,
  projectId: string,
  newName: string,
): Promise<void> {
  const projectDir = resolveManagedProjectPath(storagePath, projectId);
  const raw = JSON.parse(await fs.readFile(path.join(projectDir, PROJECT_FILE_NAME), 'utf8')) as unknown;
  const document = parseProjectDocument(raw, projectId);
  await saveManagedProject(storagePath, projectId, { ...document, name: newName });
}

export async function duplicateManagedProject(
  storagePath: string,
  projectId: string,
): Promise<{ id: string; path: string }> {
  const sourceDir = resolveManagedProjectPath(storagePath, projectId);
  const raw = JSON.parse(await fs.readFile(path.join(sourceDir, PROJECT_FILE_NAME), 'utf8')) as unknown;
  const sourceDocument = parseProjectDocument(raw, projectId);
  const name = `${sourceDocument.name} (副本)`;
  const id = createProjectId(name);
  const destinationDir = resolveManagedProjectPath(storagePath, id);
  const stagingDir = resolveInside(path.join(storagePath, 'projects'), `.duplicate-${id}`);

  try {
    await copyDirectory(sourceDir, stagingDir);
    const now = new Date().toISOString();
    await writeJsonAtomically(path.join(stagingDir, PROJECT_FILE_NAME), {
      ...sourceDocument,
      name: sanitizeName(name),
      createdAt: now,
      updatedAt: now,
    });
    await fs.rename(stagingDir, destinationDir);
    return { id, path: destinationDir };
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

export async function ingestProjectAsset(
  storagePath: string,
  projectId: string,
  sourcePath: string,
  kind: ProjectAssetKind,
): Promise<ProjectAssetResult> {
  const projectDir = resolveManagedProjectPath(storagePath, projectId);
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
  let entryCount = 0;
  let extractedBytes = 0;
  for await (const entry of archive) {
    const item = entry as unzipper.Entry;
    entryCount += 1;
    if (entryCount > MAX_PACKAGE_ENTRIES) {
      item.autodrain();
      throw new Error(`Project package contains too many files (maximum ${MAX_PACKAGE_ENTRIES})`);
    }
    const normalized = normalizeRelativePath(item.path);
    if (!normalized) {
      item.autodrain();
      throw new Error(`Unsafe archive entry: ${item.path}`);
    }
    const targetPath = resolveInside(targetDir, normalized);
    if (item.type === 'Directory') {
      await fs.mkdir(targetPath, { recursive: true });
      item.autodrain();
    } else if (item.type === 'File') {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const byteLimit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          extractedBytes += chunk.length;
          if (extractedBytes > MAX_PACKAGE_EXTRACTED_BYTES) {
            callback(new Error('Project package is too large after extraction'));
            return;
          }
          callback(null, chunk);
        },
      });
      await pipeline(item, byteLimit, createWriteStream(targetPath));
    } else {
      item.autodrain();
      throw new Error(`Unsupported archive entry type: ${item.type}`);
    }
  }
}

export async function exportChoreographyDocument(
  storagePath: string,
  projectId: string,
  targetPath: string,
): Promise<void> {
  const projectDir = resolveManagedProjectPath(storagePath, projectId);
  const raw = JSON.parse(await fs.readFile(path.join(projectDir, PROJECT_FILE_NAME), 'utf8')) as unknown;
  const document = parseProjectDocument(raw, projectId);
  await writeJsonAtomically(targetPath, createChoreographyDocument(document));
}

export async function importChoreographyDocument(
  storagePath: string,
  jsonPath: string,
): Promise<ProjectImportResult> {
  const raw = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as unknown;
  const choreography = parseChoreographyDocument(
    raw,
    path.basename(jsonPath, path.extname(jsonPath)),
  );
  const created = await createManagedProject(storagePath, choreography.name);
  try {
    await saveManagedProject(storagePath, created.id, {
      version: PROJECT_VERSION,
      name: choreography.name,
      musicName: null,
      musicAsset: null,
      performers: choreography.performers,
      performerGroups: choreography.performerGroups,
      frames: choreography.frames,
      transitions: choreography.transitions,
      audioMarkers: choreography.audioMarkers,
      stageConfig: choreography.stageConfig,
      performerNotes: choreography.performerNotes,
    });
    return { projectId: created.id, ...await loadManagedProject(storagePath, created.id) };
  } catch (error) {
    await fs.rm(created.path, { recursive: true, force: true });
    throw error;
  }
}

export async function listProjectRecoverySnapshots(
  storagePath: string,
  projectId?: string,
): Promise<ProjectRecoverySnapshot[]> {
  const recoveryRoot = path.join(storagePath, RECOVERY_DIRECTORY_NAME);
  let projectIds: string[];
  if (projectId) {
    resolveManagedProjectPath(storagePath, projectId);
    projectIds = [projectId];
  } else {
    try {
      projectIds = (await fs.readdir(recoveryRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  const snapshots: ProjectRecoverySnapshot[] = [];
  for (const candidateProjectId of projectIds) {
    let files;
    try {
      files = await fs.readdir(resolveRecoveryProjectPath(storagePath, candidateProjectId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const fileName of files.filter((name) => name.endsWith('.json'))) {
      try {
        const snapshot = await readRecoverySnapshot(storagePath, `${candidateProjectId}/${fileName}`);
        snapshots.push({
          id: snapshot.id,
          sourceProjectId: snapshot.sourceProjectId,
          projectName: snapshot.projectName,
          createdAt: snapshot.createdAt,
        });
      } catch {
        // Ignore invalid recovery files while retaining other usable snapshots.
      }
    }
  }
  return snapshots.sort((a, b) => b.id.localeCompare(a.id));
}

export async function restoreProjectRecoverySnapshot(
  storagePath: string,
  snapshotId: string,
): Promise<ProjectImportResult> {
  const snapshot = await readRecoverySnapshot(storagePath, snapshotId);
  const restoredName = `${snapshot.projectName} (恢复)`;
  const created = await createManagedProject(storagePath, restoredName);
  try {
    const sourceProjectDir = resolveManagedProjectPath(storagePath, snapshot.sourceProjectId);
    await copyDirectory(path.join(sourceProjectDir, 'assets'), path.join(created.path, 'assets'));
    await saveManagedProject(storagePath, created.id, {
      ...snapshot.document,
      name: restoredName,
      createdAt: undefined,
      updatedAt: undefined,
    });
    return { projectId: created.id, ...await loadManagedProject(storagePath, created.id) };
  } catch (error) {
    await fs.rm(created.path, { recursive: true, force: true });
    throw error;
  }
}

function stripPerformerAssets(performer: Performer): Performer {
  const {
    boxTextures: _boxTextures,
    extrudedTextures: _extrudedTextures,
    textureAssetPath: _textureAssetPath,
    textureDataUrl: _textureDataUrl,
    ...portable
  } = performer;
  return portable;
}

function stripStageAssets(stageConfig: StageConfig): StageConfig {
  return {
    width: stageConfig.width,
    depth: stageConfig.depth,
    wingWidth: stageConfig.wingWidth,
    ledWidth: stageConfig.ledWidth,
    ledHeight: stageConfig.ledHeight,
    ledBottomHeight: stageConfig.ledBottomHeight,
    ledContent: stageConfig.ledContent?.type === 'color'
      ? stageConfig.ledContent
      : { type: 'none' },
    showStageLines: stageConfig.showStageLines,
    ledDistanceFromBack: stageConfig.ledDistanceFromBack,
    performerLabelFontSize: stageConfig.performerLabelFontSize,
    propLabelFontSize: stageConfig.propLabelFontSize,
  };
}

function createChoreographyDocument(document: ProjectDocument): ChoreographyDocument {
  return {
    format: 'cosstage-choreography',
    schemaVersion: 1,
    name: document.name,
    performers: document.performers.map(stripPerformerAssets),
    performerGroups: document.performerGroups,
    frames: document.frames,
    transitions: document.transitions ?? [],
    audioMarkers: document.audioMarkers ?? [],
    stageConfig: stripStageAssets(document.stageConfig),
    performerNotes: document.performerNotes ?? [],
  };
}

function parseChoreographyDocument(value: unknown, fallbackName: string): ChoreographyDocument {
  if (!isRecord(value)) {
    throw new Error('Unsupported choreography JSON format');
  }
  const hasChoreographyEnvelope = 'format' in value || 'schemaVersion' in value;
  if (hasChoreographyEnvelope
    && (value.format !== 'cosstage-choreography' || value.schemaVersion !== 1)) {
    throw new Error('Unsupported choreography JSON format');
  }
  const document = parseProjectDocument({
    ...value,
    version: PROJECT_VERSION,
    musicName: null,
    musicAsset: null,
  }, fallbackName);
  return createChoreographyDocument(document);
}

export async function importProjectPackage(
  storagePath: string,
  packagePath: string,
  options: { name?: string } = {},
): Promise<ProjectImportResult> {
  const stagingRoot = path.join(storagePath, '.import-staging');
  await fs.mkdir(stagingRoot, { recursive: true });
  const stagingDir = await fs.mkdtemp(path.join(stagingRoot, 'project-'));
  let installedDir: string | null = null;
  try {
    await extractPackage(packagePath, stagingDir);
    const raw = JSON.parse(await fs.readFile(path.join(stagingDir, PROJECT_FILE_NAME), 'utf8')) as unknown;
    const document = parseProjectDocument(raw, path.basename(packagePath, path.extname(packagePath)));
    const importedName = options.name ? sanitizeName(options.name) : document.name;
    const id = createProjectId(importedName);
    installedDir = resolveManagedProjectPath(storagePath, id);
    await fs.mkdir(path.dirname(installedDir), { recursive: true });
    const importedDocument: ProjectDocument = {
      ...document,
      name: importedName,
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

export function resolveProjectAssetPath(
  storagePath: string,
  projectId: string,
  relativePath: string,
): string {
  return resolveInside(resolveManagedProjectPath(storagePath, projectId), relativePath);
}
