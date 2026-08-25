import type {
  Frame,
  GapSegment,
  MotionControlPoint,
  ObjectMotion,
  Performer,
  Position,
  SceneState,
  TransitionSegment,
  TransitionFrameContext,
} from '../types';

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function getDefaultBezierControlPoints(
  start: Position,
  end: Position,
): [MotionControlPoint, MotionControlPoint] {
  const hasZ = start.z !== undefined || end.z !== undefined;
  return [
    {
      x: start.x + ((end.x - start.x) / 3),
      y: start.y + ((end.y - start.y) / 3),
      ...(hasZ ? { z: (start.z ?? 0) + (((end.z ?? 0) - (start.z ?? 0)) / 3) } : {}),
    },
    {
      x: start.x + (((end.x - start.x) * 2) / 3),
      y: start.y + (((end.y - start.y) * 2) / 3),
      ...(hasZ ? { z: (start.z ?? 0) + ((((end.z ?? 0) - (start.z ?? 0)) * 2) / 3) } : {}),
    },
  ];
}

export function easeInOutQuad(progress: number): number {
  return progress < 0.5
    ? 2 * progress * progress
    : -1 + (4 - 2 * progress) * progress;
}

export function getSortedFrames(frames: Frame[]): Frame[] {
  return [...frames].sort((a, b) => a.startTime - b.startTime);
}

export function findEditableFrameAtTime(timeMs: number, frames: Frame[]): Frame | null {
  const sortedFrames = getSortedFrames(frames);
  if (sortedFrames.length === 0) return null;

  const normalizedTime = Number.isFinite(timeMs) ? timeMs : 0;
  const activeFrame = sortedFrames.find((frame) => (
    normalizedTime >= frame.startTime
    && normalizedTime < frame.startTime + frame.duration
  ));
  if (activeFrame) return activeFrame;

  const nextFrame = sortedFrames.find((frame) => frame.startTime > normalizedTime);
  return nextFrame ?? sortedFrames[sortedFrames.length - 1] ?? null;
}

export function createTransitionId(fromFrameId: string, toFrameId: string): string {
  return `transition-${fromFrameId}-${toFrameId}`;
}

export function getGapSelectionId(gap: GapSegment): string {
  return gap.transition?.id ?? gap.id;
}

export function findTransitionSegment(
  transitions: TransitionSegment[],
  fromFrameId: string,
  toFrameId: string,
): TransitionSegment | null {
  return transitions.find((transition) => (
    transition.fromFrameId === fromFrameId && transition.toFrameId === toFrameId
  )) ?? null;
}

export function getGapSegments(
  frames: Frame[],
  transitions: TransitionSegment[],
): GapSegment[] {
  const sorted = getSortedFrames(frames);
  const gaps: GapSegment[] = [];

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const gapStart = current.startTime + current.duration;
    const gapEnd = next.startTime;

    if (gapEnd > gapStart) {
      gaps.push({
        id: createTransitionId(current.id, next.id),
        start: gapStart,
        end: gapEnd,
        duration: gapEnd - gapStart,
        prevId: current.id,
        nextId: next.id,
        transition: findTransitionSegment(transitions, current.id, next.id),
      });
    }
  }

  if (sorted.length > 0 && sorted[0].startTime > 0) {
    gaps.push({
      id: `transition-start-${sorted[0].id}`,
      start: 0,
      end: sorted[0].startTime,
      duration: sorted[0].startTime,
      prevId: null,
      nextId: sorted[0].id,
      transition: null,
    });
  }

  return gaps;
}

export function getTransitionFrameContext(
  frames: Frame[],
  transitions: TransitionSegment[],
  transitionId: string,
): TransitionFrameContext | null {
  const transition = transitions.find((item) => item.id === transitionId);
  if (!transition) return null;
  const fromFrame = frames.find((frame) => frame.id === transition.fromFrameId);
  const toFrame = frames.find((frame) => frame.id === transition.toFrameId);
  if (!fromFrame || !toFrame) return null;
  return {
    fromFrame,
    toFrame,
    motion: {},
  };
}

function normalizeRotation(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value as number : fallback;
}

export function interpolateRotationShortest(
  startRotation: number,
  endRotation: number,
  progress: number,
): number {
  const rawDelta = endRotation - startRotation;
  let shortestDelta = ((rawDelta + 180) % 360 + 360) % 360 - 180;
  if (shortestDelta === -180 && rawDelta > 0) {
    shortestDelta = 180;
  }
  return startRotation + shortestDelta * progress;
}

function getObjectRotationAtTime(
  performer: Performer,
  motion: ObjectMotion | undefined,
  progress: number,
  frameStartRotation: number,
  frameEndRotation: number,
): number {
  if (!motion) return interpolateRotationShortest(frameStartRotation, frameEndRotation, progress);

  const startRotation = normalizeRotation(motion.startRotation, frameStartRotation);
  const endRotation = normalizeRotation(motion.endRotation, frameEndRotation);

  if (motion.rotationMode === 'fixed') {
    return startRotation;
  }

  if (motion.rotationMode === 'lerp') {
    return interpolateRotationShortest(startRotation, endRotation, progress);
  }

  return interpolateRotationShortest(frameStartRotation, frameEndRotation, progress);
}

function getBezierControlPoints(
  start: Position,
  end: Position,
  controlPoints: MotionControlPoint[] | undefined,
): [Position, Position, Position, Position] {
  const cp1 = controlPoints?.[0] ?? start;
  const cp2 = controlPoints?.[1] ?? end;
  return [start, cp1, cp2, end];
}

