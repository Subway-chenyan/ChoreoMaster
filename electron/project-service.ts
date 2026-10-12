import { createReadStream, createWriteStream, promises as fs } from 'fs';
import * as path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import * as archiver from 'archiver';
import unzipper from 'unzipper';
import { parseAudioMarkers, parseProjectDocument } from './project-document.js';
import { PROJECT_SCHEMA_VERSION } from './model-asset-contract.js';
import type {
  ChoreographyDocument,
  Performer,
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
import type { ModelAssetFile, ProjectModelAsset } from './model-asset-contract.js';

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

function assetUrl(projectId: string, relativePath: string): string {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  return `choreo-asset://asset/${encodeURIComponent(projectId)}/${encodedPath}`;
}

function dehydrateModelFile(file: ModelAssetFile | undefined): ModelAssetFile | undefined {
  if (!file) return undefined;
  return {
    assetPath: file.assetPath,
    ...(file.fileName ? { fileName: file.fileName } : {}),
  };
}

function dehydrateProjectModelAssets(
  assets: Record<string, ProjectModelAsset> | undefined,
): Record<string, ProjectModelAsset> {
  return Object.fromEntries(Object.entries(assets ?? {}).map(([id, asset]) => {
    const payload = asset.payload.kind === 'glb'
      ? { kind: 'glb' as const, file: dehydrateModelFile(asset.payload.file) as ModelAssetFile }
      : {
        kind: 'parametric' as const,
        recipe: {
          ...asset.payload.recipe,
          parts: asset.payload.recipe.parts.map((part) => ({
            ...part,
            material: {
              ...part.material,
              baseColorTexture: dehydrateModelFile(part.material.baseColorTexture),
            },
          })),
        },
      };
    return [id, {
      ...asset,
      thumbnail: dehydrateModelFile(asset.thumbnail),
      floorplan: dehydrateModelFile(asset.floorplan),
      payload,
    }];
  }));
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

  const performers = document.performers;

  const hydrateModelFile = async (
    file: ModelAssetFile | undefined,
    label: string,
  ): Promise<ModelAssetFile | undefined> => {
    if (!file?.assetPath) return file;
    if (await assetExists(projectDir, file.assetPath)) {
      return { ...file, runtimeUrl: assetUrl(projectId, file.assetPath) };
    }
    warnings.push({
      code: 'missing_asset',
      resource: file.assetPath,
      message: `${label}缺失：${file.assetPath}`,
    });
    return { assetPath: file.assetPath, fileName: file.fileName };
  };
  const modelAssetEntries = await Promise.all(Object.entries(document.modelAssets).map(async ([id, asset]) => {
    const payload = asset.payload.kind === 'glb'
      ? {
        kind: 'glb' as const,
        file: await hydrateModelFile(asset.payload.file, '3D 模型文件') ?? asset.payload.file,
      }
      : {
        kind: 'parametric' as const,
        recipe: {
          ...asset.payload.recipe,
          parts: await Promise.all(asset.payload.recipe.parts.map(async (part) => ({
            ...part,
            material: {
              ...part.material,
              baseColorTexture: await hydrateModelFile(part.material.baseColorTexture, '模型贴图'),
            },
          }))),
        },
      };
    const hydrated: ProjectModelAsset = {
      ...asset,
      thumbnail: await hydrateModelFile(asset.thumbnail, '模型缩略图'),
      floorplan: await hydrateModelFile(asset.floorplan, '模型俯视图'),
      payload,
    };
    return [id, hydrated] as const;
  }));

  return {
    data: { ...document, performers, modelAssets: Object.fromEntries(modelAssetEntries) },
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
    version: PROJECT_SCHEMA_VERSION,
    name: safeName,
    createdAt: now,
    updatedAt: now,
    musicName: null,
    musicAsset: null,
    modelAssets: {},
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
  const normalizedInput = parseProjectDocument(projectData, projectData.name || existing.name);
  if (hasRecoverableContent(existing)) {
    await createRecoverySnapshot(storagePath, projectId, existing);
  }
  const performers = normalizedInput.performers;
  const background = await externalizeStageBackground(projectDir, normalizedInput.stageConfig.background);
  const document: ProjectDocument = {
    ...normalizedInput,
    version: PROJECT_SCHEMA_VERSION,
    name: normalizedInput.name ? sanitizeName(normalizedInput.name) : existing.name,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    performers,
    modelAssets: dehydrateProjectModelAssets(normalizedInput.modelAssets),
    audioMarkers: parseAudioMarkers(normalizedInput.audioMarkers),
    stageConfig: {
      ...normalizedInput.stageConfig,
      background,
      showStageLines: projectData.stageConfig.showStageLines !== false,
      ledDistanceFromBack: Math.max(0, Math.min(
        normalizedInput.stageConfig.depth,
        normalizedInput.stageConfig.ledDistanceFromBack ?? 0,
      )),
      ledBottomHeight: Math.max(0, Math.min(30, normalizedInput.stageConfig.ledBottomHeight ?? 0)),
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
      version: PROJECT_SCHEMA_VERSION,
      name: choreography.name,
      musicName: null,
      musicAsset: null,
      modelAssets: {},
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
    modelAssetId: _modelAssetId,
    modelAspectLocked: _modelAspectLocked,
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
    version: PROJECT_SCHEMA_VERSION,
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
      version: PROJECT_SCHEMA_VERSION,
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
