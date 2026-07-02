import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCenteredStageGridMarks,
  normalizeStageGridSpacing,
  shouldShowStageGridLabels,
  snapStagePosition,
} from '../utils/stage-grid.ts';
import { getTimelineHorizontalWheelDelta } from '../utils/timeline-scroll.ts';

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
