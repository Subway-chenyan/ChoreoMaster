# Stage Background, LED Depth, and Direction Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted stage background with physical-size adaptation, configurable stage lines and LED depth, plus performer/prop rotation indicators across 2D, live 3D, and exports.

**Architecture:** Extend the shared project contract once, centralize size/LED calculations in a pure utility, and pass the normalized `StageConfig` to every renderer. Keep upload confirmation in a focused React modal, while `App.tsx` owns project assets and state transitions. Reuse the existing frame rotation map and undo flow instead of introducing another rotation state.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, React Three Fiber, Three.js, Electron IPC/project service, Node test runner.

---

## File Map

- Create `utils/stage-config.ts`: pure dimension, opacity, LED depth, and media URL helpers.
- Create `components/StageBackgroundDialog.tsx`: accessible width-confirmation modal with numeric draft handling.
- Modify `electron/project-contract.ts`: shared persisted stage background and stage option types.
- Modify `electron/project-service.ts`: normalize, externalize, hydrate, and package stage background assets.
- Modify `App.tsx`: upload lifecycle, dialog state, 2D export drawing, and renderer props.
- Modify `components/Sidebar.tsx`: upload/clear/opacity/line/LED controls.
- Modify `components/Stage.tsx`: 2D background, line toggle, LED marker, actor rotation, and arrows.
- Modify `3d_components/Scene3D.tsx`, `StageFloor.tsx`, `Performer3D.tsx`, `Prop3D.tsx`, and `components/LEDTV.tsx`: live 3D texture, LED depth, and arrows.
- Modify `utils/OfflineRenderer3D.ts`: offline floor texture, LED depth, and arrows.
- Modify `tests/transition-regressions.test.mjs`, `tests/project-service.test.mjs`, and `tests/desktop-regressions.test.mjs`: behavior, persistence, and renderer-chain regressions.

### Task 1: Shared Stage Configuration Contract and Pure Calculations

**Files:**
- Create: `utils/stage-config.ts`
- Modify: `electron/project-contract.ts`
- Test: `tests/transition-regressions.test.mjs`

- [ ] **Step 1: Write failing utility tests**

Add tests that import `utils/stage-config.ts` through the existing TypeScript transpile helper:

```javascript
test('derives stage dimensions from a full-stage background width', async () => {
  const { calculateStageDimensionsFromImage } = await importTypeScriptModule('../utils/stage-config.ts');
  assert.deepEqual(calculateStageDimensionsFromImage(24, 3, 1200, 800), {
    width: 18,
    depth: 16,
  });
  assert.equal(calculateStageDimensionsFromImage(6, 3, 1200, 800), null);
  assert.equal(calculateStageDimensionsFromImage(24, 3, 0, 800), null);
});

test('normalizes stage opacity and LED distance', async () => {
  const { clampStageBackgroundOpacity, getLedDistanceFromBack, getLedZPosition } =
    await importTypeScriptModule('../utils/stage-config.ts');
  assert.equal(clampStageBackgroundOpacity(2), 1);
  assert.equal(clampStageBackgroundOpacity(Number.NaN), 0.5);
  assert.equal(getLedDistanceFromBack({ width: 20, depth: 10, ledDistanceFromBack: 12 }), 10);
  assert.equal(getLedZPosition({ width: 20, depth: 10, ledDistanceFromBack: 3 }), -2);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/transition-regressions.test.mjs`

Expected: FAIL because `utils/stage-config.ts` does not exist.

- [ ] **Step 3: Add the shared types and minimal utility**

Add to `electron/project-contract.ts`:

```typescript
export interface StageBackground {
  value: string;
  opacity: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface StageConfig {
  width: number;
  depth: number;
  wingWidth?: number;
  ledWidth?: number;
  ledHeight?: number;
  ledContent?: LEDContent;
  background?: StageBackground;
  showStageLines?: boolean;
  ledDistanceFromBack?: number;
}
```

Create `utils/stage-config.ts`:

