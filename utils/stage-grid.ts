import type { Position, StageConfig } from '../types';
import { getStageXBounds } from './coordinates.ts';

export const MIN_STAGE_GRID_SPACING = 0.1;
export const MAX_STAGE_GRID_SPACING = 2.5;
export const STAGE_GRID_SPACING_STEP = 0.1;
export const STAGE_GRID_LABEL_MIN_SPACING = 0.5;
export const DEFAULT_STAGE_GRID_SPACING = 1;
export const STAGE_THIRD_POSITIONS = [1 / 3, 2 / 3] as const;

export interface StageGridMark {
  offsetMeters: number;
  positionRatio: number;
}

export function normalizeStageGridSpacing(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_STAGE_GRID_SPACING;
  const steppedValue = Number((Math.round(value / STAGE_GRID_SPACING_STEP) * STAGE_GRID_SPACING_STEP).toFixed(1));
  return Math.max(MIN_STAGE_GRID_SPACING, Math.min(MAX_STAGE_GRID_SPACING, steppedValue));
}

export function shouldShowStageGridLabels(spacing: number): boolean {
  return normalizeStageGridSpacing(spacing) >= STAGE_GRID_LABEL_MIN_SPACING;
}

export function createCenteredStageGridMarks(totalWidth: number, spacing: number): StageGridMark[] {
  if (!Number.isFinite(totalWidth) || totalWidth <= 0) return [];

  const normalizedSpacing = normalizeStageGridSpacing(spacing);
  const halfWidth = totalWidth / 2;
  const markCountPerSide = Math.floor((halfWidth + Number.EPSILON) / normalizedSpacing);

  return Array.from({ length: markCountPerSide * 2 + 1 }, (_, index) => {
    const offsetMeters = (index - markCountPerSide) * normalizedSpacing;
    return {
      offsetMeters,
      positionRatio: (offsetMeters + halfWidth) / totalWidth,
    };
  });
}

export function formatStageGridLabel(offsetMeters: number): string {
  return `${Number(Math.abs(offsetMeters).toFixed(1))}m`;
}

export function snapStagePosition(position: Position, spacing: number, stageConfig: StageConfig): Position {
  const normalizedSpacing = normalizeStageGridSpacing(spacing);
  const xMeters = ((position.x - 50) / 100) * stageConfig.width;
  const yMeters = ((position.y - 50) / 100) * stageConfig.depth;
  const xBounds = getStageXBounds(stageConfig);
  const snappedX = 50 + ((Math.round(xMeters / normalizedSpacing) * normalizedSpacing) / stageConfig.width) * 100;
  const snappedY = 50 + ((Math.round(yMeters / normalizedSpacing) * normalizedSpacing) / stageConfig.depth) * 100;

  return {
    ...position,
    x: Math.max(xBounds.min, Math.min(xBounds.max, Number(snappedX.toFixed(6)))),
    y: Math.max(0, Math.min(100, Number(snappedY.toFixed(6)))),
  };
}
