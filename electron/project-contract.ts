export interface Position {
  x: number;
  y: number;
  z?: number;
}

export interface MotionControlPoint {
  x: number;
  y: number;
  z?: number;
}

export type MotionPathType = 'linear' | 'bezier';
export type RotationMode = 'fixed' | 'lerp';

export interface ObjectMotion {
  pathType?: MotionPathType;
  controlPoints?: MotionControlPoint[];
  rotationMode?: RotationMode;
  startRotation?: number;
  endRotation?: number;
}

export interface TransitionSegment {
  id: string;
  fromFrameId: string;
  toFrameId: string;
  duration?: number;
  objectMotions: Record<string, ObjectMotion>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMotionControlPoint(value: unknown): MotionControlPoint | null {
  if (!isRecord(value)) return null;
  if (typeof value.x !== 'number' || typeof value.y !== 'number') return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return {
    x: value.x,
    y: value.y,
    ...(typeof value.z === 'number' && Number.isFinite(value.z) ? { z: value.z } : {}),
  };
}

function normalizeObjectMotion(value: unknown): ObjectMotion | null {
  if (!isRecord(value)) return null;
  const motion: ObjectMotion = {};
  if (value.pathType === 'linear' || value.pathType === 'bezier') {
    motion.pathType = value.pathType;
  }
  if (Array.isArray(value.controlPoints)) {
    const controlPoints = value.controlPoints
      .flatMap((entry) => {
        const point = normalizeMotionControlPoint(entry);
        return point ? [point] : [];
      })
      .slice(0, 2);
    if (controlPoints.length > 0) {
      motion.controlPoints = controlPoints;
    }
  }
  if (value.rotationMode === 'fixed' || value.rotationMode === 'lerp') {
    motion.rotationMode = value.rotationMode;
  }
  if (typeof value.startRotation === 'number' && Number.isFinite(value.startRotation)) {
    motion.startRotation = value.startRotation;
  }
  if (typeof value.endRotation === 'number' && Number.isFinite(value.endRotation)) {
    motion.endRotation = value.endRotation;
  }
  return motion;
}

export function normalizeTransitions(value: unknown): TransitionSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.fromFrameId !== 'string' || typeof entry.toFrameId !== 'string') {
      return [];
    }
    const fromFrameId = entry.fromFrameId.trim();
    const toFrameId = entry.toFrameId.trim();
    if (!fromFrameId || !toFrameId) return [];

    const objectMotions: Record<string, ObjectMotion> = {};
    if (isRecord(entry.objectMotions)) {
      Object.entries(entry.objectMotions).forEach(([objectId, motionValue]) => {
        const motion = normalizeObjectMotion(motionValue);
        if (motion) {
          objectMotions[objectId] = motion;
        }
      });
    }

    return [{
      id: typeof entry.id === 'string' && entry.id.trim()
        ? entry.id.trim().slice(0, 160)
        : `transition-${index}-${fromFrameId}-${toFrameId}`,
      fromFrameId,
      toFrameId,
      ...(typeof entry.duration === 'number' && Number.isFinite(entry.duration)
        ? { duration: Math.max(0, Math.round(entry.duration)) }
        : {}),
      objectMotions,
    }];
  });
}

export interface SceneState {
  positions: Record<string, Position>;
  rotations: Record<string, number>;
  hiddenGroupIds: string[];
}

export type PerformerShape = 'circle' | 'square' | 'triangle';
export type PerformerType = 'performer' | 'prop';
export type PropGeometryType = 'box' | 'extruded';
export type PropCategory = 'prop' | 'platform';
export type PropRotationPivot = 'center' | 'left' | 'right';

export interface FaceTexture {
  dataUrl?: string;
  assetPath?: string;
  fileName?: string;
}

export interface BoxTextures {
  front?: FaceTexture;
  back?: FaceTexture;
  left?: FaceTexture;
  right?: FaceTexture;
  top?: FaceTexture;
  bottom?: FaceTexture;
}

