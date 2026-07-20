import test from 'node:test';
import assert from 'node:assert/strict';
import type { Frame, Performer } from '../types.ts';
import { showPerformersInAllFrames } from '../utils/performer-visibility.ts';

const performers: Performer[] = [
  { id: 'actor-1', name: '演员一', label: '一', color: '#ffffff', shape: 'circle', groupId: 'group-1' },
  { id: 'prop-1', name: '道具一', label: '道', color: '#ff0000', shape: 'square', type: 'prop', rotation: 30 },
];

const frames: Frame[] = [
  {
    id: 'frame-1', name: '队形一', startTime: 0, duration: 1000,
    positions: { 'actor-1': { x: 12, y: 34 } },
    rotations: { 'actor-1': 15 },
    hiddenGroupIds: ['group-1'],
  },
  {
    id: 'frame-2', name: '队形二', startTime: 1000, duration: 1000,
    positions: {}, rotations: {}, hiddenGroupIds: ['group-1'],
  },
];

test('shows an actor in every formation and clears its group visibility mask', () => {
  const result = showPerformersInAllFrames(frames, performers, ['actor-1']);

  assert.deepEqual(result[1].positions['actor-1'], { x: 12, y: 34 });
  assert.equal(result[1].rotations?.['actor-1'], 15);
  assert.deepEqual(result.map((frame) => frame.hiddenGroupIds), [[], []]);
});

test('uses the stage center when an entity has never appeared in a formation', () => {
  const result = showPerformersInAllFrames(frames, performers, ['prop-1']);

  assert.deepEqual(result.map((frame) => frame.positions['prop-1']), [
    { x: 50, y: 50 },
    { x: 50, y: 50 },
  ]);
  assert.deepEqual(result.map((frame) => frame.rotations?.['prop-1']), [30, 30]);
});
