# Batch Performer Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow compatible multi-selected performers or props to move together into or out of sidebar groups through right-click and drag-and-drop.

**Architecture:** Put deterministic selection/type filtering in a small pure utility. Keep transient menu and drag feedback in `Sidebar.tsx`, while `App.tsx` performs immutable batch updates to the persisted performer collection.

**Tech Stack:** React 19, TypeScript, HTML5 drag-and-drop, Node test runner.

---

### Task 1: Compatible grouping selection utility

**Files:**
- Create: `utils/performer-grouping.ts`
- Create: `tests/performer-grouping.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing utility tests**

```ts
test('selected initiator batches only selected performers of the same type', () => {
  assert.deepEqual(resolveGroupAction(performers, ['actor-1', 'actor-2', 'prop-1'], 'actor-1'), {
    performerIds: ['actor-1', 'actor-2'],
    performerType: 'performer',
  });
});

test('unselected initiator becomes a single-item action', () => {
  assert.deepEqual(resolveGroupAction(performers, ['actor-1'], 'actor-2'), {
    performerIds: ['actor-2'],
    performerType: 'performer',
  });
});

test('group compatibility preserves performer and prop boundaries', () => {
  assert.equal(isPerformerGroupCompatible({ type: 'prop' }, 'performer'), false);
  assert.equal(isPerformerGroupCompatible({ type: 'prop' }, 'prop'), true);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --experimental-strip-types --test tests/performer-grouping.test.ts`
Expected: FAIL because `utils/performer-grouping.ts` does not exist.

- [ ] **Step 3: Implement the pure utility**

```ts
export type GroupablePerformerType = 'performer' | 'prop';

export function getGroupablePerformerType(performer: Pick<Performer, 'type'>): GroupablePerformerType {
  return performer.type === 'prop' ? 'prop' : 'performer';
}

export function resolveGroupAction(
  performers: Array<Pick<Performer, 'id' | 'type'>>,
  selectedIds: string[],
  initiatorId: string,
): { performerIds: string[]; performerType: GroupablePerformerType } | null {
  const initiator = performers.find((performer) => performer.id === initiatorId);
  if (!initiator) return null;
  const performerType = getGroupablePerformerType(initiator);
  const ids = selectedIds.includes(initiatorId)
    ? selectedIds.filter((id) => performers.some((performer) => performer.id === id && getGroupablePerformerType(performer) === performerType))
    : [initiatorId];
  return { performerIds: ids.length > 0 ? ids : [initiatorId], performerType };
}
```

- [ ] **Step 4: Add the test to `test:desktop` and verify GREEN**

Run: `npm run test:desktop`
Expected: all desktop and pure tests pass.

### Task 2: Sidebar batch menu and drag/drop

**Files:**
- Modify: `components/Sidebar.tsx`
- Modify: `App.tsx`
- Modify: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add failing source regressions**

```js
assert.match(sidebar, /performerIds: string\[\]/);
assert.match(sidebar, /resolveGroupAction/);
assert.match(sidebar, /onAddPerformersToGroup\(contextMenuState\.performerIds/);
assert.match(sidebar, /onRemovePerformersFromGroup/);
assert.match(sidebar, /拖入 \{dragState\.performerIds\.length\} 项/);
assert.match(app, /handleRemovePerformersFromGroup/);
```

- [ ] **Step 2: Run desktop tests and verify RED**

Run: `npm run test:desktop`
Expected: FAIL because Sidebar drag/menu state still stores one performer ID.

- [ ] **Step 3: Implement batch callbacks and transient state**

```tsx
const handleRemovePerformersFromGroup = (performerIds: string[]) => {
  const ids = new Set(performerIds);
  setPerformers((previous) => previous.map((performer) => (
    ids.has(performer.id) ? { ...performer, groupId: undefined } : performer
  )));
};
```

```tsx
const action = resolveGroupAction(performers, selectedPerformerIds, performerId);
if (!action) return;
if (!selectedPerformerIds.includes(performerId)) onSelectionChange([performerId]);
setContextMenuState({ show: true, x, y, performerIds: action.performerIds, performerType: action.performerType, groupId: null });
```

Use the same action for drag start. A compatible destination calls `onAddPerformersToGroup(dragState.performerIds, group.id)`; the ungrouped target calls `onRemovePerformersFromGroup(dragState.performerIds)`. Store `overGroupId`/`overUngrouped` for highlight state and clear it on drop or drag end.

- [ ] **Step 4: Verify behavior and build**

Run: `npm run test:desktop`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App.tsx components/Sidebar.tsx utils/performer-grouping.ts tests/performer-grouping.test.ts tests/desktop-regressions.test.mjs package.json docs/superpowers/plans/2026-07-02-batch-performer-grouping.md
git commit -m "feat: support batch performer grouping"
```
