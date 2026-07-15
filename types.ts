
export type {
  AppSettings,
  AudioMarker,
  BoxTextures,
  ExtrudedTextures,
  FaceTexture,
  Frame,
  LEDContent,
  MotionControlPoint,
  MotionPathType,
  ObjectMotion,
  Performer,
  PerformerGroup,
  PerformerShape,
  PerformerType,
  Position,
  ProjectAssetKind,
  ProjectAssetResult,
  ChoreographyDocument,
  ProjectDocument,
  ProjectImportResult,
  ProjectLoadResult,
  ProjectMeta,
  ProjectTemplateData,
  ProjectRecoverySnapshot,
  ProjectWarning,
  PropCategory,
  PropGeometryType,
  PropRotationPivot,
  RotationMode,
  SceneState,
  StageBackground,
  StageConfig,
  TransitionSegment,
  PerformerNote,
  NoteItem,
} from './electron/project-contract';

export {
  normalizeFrames,
  normalizePerformers,
  normalizeTransitions,
} from './electron/project-contract';

import type {
  Frame,
  MotionControlPoint,
  ObjectMotion,
  Performer,
  PerformerGroup,
  PerformerShape,
  Position,
  PropCategory,
  PropGeometryType,
  SceneState,
  StageConfig,
  TransitionSegment,
} from './electron/project-contract';

export interface Project {
  name: string;
  performers: Performer[];
  groups: PerformerGroup[];
  frames: Frame[];
  transitions?: TransitionSegment[];
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
  transitions?: TransitionSegment[];
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
  propCategory?: PropCategory;
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

export interface GapSegment {
  id: string;
  start: number;
  end: number;
  duration: number;
  prevId: string | null;
  nextId: string;
  transition: TransitionSegment | null;
}

export interface TransitionSelection {
  transitionId: string;
  performerId: string | null;
}

export interface TransitionFrameContext {
  fromFrame: Frame;
  toFrame: Frame;
  motion: ObjectMotion;
}

export interface TransitionPathDisplay {
  performerId: string;
  color: string;
  start: Position;
  end: Position;
  pathType: 'linear' | 'bezier';
  controlPoints: MotionControlPoint[];
  isSelected: boolean;
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
