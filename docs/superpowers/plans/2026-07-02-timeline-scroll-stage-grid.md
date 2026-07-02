# Timeline Scrolling and Stage Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix native timeline scrollbar seeking and add a 0.1m horizontal/vertical stage grid with optional drop-time snapping.

**Architecture:** Keep pointer seeking on an inner timeline content surface and isolate wheel normalization in a pure utility. Extend the existing stage-grid utility into the single source of truth for marks, label visibility, and position snapping, then consume it from 2D, live 3D, offline 3D, and the App toolbar.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, React Three Fiber/Three.js, Node test runner.

---

### Task 1: Pure timeline and grid behavior

**Files:**
- Create: `utils/timeline-scroll.ts`
- Modify: `utils/stage-grid.ts`
- Create: `tests/stage-grid-behavior.test.ts`

- [ ] **Step 1: Write failing behavior tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { getTimelineHorizontalWheelDelta } from '../utils/timeline-scroll.ts';
import { createCenteredStageGridMarks, normalizeStageGridSpacing, shouldShowStageGridLabels, snapStagePosition } from '../utils/stage-grid.ts';

test('normalizes 0.1m grid spacing and hides dense labels', () => {
  assert.equal(normalizeStageGridSpacing(0.14), 0.1);
  assert.equal(normalizeStageGridSpacing(0.46), 0.5);
  assert.equal(shouldShowStageGridLabels(0.4), false);
});

test('creates centered horizontal marks and snaps percentages in meters', () => {
  assert.deepEqual(createCenteredStageGridMarks(1, 0.5).map((mark) => mark.offsetMeters), [-0.5, 0, 0.5]);
  assert.deepEqual(snapStagePosition({ x: 52.4, y: 53.1 }, 0.5, { width: 20, depth: 10, wingWidth: 4 } as never), { x: 52.5, y: 55 });
});

