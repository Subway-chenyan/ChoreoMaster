export interface Position {
  x: number;
  y: number;
  z?: number;
}

export type PerformerShape = 'circle' | 'square' | 'triangle';
export type PerformerType = 'performer' | 'prop';
export type PropGeometryType = 'box' | 'extruded';
export type PropCategory = 'prop' | 'platform';

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
  boundToId?: string;
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
  notes?: string;
  hiddenGroupIds?: string[];
}

export interface LEDContent {
  type: 'none' | 'color' | 'image' | 'video';
  value?: string;
  loop?: boolean;
}

export interface StageConfig {
  width: number;
  depth: number;
  wingWidth?: number;
  ledWidth?: number;
  ledHeight?: number;
  ledContent?: LEDContent;
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
  audioMarkers?: AudioMarker[];
  stageConfig: StageConfig;
}

export type ProjectAssetKind = 'audio' | 'background';

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
