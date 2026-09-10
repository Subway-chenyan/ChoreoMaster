import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getBuiltinModelAssets } from './builtin-model-assets.js';
import {
  GLB_TRIANGLE_WARNING_THRESHOLD,
  MAX_GLB_FILE_BYTES,
  MAX_GLB_TRIANGLES,
  MODEL_ASSET_SCHEMA_VERSION,
  TEXTURE_SIZE_WARNING_THRESHOLD,
  normalizeModelAsset,
  normalizeParametricRecipe,
  normalizeProjectModelAssets,
  toModelAssetSummary,
} from './model-asset-contract.js';
import type {
  GlbImportCommitInput,
  GlbImportSession,
  ModelAssetErrorCode,
  ModelAssetFile,
  ModelAssetManifest,
  ModelAssetMetadataUpdateInput,
  ModelAssetThumbnailUpdateInput,
  ModelAssetSummary,
  ModelPart,
  ParametricAssetSaveInput,
  ParametricModelRecipe,
  ProjectModelAsset,
  ProjectModelAssetTransferResult,
} from './model-asset-contract.js';

const MANIFEST_FILE_NAME = 'manifest.json';
const LIBRARY_DIRECTORY_NAME = 'asset-library';
const STAGING_DIRECTORY_NAME = '.asset-library-staging';
const ASSET_ID_PATTERN = /^[a-zA-Z0-9\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff-]{0,159}$/u;
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;

type ImportSessionState = {
  storagePath: string;
  directory: string;
  fileName: string;
  sizeBytes: number;
  triangleCount: number;
  textureMaxDimension: number;
};

const importSessions = new Map<string, ImportSessionState>();

export class ModelAssetError extends Error {
  constructor(public readonly code: ModelAssetErrorCode, message: string) {
    super(message);
    this.name = 'ModelAssetError';
  }
}

function normalizeAssetId(value: string): string {
  if (!ASSET_ID_PATTERN.test(value)) throw new ModelAssetError('INVALID_INPUT', '3D 资产 ID 无效');
  return value;
}

function sanitizeAssetName(value: string): string {
  const name = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ');
  if (!name) throw new ModelAssetError('INVALID_INPUT', '3D 资产名称不能为空');
  return name.slice(0, 120);
}

function createAssetId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-').replace(/^-|-$/g, '');
  return `${slug || 'model'}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..')) {
    throw new ModelAssetError('PATH_OUTSIDE_ROOT', '3D 资产路径无效');
  }
  return normalized;
}

function resolveInside(basePath: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const base = path.resolve(basePath);
  const resolved = path.resolve(base, normalized);
  const relative = path.relative(base, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ModelAssetError('PATH_OUTSIDE_ROOT', '3D 资产路径超出允许目录');
  }
  return resolved;
}

function libraryRoot(storagePath: string): string {
  return path.join(storagePath, LIBRARY_DIRECTORY_NAME);
}

function userAssetDirectory(storagePath: string, assetId: string): string {
  return resolveInside(libraryRoot(storagePath), normalizeAssetId(assetId));
}

function stagingDirectory(storagePath: string, sessionId: string): string {
  return resolveInside(path.join(storagePath, STAGING_DIRECTORY_NAME), normalizeAssetId(sessionId));
}

function libraryUrl(scope: 'asset' | 'staging', id: string, relativePath: string): string {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  return `choreo-library://${scope}/${encodeURIComponent(id)}/${encodedPath}`;
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function stripRuntimeFile(file: ModelAssetFile | undefined): ModelAssetFile | undefined {
  if (!file) return undefined;
  return {
    assetPath: normalizeRelativePath(file.assetPath),
    ...(file.fileName ? { fileName: file.fileName } : {}),
  };
}

function mapRecipeFiles(
  recipe: ParametricModelRecipe,
  mapper: (file: ModelAssetFile, partId: string) => ModelAssetFile,
): ParametricModelRecipe {
  return {
    ...recipe,
    parts: recipe.parts.map((part) => ({
      ...part,
      material: {
        ...part.material,
        ...(part.material.baseColorTexture
          ? { baseColorTexture: mapper(part.material.baseColorTexture, part.id) }
          : {}),
      },
    })),
  };
}

