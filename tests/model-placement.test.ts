import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateModelStageFitScale, createForwardFrameUpdates } from '../utils/model-placement.ts';

test('oversized models fit to 90 percent of the complete stage without enlarging small assets', () => {
  const stage = { width: 20, depth: 10, wingWidth: 5 };
  assert.equal(calculateModelStageFitScale(stage, { width: 10, depth: 5 }), 1);
  assert.equal(calculateModelStageFitScale(stage, { width: 60, depth: 5 }), 0.45);
  assert.equal(calculateModelStageFitScale(stage, { width: 10, depth: 20 }), 0.45);
});

test('model placement inserts into the current and later frames only', () => {
  const frames = [
    { id: 'before', name: 'before', startTime: 0, duration: 1000, positions: {} },
    { id: 'current', name: 'current', startTime: 1000, duration: 1000, positions: {} },
    { id: 'after', name: 'after', startTime: 2000, duration: 1000, positions: {} },
  ];
  const updates = createForwardFrameUpdates(frames, 'current', 'model-1', { x: 30, y: 40 });
  assert.deepEqual(Object.keys(updates), ['current', 'after']);
  assert.deepEqual(updates.after.positions['model-1'], { x: 30, y: 40 });
  assert.equal(updates.current.rotations['model-1'], 0);
});
