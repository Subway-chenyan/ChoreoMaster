import type { Frame, Performer, Position } from '../types';

function clonePosition(position: Position): Position {
  return { ...position };
}

export function showPerformersInAllFrames(
  frames: Frame[],
  performers: Performer[],
  performerIds: string[],
  additionalGroupIds: string[] = [],
): Frame[] {
  const targetIds = new Set(performerIds);
  const targetPerformers = performers.filter((performer) => targetIds.has(performer.id));
  if (targetPerformers.length === 0) return frames;

  const groupIds = new Set([
    ...additionalGroupIds,
    ...targetPerformers.flatMap((performer) => performer.groupId ? [performer.groupId] : []),
  ]);
  const sourceByPerformerId = new Map<string, { frame: Frame; position: Position }>();

  targetPerformers.forEach((performer) => {
    const sourceFrame = frames.find((frame) => frame.positions[performer.id]);
    const position = sourceFrame?.positions[performer.id];
    if (sourceFrame && position) sourceByPerformerId.set(performer.id, { frame: sourceFrame, position });
  });

  return frames.map((frame) => {
    const positions = { ...frame.positions };
    const rotations = { ...(frame.rotations ?? {}) };

    targetPerformers.forEach((performer) => {
      if (positions[performer.id]) return;
      const source = sourceByPerformerId.get(performer.id);
      positions[performer.id] = source ? clonePosition(source.position) : { x: 50, y: 50 };
      rotations[performer.id] = source?.frame.rotations?.[performer.id] ?? performer.rotation ?? 0;
    });

    return {
      ...frame,
      positions,
      rotations,
      hiddenGroupIds: (frame.hiddenGroupIds ?? []).filter((groupId) => !groupIds.has(groupId)),
    };
  });
}
