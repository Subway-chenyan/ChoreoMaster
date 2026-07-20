import assert from 'node:assert/strict';
import test from 'node:test';

import type { Performer, PerformerGroup } from '../types.ts';
import { filterUnlockedPerformerIds, getEffectivelyLockedPerformerIds } from '../utils/performer-locking.ts';

const performer = (id: string, overrides: Partial<Performer> = {}): Performer => ({
  id,
  name: id,
  color: '#fff',
  label: id,
  shape: 'circle',
  ...overrides,
});

test('演员自身锁定和分组锁定都产生全局有效锁定', () => {
  const performers = [
    performer('direct', { locked: true }),
    performer('grouped', { groupId: 'locked-group' }),
    performer('free', { groupId: 'free-group' }),
  ];
  const groups: PerformerGroup[] = [
    { id: 'locked-group', name: '锁定组', color: '#f00', collapsed: false, locked: true },
    { id: 'free-group', name: '普通组', color: '#0f0', collapsed: false },
  ];

  assert.deepEqual([...getEffectivelyLockedPerformerIds(performers, groups)].sort(), ['direct', 'grouped']);
});

test('批量编辑只保留未锁定对象', () => {
  assert.deepEqual(filterUnlockedPerformerIds(['a', 'b', 'c'], new Set(['a', 'c'])), ['b']);
});