function cubicBezierPoint(
  start: Position,
  end: Position,
  controlPoints: MotionControlPoint[] | undefined,
  progress: number,
): Position {
  const [p0, p1, p2, p3] = getBezierControlPoints(start, end, controlPoints);
  const inv = 1 - progress;
  const includeZ = p0.z !== undefined || p1.z !== undefined || p2.z !== undefined || p3.z !== undefined;
  const sample = (a: number, b: number, c: number, d: number): number => (
    (inv ** 3) * a
    + 3 * (inv ** 2) * progress * b
    + 3 * inv * (progress ** 2) * c
    + (progress ** 3) * d
  );

  const point: Position = {
    x: sample(p0.x, p1.x, p2.x, p3.x),
    y: sample(p0.y, p1.y, p2.y, p3.y),
  };

  if (includeZ) {
    point.z = sample(p0.z ?? 0, p1.z ?? 0, p2.z ?? 0, p3.z ?? 0);
  }

  return point;
}

function interpolatePosition(
  start: Position,
  end: Position,
  motion: ObjectMotion | undefined,
  progress: number,
): Position {
  if (motion?.pathType === 'bezier') {
    return cubicBezierPoint(start, end, motion.controlPoints, progress);
  }

  const includeZ = start.z !== undefined || end.z !== undefined;
  const point: Position = {
    x: lerp(start.x, end.x, progress),
    y: lerp(start.y, end.y, progress),
  };

  if (includeZ) {
    point.z = lerp(start.z ?? 0, end.z ?? 0, progress);
  }

  return point;
}

function buildStaticSceneState(
  framePositions: Record<string, Position>,
  performers: Performer[],
  hiddenGroupIds: string[],
  frameRotations: Record<string, number> = {},
): SceneState {
  const rotations = Object.fromEntries(
    performers.map((performer) => [
      performer.id,
      frameRotations[performer.id] ?? performer.rotation ?? 0,
    ]),
  );
  return {
    positions: framePositions,
    rotations,
    hiddenGroupIds,
  };
}

export function evaluateSceneStateAtTime(
  timeMs: number,
  frames: Frame[],
  performers: Performer[],
  transitions: TransitionSegment[],
): SceneState {
  const sortedFrames = getSortedFrames(frames);
  const activeFrame = sortedFrames.find((frame) => timeMs >= frame.startTime && timeMs < frame.startTime + frame.duration);

  if (activeFrame) {
    return buildStaticSceneState(
      activeFrame.positions,
      performers,
      activeFrame.hiddenGroupIds || [],
      activeFrame.rotations,
    );
  }

  const previousFrame = [...sortedFrames].reverse().find((frame) => frame.startTime + frame.duration <= timeMs);
  const nextFrame = sortedFrames.find((frame) => frame.startTime > timeMs);

  if (previousFrame && nextFrame) {
    const gapStart = previousFrame.startTime + previousFrame.duration;
    const gapEnd = nextFrame.startTime;
    const totalGap = gapEnd - gapStart;

    if (totalGap <= 0) {
      return buildStaticSceneState(
        previousFrame.positions,
        performers,
        previousFrame.hiddenGroupIds || [],
        previousFrame.rotations,
      );
    }

    const transition = findTransitionSegment(transitions, previousFrame.id, nextFrame.id);
    const configuredDuration = transition?.duration;
    const transitionDuration = typeof configuredDuration === 'number' && Number.isFinite(configuredDuration)
      ? Math.min(totalGap, Math.max(0, configuredDuration))
      : totalGap;
    const rawProgress = transitionDuration === 0
      ? 1
      : (timeMs - gapStart) / transitionDuration;
    const progress = easeInOutQuad(Math.max(0, Math.min(1, rawProgress)));
    const positions: Record<string, Position> = {};
    const rotations: Record<string, number> = {};

    performers.forEach((performer) => {
      const start = previousFrame.positions[performer.id];
      const end = nextFrame.positions[performer.id];
      if (!start || !end) return;

      const motion = transition?.objectMotions?.[performer.id];
      positions[performer.id] = interpolatePosition(start, end, motion, progress);
      const fallbackRotation = performer.rotation ?? 0;
      rotations[performer.id] = getObjectRotationAtTime(
        performer,
        motion,
        progress,
        previousFrame.rotations?.[performer.id] ?? fallbackRotation,
        nextFrame.rotations?.[performer.id] ?? fallbackRotation,
      );
    });

    return {
      positions,
      rotations,
      hiddenGroupIds: previousFrame.hiddenGroupIds || [],
    };
  }

  if (sortedFrames.length > 0) {
    if (timeMs < sortedFrames[0].startTime) {
      return buildStaticSceneState(
        sortedFrames[0].positions,
        performers,
        sortedFrames[0].hiddenGroupIds || [],
        sortedFrames[0].rotations,
      );
    }

    const lastFrame = sortedFrames[sortedFrames.length - 1];
    return buildStaticSceneState(
      lastFrame.positions,
      performers,
      lastFrame.hiddenGroupIds || [],
      lastFrame.rotations,
    );
  }

  return {
    positions: {},
    rotations: Object.fromEntries(performers.map((performer) => [performer.id, performer.rotation ?? 0])),
    hiddenGroupIds: [],
  };
}
