import type { Performer, Position, PropRotationPivot, StageConfig } from '../types';

function getPivotOffsetMeters(
  performer: Pick<Performer, 'width'>,
  pivot: PropRotationPivot,
): number {
  const halfWidth = Math.max(performer.width ?? 1, 0) / 2;
  if (pivot === 'left') return halfWidth;
  if (pivot === 'right') return -halfWidth;
  return 0;
}

function getRotatedOffset(
  rotationDegrees: number,
  offsetMeters: number,
  stageConfig: StageConfig,
): Position {
  const radians = (rotationDegrees * Math.PI) / 180;
  return {
    x: ((Math.cos(radians) * offsetMeters) / stageConfig.width) * 100,
    y: ((Math.sin(radians) * offsetMeters) / stageConfig.depth) * 100,
  };
}

export function getPropCenterFromAnchor(
  anchor: Position,
  rotationDegrees: number,
  performer: Pick<Performer, 'width' | 'rotationPivot'>,
  stageConfig: StageConfig,
): Position {
  const offset = getRotatedOffset(
    rotationDegrees,
    getPivotOffsetMeters(performer, performer.rotationPivot ?? 'center'),
    stageConfig,
  );
  return {
    x: anchor.x + offset.x,
    y: anchor.y + offset.y,
    ...(anchor.z !== undefined ? { z: anchor.z } : {}),
  };
}

export function getPropAnchorFromCenter(
  center: Position,
  rotationDegrees: number,
  performer: Pick<Performer, 'width' | 'rotationPivot'>,
  stageConfig: StageConfig,
): Position {
  const offset = getRotatedOffset(
    rotationDegrees,
    getPivotOffsetMeters(performer, performer.rotationPivot ?? 'center'),
    stageConfig,
  );
  return {
    x: center.x - offset.x,
    y: center.y - offset.y,
    ...(center.z !== undefined ? { z: center.z } : {}),
  };
}

export function migratePropAnchor(
  anchor: Position,
  rotationDegrees: number,
  performer: Pick<Performer, 'width'>,
  fromPivot: PropRotationPivot,
  toPivot: PropRotationPivot,
  stageConfig: StageConfig,
): Position {
  const center = getPropCenterFromAnchor(
    anchor,
    rotationDegrees,
    { ...performer, rotationPivot: fromPivot },
    stageConfig,
  );
  return getPropAnchorFromCenter(
    center,
    rotationDegrees,
    { ...performer, rotationPivot: toPivot },
    stageConfig,
  );
}