function stripRuntimeAsset(asset: ModelAssetManifest): ModelAssetManifest {
  const payload = asset.payload.kind === 'glb'
    ? { kind: 'glb' as const, file: stripRuntimeFile(asset.payload.file) as ModelAssetFile }
    : {
      kind: 'parametric' as const,
      recipe: mapRecipeFiles(asset.payload.recipe, (file) => stripRuntimeFile(file) as ModelAssetFile),
    };
  return {
    ...asset,
    payload,
    thumbnail: stripRuntimeFile(asset.thumbnail),
    floorplan: stripRuntimeFile(asset.floorplan),
  };
}

function hydrateFile(scope: 'asset' | 'staging', id: string, file: ModelAssetFile | undefined): ModelAssetFile | undefined {
  if (!file) return undefined;
  return { ...file, runtimeUrl: libraryUrl(scope, id, file.assetPath) };
}

function hydrateAsset(asset: ModelAssetManifest): ModelAssetManifest {
  const payload = asset.payload.kind === 'glb'
    ? { kind: 'glb' as const, file: hydrateFile('asset', asset.id, asset.payload.file) ?? asset.payload.file }
    : {
      kind: 'parametric' as const,
      recipe: mapRecipeFiles(asset.payload.recipe, (file) => hydrateFile('asset', asset.id, file) ?? file),
    };
  return {
    ...asset,
    payload,
    ...(asset.thumbnail ? { thumbnail: hydrateFile('asset', asset.id, asset.thumbnail) } : {}),
    ...(asset.floorplan ? { floorplan: hydrateFile('asset', asset.id, asset.floorplan) } : {}),
  };
}

async function readUserAsset(storagePath: string, assetId: string): Promise<ModelAssetManifest> {
  const id = normalizeAssetId(assetId);
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path.join(userAssetDirectory(storagePath, id), MANIFEST_FILE_NAME), 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ModelAssetError('ASSET_NOT_FOUND', `找不到 3D 资产：${id}`);
    }
    throw error;
  }
  const asset = normalizeModelAsset(raw);
  if (!asset || asset.id !== id || asset.origin !== 'user') {
    throw new ModelAssetError('INVALID_INPUT', `3D 资产清单损坏：${id}`);
  }
  return asset;
}

async function readAsset(storagePath: string, assetId: string): Promise<ModelAssetManifest> {
  const id = normalizeAssetId(assetId);
  const builtin = getBuiltinModelAssets().find((asset) => asset.id === id);
  return builtin ?? readUserAsset(storagePath, id);
}

async function listUserAssets(storagePath: string): Promise<ModelAssetManifest[]> {
  const root = libraryRoot(storagePath);
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const assets = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try {
      return await readUserAsset(storagePath, entry.name);
    } catch {
      return null;
    }
  }));
  return assets.filter((asset): asset is ModelAssetManifest => asset !== null);
}

export async function listModelAssets(storagePath: string): Promise<ModelAssetSummary[]> {
  const assets = [...getBuiltinModelAssets(), ...await listUserAssets(storagePath)]
    .map(hydrateAsset)
    .sort((a, b) => a.origin === b.origin ? a.name.localeCompare(b.name, 'zh-CN') : a.origin === 'builtin' ? -1 : 1);
  return assets.map(toModelAssetSummary);
}

export async function getModelAsset(storagePath: string, assetId: string): Promise<ModelAssetManifest> {
  return hydrateAsset(await readAsset(storagePath, assetId));
}

function decodeImageDataUrl(value: string): { extension: string; buffer: Buffer } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(value);
  if (!match) throw new ModelAssetError('INVALID_INPUT', '只支持 PNG、JPEG 或 WebP 图片');
  const extension = match[1] === 'image/png' ? '.png' : match[1] === 'image/webp' ? '.webp' : '.jpg';
  return { extension, buffer: Buffer.from(match[2], 'base64') };
}

