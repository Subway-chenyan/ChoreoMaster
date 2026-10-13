import type { Frame, Performer, Position, ProjectDocument } from '../types';
import { getStageXBounds } from '../utils/coordinates';
import { PROJECT_SCHEMA_VERSION } from '../electron/model-asset-contract';
import { getEffectivelyLockedPerformerIds } from '../utils/performer-locking';

export function createMobileDocument(name: string, id: () => string): ProjectDocument {
  return {
    version: PROJECT_SCHEMA_VERSION,
    name: name.trim() || '新的编排',
    modelAssets: {},
    performers: [],
    performerGroups: [],
    frames: [{ id: id(), name: '开场', startTime: 0, duration: 4000, positions: {}, rotations: {} }],
    transitions: [],
    audioMarkers: [],
    musicAsset: null,
    musicName: null,
    performerNotes: [],
    stageConfig: {
      width: 14,
      depth: 8,
      wingWidth: 2,
      showStageLines: true,
      performerLabelFontSize: 10,
      ledContent: { type: 'none' },
    },
  };
}
export function moveActors(
  document: ProjectDocument,
  frameId: string,
  updates: { id: string; pos: Position }[]
): ProjectDocument {
  const locked = new Set(getEffectivelyLockedPerformerIds(document.performers, document.performerGroups));
  return {
    ...document,
    frames: document.frames.map((frame) => {
      if (frame.id !== frameId) return frame;
      const positions = { ...frame.positions };
      for (const update of updates) {
        if (
          !locked.has(update.id) &&
          positions[update.id] &&
          Number.isFinite(update.pos.x) &&
          Number.isFinite(update.pos.y)
        ) {
          positions[update.id] = { ...positions[update.id], ...update.pos };
        }
      }
      return { ...frame, positions };
    }),
  };
}
export function addActor(document: ProjectDocument, performer: Performer): ProjectDocument {
  const index = document.performers.length;
  const position = { x: 20 + (index % 6) * 12, y: 25 + (Math.floor(index / 6) % 5) * 12 };
  return {
    ...document,
    performers: [...document.performers, performer],
    frames: document.frames.map((frame) => ({
      ...frame,
      positions: { ...frame.positions, [performer.id]: position },
    })),
  };
}
export function removeActors(document: ProjectDocument, ids: string[]): ProjectDocument {
  const locked = new Set(getEffectivelyLockedPerformerIds(document.performers, document.performerGroups));
  const removed = new Set(ids.filter((id) => !locked.has(id)));
  const omit = <T>(map: Record<string, T> = {}) =>
    Object.fromEntries(Object.entries(map).filter(([id]) => !removed.has(id)));
  return {
    ...document,
    performers: document.performers
      .filter((p) => !removed.has(p.id))
      .map((p) => (p.boundToId && removed.has(p.boundToId) ? { ...p, boundToId: undefined } : p)),
    frames: document.frames.map((frame) => ({
      ...frame,
      positions: omit(frame.positions),
      rotations: omit(frame.rotations),
    })),
    transitions: document.transitions?.map((transition) => ({
      ...transition,
      objectMotions: omit(transition.objectMotions),
    })),
    performerNotes: document.performerNotes?.filter((note) => !removed.has(note.performerId)),
  };
}
export function duplicateFormation(document: ProjectDocument, frameId: string, id: string): ProjectDocument {
  const frames = [...document.frames].sort((a, b) => a.startTime - b.startTime);
  const source = frames.find((frame) => frame.id === frameId);
  if (!source) return document;
  const offset = source.duration + 2000;
  const nextFrame: Frame = {
    ...structuredClone(source),
    id,
    name: `${source.name} 副本`,
    startTime: source.startTime + offset,
  };
  return {
    ...document,
    frames: [
      ...frames.map((frame) =>
        frame.startTime > source.startTime ? { ...frame, startTime: frame.startTime + offset } : frame
      ),
      nextFrame,
    ].sort((a, b) => a.startTime - b.startTime),
    transitions: document.transitions?.map((transition) =>
      transition.fromFrameId === frameId ? { ...transition, fromFrameId: id } : transition
    ),
  };
}
export function removeFormation(document: ProjectDocument, id: string): ProjectDocument {
  if (document.frames.length <= 1) return document;
  return {
    ...document,
    frames: document.frames.filter((frame) => frame.id !== id),
    transitions: document.transitions?.filter((t) => t.fromFrameId !== id && t.toFrameId !== id),
    performerNotes: document.performerNotes?.filter((note) => note.frameId !== id),
  };
}
export function changeFormationDuration(
  document: ProjectDocument,
  id: string,
  duration: number
): ProjectDocument {
  const frame = document.frames.find((item) => item.id === id);
  if (!frame || !Number.isFinite(duration)) return document;
  const next = Math.max(100, Math.min(600000, Math.round(duration)));
  const delta = next - frame.duration;
  return {
    ...document,
    frames: document.frames.map((item) =>
      item.id === id
        ? { ...item, duration: next }
        : item.startTime > frame.startTime
        ? { ...item, startTime: item.startTime + delta }
        : item
    ),
  };
}

export interface EditHistory {
  past: ProjectDocument[];
  present: ProjectDocument;
  future: ProjectDocument[];
}
export type HistoryAction =
  | { type: 'commit'; document: ProjectDocument }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; document: ProjectDocument };
export function editHistory(state: EditHistory, action: HistoryAction): EditHistory {
  if (action.type === 'reset') return { past: [], present: action.document, future: [] };
  if (action.type === 'commit')
    return action.document === state.present
      ? state
      : { past: [...state.past.slice(-39), state.present], present: action.document, future: [] };
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    return previous
      ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] }
      : state;
  }
  const next = state.future[0];
  return next
    ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) }
    : state;
}

// 微调按物理米数换算，一起约束整组位移，避免触边后队形被压扁。
export function nudgeActors(
  document: ProjectDocument,
  frameId: string,
  ids: string[],
  dxMeters: number,
  dyMeters: number
): ProjectDocument {
  const frame = document.frames.find((item) => item.id === frameId);
  const { width, depth } = document.stageConfig;
  if (!frame || ![dxMeters, dyMeters, width, depth].every(Number.isFinite) || width <= 0 || depth <= 0)
    return document;
  const locked = new Set(getEffectivelyLockedPerformerIds(document.performers, document.performerGroups));
  const selected = new Set(ids);
  const movable = document.performers.filter(
    (actor) => selected.has(actor.id) && !locked.has(actor.id) && frame.positions[actor.id]
  );
  if (!movable.length) return document;
  const bounds = getStageXBounds(document.stageConfig);
  const constrain = (delta: number, values: number[], min: number, max: number) => {
    // 已在边界外的旧项目只允许向舞台内移动，不做额外跳跃修复。
    return delta > 0
      ? Math.min(delta, Math.max(0, max - Math.max(...values)))
      : Math.max(delta, Math.min(0, min - Math.min(...values)));
  };
  const dx = constrain(
    (dxMeters / width) * 100,
    movable.map((actor) => frame.positions[actor.id].x),
    bounds.min,
    bounds.max
  );
  const dy = constrain(
    (dyMeters / depth) * 100,
    movable.map((actor) => frame.positions[actor.id].y),
    0,
    100
  );
  if (dx === 0 && dy === 0) return document;
  return moveActors(
    document,
    frameId,
    movable.map((actor) => ({
      id: actor.id,
      pos: {
        ...frame.positions[actor.id],
        x: frame.positions[actor.id].x + dx,
        y: frame.positions[actor.id].y + dy,
      },
    }))
  );
}
