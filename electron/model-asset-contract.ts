export const MODEL_ASSET_SCHEMA_VERSION = 1;
export const PROJECT_SCHEMA_VERSION = '4.0';
export const MAX_PARAMETRIC_MODEL_PARTS = 200;
export const MAX_GLB_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_GLB_TRIANGLES = 1_000_000;
export const GLB_TRIANGLE_WARNING_THRESHOLD = 250_000;
export const TEXTURE_SIZE_WARNING_THRESHOLD = 4096;

export type ModelAssetOrigin = 'builtin' | 'user';
export type ModelAssetFormat = 'parametric' | 'glb';
export type ModelAssetUsage = 'prop' | 'platform';
export type ModelPrimitiveKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'extrusion';

export interface ModelVector2 {
  x: number;
  y: number;
}

export interface ModelVector3 {
  x: number;
  y: number;
  z: number;
}

export interface ModelSize {
  width: number;
  height: number;
  depth: number;
}

export interface ModelBounds {
  min: ModelVector3;
  max: ModelVector3;
}

export interface ModelAssetFile {
  assetPath: string;
  fileName?: string;
  runtimeUrl?: string;
}

export interface ModelPartMaterial {
  color: string;
  baseColorTexture?: ModelAssetFile;
}

export type ModelPartGeometry =
  | { kind: 'box'; width: number; height: number; depth: number }
  | { kind: 'cylinder'; radius: number; height: number; segments?: number }
  | { kind: 'sphere'; radius: number; segments?: number }
  | { kind: 'cone'; radius: number; height: number; segments?: number }
  | { kind: 'extrusion'; points: ModelVector2[]; height: number };

export interface ModelPart {
  id: string;
  name: string;
  parentId?: string;
  position: ModelVector3;
  rotation: ModelVector3;
  scale: ModelVector3;
  geometry: ModelPartGeometry;
  material: ModelPartMaterial;
}

export interface ParametricModelRecipe {
  schemaVersion: 1;
  origin: ModelVector3;
  parts: ModelPart[];
}

export interface ModelAssetCorrection {
  offset: ModelVector3;
  rotation: ModelVector3;
  scale: ModelVector3;
}

export type ModelAssetPayload =
  | { kind: 'parametric'; recipe: ParametricModelRecipe }
  | { kind: 'glb'; file: ModelAssetFile };