```typescript
import type { StageConfig } from '../types';

export function calculateStageDimensionsFromImage(
  totalWidth: number,
  wingWidth: number,
  pixelWidth: number,
  pixelHeight: number,
): { width: number; depth: number } | null {
  if (![totalWidth, wingWidth, pixelWidth, pixelHeight].every(Number.isFinite)) return null;
  if (pixelWidth <= 0 || pixelHeight <= 0 || wingWidth < 0 || totalWidth <= wingWidth * 2) return null;
  return { width: totalWidth - wingWidth * 2, depth: totalWidth * pixelHeight / pixelWidth };
}

export function clampStageBackgroundOpacity(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value as number));
}

export function getLedDistanceFromBack(config: StageConfig): number {
  const value = Number.isFinite(config.ledDistanceFromBack) ? config.ledDistanceFromBack as number : 0;
  return Math.max(0, Math.min(config.depth, value));
}

export function getLedZPosition(config: StageConfig): number {
  return -config.depth / 2 + getLedDistanceFromBack(config);
}

export function getLedStageYPercent(config: StageConfig): number {
  return config.depth > 0 ? getLedDistanceFromBack(config) / config.depth * 100 : 0;
}

export function resolveStageBackgroundUrl(config: StageConfig, mediaCache: Record<string, string>): string | null {
  const value = config.background?.value;
  return value ? mediaCache[value] ?? value : null;
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/transition-regressions.test.mjs`

Expected: PASS.

### Task 2: Project Persistence and Asset Hydration

**Files:**
- Modify: `electron/project-contract.ts`
- Modify: `electron/project-service.ts`
- Test: `tests/project-service.test.mjs`

- [ ] **Step 1: Write failing persistence tests**

Extend the project fixture with:

```javascript
stageConfig: {
  width: 18,
  depth: 16,
  wingWidth: 3,
  showStageLines: false,
  ledDistanceFromBack: 2.5,
  background: {
    value: ONE_PIXEL_PNG,
    opacity: 0.35,
    pixelWidth: 1,
    pixelHeight: 1,
  },
},
```

Assert saved JSON stores the background under `assets/stage-backgrounds/`, loaded data exposes a `choreo-asset://` URL through `mediaUrls`, and a legacy project defaults to `showStageLines !== false` and LED distance `0`.

- [ ] **Step 2: Run the project test and verify RED**

Run: `npm run test:project`

Expected: FAIL because background data URLs are not externalized or hydrated.

- [ ] **Step 3: Implement normalization and resource lifecycle**

Extend `ProjectAssetKind` with `'stage-background'`, map it to `assets/stage-backgrounds`, create that directory for managed projects, and add focused helpers:

```typescript
function parseStageBackground(value: unknown): StageConfig['background'] {
  if (!isRecord(value) || typeof value.value !== 'string' || !value.value) return undefined;
  const pixelWidth = typeof value.pixelWidth === 'number' && value.pixelWidth > 0 ? value.pixelWidth : 1;
  const pixelHeight = typeof value.pixelHeight === 'number' && value.pixelHeight > 0 ? value.pixelHeight : 1;
  const rawOpacity = typeof value.opacity === 'number' && Number.isFinite(value.opacity) ? value.opacity : 0.5;
  return { value: value.value, opacity: Math.max(0, Math.min(1, rawOpacity)), pixelWidth, pixelHeight };
}
```

Normalize `showStageLines` to `rawStageConfig.showStageLines !== false`, clamp `ledDistanceFromBack`, externalize data URLs during save, and hydrate persisted background paths into `mediaUrls` during load. Preserve the background metadata while replacing only its `value` when externalizing.

- [ ] **Step 4: Run the project test and verify GREEN**

Run: `npm run test:project`

Expected: PASS, including legacy project tests.

### Task 3: Upload Confirmation and Sidebar Controls

**Files:**
- Create: `components/StageBackgroundDialog.tsx`
- Modify: `components/Sidebar.tsx`
- Modify: `App.tsx`
- Test: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add failing source-contract tests**