export interface ExtrudedTextures {
  side?: FaceTexture;
  top?: FaceTexture;
  bottom?: FaceTexture;
}

export interface Performer {
  id: string;
  name: string;
  color: string;
  label: string;
  shape: PerformerShape;
  groupId?: string;
  type?: PerformerType;
  width?: number;
  height?: number;
  depth?: number;
  rotation?: number;
  propGeometryType?: PropGeometryType;
  boxTextures?: BoxTextures;
  extrudedTextures?: ExtrudedTextures;
  extrudeHeight?: number;
  polygonPoints?: { x: number; y: number }[];
  textureDataUrl?: string;
  textureAssetPath?: string;
  propShape?: 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'custom';
  propCategory?: PropCategory;
  rotationPivot?: PropRotationPivot;
  boundToId?: string;
}

export interface NoteItem {
  id: string;
  name: string;
  type: 'carry' | 'handoff' | 'event';
  description?: string;
  frameId?: string;
}

export interface PerformerNote {
  id: string;
  performerId: string;
  frameId?: string;       // undefined = global note
  content: string;
  items: NoteItem[];
  createdAt: number;
  updatedAt: number;
}

export interface PerformerGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
  type?: 'performer' | 'prop';
}

export interface Frame {
  id: string;
  name: string;
  startTime: number;
  duration: number;
  positions: Record<string, Position>;
  rotations?: Record<string, number>;
  notes?: string;
  hiddenGroupIds?: string[];
}

function normalizeRotationMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isFinite(entry[1])
    )),
  );
}

export function normalizeFrames(value: unknown): Frame[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)
      || typeof entry.id !== 'string'
      || typeof entry.name !== 'string'
      || typeof entry.startTime !== 'number'
      || typeof entry.duration !== 'number'
      || !isRecord(entry.positions)) {
      return [];
    }
    return [{
      ...entry,
      id: entry.id,
      name: entry.name,
      startTime: entry.startTime,
      duration: entry.duration,
      positions: entry.positions as Record<string, Position>,
      rotations: normalizeRotationMap(entry.rotations),
    } as Frame];
  });
}

export function normalizePerformers(value: unknown): Performer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') {
      return [];
    }
    const performer = { ...entry } as unknown as Performer;
    performer.rotationPivot = performer.type === 'prop' && performer.propCategory !== 'platform'
      && (entry.rotationPivot === 'left' || entry.rotationPivot === 'right')
      ? entry.rotationPivot
      : 'center';
    return [performer];
  });
}

export interface LEDContent {
  type: 'none' | 'color' | 'image' | 'video';
  value?: string;
  loop?: boolean;
}

export interface StageBackground {
  value: string;
  opacity: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface StageConfig {
  width: number;
  depth: number;
  wingWidth?: number;
  ledWidth?: number;
  ledHeight?: number;
  ledContent?: LEDContent;
  background?: StageBackground;
  showStageLines?: boolean;
  ledDistanceFromBack?: number;
}

export interface AudioMarker {
  id: string;
  label: string;
  timeMs: number;
  color: string;
}

export interface ProjectDocument {
  version: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  musicName?: string | null;
  musicAsset?: string | null;
  performers: Performer[];
  performerGroups: PerformerGroup[];
  frames: Frame[];
  transitions?: TransitionSegment[];
  audioMarkers?: AudioMarker[];
  stageConfig: StageConfig;
  performerNotes?: PerformerNote[];
}

export type ProjectAssetKind = 'audio' | 'background' | 'stage-background';

export interface ProjectAssetResult {
  relativePath: string;
  displayName: string;
  url: string;
}

export interface ProjectWarning {
  code: 'missing_asset' | 'invalid_asset' | 'legacy_resource_missing';
  resource: string;
  message: string;
}

export interface ProjectLoadResult {
  data: ProjectDocument;
  projectPath: string;
  audioUrl: string | null;
  mediaUrls: Record<string, string>;
  warnings: ProjectWarning[];
}

export interface ProjectImportResult extends ProjectLoadResult {
  projectId: string;
}
