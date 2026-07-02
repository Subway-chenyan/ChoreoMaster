import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPerformerGroupCompatible,
  resolveGroupAction,
} from '../utils/performer-grouping.ts';

const performers = [
  { id: 'actor-1', type: 'performer' as const },
  { id: 'actor-2', type: 'performer' as const },
  { id: 'prop-1', type: 'prop' as const },
];

test('selected initiator batches only selected items of the same type', () => {
  assert.deepEqual(
    resolveGroupAction(performers, ['actor-1', 'actor-2', 'prop-1'], 'actor-1'),
    {
      performerIds: ['actor-1', 'actor-2'],
      performerType: 'performer',
    },
  );
});

test('unselected initiator becomes a single-item action', () => {
  assert.deepEqual(
    resolveGroupAction(performers, ['actor-1'], 'actor-2'),
    {
      performerIds: ['actor-2'],
      performerType: 'performer',
    },
  );
});

test('missing initiator produces no grouping action', () => {
  assert.equal(resolveGroupAction(performers, ['actor-1'], 'missing'), null);
});

test('group compatibility preserves performer and prop boundaries', () => {
  assert.equal(isPerformerGroupCompatible({ type: 'prop' }, 'performer'), false);
  assert.equal(isPerformerGroupCompatible({ type: 'prop' }, 'prop'), true);
  assert.equal(isPerformerGroupCompatible({}, 'performer'), true);
});