test('converts vertical wheel input while preserving horizontal input', () => {
  assert.equal(getTimelineHorizontalWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 500), 48);
  assert.equal(getTimelineHorizontalWheelDelta({ deltaX: 24, deltaY: 2, deltaMode: 0 }, 500), 24);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --experimental-strip-types --test tests/stage-grid-behavior.test.ts`
Expected: FAIL because the new exports do not exist and the minimum spacing is still `0.5`.

- [ ] **Step 3: Implement minimal pure utilities**

```ts
export const MIN_STAGE_GRID_SPACING = 0.1;
export const STAGE_GRID_SPACING_STEP = 0.1;
export const STAGE_GRID_LABEL_MIN_SPACING = 0.5;

export function shouldShowStageGridLabels(spacing: number): boolean {
  return normalizeStageGridSpacing(spacing) >= STAGE_GRID_LABEL_MIN_SPACING;
}

export function snapStagePosition(pos: Position, spacing: number, config: StageConfig): Position {
  const step = normalizeStageGridSpacing(spacing);
  const xMeters = ((pos.x - 50) / 100) * config.width;
  const yMeters = ((pos.y - 50) / 100) * config.depth;
  const bounds = getStageXBounds(config);
  return {
    ...pos,
    x: Math.max(bounds.min, Math.min(bounds.max, 50 + (Math.round(xMeters / step) * step / config.width) * 100)),
    y: Math.max(0, Math.min(100, 50 + (Math.round(yMeters / step) * step / config.depth) * 100)),
  };
}
```

```ts
const LINE_HEIGHT_PX = 16;
export function getTimelineHorizontalWheelDelta(input: { deltaX: number; deltaY: number; deltaMode: number }, pageWidth: number): number {
  const unit = input.deltaMode === 1 ? LINE_HEIGHT_PX : input.deltaMode === 2 ? pageWidth : 1;
  return (Math.abs(input.deltaX) >= Math.abs(input.deltaY) ? input.deltaX : input.deltaY) * unit;
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --experimental-strip-types --test tests/stage-grid-behavior.test.ts`
Expected: PASS.

### Task 2: Timeline event isolation

**Files:**
- Modify: `components/Timeline.tsx`
- Modify: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add failing source regression assertions**

```js
assert.match(timeline, /onWheel=\{handleTimelineWheel\}/);
assert.match(timeline, /data-timeline-content/);
assert.doesNotMatch(scrollViewport, /onPointerDown=\{handlePointerDown\}/);
```

- [ ] **Step 2: Run the regression test and verify RED**

Run: `node --test tests/desktop-regressions.test.mjs`
Expected: FAIL because the overflow viewport still owns `onPointerDown`.

- [ ] **Step 3: Move seeking to the inner content and add wheel scrolling**

```tsx
const handleTimelineWheel = (event: React.WheelEvent<HTMLDivElement>) => {
  const container = containerRef.current;
  if (!container || container.scrollWidth <= container.clientWidth) return;
  const delta = getTimelineHorizontalWheelDelta(event, container.clientWidth);
  if (delta === 0) return;
  event.preventDefault();
  container.scrollLeft += delta;
};

<div ref={containerRef} onWheel={handleTimelineWheel} className="timeline-scroll ...">
  <div data-timeline-content onPointerDown={handlePointerDown} style={{ width: totalWidth, minWidth: '100%' }}>
```

- [ ] **Step 4: Run desktop regressions and verify GREEN**

Run: `node --test tests/desktop-regressions.test.mjs`
Expected: PASS.

### Task 3: Bidirectional rendering and drop-time snapping

**Files:**
- Modify: `components/Stage.tsx`
- Modify: `components/Stage3D.tsx`
- Modify: `3d_components/Scene3D.tsx`
- Modify: `3d_components/StageFloor.tsx`
- Modify: `utils/OfflineRenderer3D.ts`
- Modify: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add failing rendering and snapping regressions**

```js
assert.match(stage, /createCenteredStageGridMarks\(stageConfig\.depth, gridScale\)/);
assert.match(stage, /snapStagePosition/);
assert.match(stageFloor, /depthGridMarks\.map/);
assert.match(offline, /depthGridMarks/);
assert.match(scene, /snapToGrid/);
```

- [ ] **Step 2: Run desktop regressions and verify RED**

Run: `node --test tests/desktop-regressions.test.mjs`
Expected: FAIL because only width-axis regular grid lines exist.

- [ ] **Step 3: Render both axes and snap final positions only**

```tsx
const depthGridMarks = useMemo(() => createCenteredStageGridMarks(stageConfig.depth, gridScale), [gridScale, stageConfig.depth]);
// Render depthGridMarks as horizontal SVG lines in 2D and thin Z-axis boxes in Three.js.

const finalDragUpdates = dragState ? getDragUpdates(e.clientX, e.clientY, dragState) : [];
const committedUpdates = snapToGrid
  ? finalDragUpdates.map((update) => ({ ...update, pos: snapStagePosition(update.pos, gridScale, stageConfig) }))
  : finalDragUpdates;
onPositionChange(committedUpdates);
onDragEnd?.(draggedIds, committedUpdates);
```

Pass `snapToGrid` through `Stage3D` to `Scene3D`; retain the latest 3D drag position in a ref and emit its snapped update before `onDragEnd`.

- [ ] **Step 4: Run pure and desktop tests and verify GREEN**

Run: `node --experimental-strip-types --test tests/stage-grid-behavior.test.ts && node --test tests/desktop-regressions.test.mjs`
Expected: PASS.

### Task 4: Toolbar controls, label density, and full verification

**Files:**
- Modify: `App.tsx`
- Modify: `components/Stage.tsx`
- Modify: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add failing toolbar and label assertions**

```js
assert.match(app, /const \[snapToGrid, setSnapToGrid\] = useState\(false\)/);
assert.match(app, /aria-label="吸附到网格"/);
assert.match(app, /step=\{0\.1\}/);
assert.match(stage, /shouldShowStageGridLabels\(gridScale\)/);
```

- [ ] **Step 2: Run desktop regressions and verify RED**

Run: `node --test tests/desktop-regressions.test.mjs`
Expected: FAIL because the toolbar has fixed text and no snap toggle.

- [ ] **Step 3: Implement the approved inline toolbar**

```tsx
const [snapToGrid, setSnapToGrid] = useState(false);

<EditableNumberInput
  min={MIN_STAGE_GRID_SPACING}
  max={MAX_STAGE_GRID_SPACING}
  step={STAGE_GRID_SPACING_STEP}
  value={gridScale}
  onChange={(value) => setGridScale(normalizeStageGridSpacing(value))}
/>
<button aria-label="吸附到网格" aria-pressed={snapToGrid} onClick={() => setSnapToGrid((value) => !value)}>
  <Magnet size={16} />
</button>
```

Pass `snapToGrid` to both stage renderers and gate bottom labels with `shouldShowStageGridLabels(gridScale)`.

- [ ] **Step 4: Run complete verification**

Run: `node --experimental-strip-types --test tests/stage-grid-behavior.test.ts`
Expected: PASS.

Run: `npm run test:desktop`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit the implementation**

```bash
git add App.tsx components/Timeline.tsx components/Stage.tsx components/Stage3D.tsx 3d_components/Scene3D.tsx 3d_components/StageFloor.tsx utils/stage-grid.ts utils/timeline-scroll.ts utils/OfflineRenderer3D.ts tests/stage-grid-behavior.test.ts tests/desktop-regressions.test.mjs docs/superpowers/plans/2026-07-02-timeline-scroll-stage-grid.md
git commit -m "feat: improve timeline scrolling and stage grid"
```
