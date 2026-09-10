import type { Frame, Position, StageConfig } from '../types.ts';
import { getTotalStageWidth } from './coordinates.ts';

export function calculateModelStageFitScale(
  stageConfig: StageConfig,
  size: { width: number; depth: number },
): number {
  const width = Math.max(size.width, Number.EPSILON);
  const depth = Math.max(size.depth, Number.EPSILON);
  return Math.min(
    1,
    0.9 * getTotalStageWidth(stageConfig) / width,
    0.9 * stageConfig.depth / depth,
  );
}

export function createForwardFrameUpdates(
  frames: Frame[],
  currentFrameId: string,
  performerId: string,
  position: Position,
  rotation: number = 0,
): Record<string, { positions: Record<string, Position>; rotations: Record<string, number> }> {
  const currentFrame = frames.find((frame) => frame.id === currentFrameId);
  const threshold = currentFrame?.startTime ?? Number.NEGATIVE_INFINITY;
  return Object.fromEntries(
    frames
      .filter((frame) => frame.startTime >= threshold)
      .map((frame) => [frame.id, {
        positions: { [performerId]: { ...position } },
        rotations: { [performerId]: rotation },
      }]),
  );
}