Assert the dialog does not use browser dialogs and App routes uploads through it:

```javascript
test('stage background upload uses a custom width dialog', async () => {
  const [app, dialog, sidebar] = await Promise.all([
    read('App.tsx'),
    read('components/StageBackgroundDialog.tsx'),
    read('components/Sidebar.tsx'),
  ]);
  assert.match(app, /StageBackgroundDialog/);
  assert.match(dialog, /role="dialog"/);
  assert.doesNotMatch(`${app}\n${dialog}`, /\bprompt\s*\(/);
  assert.match(sidebar, /舞台底图/);
  assert.match(sidebar, /舞台划线/);
  assert.match(sidebar, /LED 距舞台后沿/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:desktop`

Expected: FAIL because the dialog and controls do not exist.

- [ ] **Step 3: Build the modal and upload state flow**

`StageBackgroundDialog` accepts `pixelWidth`, `pixelHeight`, `initialTotalWidth`, `wingWidth`, `onConfirm(totalWidth)`, and `onCancel`. It stores the numeric draft as a string, displays the derived depth, disables confirmation when `calculateStageDimensionsFromImage` returns `null`, closes on Escape, and uses `role="dialog" aria-modal="true"`.

In `App.tsx`, keep pending upload metadata in state. Electron selects and ingests `'stage-background'`, loads dimensions from `asset.url`, then opens the modal. Web reads a data URL with `FileReader`, loads dimensions, then opens the modal. Confirmation atomically sets `background`, `width`, and `depth`; cancellation preserves the old config.

Pass these sidebar callbacks:

```typescript
onStageBackgroundUpload: (event?: React.ChangeEvent<HTMLInputElement>) => void;
onClearStageBackground: () => void;
```

