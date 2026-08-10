const WHEEL_LINE_HEIGHT_PX = 16;

interface WheelDeltaInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

interface FollowPlayheadInput {
  playheadX: number;
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
  edgeRatio?: number;
}

export function getTimelineHorizontalWheelDelta(input: WheelDeltaInput, pageWidth: number): number {
  const unit = input.deltaMode === 1
    ? WHEEL_LINE_HEIGHT_PX
    : input.deltaMode === 2
      ? Math.max(0, pageWidth)
      : 1;
  const dominantDelta = Math.abs(input.deltaX) >= Math.abs(input.deltaY)
    ? input.deltaX
    : input.deltaY;
  return dominantDelta * unit;
}

export function getTimelineFollowPlayheadScrollLeft(input: FollowPlayheadInput): number | null {
  const {
    playheadX,
    scrollLeft,
    clientWidth,
    scrollWidth,
    edgeRatio = 0.2,
  } = input;

  if (
    !Number.isFinite(playheadX)
    || !Number.isFinite(scrollLeft)
    || !Number.isFinite(clientWidth)
    || !Number.isFinite(scrollWidth)
    || clientWidth <= 0
    || scrollWidth <= clientWidth
  ) {
    return null;
  }

  const safeEdgeRatio = Math.max(0, Math.min(0.45, edgeRatio));
  const visibleStart = scrollLeft;
  const visibleEnd = scrollLeft + clientWidth;
  const safeStart = visibleStart + clientWidth * safeEdgeRatio;
  const safeEnd = visibleEnd - clientWidth * safeEdgeRatio;

  if (playheadX >= safeStart && playheadX <= safeEnd) {
    return null;
  }

  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
  const centeredScrollLeft = Math.max(0, Math.min(maxScrollLeft, playheadX - clientWidth / 2));

  return Math.abs(centeredScrollLeft - scrollLeft) < 1 ? null : centeredScrollLeft;
}
