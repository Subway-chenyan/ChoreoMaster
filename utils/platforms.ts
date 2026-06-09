import type { Performer, Position, StageConfig } from '../types.ts';
import { pointInPolygon } from '../components/prop-editor/PolygonUtils.ts';

export function isPlatformProp(performer: Performer): boolean {
  return performer.type === 'prop' && performer.propCategory === 'platform';
}

export function getPlatformHeight(performer: Performer): number {
  if (!isPlatformProp(performer)) {
    return 0;
  }
  return Math.max(0, performer.height ?? 0);
}

function toLocalMeters(
  performerPosition: Position,
  platformPosition: Position,
  stageConfig: StageConfig,
  rotationDegrees: number,
): { x: number; y: number } {
  const deltaX = ((performerPosition.x - platformPosition.x) * stageConfig.width) / 100;
  const deltaY = ((performerPosition.y - platformPosition.y) * stageConfig.depth) / 100;
  const radians = (-rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: deltaX * cos - deltaY * sin,
    y: deltaX * sin + deltaY * cos,
  };
}

export function isPerformerOnPlatform(
  performerPosition: Position | undefined,
  platform: Performer,
  platformPosition: Position | undefined,
  stageConfig: StageConfig,
): boolean {
  if (!performerPosition || !platformPosition || !isPlatformProp(platform)) {
    return false;
  }

  const localPoint = toLocalMeters(
    performerPosition,
    platformPosition,
    stageConfig,
    platform.rotation || 0,
  );

  if (platform.propGeometryType === 'extruded' && platform.polygonPoints && platform.polygonPoints.length >= 3) {
    const width = Math.max(platform.width || 1, 0.1);
    const depth = Math.max(platform.depth || 1, 0.1);
    const normalizedPoint = {
      x: localPoint.x / width + 0.5,
      y: localPoint.y / depth + 0.5,
    };
    return pointInPolygon(normalizedPoint, platform.polygonPoints);
  }

  const halfWidth = (platform.width || 1) / 2;
  const halfDepth = (platform.depth || 1) / 2;
  return Math.abs(localPoint.x) <= halfWidth && Math.abs(localPoint.y) <= halfDepth;
}

export interface PlatformOccupancy {
  entityLiftById: Record<string, number>;
  entityPlatformIds: Record<string, string[]>;
  occupiedPlatformIds: Set<string>;
}

export function buildPlatformOccupancy(
  performers: Performer[],
  positions: Record<string, Position>,
  stageConfig: StageConfig,
): PlatformOccupancy {
  const platforms = performers.filter(isPlatformProp);
  const entityLiftById: Record<string, number> = {};
  const entityPlatformIds: Record<string, string[]> = {};
  const occupiedPlatformIds = new Set<string>();

  performers.forEach((entity) => {
    if (isPlatformProp(entity)) {
      return;
    }

    const entityPosition = positions[entity.id];
    if (!entityPosition) {
      return;
    }

    const overlappingPlatforms = platforms.filter((platform) =>
      isPerformerOnPlatform(entityPosition, platform, positions[platform.id], stageConfig),
    );

    if (overlappingPlatforms.length === 0) {
      return;
    }

    entityPlatformIds[entity.id] = overlappingPlatforms.map((platform) => platform.id);
    entityLiftById[entity.id] = overlappingPlatforms.reduce(
      (maxHeight, platform) => Math.max(maxHeight, getPlatformHeight(platform)),
      0,
    );

    overlappingPlatforms.forEach((platform) => {
      occupiedPlatformIds.add(platform.id);
    });
  });

  return {
    entityLiftById,
    entityPlatformIds,
    occupiedPlatformIds,
  };
}