export interface ModelAssetManifest {
  schemaVersion: 1;
  id: string;
  revision: number;
  contentHash: string;
  name: string;
  tags: string[];
  defaultUsage: ModelAssetUsage;
  origin: ModelAssetOrigin;
  format: ModelAssetFormat;
  intrinsicSize: ModelSize;
  bounds: ModelBounds;
  pivot: ModelVector3;
  footprints: ModelVector2[][];
  correction: ModelAssetCorrection;
  thumbnailVersion?: 1;
  floorplanVersion?: 1;
  thumbnail?: ModelAssetFile;
  floorplan?: ModelAssetFile;
  payload: ModelAssetPayload;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectModelAsset extends ModelAssetManifest {
  sourceAssetId?: string;
  sourceRevision?: number;
}

export interface ModelAssetSummary {
  id: string;
  revision: number;
  contentHash: string;
  name: string;
  tags: string[];
  defaultUsage: ModelAssetUsage;
  origin: ModelAssetOrigin;
  format: ModelAssetFormat;
  intrinsicSize: ModelSize;
  thumbnailUrl?: string;
  thumbnailVersion?: 1;
  floorplanVersion?: 1;
  updatedAt: number;
}

export interface ParametricAssetSaveInput {
  assetId?: string;
  expectedRevision?: number;
  name: string;
  tags: string[];
  defaultUsage: ModelAssetUsage;
  recipe: ParametricModelRecipe;
  intrinsicSize: ModelSize;
  bounds: ModelBounds;
  pivot: ModelVector3;
  footprints: ModelVector2[][];
  thumbnailDataUrl?: string;
  floorplanDataUrl?: string;
}

export interface ModelAssetMetadataUpdateInput {
  assetId: string;
  expectedRevision: number;
  name: string;
  tags: string[];
  defaultUsage: ModelAssetUsage;
}

export interface ModelAssetThumbnailUpdateInput {
  assetId: string;
  expectedRevision: number;
  thumbnailDataUrl: string;
  floorplanDataUrl: string;
}

export interface GlbImportSession {
  sessionId: string;
  fileName: string;
  sizeBytes: number;
  triangleCount: number;
  textureMaxDimension: number;
  modelUrl: string;
  warnings: string[];
}

export interface GlbImportCommitInput {
  name: string;
  tags: string[];
  defaultUsage: ModelAssetUsage;
  intrinsicSize: ModelSize;
  pivot: ModelVector3;
  footprints: ModelVector2[][];
  correction: ModelAssetCorrection;
  thumbnailDataUrl?: string;
  floorplanDataUrl?: string;
  textureMaxDimension?: number;
}

export interface ProjectModelAssetTransferResult {
  assets: Record<string, ProjectModelAsset>;
  idMap: Record<string, string>;
}

export type ModelAssetErrorCode =
  | 'INVALID_INPUT'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_READ_ONLY'
  | 'REVISION_CONFLICT'
  | 'IMPORT_CANCELLED'
  | 'GLB_INVALID'
  | 'GLB_EXTERNAL_RESOURCE'
  | 'GLB_TOO_LARGE'
  | 'GLB_TOO_COMPLEX'
  | 'PATH_OUTSIDE_ROOT'
  | 'IO_ERROR';

export interface ModelAssetErrorShape {
  code: ModelAssetErrorCode;
  message: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  return Math.max(0.001, finiteNumber(value, fallback));
}

function normalizeVector3(value: unknown, fallback: ModelVector3): ModelVector3 {
  if (!isRecord(value)) return { ...fallback };
  return {
    x: finiteNumber(value.x, fallback.x),
    y: finiteNumber(value.y, fallback.y),
    z: finiteNumber(value.z, fallback.z),
  };
}

function normalizeSize(value: unknown): ModelSize {
  if (!isRecord(value)) return { width: 1, height: 1, depth: 1 };
  return {
    width: positiveNumber(value.width, 1),
    height: positiveNumber(value.height, 1),
    depth: positiveNumber(value.depth, 1),
  };
}

function normalizeFile(value: unknown): ModelAssetFile | undefined {
  if (!isRecord(value) || typeof value.assetPath !== 'string' || !value.assetPath.trim()) return undefined;
  return {
    assetPath: value.assetPath.replace(/\\/g, '/'),
    ...(typeof value.fileName === 'string' ? { fileName: value.fileName } : {}),
    ...(typeof value.runtimeUrl === 'string' ? { runtimeUrl: value.runtimeUrl } : {}),
  };
}

function normalizeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#64748b';
}

function normalizePoints(value: unknown): ModelVector2[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point) => {
    if (!isRecord(point)) return [];
    const x = finiteNumber(point.x, Number.NaN);
    const y = finiteNumber(point.y, Number.NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
  });
}

function orientation(a: ModelVector2, b: ModelVector2, c: ModelVector2): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentsIntersect(a: ModelVector2, b: ModelVector2, c: ModelVector2, d: ModelVector2): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function isSimplePolygon(points: ModelVector2[]): boolean {
  if (points.length < 3) return false;
  const area = Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return next ? sum + point.x * next.y - next.x * point.y : sum;
  }, 0)) / 2;
  if (area < 0.0001) return false;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j];
      const d = points[(j + 1) % points.length];
      if (c && d && segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

function normalizeGeometry(value: unknown): ModelPartGeometry | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'box') {
    return {
      kind: 'box',
      width: positiveNumber(value.width, 1),
      height: positiveNumber(value.height, 1),
      depth: positiveNumber(value.depth, 1),
    };
  }
  if (value.kind === 'cylinder' || value.kind === 'cone') {
    return {
      kind: value.kind,
      radius: positiveNumber(value.radius, 0.5),
      height: positiveNumber(value.height, 1),
      segments: Math.max(8, Math.min(128, Math.round(finiteNumber(value.segments, 32)))),
    };
  }
  if (value.kind === 'sphere') {
    return {
      kind: 'sphere',
      radius: positiveNumber(value.radius, 0.5),
      segments: Math.max(8, Math.min(128, Math.round(finiteNumber(value.segments, 32)))),
    };
  }
  if (value.kind === 'extrusion') {
    const points = normalizePoints(value.points);
    if (!isSimplePolygon(points)) return null;
    return { kind: 'extrusion', points, height: positiveNumber(value.height, 1) };
  }
  return null;
}

