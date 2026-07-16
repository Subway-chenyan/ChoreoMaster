# 3D Drag Editing Safety Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live 3D object movement opt-in, safe by default, and mutually exclusive with primary-drag camera rotation.

**Architecture:** Add a pure 3D interaction policy, keep the requested mode as transient `App` state, and pass an explicit `dragEnabled` capability through `Stage3D` to `Scene3D`. The scene applies the policy to both OrbitControls and object callbacks; performer and prop components own pointer capture and report an exact final position so undo, snapping, and prop anchors remain correct.

**Tech Stack:** React 19, TypeScript 5.8, React Three Fiber 9, Drei OrbitControls, Three.js 0.182, Node test runner, Changesets.

## Global Constraints

- The default requested state is exactly `false`.
- The control copy is `3D 拖动编辑`; the mode is transient UI state and must not enter project JSON, exported packages, localStorage, undo history, or dirty-state serialization.
- Preview mode locks performer plane movement, prop plane movement, and performer height adjustment while preserving click selection, primary-drag camera rotation, secondary-drag pan, and wheel zoom.
- Drag editing mode allows primary-pointer object movement and performer height adjustment, disables camera primary-drag rotation, and keeps secondary-drag pan and wheel zoom.
- `readonly`/playback always overrides the requested mode.
- Application start and every project-session transition reset the requested mode to off; 2D/3D toggling within one project retains it.
- Only primary button `0` may start an object drag.
- Pointer up, pointer cancel, permission loss, and unmount must clear drag state; one gesture creates at most one undo action.
- Hinged prop positions remain stored as pivot anchors, never as displayed centers.
- Do not add a persisted preference or a new browser-test dependency.
- Never modify or stage `.trellis/tasks/07-15-release-version-management/`.

---

## File Map

- Create `utils/three-interaction.ts`: pure interaction policy and button-permission functions.
- Create `tests/three-interaction.test.ts`: executable policy contract.
- Modify `package.json`: include the new policy test in `test:desktop`.
- Modify `App.tsx`: transient state, project-session reset, 3D-only accessible toolbar button, and prop wiring.
- Modify `components/Stage3D.tsx`: explicit `dragEnabled` prop boundary.
- Modify `3d_components/Scene3D.tsx`: effective policy, OrbitControls arbitration, drag coordinator, exact drag-end payload.
- Modify `3d_components/Performer3D.tsx`: gated primary-button plane/height gestures, pointer capture, cancellation, final position reporting.
- Modify `3d_components/Prop3D.tsx`: the same plane gesture lifecycle plus center-to-anchor conversion.
- Modify `tests/desktop-regressions.test.mjs`: renderer wiring and lifecycle regressions.
- Create `.changeset/three-drag-safety-lock.md`: patch release note.
- Modify `.trellis/spec/frontend/index.md` and create `.trellis/spec/frontend/three-interaction.md`: executable project contract.

---

### Task 1: Pure 3D interaction policy

**Files:**
- Create: `utils/three-interaction.ts`
- Create: `tests/three-interaction.test.ts`
- Modify: `package.json:25`

**Interfaces:**
- Produces: `resolveThreeInteractionPolicy(input): ThreeInteractionPolicy`.
- Produces: `canStartThreeObjectDrag(input): boolean`.
- Later tasks consume `canDragObjects`, `enableRotate`, `enablePan`, and `enableZoom` without reimplementing policy branches.

- [ ] **Step 1: Write the failing executable contract**

Create `tests/three-interaction.test.ts` with direct imports and assertions for default preview, selected-independent preview, enabled edit mode, read-only override, active-drag pan, and button filtering:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canStartThreeObjectDrag,
  resolveThreeInteractionPolicy,
} from '../utils/three-interaction.ts';

test('3D preview is safe by default and keeps camera navigation enabled', () => {
  assert.deepEqual(resolveThreeInteractionPolicy({
    dragEnabled: false,
    readonly: false,
    isDragging: false,
  }), {
    canDragObjects: false,
    enableRotate: true,
    enablePan: true,
    enableZoom: true,
  });
});

test('3D drag editing replaces primary camera rotation with object movement', () => {
  assert.deepEqual(resolveThreeInteractionPolicy({
    dragEnabled: true,
    readonly: false,
    isDragging: false,
  }), {
    canDragObjects: true,
    enableRotate: false,
    enablePan: true,
    enableZoom: true,
  });
});

