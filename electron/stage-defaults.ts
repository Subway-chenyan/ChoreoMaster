import type { Performer } from './project-contract';

export const DEFAULT_PERFORMER_WIDTH = 1;
export const DEFAULT_PERFORMER_DEPTH = 1;
export const DEFAULT_PERFORMER_HEIGHT = 1.8;

export const DEFAULT_PROP_WIDTH = 1;
export const DEFAULT_PROP_DEPTH = 1;
export const DEFAULT_PROP_HEIGHT = 1;

export const DEFAULT_PERFORMER_LABEL_FONT_SIZE = 10;
export const DEFAULT_PROP_LABEL_FONT_SIZE = 8;
export const MIN_LABEL_FONT_SIZE = 6;
export const MAX_LABEL_FONT_SIZE = 32;

function normalizePositiveNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max?: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  const next = Number(value);
  const upperBound = typeof max === 'number' ? Math.min(next, max) : next;
  return Math.max(min, upperBound);
}

export function normalizeLabelFontSize(
  value: number | undefined,
  fallback: number,
): number {
  return Math.round(
    normalizePositiveNumber(value, fallback, MIN_LABEL_FONT_SIZE, MAX_LABEL_FONT_SIZE),
  );
}

export function getPerformerDimensions(
  performer: Pick<Performer, 'type' | 'width' | 'height' | 'depth'>,
): { width: number; height: number; depth: number } {
  if (performer.type === 'prop') {
    return {
      width: normalizePositiveNumber(performer.width, DEFAULT_PROP_WIDTH, 0.1),
      height: normalizePositiveNumber(performer.height, DEFAULT_PROP_HEIGHT, 0.1),
      depth: normalizePositiveNumber(performer.depth, DEFAULT_PROP_DEPTH, 0.1),
    };
  }

  return {
    width: normalizePositiveNumber(performer.width, DEFAULT_PERFORMER_WIDTH, 0.1),
    height: normalizePositiveNumber(performer.height, DEFAULT_PERFORMER_HEIGHT, 0.1),
    depth: normalizePositiveNumber(performer.depth, DEFAULT_PERFORMER_DEPTH, 0.1),
  };
}

export function getStageLabelFontSize(
  performer: Pick<Performer, 'type'>,
  performerLabelFontSize: number | undefined,
  propLabelFontSize: number | undefined,
): number {
  return performer.type === 'prop'
    ? normalizeLabelFontSize(propLabelFontSize, DEFAULT_PROP_LABEL_FONT_SIZE)
    : normalizeLabelFontSize(performerLabelFontSize, DEFAULT_PERFORMER_LABEL_FONT_SIZE);
}
