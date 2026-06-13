export const MIN_STAGE_GRID_SPACING = 0.5;
export const MAX_STAGE_GRID_SPACING = 2.5;
export const STAGE_GRID_SPACING_STEP = 0.5;
export const DEFAULT_STAGE_GRID_SPACING = 1;
export const STAGE_THIRD_POSITIONS = [1 / 3, 2 / 3] as const;

export interface StageGridMark {
  offsetMeters: number;
  positionRatio: number;
}

export function normalizeStageGridSpacing(value: number): number {
  const steppedValue = Math.round(value / STAGE_GRID_SPACING_STEP) * STAGE_GRID_SPACING_STEP;
  return Math.max(MIN_STAGE_GRID_SPACING, Math.min(MAX_STAGE_GRID_SPACING, steppedValue));
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
