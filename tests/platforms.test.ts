import test from 'node:test';
import assert from 'node:assert/strict';

import type { Performer, Position } from '../types.ts';
import {
  buildPlatformOccupancy,
  getPlatformHeight,
  isPerformerOnPlatform,
  isPlatformProp,
} from '../utils/platforms.ts';

function createPosition(x: number, y: number, z?: number): Position {
  return z === undefined ? { x, y } : { x, y, z };
}

test('identifies platform props and height fallback correctly', () => {
  const platform: Performer = {
    id: 'platform-1',
    name: '高台',
    color: '#f59e0b',
    label: '高',
    shape: 'square',
    type: 'prop',
    propCategory: 'platform',
    height: 1.2,
  };

  const regularProp: Performer = {
    id: 'prop-1',
    name: '道具箱',
    color: '#475569',
    label: '道',
    shape: 'square',
    type: 'prop',
    propCategory: 'prop',
  };

  assert.equal(isPlatformProp(platform), true);
  assert.equal(isPlatformProp(regularProp), false);
  assert.equal(getPlatformHeight(platform), 1.2);
  assert.equal(getPlatformHeight(regularProp), 0);
});

const stageConfig = {
  width: 20,
  depth: 10,
};

test('detects platform occupancy by footprint collision instead of exact coordinate equality', () => {
  const platform: Performer = {
    id: 'platform-1',
    name: '高台',
    color: '#f59e0b',
    label: '高',
    shape: 'square',
    type: 'prop',
    propCategory: 'platform',
    width: 4,
    depth: 2,
    height: 1.2,
  };

  assert.equal(
    isPerformerOnPlatform(createPosition(58, 54), platform, createPosition(50, 50), stageConfig as any),
    true,
  );
  assert.equal(
    isPerformerOnPlatform(createPosition(80, 54), platform, createPosition(50, 50), stageConfig as any),
    false,
  );
});

test('builds occupancy and lifts actors by the tallest overlapping platform', () => {
  const performers: Performer[] = [
    {
      id: 'actor-1',
      name: '演员A',
      color: '#3b82f6',
      label: 'A',
      shape: 'circle',
      type: 'performer',
    },
    {
      id: 'actor-2',
      name: '演员B',
      color: '#10b981',
      label: 'B',
      shape: 'circle',
      type: 'performer',
    },
    {
      id: 'platform-1',
      name: '低高台',
      color: '#f59e0b',
      label: '低',
      shape: 'square',
      type: 'prop',
      propCategory: 'platform',
      height: 0.6,
    },
    {
      id: 'platform-2',
      name: '高高台',
      color: '#f97316',
      label: '高',
      shape: 'square',
      type: 'prop',
      propCategory: 'platform',
      height: 1.2,
    },
    {
      id: 'prop-1',
      name: '普通道具',
      color: '#64748b',
      label: '道',
      shape: 'square',
      type: 'prop',
      propCategory: 'prop',
      width: 1,
      depth: 1,
      height: 0.5,
    },
  ];

  const positions: Record<string, Position> = {
    'actor-1': createPosition(50, 50),
    'actor-2': createPosition(30, 30),
    'platform-1': createPosition(50, 50),
    'platform-2': createPosition(50, 50),
    'prop-1': createPosition(50, 50),
  };

  const occupancy = buildPlatformOccupancy(performers, positions, stageConfig as any);

  assert.equal(occupancy.entityLiftById['actor-1'], 1.2);
  assert.deepEqual(occupancy.entityPlatformIds['actor-1'], ['platform-1', 'platform-2']);
  assert.equal(occupancy.entityLiftById['prop-1'], 1.2);
  assert.deepEqual(occupancy.entityPlatformIds['prop-1'], ['platform-1', 'platform-2']);
  assert.equal(occupancy.entityLiftById['actor-2'], undefined);
  assert.equal(occupancy.occupiedPlatformIds.has('platform-1'), true);
  assert.equal(occupancy.occupiedPlatformIds.has('platform-2'), true);
});
