import type { StageConfig } from '../types';

export interface StageDimensions {
  width: number;
  depth: number;
}

export function calculateStageDimensionsFromImage(
  totalWidth: number,
  wingWidth: number,
  pixelWidth: number,
  pixelHeight: number,
): StageDimensions | null {
  if (![totalWidth, wingWidth, pixelWidth, pixelHeight].every(Number.isFinite)) return null;
  if (pixelWidth <= 0 || pixelHeight <= 0 || wingWidth < 0 || totalWidth <= wingWidth * 2) return null;
  return {
    width: totalWidth - wingWidth * 2,
    depth: totalWidth * pixelHeight / pixelWidth,
  };
}

export function clampStageBackgroundOpacity(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value as number));
}

export function getLedDistanceFromBack(config: StageConfig): number {
  const value = Number.isFinite(config.ledDistanceFromBack)
    ? config.ledDistanceFromBack as number
    : 0;
  return Math.max(0, Math.min(config.depth, value));
}

export function getLedBottomHeight(config: StageConfig): number {
  const value = Number.isFinite(config.ledBottomHeight)
    ? config.ledBottomHeight as number
    : 0;
  return Math.max(0, Math.min(30, value));
}

export function getLedZPosition(config: StageConfig): number {
  return -config.depth / 2 + getLedDistanceFromBack(config);
}

export function getLedStageYPercent(config: StageConfig): number {
  return config.depth > 0 ? getLedDistanceFromBack(config) / config.depth * 100 : 0;
}

export function resolveStageBackgroundUrl(
  config: StageConfig,
  mediaCache: Record<string, string>,
): string | null {
  return resolveStageMediaUrl(config.background?.value, mediaCache);
}

/** Resolve both persisted project assets and browser-local media URLs. */
export function resolveStageMediaUrl(
  value: string | undefined,
  mediaCache: Record<string, string>,
): string | null {
  return value ? mediaCache[value] ?? value : null;
}
