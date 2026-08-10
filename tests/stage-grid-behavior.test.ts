import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCenteredStageGridMarks,
  normalizeStageGridSpacing,
  shouldShowStageGridLabels,
  snapStagePosition,
} from '../utils/stage-grid.ts';
import { getTimelineFollowPlayheadScrollLeft, getTimelineHorizontalWheelDelta } from '../utils/timeline-scroll.ts';
import {
  KEYFRAME_DURATION_THRESHOLD_MS,
  MIN_FRAME_DURATION_MS,
  formatFrameDuration,
  isKeyframeFrame,
  normalizeFrameDuration,
} from '../utils/frame-keyframes.ts';

test('grid spacing uses 0.1m increments and hides labels below 0.5m', () => {
  assert.equal(normalizeStageGridSpacing(0.14), 0.1);
  assert.equal(normalizeStageGridSpacing(0.46), 0.5);
  assert.equal(normalizeStageGridSpacing(-5), 0.1);
  assert.equal(shouldShowStageGridLabels(0.4), false);
  assert.equal(shouldShowStageGridLabels(0.5), true);
});

test('centered grid marks work for both stage dimensions', () => {
  assert.deepEqual(
    createCenteredStageGridMarks(1, 0.5).map((mark) => mark.offsetMeters),
    [-0.5, 0, 0.5],
  );
});

test('stage positions snap to the nearest centered grid point', () => {
  assert.deepEqual(
    snapStagePosition(
      { x: 52.4, y: 53.1, z: 1.25 },
      0.5,
      { width: 20, depth: 10, wingWidth: 4 },
    ),
    { x: 52.5, y: 55, z: 1.25 },
  );
});

test('timeline wheel converts vertical input and preserves dominant horizontal input', () => {
  assert.equal(
    getTimelineHorizontalWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 500),
    48,
  );
  assert.equal(
    getTimelineHorizontalWheelDelta({ deltaX: 24, deltaY: 2, deltaMode: 0 }, 500),
    24,
  );
  assert.equal(
    getTimelineHorizontalWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 500),
    500,
  );
});

test('timeline playback follows the playhead only near viewport edges', () => {
  assert.equal(
    getTimelineFollowPlayheadScrollLeft({
      playheadX: 430,
      scrollLeft: 200,
      clientWidth: 500,
      scrollWidth: 2000,
    }),
    null,
  );

  assert.equal(
    getTimelineFollowPlayheadScrollLeft({
      playheadX: 710,
      scrollLeft: 200,
      clientWidth: 500,
      scrollWidth: 2000,
    }),
    460,
  );

  assert.equal(
    getTimelineFollowPlayheadScrollLeft({
      playheadX: 40,
      scrollLeft: 200,
      clientWidth: 500,
      scrollWidth: 2000,
    }),
    0,
  );

  assert.equal(
    getTimelineFollowPlayheadScrollLeft({
      playheadX: 1950,
      scrollLeft: 1300,
      clientWidth: 500,
      scrollWidth: 2000,
    }),
    1500,
  );
});

test('short formation durations are treated as keyframes', () => {
  assert.equal(KEYFRAME_DURATION_THRESHOLD_MS, 500);
  assert.equal(MIN_FRAME_DURATION_MS, 100);
  assert.equal(isKeyframeFrame({ duration: 499 }), true);
  assert.equal(isKeyframeFrame({ duration: 500 }), false);
  assert.equal(normalizeFrameDuration(42), 100);
  assert.equal(normalizeFrameDuration(375.4), 375);
  assert.equal(formatFrameDuration(375), '0.4秒');
});