async function persistOptionalImage(
  assetDir: string,
  name: string,
  dataUrl: string | undefined,
): Promise<ModelAssetFile | undefined> {
  if (!dataUrl) return undefined;
  const decoded = decodeImageDataUrl(dataUrl);
  const fileName = `${name}-${Date.now()}${decoded.extension}`;
  await fs.writeFile(path.join(assetDir, fileName), decoded.buffer);
  return { assetPath: fileName, fileName };
}

async function externalizeRecipeTextures(assetDir: string, recipe: ParametricModelRecipe): Promise<ParametricModelRecipe> {
  const parts: ModelPart[] = [];
  for (const part of recipe.parts) {
    const texture = part.material.baseColorTexture;
    if (!texture?.runtimeUrl?.startsWith('data:')) {
      parts.push({
        ...part,
        material: {
          ...part.material,
          ...(texture ? { baseColorTexture: stripRuntimeFile(texture) } : {}),
        },
      });
      continue;
    }
    const decoded = decodeImageDataUrl(texture.runtimeUrl);
    const relativePath = `textures/${part.id}-${Date.now()}${decoded.extension}`;
    const targetPath = resolveInside(assetDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, decoded.buffer);
    parts.push({
      ...part,
      material: {
        ...part.material,
        baseColorTexture: { assetPath: relativePath, fileName: texture.fileName },
      },
    });
  }
  return { ...recipe, parts };
}

function normalizeCandidate(value: unknown): ModelAssetManifest {
  const candidate = normalizeModelAsset(value);
  if (!candidate) throw new ModelAssetError('INVALID_INPUT', '3D 资产数据无效');
  return candidate;
}