function normalizePart(value: unknown, index: number): ModelPart | null {
  if (!isRecord(value)) return null;
  const geometry = normalizeGeometry(value.geometry);
  if (!geometry) return null;
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `part-${index + 1}`;
  const material = isRecord(value.material) ? value.material : {};
  return {
    id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 120) : `部件 ${index + 1}`,
    ...(typeof value.parentId === 'string' && value.parentId.trim() ? { parentId: value.parentId.trim() } : {}),
    position: normalizeVector3(value.position, { x: 0, y: 0, z: 0 }),
    rotation: normalizeVector3(value.rotation, { x: 0, y: 0, z: 0 }),
    scale: normalizeVector3(value.scale, { x: 1, y: 1, z: 1 }),
    geometry,
    material: {
      color: normalizeColor(material.color),
      ...(normalizeFile(material.baseColorTexture) ? { baseColorTexture: normalizeFile(material.baseColorTexture) } : {}),
    },
  };
}

function hasParentCycle(parts: ModelPart[]): boolean {
  const parentById = new Map(parts.map((part) => [part.id, part.parentId]));
  return parts.some((part) => {
    const visited = new Set<string>();
    let current: string | undefined = part.id;
    while (current) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = parentById.get(current);
    }
    return false;
  });
}

export function normalizeParametricRecipe(value: unknown): ParametricModelRecipe {
  if (!isRecord(value) || !Array.isArray(value.parts)) throw new Error('参数化模型缺少部件列表');
  if (value.parts.length === 0) throw new Error('参数化模型至少需要一个部件');
  if (value.parts.length > MAX_PARAMETRIC_MODEL_PARTS) {
    throw new Error(`参数化模型最多支持 ${MAX_PARAMETRIC_MODEL_PARTS} 个部件`);
  }
  const parts = value.parts.map(normalizePart);
  if (parts.some((part) => part === null)) throw new Error('参数化模型包含无效部件');
  const validParts = parts.filter((part): part is ModelPart => part !== null);
  const ids = new Set(validParts.map((part) => part.id));
  if (ids.size !== validParts.length) throw new Error('参数化模型部件 ID 必须唯一');
  if (validParts.some((part) => part.parentId && !ids.has(part.parentId))) {
    throw new Error('参数化模型包含不存在的父部件');
  }
  if (hasParentCycle(validParts)) throw new Error('参数化模型部件层级不能循环引用');
  return {
    schemaVersion: 1,
    origin: normalizeVector3(value.origin, { x: 0, y: 0, z: 0 }),
    parts: validParts,
  };
}

function normalizeCorrection(value: unknown): ModelAssetCorrection {
  const record = isRecord(value) ? value : {};
  return {
    offset: normalizeVector3(record.offset, { x: 0, y: 0, z: 0 }),
    rotation: normalizeVector3(record.rotation, { x: 0, y: 0, z: 0 }),
    scale: normalizeVector3(record.scale, { x: 1, y: 1, z: 1 }),
  };
}

