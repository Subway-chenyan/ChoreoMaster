const WHEEL_LINE_HEIGHT_PX = 16;

interface WheelDeltaInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
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