Add controls for upload/replace, clear, `background.opacity`, `showStageLines`, and `ledDistanceFromBack`, using `EditableNumberInput` for numeric values and clamping in App.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm run test:desktop`

Expected: PASS.

### Task 4: Interactive 2D Rendering and Performer Rotation

**Files:**
- Modify: `components/Stage.tsx`
- Modify: `App.tsx`
- Test: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add failing 2D renderer assertions**

```javascript
test('2D stage renders background, LED marker, arrows, and actor rotation controls', async () => {
  const stage = await read('components/Stage.tsx');
  assert.match(stage, /resolveStageBackgroundUrl/);
  assert.match(stage, /getLedStageYPercent/);
  assert.match(stage, /data-direction-arrow/);
  assert.match(stage, /onRotationStart\?\.\(performer\.id\)/);
  assert.match(stage, /rotations\[performer\.id\] \?\? performer\.rotation \?\? 0/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:desktop`

Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement the 2D layers**

Pass `mediaCache` into `Stage`. Render the resolved background as the first absolute child with `backgroundSize: '100% 100%'` and configured opacity. Gate only wing boundary overlays and `STAGE_THIRD_POSITIONS` horizontal lines with `stageConfig.showStageLines !== false`; keep vertical meter grid behavior tied to the existing grid control.

Render an LED line at `getLedStageYPercent(stageConfig)` across the configured LED width. Add a small reusable in-file `DirectionArrow` element marked `data-direction-arrow`, placed above both actor and prop geometry and rotated with the object.

For actors, compute the same rotation fallback as props, add `data-performer-id`, rotate the visual group, and show the same selected rotation button that calls `onRotationStart`, `onRotationChange`, and `onRotationEnd`. Preserve actor movement coordinates and label orientation.

Update 2D canvas export to draw the stage background before lines/objects, honor `showStageLines`, draw the LED marker, rotate actor shapes, and draw an arrow for every actor and prop.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm run test:desktop && npm run build`

Expected: both commands PASS.

### Task 5: Live 3D Floor, LED Depth, and Direction Arrows

**Files:**
- Modify: `3d_components/Scene3D.tsx`
- Modify: `3d_components/StageFloor.tsx`
- Modify: `components/LEDTV.tsx`
- Modify: `3d_components/Performer3D.tsx`
- Modify: `3d_components/Prop3D.tsx`
- Test: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add failing live-3D assertions**

Assert `Scene3D` passes full `stageConfig` and `mediaCache` to `StageFloor`, `LEDTV` uses `getLedZPosition`, and both object components render a `DirectionArrow3D` or `data-direction-arrow` group.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:desktop`

Expected: FAIL on all new live-3D contracts.

- [ ] **Step 3: Implement live-3D rendering**

Change `StageFloor` to receive `stageConfig` and `mediaCache`. Load the resolved image with `THREE.TextureLoader`, configure sRGB/clamp filters, dispose it on replacement/unmount, and render one full-width floor plane using the texture and configured opacity. Keep the existing dark main/wing meshes beneath it as fallback. Gate horizontal third lines and wing boundary meshes with `showStageLines !== false`.

Move LED to:

```tsx
<mesh position={[0, height / 2, getLedZPosition(config) - 0.1]}>
```

Create a compact arrow group from a shaft box and cone, placed slightly above the floor and pointing along the same local forward axis as the performer nose. Add it inside the rotating root group in both `Performer3D` and `Prop3D`, with `raycast={() => null}` so it does not steal selection.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm run test:desktop && npm run build`

Expected: PASS with no TypeScript or R3F errors.

### Task 6: Offline 3D Export Parity

**Files:**
- Modify: `utils/OfflineRenderer3D.ts`
- Modify: `App.tsx`
- Test: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add failing offline-renderer assertions**

```javascript
test('offline 3D renderer includes stage background, LED depth, and arrows', async () => {
  const offline = await read('utils/OfflineRenderer3D.ts');
  assert.match(offline, /resolveStageBackgroundUrl/);
  assert.match(offline, /getLedZPosition/);
  assert.match(offline, /createDirectionArrow/);
  assert.match(offline, /showStageLines/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:desktop`

Expected: FAIL because offline export lacks these elements.

- [ ] **Step 3: Implement offline parity**

Pass `mediaCache` into floor construction, load the background with `THREE.TextureLoader.loadAsync`, apply opacity to a full-stage plane, and register the texture for disposal. Use `getLedZPosition(stageConfig)` for the LED mesh. Add `createDirectionArrow()` to each performer and prop group before applying its existing Y rotation. Gate wing and third-division line geometry with `stageConfig.showStageLines !== false`.

If the floor texture fails to load, log one warning and continue with the dark floor; do not reject `createOfflineScene`.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm run test:desktop && npm run build`

Expected: PASS.

### Task 7: Full Verification, Project Spec Update, and Commit

**Files:**
- Modify: `.trellis/spec/frontend/stage-division.md`
- Modify: `.trellis/workspace/codex/journal-*` only through the Trellis finish workflow if requested by the skill.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node --test tests/transition-regressions.test.mjs
npm run test:project
npm run test:desktop
```

Expected: all PASS.

- [ ] **Step 2: Run production verification**

Run: `npm run build`

Expected: Vite build exits `0` with no TypeScript errors.

- [ ] **Step 3: Run the Trellis quality gate**

Load `trellis-check`, follow its full cross-layer checklist, and fix every issue before continuing.

- [ ] **Step 4: Capture the renderer contract**

Load `trellis-update-spec` and add the new shared rules to `.trellis/spec/frontend/stage-division.md`: stage background spans all renderers, `showStageLines` gates wing/third lines, and LED depth/arrows must remain consistent across live/export paths.

- [ ] **Step 5: Commit the implementation**

Review `git diff --check` and `git status --short`, then commit only feature-related files:

```powershell
git add -- App.tsx components electron 3d_components utils tests .trellis/spec/frontend/stage-division.md docs/superpowers/plans/2026-06-29-stage-background-led-direction.md
git commit -m "feat: add stage background and direction controls"
```