export async function saveParametricModelAsset(
  storagePath: string,
  input: ParametricAssetSaveInput,
): Promise<ModelAssetManifest> {
  const name = sanitizeAssetName(input.name);
  const id = input.assetId ? normalizeAssetId(input.assetId) : createAssetId(name);
  if (getBuiltinModelAssets().some((asset) => asset.id === id)) {
    throw new ModelAssetError('ASSET_READ_ONLY', '内置预设不能直接修改，请先复制');
  }
  let existing: ModelAssetManifest | null = null;
  try {
    existing = await readUserAsset(storagePath, id);
  } catch (error) {
    if (!(error instanceof ModelAssetError) || error.code !== 'ASSET_NOT_FOUND') throw error;
  }
  if (existing && input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) {
    throw new ModelAssetError('REVISION_CONFLICT', '资产已经被其他编辑覆盖，请刷新后重试');
  }
  const assetDir = userAssetDirectory(storagePath, id);
  await fs.mkdir(assetDir, { recursive: true });
  const recipe = await externalizeRecipeTextures(assetDir, normalizeParametricRecipe(input.recipe));
  const thumbnail = await persistOptionalImage(assetDir, 'thumbnail', input.thumbnailDataUrl)
    ?? stripRuntimeFile(existing?.thumbnail);
  const floorplan = await persistOptionalImage(assetDir, 'floorplan', input.floorplanDataUrl)
    ?? stripRuntimeFile(existing?.floorplan);
  const now = Date.now();
  const revision = (existing?.revision ?? 0) + 1;
  const hashSource = JSON.stringify({ name, tags: input.tags, usage: input.defaultUsage, recipe, size: input.intrinsicSize, bounds: input.bounds });
  const candidate = normalizeCandidate({
    schemaVersion: MODEL_ASSET_SCHEMA_VERSION,
    id,
    revision,
    contentHash: createHash('sha256').update(hashSource).digest('hex'),
    name,
    tags: input.tags,
    defaultUsage: input.defaultUsage,
    origin: 'user',
    format: 'parametric',
    intrinsicSize: input.intrinsicSize,
    bounds: input.bounds,
    pivot: input.pivot,
    footprints: input.footprints,
    correction: { offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ...(thumbnail ? { thumbnailVersion: 1 as const } : {}),
    ...(floorplan ? { floorplanVersion: 1 as const } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(floorplan ? { floorplan } : {}),
    payload: { kind: 'parametric', recipe },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  await writeJsonAtomically(path.join(assetDir, MANIFEST_FILE_NAME), candidate);
  return hydrateAsset(candidate);
}

export async function updateModelAssetMetadata(
  storagePath: string,
  input: ModelAssetMetadataUpdateInput,
): Promise<ModelAssetManifest> {
  const id = normalizeAssetId(input.assetId);
  const existing = await readAsset(storagePath, id);
  if (existing.origin === 'builtin') {
    throw new ModelAssetError('ASSET_READ_ONLY', '内置预设不能直接修改，请先复制');
  }
  if (existing.revision !== input.expectedRevision) {
    throw new ModelAssetError('REVISION_CONFLICT', '资产已经被其他编辑覆盖，请刷新后重试');
  }
  const revision = existing.revision + 1;
  const candidate = normalizeCandidate({
    ...stripRuntimeAsset(existing),
    name: sanitizeAssetName(input.name),
    tags: input.tags,
    defaultUsage: input.defaultUsage,
    revision,
    contentHash: createHash('sha256').update(existing.contentHash).update(JSON.stringify(input)).digest('hex'),
    updatedAt: Date.now(),
  });
  await writeJsonAtomically(path.join(userAssetDirectory(storagePath, id), MANIFEST_FILE_NAME), candidate);
  return hydrateAsset(candidate);
}

export async function updateModelAssetThumbnail(
  storagePath: string,
  input: ModelAssetThumbnailUpdateInput,
): Promise<ModelAssetManifest> {
  const id = normalizeAssetId(input.assetId);
  const existing = await readAsset(storagePath, id);
  if (existing.origin === 'builtin') {
    throw new ModelAssetError('ASSET_READ_ONLY', '内置预设不能直接修改');
  }
  if (existing.revision !== input.expectedRevision) {
    throw new ModelAssetError('REVISION_CONFLICT', '资产已经更新，请刷新后重试');
  }
  const assetDir = userAssetDirectory(storagePath, id);
  const thumbnail = await persistOptionalImage(assetDir, 'thumbnail', input.thumbnailDataUrl);
  if (!thumbnail) throw new ModelAssetError('INVALID_INPUT', '模型预览图不能为空');
  const floorplan = await persistOptionalImage(assetDir, 'floorplan', input.floorplanDataUrl);
  if (!floorplan) throw new ModelAssetError('INVALID_INPUT', '模型俯视图不能为空');
  const candidate = normalizeCandidate({
    ...stripRuntimeAsset(existing),
    revision: existing.revision + 1,
    contentHash: createHash('sha256')
      .update(existing.contentHash)
      .update(input.thumbnailDataUrl)
      .update(input.floorplanDataUrl)
      .digest('hex'),
    thumbnailVersion: 1,
    floorplanVersion: 1,
    thumbnail,
    floorplan,
    updatedAt: Date.now(),
  });
  await writeJsonAtomically(path.join(assetDir, MANIFEST_FILE_NAME), candidate);
  return hydrateAsset(candidate);
}

type GlbJson = {
  accessors?: { count?: number }[];
  buffers?: { uri?: string }[];
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  meshes?: { primitives?: { indices?: number; attributes?: { POSITION?: number }; mode?: number }[] }[];
  nodes?: { mesh?: number; children?: number[] }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
};

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

function imageDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length >= 24 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) return jpegDimensions(buffer);
  if (buffer.length >= 30 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    && buffer.subarray(12, 16).toString('ascii') === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  const ktx2Signature = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length >= 28 && buffer.subarray(0, 12).equals(ktx2Signature)) {
    return { width: buffer.readUInt32LE(20), height: buffer.readUInt32LE(24) };
  }
  return null;
}

function embeddedTextureMaxDimension(buffer: Buffer, json: GlbJson): number {
  const jsonChunkLength = buffer.readUInt32LE(12);
  const binaryHeaderOffset = 20 + jsonChunkLength;
  const hasBinaryChunk = binaryHeaderOffset + 8 <= buffer.length
    && buffer.readUInt32LE(binaryHeaderOffset + 4) === 0x004e4942;
  const binaryDataOffset = hasBinaryChunk ? binaryHeaderOffset + 8 : -1;
  let maximum = 0;
  (json.images ?? []).forEach((image) => {
    let imageBuffer: Buffer | null = null;
    if (typeof image.uri === 'string' && image.uri.startsWith('data:')) {
      const match = /^data:[^;,]+;base64,(.*)$/s.exec(image.uri);
      if (match) imageBuffer = Buffer.from(match[1], 'base64');
    } else if (image.bufferView !== undefined && binaryDataOffset >= 0) {
      const view = json.bufferViews?.[image.bufferView];
      if (view && (view.buffer ?? 0) === 0) {
        const start = binaryDataOffset + (view.byteOffset ?? 0);
        imageBuffer = buffer.subarray(start, start + (view.byteLength ?? 0));
      }
    }
    if (!imageBuffer) return;
    const dimensions = imageDimensions(imageBuffer);
    if (dimensions) maximum = Math.max(maximum, dimensions.width, dimensions.height);
  });
  return maximum;
}

function parseGlbJson(buffer: Buffer): GlbJson {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== GLB_MAGIC || buffer.readUInt32LE(4) !== 2) {
    throw new ModelAssetError('GLB_INVALID', '文件不是有效的 GLB 2.0 模型');
  }
  const declaredLength = buffer.readUInt32LE(8);
  const chunkLength = buffer.readUInt32LE(12);
  const chunkType = buffer.readUInt32LE(16);
  if (declaredLength !== buffer.length || chunkType !== GLB_JSON_CHUNK || 20 + chunkLength > buffer.length) {
    throw new ModelAssetError('GLB_INVALID', 'GLB 文件头或 JSON 数据块损坏');
  }
  try {
    return JSON.parse(buffer.subarray(20, 20 + chunkLength).toString('utf8').replace(/\u0000+$/g, '').trim()) as GlbJson;
  } catch {
    throw new ModelAssetError('GLB_INVALID', 'GLB JSON 数据无法解析');
  }
}

function countPrimitiveTriangles(json: GlbJson, meshIndex: number): number {
  const mesh = json.meshes?.[meshIndex];
  if (!mesh?.primitives) return 0;
  return mesh.primitives.reduce((sum, primitive) => {
    const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
    const count = accessorIndex === undefined ? 0 : json.accessors?.[accessorIndex]?.count ?? 0;
    const mode = primitive.mode ?? 4;
    if (mode === 4) return sum + Math.floor(count / 3);
    if (mode === 5 || mode === 6) return sum + Math.max(0, count - 2);
    return sum;
  }, 0);
}

function inspectGlb(json: GlbJson): number {
  const externalUri = [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((entry) => entry.uri)
    .find((uri) => typeof uri === 'string' && !uri.startsWith('data:'));
  if (externalUri) throw new ModelAssetError('GLB_EXTERNAL_RESOURCE', 'GLB 引用了外部文件，请导出为自包含 GLB');
  if (!json.meshes || json.meshes.length === 0) throw new ModelAssetError('GLB_INVALID', 'GLB 中没有可用网格');
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? json.nodes?.map((_node, index) => index) ?? [];
  let triangles = 0;
  const visit = (nodeIndex: number, ancestors: Set<number>): void => {
    if (ancestors.has(nodeIndex)) throw new ModelAssetError('GLB_INVALID', 'GLB 节点层级存在循环');
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    if (node.mesh !== undefined) triangles += countPrimitiveTriangles(json, node.mesh);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(nodeIndex);
    node.children?.forEach((child) => visit(child, nextAncestors));
  };
  roots.forEach((root) => visit(root, new Set()));
  return triangles || json.meshes.reduce((sum, _mesh, index) => sum + countPrimitiveTriangles(json, index), 0);
}

export async function beginGlbModelImport(storagePath: string, sourcePath: string): Promise<GlbImportSession> {
  if (path.extname(sourcePath).toLowerCase() !== '.glb') {
    throw new ModelAssetError('GLB_INVALID', '首版仅支持 GLB 文件');
  }
  const stats = await fs.stat(sourcePath);
  if (!stats.isFile()) throw new ModelAssetError('GLB_INVALID', '选择的 GLB 路径不是文件');
  if (stats.size > MAX_GLB_FILE_BYTES) throw new ModelAssetError('GLB_TOO_LARGE', 'GLB 文件不能超过 100 MB');
  const buffer = await fs.readFile(sourcePath);
  const glbJson = parseGlbJson(buffer);
  const triangleCount = inspectGlb(glbJson);
  const textureMaxDimension = embeddedTextureMaxDimension(buffer, glbJson);
  if (triangleCount > MAX_GLB_TRIANGLES) {
    throw new ModelAssetError('GLB_TOO_COMPLEX', 'GLB 渲染三角面不能超过 100 万');
  }
  const sessionId = randomUUID();
  const directory = stagingDirectory(storagePath, sessionId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'model.glb'), buffer);
  importSessions.set(sessionId, {
    storagePath,
    directory,
    fileName: path.basename(sourcePath),
    sizeBytes: stats.size,
    triangleCount,
    textureMaxDimension,
  });
  return {
    sessionId,
    fileName: path.basename(sourcePath),
    sizeBytes: stats.size,
    triangleCount,
    textureMaxDimension,
    modelUrl: libraryUrl('staging', sessionId, 'model.glb'),
    warnings: [
      ...(triangleCount > GLB_TRIANGLE_WARNING_THRESHOLD
        ? [`模型包含 ${triangleCount.toLocaleString('zh-CN')} 个三角面，可能影响实时预览性能`]
        : []),
      ...(textureMaxDimension > TEXTURE_SIZE_WARNING_THRESHOLD
        ? [`模型包含边长 ${textureMaxDimension}px 的纹理，可能占用较多显存`]
        : []),
    ],
  };
}

export async function cancelGlbModelImport(sessionId: string): Promise<void> {
  const session = importSessions.get(sessionId);
  importSessions.delete(sessionId);
  if (session) await fs.rm(session.directory, { recursive: true, force: true });
}

export async function commitGlbModelImport(
  storagePath: string,
  sessionId: string,
  input: GlbImportCommitInput,
): Promise<ModelAssetManifest> {
  const session = importSessions.get(sessionId);
  if (!session || path.resolve(session.storagePath) !== path.resolve(storagePath)) {
    throw new ModelAssetError('IMPORT_CANCELLED', 'GLB 导入会话不存在或已经结束');
  }
  const name = sanitizeAssetName(input.name);
  const id = createAssetId(name);
  const assetDir = userAssetDirectory(storagePath, id);
  await fs.mkdir(assetDir, { recursive: true });
  try {
    await fs.copyFile(path.join(session.directory, 'model.glb'), path.join(assetDir, 'model.glb'));
    const thumbnail = await persistOptionalImage(assetDir, 'thumbnail', input.thumbnailDataUrl);
    const floorplan = await persistOptionalImage(assetDir, 'floorplan', input.floorplanDataUrl);
    const sourceBuffer = await fs.readFile(path.join(assetDir, 'model.glb'));
    const now = Date.now();
    const hash = createHash('sha256').update(sourceBuffer).update(JSON.stringify(input)).digest('hex');
    const candidate = normalizeCandidate({
      schemaVersion: MODEL_ASSET_SCHEMA_VERSION,
      id,
      revision: 1,
      contentHash: hash,
      name,
      tags: input.tags,
      defaultUsage: input.defaultUsage,
      origin: 'user',
      format: 'glb',
      intrinsicSize: input.intrinsicSize,
      bounds: {
        min: { x: -input.intrinsicSize.width / 2, y: 0, z: -input.intrinsicSize.depth / 2 },
        max: { x: input.intrinsicSize.width / 2, y: input.intrinsicSize.height, z: input.intrinsicSize.depth / 2 },
      },
      pivot: input.pivot,
      footprints: input.footprints,
      correction: input.correction,
      ...(thumbnail ? { thumbnailVersion: 1 as const } : {}),
      ...(floorplan ? { floorplanVersion: 1 as const } : {}),
      ...(thumbnail ? { thumbnail } : {}),
      ...(floorplan ? { floorplan } : {}),
      payload: { kind: 'glb', file: { assetPath: 'model.glb', fileName: session.fileName } },
      createdAt: now,
      updatedAt: now,
    });
    await writeJsonAtomically(path.join(assetDir, MANIFEST_FILE_NAME), candidate);
    if ((input.textureMaxDimension ?? 0) > TEXTURE_SIZE_WARNING_THRESHOLD) {
      // The warning is presented during calibration; it does not make the stored asset invalid.
    }
    return hydrateAsset(candidate);
  } finally {
    await cancelGlbModelImport(sessionId);
  }
}

export async function duplicateModelAsset(storagePath: string, assetId: string): Promise<ModelAssetManifest> {
  const source = await readAsset(storagePath, assetId);
  const name = `${source.name} 副本`;
  if (source.origin === 'user') {
    const sourceDir = userAssetDirectory(storagePath, source.id);
    const id = createAssetId(name);
    const destination = userAssetDirectory(storagePath, id);
    await fs.cp(sourceDir, destination, { recursive: true, errorOnExist: true });
    const now = Date.now();
    const duplicate = normalizeCandidate({
      ...stripRuntimeAsset(source),
      id,
      name,
      origin: 'user',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    await writeJsonAtomically(path.join(destination, MANIFEST_FILE_NAME), duplicate);
    return hydrateAsset(duplicate);
  }
  if (source.payload.kind === 'parametric') {
    return saveParametricModelAsset(storagePath, {
      name,
      tags: [...source.tags],
      defaultUsage: source.defaultUsage,
      recipe: source.payload.recipe,
      intrinsicSize: source.intrinsicSize,
      bounds: source.bounds,
      pivot: source.pivot,
      footprints: source.footprints,
    });
  }
  throw new ModelAssetError('ASSET_READ_ONLY', '内置 GLB 资产不能直接复制');
}

export async function getModelAssetDeletionPath(storagePath: string, assetId: string): Promise<string> {
  const asset = await readAsset(storagePath, assetId);
  if (asset.origin === 'builtin') throw new ModelAssetError('ASSET_READ_ONLY', '内置预设不能删除');
  return userAssetDirectory(storagePath, asset.id);
}

function projectAssetUrl(projectId: string, relativePath: string): string {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  return `choreo-asset://asset/${encodeURIComponent(projectId)}/${encodedPath}`;
}

function rewriteProjectFile(projectId: string, snapshotId: string, file: ModelAssetFile): ModelAssetFile {
  const sourcePath = normalizeRelativePath(file.assetPath);
  const assetPath = `assets/models/${snapshotId}/${sourcePath}`;
  return { assetPath, ...(file.fileName ? { fileName: file.fileName } : {}), runtimeUrl: projectAssetUrl(projectId, assetPath) };
}

export async function materializeModelAsset(
  storagePath: string,
  projectId: string,
  projectDir: string,
  assetId: string,
  expectedRevision?: number,
): Promise<ProjectModelAsset> {
  const source = await readAsset(storagePath, assetId);
  if (expectedRevision !== undefined && expectedRevision !== source.revision) {
    throw new ModelAssetError('REVISION_CONFLICT', '资产版本已经更新，请刷新资产库');
  }
  const snapshotId = `${source.id}-${source.contentHash.slice(0, 12)}`;
  const destinationDir = resolveInside(projectDir, `assets/models/${snapshotId}`);
  await fs.mkdir(destinationDir, { recursive: true });
  if (source.origin === 'user') {
    const sourceDir = userAssetDirectory(storagePath, source.id);
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === MANIFEST_FILE_NAME) continue;
      await fs.copyFile(path.join(sourceDir, entry.name), path.join(destinationDir, entry.name));
    }
    const textureDir = path.join(sourceDir, 'textures');
    await fs.cp(textureDir, path.join(destinationDir, 'textures'), { recursive: true, force: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
  const payload = source.payload.kind === 'glb'
    ? { kind: 'glb' as const, file: rewriteProjectFile(projectId, snapshotId, source.payload.file) }
    : {
      kind: 'parametric' as const,
      recipe: mapRecipeFiles(source.payload.recipe, (file) => rewriteProjectFile(projectId, snapshotId, file)),
    };
  return {
    ...source,
    id: snapshotId,
    payload,
    ...(source.thumbnail ? { thumbnail: rewriteProjectFile(projectId, snapshotId, source.thumbnail) } : {}),
    ...(source.floorplan ? { floorplan: rewriteProjectFile(projectId, snapshotId, source.floorplan) } : {}),
    sourceAssetId: source.id,
    sourceRevision: source.revision,
  };
}

async function copyProjectSnapshot(sourceDir: string, destinationDir: string): Promise<void> {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyProjectSnapshot(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

function rewriteTransferredFile(
  targetProjectId: string,
  sourceSnapshotId: string,
  targetSnapshotId: string,
  file: ModelAssetFile,
): ModelAssetFile {
  const normalized = normalizeRelativePath(file.assetPath);
  const prefix = `assets/models/${sourceSnapshotId}/`;
  if (!normalized.startsWith(prefix)) {
    throw new ModelAssetError('INVALID_INPUT', '项目模型文件不属于指定快照');
  }
  const assetPath = `assets/models/${targetSnapshotId}/${normalized.slice(prefix.length)}`;
  return {
    assetPath,
    ...(file.fileName ? { fileName: file.fileName } : {}),
    runtimeUrl: projectAssetUrl(targetProjectId, assetPath),
  };
}

export async function transferProjectModelAssets(
  sourceProjectDir: string,
  targetProjectDir: string,
  targetProjectId: string,
  assets: Record<string, ProjectModelAsset>,
): Promise<ProjectModelAssetTransferResult> {
  const normalizedAssets = normalizeProjectModelAssets(assets);
  if (Object.keys(normalizedAssets).length !== Object.keys(assets).length) {
    throw new ModelAssetError('INVALID_INPUT', '项目模型资产数据无效');
  }
  const transferred: Record<string, ProjectModelAsset> = {};
  const idMap: Record<string, string> = {};
  for (const [sourceSnapshotId, asset] of Object.entries(normalizedAssets)) {
    const targetSnapshotId = `${asset.sourceAssetId ?? sourceSnapshotId}-${asset.contentHash.slice(0, 12)}`;
    const sourceDir = resolveInside(sourceProjectDir, `assets/models/${sourceSnapshotId}`);
    const destinationDir = resolveInside(targetProjectDir, `assets/models/${targetSnapshotId}`);
    await fs.access(destinationDir).catch(async () => copyProjectSnapshot(sourceDir, destinationDir));
    const rewrite = (file: ModelAssetFile): ModelAssetFile => rewriteTransferredFile(
      targetProjectId,
      sourceSnapshotId,
      targetSnapshotId,
      file,
    );
    const payload = asset.payload.kind === 'glb'
      ? { kind: 'glb' as const, file: rewrite(asset.payload.file) }
      : { kind: 'parametric' as const, recipe: mapRecipeFiles(asset.payload.recipe, rewrite) };
    transferred[targetSnapshotId] = {
      ...asset,
      id: targetSnapshotId,
      payload,
      ...(asset.thumbnail ? { thumbnail: rewrite(asset.thumbnail) } : {}),
      ...(asset.floorplan ? { floorplan: rewrite(asset.floorplan) } : {}),
    };
    idMap[sourceSnapshotId] = targetSnapshotId;
  }
  return { assets: transferred, idMap };
}

export function resolveLibraryAssetPath(
  storagePath: string,
  scope: 'asset' | 'staging',
  id: string,
  relativePath: string,
): string {
  const root = scope === 'asset'
    ? userAssetDirectory(storagePath, id)
    : stagingDirectory(storagePath, id);
  return resolveInside(root, relativePath);
}
