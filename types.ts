
export interface Position {
  x: number; // Main-stage percentage; wings may extend below 0 or above 100
  y: number; // Percentage 0-100
  z?: number; // Optional height in meters (0 = ground)
}

export type PerformerShape = 'circle' | 'square' | 'triangle';

export type PerformerType = 'performer' | 'prop';

export type PropGeometryType = 'box' | 'extruded';


export interface FaceTexture {
  dataUrl: string;
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
  groupId?: string; // Optional group membership
  type?: PerformerType;
  width?: number; // Width in meters
  height?: number; // Height in meters
  depth?: number; // Depth in meters (for 3D props)
  rotation?: number; // Rotation in degrees
  propGeometryType?: PropGeometryType;
  boxTextures?: BoxTextures;
  extrudedTextures?: ExtrudedTextures;
  extrudeHeight?: number;
  polygonPoints?: { x: number; y: number }[];
  textureDataUrl?: string;
  propShape?: 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'custom';
  boundToId?: string;
}

export interface PerformerGroup {
  id: string;
  name: string;
  color: string; // Group theme color
  collapsed: boolean; // Whether the group is collapsed in UI
  type?: 'performer' | 'prop'; // Group type
}

export interface Frame {
  id: string;
  name: string;
  startTime: number; // Absolute start time in ms
  duration: number; // How long the formation is held (ms)
  positions: Record<string, Position>; // Map performer ID to position
  notes?: string;
  hiddenGroupIds?: string[]; // IDs of groups that are hidden in this frame
}

export interface Project {
  name: string;
  performers: Performer[];
  groups: PerformerGroup[];
  frames: Frame[];
  musicUrl: string | null;
  audioBuffer: AudioBuffer | null;
}

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export enum ToolMode {
  SELECT = 'SELECT',
  ADD_PERFORMER = 'ADD_PERFORMER',
}

export interface StageConfig {
  width: number; // Stage width in meters (default 20)
  depth: number; // Stage depth in meters
  wingWidth?: number; // Width of each offstage wing in meters
  ledWidth?: number; // LED wall width in meters
  ledHeight?: number; // LED wall height in meters
  ledContent?: LEDContent;
}

export interface LEDContent {
  type: 'none' | 'color' | 'image' | 'video';
  value?: string; // Color hex or filename reference
  loop?: boolean; // For video looping
}

export interface Entity {
  id: string;
  name: string;
  type: 'performer' | 'prop';
  position: Position;
  color: string;
  rotation?: number;
  dimensions?: {
    width: number;
    height: number;
    depth: number;
  };
}
export type AIChoreoTaskType = 'auto' | 'initialize_project' | 'create_entities' | 'generate_formation' | 'generate_motion_frames';

export interface AIConfig {
  backendUrl: string;
  memberToken: string;
}

export interface AIProjectSnapshot {
  performers: Performer[];
  performerGroups: PerformerGroup[];
  frames: Frame[];
  stageConfig: StageConfig;
}

export interface AIChoreoRequest {
  prompt: string;
  taskType?: AIChoreoTaskType;
  project: AIProjectSnapshot;
  selectedPerformerIds: string[];
  currentFrameId: string | null;
  applyMode?: 'preview' | 'direct';
}

export interface AIGroupCreate {
  tempId: string;
  name: string;
  color: string;
  type?: 'performer' | 'prop';
}

export interface AIEntityCreate {
  tempId: string;
  type: 'performer' | 'prop';
  name: string;
  color: string;
  label?: string;
  shape?: PerformerShape;
  groupTempId?: string;
  width?: number;
  height?: number;
  depth?: number;
  rotation?: number;
  propGeometryType?: PropGeometryType;
}

export interface AIFrameCreate {
  tempId: string;
  name: string;
  startTime: number;
  duration: number;
  positions: Record<string, Position>;
  notes?: string;
}

export interface AIPositionUpdate {
  frameId: string;
  positions: Record<string, Position>;
}

export interface AIChoreoPlan {
  intent: Exclude<AIChoreoTaskType, 'auto'>;
  summary: string;
  groupsToCreate: AIGroupCreate[];
  entitiesToCreate: AIEntityCreate[];
  framesToCreate: AIFrameCreate[];
  positionUpdates: AIPositionUpdate[];
  warnings: string[];
}

export interface ChoreoTimedInsight {
  timestampMs: number;
  label: string;
  description: string;
  confidence: number;
}

export interface ChoreoAudioAnalysis {
  segmentStartMs: number;
  segmentEndMs: number;
  estimatedBpm: number;
  rhythmicFeel: string;
  dynamics: string;
  emotion: string;
  significantMoments: ChoreoTimedInsight[];
  formationChangeCandidates: ChoreoTimedInsight[];
}

export interface ChoreoSketchElement {
  id: string;
  shape: 'ellipse' | 'triangle' | 'rectangle' | 'square' | 'line' | 'other';
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | null;
  possibleRole: 'actor' | 'prop' | 'unknown';
  confidence: number;
}

export interface ChoreoSketchAnalysis {
  stageOrientation: 'top_is_back' | 'bottom_is_back' | 'left_is_back' | 'right_is_back' | 'unknown';
  elements: ChoreoSketchElement[];
  spatialSummary: string;
  ambiguities: string[];
  questions: string[];
}

export interface ChoreoPropDimensions {
  width: number;
  depth: number;
  height: number;
}

export interface ChoreoInitialProposal {
  summary: string;
  formations: Array<{
    id: string;
    name: string;
    timeMs: number;
    description: string;
    sourceElementIds: string[];
  }>;
  questions: string[];
  risks: string[];
}

export interface ChoreoDesignSummary {
  summary: string;
  musicRationale: string;
  sketchRationale: string;
  formationSequence: string[];
  risks: string[];
}

export interface ChoreoAgentSession {
  id: string;
  status: string;
  phase: string;
  interrupt?: {
    type: 'initial_approval' | 'final_approval';
    message: string;
    allowedActions: Array<'approve' | 'edit' | 'reject'>;
  } | null;
  audioAnalysis?: ChoreoAudioAnalysis | null;
  sketchAnalysis?: ChoreoSketchAnalysis | null;
  initialProposal?: ChoreoInitialProposal | null;
  designSummary?: ChoreoDesignSummary | null;
  draft?: {
    id: string;
    sessionId: string;
    plan: AIChoreoPlan;
    validation: {
      valid: boolean;
      segmentStartMs: number;
      segmentEndMs: number;
      entityCount: number;
      frameCount: number;
    };
  } | null;
  callLog: Array<{ model: string; purpose: string }>;
}