export function normalizeModelAsset(value: unknown): ProjectModelAsset | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || !isRecord(value.payload)) return null;
  const size = normalizeSize(value.intrinsicSize);
  const minFallback = { x: -size.width / 2, y: 0, z: -size.depth / 2 };
  const maxFallback = { x: size.width / 2, y: size.height, z: size.depth / 2 };
  const payloadKind = value.payload.kind;
  let payload: ModelAssetPayload;
  try {
    if (payloadKind === 'parametric') {
      payload = { kind: 'parametric', recipe: normalizeParametricRecipe(value.payload.recipe) };
    } else if (payloadKind === 'glb') {
      const file = normalizeFile(value.payload.file);
      if (!file) return null;
      payload = { kind: 'glb', file };
    } else {
      return null;
    }
  } catch {
    return null;
  }
  const footprints = Array.isArray(value.footprints)
    ? value.footprints.map(normalizePoints).filter((points) => points.length >= 3)
    : [];
  return {
    schemaVersion: 1,
    id: value.id,
    revision: Math.max(1, Math.round(finiteNumber(value.revision, 1))),
    contentHash: typeof value.contentHash === 'string' ? value.contentHash : '',
    name: value.name.trim().slice(0, 120) || '未命名模型',
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 20)
      : [],
    defaultUsage: value.defaultUsage === 'platform' ? 'platform' : 'prop',
    origin: value.origin === 'builtin' ? 'builtin' : 'user',
    format: payload.kind,
    intrinsicSize: size,
    bounds: isRecord(value.bounds)
      ? {
        min: normalizeVector3(value.bounds.min, minFallback),
        max: normalizeVector3(value.bounds.max, maxFallback),
      }
      : { min: minFallback, max: maxFallback },
    pivot: normalizeVector3(value.pivot, { x: 0, y: 0, z: 0 }),
    footprints: footprints.length > 0 ? footprints : [[
      { x: minFallback.x, y: minFallback.z },
      { x: maxFallback.x, y: minFallback.z },
      { x: maxFallback.x, y: maxFallback.z },
      { x: minFallback.x, y: maxFallback.z },
    ]],
    correction: normalizeCorrection(value.correction),
    ...(value.thumbnailVersion === 1 ? { thumbnailVersion: 1 as const } : {}),
    ...(value.floorplanVersion === 1 ? { floorplanVersion: 1 as const } : {}),
    ...(normalizeFile(value.thumbnail) ? { thumbnail: normalizeFile(value.thumbnail) } : {}),
    ...(normalizeFile(value.floorplan) ? { floorplan: normalizeFile(value.floorplan) } : {}),
    payload,
    createdAt: finiteNumber(value.createdAt, Date.now()),
    updatedAt: finiteNumber(value.updatedAt, Date.now()),
    ...(typeof value.sourceAssetId === 'string' ? { sourceAssetId: value.sourceAssetId } : {}),
    ...(typeof value.sourceRevision === 'number' ? { sourceRevision: Math.max(1, Math.round(value.sourceRevision)) } : {}),
  };
}

export function normalizeProjectModelAssets(value: unknown): Record<string, ProjectModelAsset> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, candidate]) => {
    const asset = normalizeModelAsset(candidate);
    return asset && asset.id === id ? [[id, asset]] : [];
  }));
}

export function createLegacyUnitBoxAsset(): ProjectModelAsset {
  const now = Date.now();
  return {
    schemaVersion: 1,
    id: 'legacy-unit-box-v1',
    revision: 1,
    contentHash: '36d0dfe40b28f972e217c91b1a5de96ac84640d78968f577d6b1d23c82c46541',
    name: '兼容方箱',
    tags: ['兼容', '方箱'],
    defaultUsage: 'prop',
    origin: 'builtin',
    format: 'parametric',
    intrinsicSize: { width: 1, height: 1, depth: 1 },
    bounds: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } },
    pivot: { x: 0, y: 0, z: 0 },
    footprints: [[
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 },
    ]],
    correction: {
      offset: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    payload: {
      kind: 'parametric',
      recipe: {
        schemaVersion: 1,
        origin: { x: 0, y: 0, z: 0 },
        parts: [{
          id: 'box',
          name: '方箱',
          position: { x: 0, y: 0.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          geometry: { kind: 'box', width: 1, height: 1, depth: 1 },
          material: { color: '#64748b' },
        }],
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function toModelAssetSummary(asset: ModelAssetManifest): ModelAssetSummary {
  return {
    id: asset.id,
    revision: asset.revision,
    contentHash: asset.contentHash,
    name: asset.name,
    tags: [...asset.tags],
    defaultUsage: asset.defaultUsage,
    origin: asset.origin,
    format: asset.format,
    intrinsicSize: { ...asset.intrinsicSize },
    ...(asset.thumbnail?.runtimeUrl ? { thumbnailUrl: asset.thumbnail.runtimeUrl } : {}),
    ...(asset.thumbnailVersion === 1 ? { thumbnailVersion: 1 as const } : {}),
    ...(asset.floorplanVersion === 1 ? { floorplanVersion: 1 as const } : {}),
    updatedAt: asset.updatedAt,
  };
}
