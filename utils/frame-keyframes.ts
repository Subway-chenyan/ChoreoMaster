import type { Frame } from '../types';

export const KEYFRAME_DURATION_THRESHOLD_MS = 500;
export const MIN_FRAME_DURATION_MS = 100;

export function isKeyframeFrame(frame: Pick<Frame, 'duration'>): boolean {
  return frame.duration < KEYFRAME_DURATION_THRESHOLD_MS;
}

export function normalizeFrameDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return KEYFRAME_DURATION_THRESHOLD_MS;
  return Math.max(MIN_FRAME_DURATION_MS, Math.round(durationMs));
}

export function formatFrameDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}秒`;
}
