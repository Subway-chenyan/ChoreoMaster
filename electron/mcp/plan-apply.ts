import { randomUUID } from 'crypto';
import type {
  Frame,
  Performer,
  PerformerGroup,
  Position,
  ProjectDocument,
} from '../project-contract.js';

// AIChoreoPlan 格式镜像（与前端 App.tsx applyAIPlan / 后端 models.py AIChoreoPlan 对齐）
export interface AIPlanGroupCreate {
  tempId: string;
  name: string;
  color: string;
  type?: 'performer' | 'prop';
}

export interface AIPlanEntityCreate {
  tempId: string;
  type?: 'performer' | 'prop';
  name: string;
  color: string;
  label?: string;
  shape?: Performer['shape'];
  groupTempId?: string;
  width?: number;
  height?: number;
  depth?: number;
  rotation?: number;
  propGeometryType?: 'box' | 'extruded';
  propCategory?: 'prop' | 'platform';
}

export interface AIPlanFrameCreate {
  tempId?: string;
  name: string;
  startTime: number;
  duration: number;
  positions: Record<string, Position>;
  notes?: string;
}

export interface AIPlanPositionUpdate {
  frameId: string;
  positions: Record<string, Position>;
}

export interface AIChoreoPlan {
  intent?: 'initialize_project' | 'create_entities' | 'generate_formation' | 'generate_motion_frames' | string;
  summary?: string;
  warnings?: string[];
  groupsToCreate?: AIPlanGroupCreate[];
  entitiesToCreate?: AIPlanEntityCreate[];
  framesToCreate?: AIPlanFrameCreate[];
  positionUpdates?: AIPlanPositionUpdate[];
}

export function generateEntityId(): string {
  return randomUUID();
}

// 镜像前端 App.tsx createGridPosition：新实体在既有帧的网格占位排布
export function createGridPosition(index: number, count: number): Position {
  const cols = Math.ceil(Math.sqrt(Math.max(count, 1)));
  const rows = Math.ceil(count / cols);
  const spreadX = Math.min(70, Math.max(20, cols * 12));
  const spreadY = Math.min(70, Math.max(20, rows * 12));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: 50 - spreadX / 2 + (cols > 1 ? (spreadX / (cols - 1)) * col : spreadX / 2),
    y: 50 - spreadY / 2 + (rows > 1 ? (spreadY / (rows - 1)) * row : spreadY / 2),
  };
}

function clampPosition(position: Position): Position {
  return {
    x: Math.max(2, Math.min(98, position.x)),
    y: Math.max(2, Math.min(98, position.y)),
    ...(position.z !== undefined ? { z: position.z } : {}),
  };
}

export interface ApplyPlanResult {
  document: ProjectDocument;
  createdEntityIds: string[];
  createdFrameIds: string[];
}

// 主进程版 AIChoreoPlan 应用，语义对齐前端 App.tsx applyAIPlan：
// tempId → 真实 id 映射、新实体在既有帧网格补位、坐标 clamp 2-98、positionUpdates 合并、帧按 startTime 排序
export function applyChoreoPlan(
  base: ProjectDocument,
  plan: AIChoreoPlan,
  overwrite: boolean,
): ApplyPlanResult {
  const baseFrames: Frame[] = overwrite
    ? [{ id: 'start-frame', name: 'Opening', startTime: 0, duration: 2000, positions: {}, rotations: {} }]
    : base.frames.map((frame) => structuredClone(frame));
  const basePerformers: Performer[] = overwrite ? [] : base.performers.map((p) => structuredClone(p));
  const baseGroups: PerformerGroup[] = overwrite ? [] : base.performerGroups.map((g) => structuredClone(g));

  const groupIdByTempId = new Map<string, string>();
  const performerIdByTempId = new Map<string, string>();

  const newGroups: PerformerGroup[] = (plan.groupsToCreate ?? []).map((group) => {
    const id = generateEntityId();
    groupIdByTempId.set(group.tempId, id);
    return {
      id,
      name: group.name,
      color: group.color,
      collapsed: false,
      type: group.type || 'performer',
    };
  });

  const newPerformers: Performer[] = (plan.entitiesToCreate ?? []).map((entity) => {
    const id = generateEntityId();
    performerIdByTempId.set(entity.tempId, id);
    return {
      id,
      name: entity.name,
      color: entity.color,
      label: entity.label || entity.name.charAt(0).toUpperCase(),
      shape: entity.shape || (entity.type === 'prop' ? 'square' : 'circle'),
      type: entity.type,
      groupId: entity.groupTempId ? groupIdByTempId.get(entity.groupTempId) : undefined,
      width: entity.type === 'prop' ? (entity.width ?? 1) : entity.width,
      height: entity.type === 'prop' ? (entity.height ?? 2) : entity.height,
      depth: entity.type === 'prop' ? (entity.depth ?? 0.3) : entity.depth,
      rotation: entity.rotation,
      propGeometryType: entity.propGeometryType || (entity.type === 'prop' ? 'box' : undefined),
      propCategory: entity.type === 'prop' ? (entity.propCategory ?? 'prop') : undefined,
    };
  });

  const allPerformers = [...basePerformers, ...newPerformers];
  const allGroups = [...baseGroups, ...newGroups];

  // 新实体在既有帧自动补网格占位（与前端 applyAIPlan 一致）
  const framesWithEntities = baseFrames.map((frame) => {
    const positions = { ...frame.positions };
    newPerformers.forEach((performer, index) => {
      positions[performer.id] = createGridPosition(basePerformers.length + index, allPerformers.length);
    });
    return { ...frame, positions };
  });

  const remapPositions = (positions: Record<string, Position>): Record<string, Position> => {
    const remapped: Record<string, Position> = {};
    Object.entries(positions).forEach(([id, pos]) => {
      remapped[performerIdByTempId.get(id) || id] = clampPosition(pos);
    });
    return remapped;
  };

  const createdFrames: Frame[] = (plan.framesToCreate ?? []).map((frame) => ({
    id: generateEntityId(),
    name: frame.name,
    startTime: frame.startTime,
    duration: frame.duration,
    positions: remapPositions(frame.positions),
    notes: frame.notes,
  }));

  let nextFrames = [...framesWithEntities, ...createdFrames];
  (plan.positionUpdates ?? []).forEach((update) => {
    nextFrames = nextFrames.map((frame) => {
      if (frame.id !== update.frameId) return frame;
      return {
        ...frame,
        positions: {
          ...frame.positions,
          ...remapPositions(update.positions),
        },
      };
    });
  });
  nextFrames.sort((a, b) => a.startTime - b.startTime);

  return {
    document: {
      ...base,
      performerGroups: allGroups,
      performers: allPerformers,
      frames: nextFrames,
    },
    createdEntityIds: newPerformers.map((p) => p.id),
    createdFrameIds: createdFrames.map((f) => f.id),
  };
}