test('playback read-only mode overrides the requested drag mode', () => {
  assert.deepEqual(resolveThreeInteractionPolicy({
    dragEnabled: true,
    readonly: true,
    isDragging: false,
  }), {
    canDragObjects: false,
    enableRotate: true,
    enablePan: true,
    enableZoom: true,
  });
});

test('active object movement temporarily disables camera pan', () => {
  assert.equal(resolveThreeInteractionPolicy({
    dragEnabled: true,
    readonly: false,
    isDragging: true,
  }).enablePan, false);
});

test('only a primary button can start an enabled writable object drag', () => {
  assert.equal(canStartThreeObjectDrag({ dragEnabled: true, readonly: false, button: 0 }), true);
  assert.equal(canStartThreeObjectDrag({ dragEnabled: false, readonly: false, button: 0 }), false);
  assert.equal(canStartThreeObjectDrag({ dragEnabled: true, readonly: true, button: 0 }), false);
  assert.equal(canStartThreeObjectDrag({ dragEnabled: true, readonly: false, button: 1 }), false);
  assert.equal(canStartThreeObjectDrag({ dragEnabled: true, readonly: false, button: 2 }), false);
  assert.equal(canStartThreeObjectDrag({ dragEnabled: true, readonly: false, button: -1 }), false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --experimental-strip-types --test tests/three-interaction.test.ts
```

Expected: FAIL because `utils/three-interaction.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure policy**

Create `utils/three-interaction.ts`:

```typescript
export interface ThreeInteractionPolicyInput {
  dragEnabled: boolean;
  readonly: boolean;
  isDragging: boolean;
}

export interface ThreeInteractionPolicy {
  canDragObjects: boolean;
  enableRotate: boolean;
  enablePan: boolean;
  enableZoom: boolean;
}

export function resolveThreeInteractionPolicy(
  input: ThreeInteractionPolicyInput,
): ThreeInteractionPolicy {
  const canDragObjects = input.dragEnabled && !input.readonly;
  return {
    canDragObjects,
    enableRotate: !canDragObjects,
    enablePan: !input.isDragging,
    enableZoom: true,
  };
}

export function canStartThreeObjectDrag(input: {
  dragEnabled: boolean;
  readonly: boolean;
  button: number;
}): boolean {
  return input.dragEnabled && !input.readonly && input.button === 0;
}
```

Append `tests/three-interaction.test.ts` to the existing `test:desktop` command in `package.json`.

- [ ] **Step 4: Verify GREEN and standard-suite inclusion**

Run:

```powershell
node --experimental-strip-types --test tests/three-interaction.test.ts
npm run test:desktop
```

Expected: policy tests pass and `test:desktop` includes the same passing cases.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- utils/three-interaction.ts tests/three-interaction.test.ts package.json
git commit -m "test(3d): define drag interaction policy"
```

---

### Task 2: Transient mode control and scene arbitration

**Files:**
- Modify: `tests/desktop-regressions.test.mjs`
- Modify: `App.tsx:390-505,4474-4485,4657-4677,4947-5025`
- Modify: `components/Stage3D.tsx`
- Modify: `3d_components/Scene3D.tsx`

**Interfaces:**
- Consumes: `resolveThreeInteractionPolicy` from Task 1.
- Produces: optional `dragEnabled?: boolean` on both `Stage3DProps` and `Scene3DProps`, defaulting to `false`.
- Produces: one effective `canDragObjects` capability for both performer and prop callbacks.

- [ ] **Step 1: Add failing renderer wiring regressions**

Add focused source-contract tests to `tests/desktop-regressions.test.mjs` that read `App.tsx`, `components/Stage3D.tsx`, and `3d_components/Scene3D.tsx`, then assert all of the following strings/structures:

```javascript
assert.match(appSource, /const \[is3DDragEnabled, setIs3DDragEnabled\] = useState\(false\)/);
assert.match(appSource, /setIs3DDragEnabled\(false\)/);
assert.match(appSource, /viewMode === '3d'[\s\S]*aria-pressed=\{is3DDragEnabled\}/);
assert.match(appSource, /aria-label=\{is3DDragEnabled \? '锁定 3D 对象' : '启用 3D 拖动编辑'\}/);
assert.match(appSource, /<Stage3D[\s\S]*dragEnabled=\{is3DDragEnabled\}/);
assert.doesNotMatch(appSource, /localStorage[\s\S]{0,120}is3DDragEnabled/);
assert.match(stage3DSource, /dragEnabled\?: boolean/);
assert.match(stage3DSource, /dragEnabled=\{dragEnabled\}/);
assert.match(scene3DSource, /resolveThreeInteractionPolicy/);
assert.match(scene3DSource, /enableRotate=\{interactionPolicy\.enableRotate\}/);
assert.match(scene3DSource, /enablePan=\{interactionPolicy\.enablePan\}/);
assert.match(scene3DSource, /enableZoom=\{interactionPolicy\.enableZoom\}/);
assert.doesNotMatch(scene3DSource, /enableRotate=\{[^}]*hasSelection/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="3D drag editing" tests/desktop-regressions.test.mjs
```

Expected: FAIL because the state, control, prop, and policy wiring do not exist.

- [ ] **Step 3: Implement the App control and project-session reset**

In the stage UI state block, add:

```typescript
const [is3DDragEnabled, setIs3DDragEnabled] = useState(false);
```

After `activeProjectClipboardKey` is derived, add:

```typescript
useEffect(() => {
  setIs3DDragEnabled(false);
}, [activeProjectClipboardKey]);
```

Import `Lock` and `Unlock` from `lucide-react`. In the expanded stage toolbar, render the following only for `viewMode === '3d'`:

```tsx
{viewMode === '3d' && (
  <button
    type="button"
    onClick={() => setIs3DDragEnabled((enabled) => !enabled)}
    disabled={isPlaying}
    className={`rounded p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
      is3DDragEnabled
        ? 'bg-amber-500/15 text-amber-400'
        : theme === 'dark'
          ? 'text-slate-500 hover:bg-slate-800 hover:text-white'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
    }`}
    aria-label={is3DDragEnabled ? '锁定 3D 对象' : '启用 3D 拖动编辑'}
    aria-pressed={is3DDragEnabled}
    title={isPlaying
      ? '播放中已临时锁定 3D 编辑'
      : is3DDragEnabled
        ? '锁定 3D 对象，恢复左键旋转视角'
        : '启用 3D 拖动编辑'}
  >
    {is3DDragEnabled ? <Unlock size={16} /> : <Lock size={16} />}
  </button>
)}
```

Pass `dragEnabled={is3DDragEnabled}` to `Stage3D` without adding it to the project-save snapshot.

- [ ] **Step 4: Implement the Stage3D and Scene3D policy boundary**

Add `dragEnabled?: boolean` to both prop interfaces, default it to `false`, and pass it from `Stage3D` to `Scene3D`.

In `Scene3D`, replace the ref-derived/selection-derived Orbit policy with React state and the pure helper:

```typescript
const [isDragging, setIsDragging] = useState(false);
const interactionPolicy = resolveThreeInteractionPolicy({
  dragEnabled,
  readonly,
  isDragging,
});
```

Update drag start/end to set `isDragging`, and configure OrbitControls exactly from `interactionPolicy`. Expose child `onPositionChange` only when `interactionPolicy.canDragObjects` is true. Remove the duplicate `DragContextType` declaration and remove `hasSelection` from Orbit rotation decisions.

- [ ] **Step 5: Verify Task 2 GREEN**

Run:

```powershell
node --test --test-name-pattern="3D drag editing" tests/desktop-regressions.test.mjs
npm run typecheck
npm run test:desktop
```

Expected: focused wiring tests, typecheck, and the desktop suite pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- App.tsx components/Stage3D.tsx 3d_components/Scene3D.tsx tests/desktop-regressions.test.mjs
git commit -m "feat(3d): add default-safe drag editing mode"
```

---

### Task 3: Pointer lifecycle, final updates, and prop anchor safety

**Files:**
- Modify: `tests/three-interaction.test.ts`
- Modify: `tests/desktop-regressions.test.mjs`
- Modify: `3d_components/Scene3D.tsx`
- Modify: `3d_components/Performer3D.tsx`
- Modify: `3d_components/Prop3D.tsx`

**Interfaces:**
- Consumes: `canStartThreeObjectDrag` from Task 1.
- Produces: `onDragEnd?: (position?: Position) => void` from object components to the scene coordinator.
- Produces: exact `{ id, pos }` final updates for the existing App undo boundary.

- [ ] **Step 1: Add failing lifecycle and pivot regressions**

Extend `tests/three-interaction.test.ts` with a pure prop-anchor round trip using existing `getPropCenterFromAnchor` and `getPropAnchorFromCenter`. Extend `tests/desktop-regressions.test.mjs` to assert that both object components:

```typescript
import {
  getPropAnchorFromCenter,
  getPropCenterFromAnchor,
} from '../utils/prop-pivot.ts';

test('moving a hinged prop center preserves its stored anchor semantics', () => {
  const stageConfig = { width: 20, depth: 10 };
  const performer = { id: 'door', width: 4, rotationPivot: 'left' };
  const anchor = { x: 20, y: 40 };
  const center = getPropCenterFromAnchor(anchor, 90, performer, stageConfig);
  const movedCenter = { ...center, x: center.x + 10, y: center.y - 5 };
  const movedAnchor = getPropAnchorFromCenter(movedCenter, 90, performer, stageConfig);

  assert.deepEqual(movedAnchor, { x: anchor.x + 10, y: anchor.y - 5 });
});
```

The executable source contracts are:

```javascript
assert.match(performer3DSource, /canStartThreeObjectDrag/);
assert.match(prop3DSource, /canStartThreeObjectDrag/);
assert.match(performer3DSource, /event\.button/);
assert.match(prop3DSource, /event\.button/);
assert.match(performer3DSource, /setPointerCapture/);
assert.match(prop3DSource, /setPointerCapture/);
assert.match(performer3DSource, /onPointerCancel=\{handlePlanePointerCancel\}/);
assert.match(prop3DSource, /onPointerCancel=\{handlePlanePointerCancel\}/);
assert.match(prop3DSource, /getPropAnchorFromCenter/);
assert.match(scene3DSource, /onDragEnd\?\.\(\[draggedId\], \[committedUpdate\]\)/);
```

The anchor round trip uses a non-center pivot and asserts that moving a displayed center by a delta yields the same delta on the stored anchor.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --experimental-strip-types --test tests/three-interaction.test.ts
node --test --test-name-pattern="3D pointer lifecycle" tests/desktop-regressions.test.mjs
```

Expected: FAIL because button gating, pointer capture/cancel, exact final updates, and prop anchor conversion are absent.

- [ ] **Step 3: Implement accepted-drag capture and cleanup**

Use `ThreeEvent<PointerEvent>` instead of `any`. Before stopping propagation, call:

```typescript
if (!onPositionChange || !canStartThreeObjectDrag({
  dragEnabled,
  readonly: false,
  button: event.button,
})) return;
```

For an accepted drag, stop propagation, capture the pointer, initialize the plane and offset, and call drag start. Keep the last emitted `Position` in a ref. Pointer up and pointer cancel both:

```typescript
interface PointerCaptureApi extends EventTarget {
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
  setPointerCapture(pointerId: number): void;
}

function getPointerCaptureApi(
  event: ThreeEvent<PointerEvent>,
): PointerCaptureApi | null {
  const target = event.target;
  if (
    !target
    || !('hasPointerCapture' in target)
    || typeof target.hasPointerCapture !== 'function'
    || !('releasePointerCapture' in target)
    || typeof target.releasePointerCapture !== 'function'
    || !('setPointerCapture' in target)
    || typeof target.setPointerCapture !== 'function'
  ) return null;
  return target as PointerCaptureApi;
}

const capturedPointerRef = useRef<{
  pointerId: number;
  target: PointerCaptureApi;
} | null>(null);

const capturePointer = (event: ThreeEvent<PointerEvent>) => {
  const target = getPointerCaptureApi(event);
  if (!target) return;
  target.setPointerCapture(event.pointerId);
  capturedPointerRef.current = { pointerId: event.pointerId, target };
};

const releaseCapturedPointer = () => {
  const captured = capturedPointerRef.current;
  capturedPointerRef.current = null;
  if (!captured || !captured.target.hasPointerCapture(captured.pointerId)) return;
  captured.target.releasePointerCapture(captured.pointerId);
};

const finishPlaneDrag = useCallback((event: ThreeEvent<PointerEvent>) => {
  if (!isPlaneDraggingRef.current) return;
  event.stopPropagation();
  releaseCapturedPointer();
  isPlaneDraggingRef.current = false;
  onDragEnd?.(lastPlanePositionRef.current ?? undefined);
  lastPlanePositionRef.current = null;
}, [onDragEnd]);
```

Add `onPointerCancel={handlePlanePointerCancel}` and `onLostPointerCapture={handlePlanePointerCancel}`. An effect cleanup must clear local refs when `dragEnabled` becomes false or the component unmounts so `useFrame` cannot keep writing.

- [ ] **Step 4: Preserve performer and prop coordinate semantics**

For performers, report the clamped `mapTo2D` result as the latest position.

For props, convert the moved displayed center back to its stored pivot anchor before writing:

```typescript
const movedCenter = mapTo2D(
  clampedPoint.x,
  position.z || 0,
  clampedPoint.z,
  stageConfig,
);
const newPos = getPropAnchorFromCenter(
  movedCenter,
  rotationDeg,
  performer,
  stageConfig,
);
lastPlanePositionRef.current = newPos;
onPositionChange(newPos);
```

Height movement also reports its final `Position` to `onDragEnd`, so the existing App undo boundary receives the performer ID and exact final update. In `Scene3D`, convert component `onDragEnd(position)` to `onDragEnd?.([id], position ? [{ id, pos: snappedPosition }] : undefined)` and apply grid snapping once at gesture end.

- [ ] **Step 5: Verify Task 3 GREEN**

Run:

```powershell
node --experimental-strip-types --test tests/three-interaction.test.ts
node --test --test-name-pattern="3D pointer lifecycle" tests/desktop-regressions.test.mjs
npm run typecheck
npm run test:desktop
```

Expected: all targeted tests, typecheck, and desktop regressions pass with no continuing drag after cancel.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- 3d_components/Scene3D.tsx 3d_components/Performer3D.tsx 3d_components/Prop3D.tsx tests/three-interaction.test.ts tests/desktop-regressions.test.mjs
git commit -m "fix(3d): isolate object drag pointer gestures"
```

---

### Task 4: Release intent, executable spec, and full verification

**Files:**
- Create: `.changeset/three-drag-safety-lock.md`
- Create: `.trellis/spec/frontend/three-interaction.md`
- Modify: `.trellis/spec/frontend/index.md`

**Interfaces:**
- Documents the final `dragEnabled`, policy, gesture, reset, and verification contracts established by Tasks 1-3.
- Produces one patch Changeset consumed by the aggregate 1.1.0 Release PR.

- [ ] **Step 1: Add the release intent**

Create `.changeset/three-drag-safety-lock.md`:

```markdown
---
"cosstage-desktop": patch
---

3D 预览默认锁定演员和道具拖动，并提供显式拖动编辑开关，避免旋转视角时误改队形位置。
```

- [ ] **Step 2: Add the executable Trellis contract**

Create `.trellis/spec/frontend/three-interaction.md` with the required seven sections: scope/trigger, exact signatures, contracts, validation matrix, good/base/bad cases, required tests, and wrong/correct examples. Add it to `.trellis/spec/frontend/index.md` as `3D interaction changes`.

The contract must state exact defaults (`false`, primary button `0`), transient storage, project-session reset, read-only priority, Orbit policy, pointer cleanup, exact final update, and prop pivot preservation.

- [ ] **Step 3: Run the full quality gate**

Run:

```powershell
npm run typecheck
npm run test:desktop
npm test
git diff --check
```

Expected: all commands pass. The repository has no lint script, so do not claim lint coverage.

- [ ] **Step 4: Perform a source and runtime acceptance audit**

Build the app and use an isolated desktop profile to verify the toolbar default, locked preview gesture, enabled object drag, project reset, playback override, and absence of unintended project position changes. Record the exact profile, commands, screenshots or project JSON comparison, and results for the final release audit.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- .changeset/three-drag-safety-lock.md .trellis/spec/frontend/three-interaction.md .trellis/spec/frontend/index.md
git commit -m "docs(3d): specify drag editing safety contract"
```

---

## Final Review and Release Continuation

- Generate a review package from `a25b8bb` through the final implementation commit.
- Dispatch an independent final reviewer for spec compliance and code quality.
- Resolve every Critical or Important finding and rerun the covering tests.
- Re-run `npm test` after review fixes.
- Continue the existing aggregate 1.1.0 clean-clone versioning, unsigned dry run, authentic 1.0 profile migration test, project recovery test, push, implementation PR, and human-confirmed Release PR workflow.
- Do not create or push `v1.1.0` until the Release PR has been manually approved and production signing/COS preconditions are satisfied.
