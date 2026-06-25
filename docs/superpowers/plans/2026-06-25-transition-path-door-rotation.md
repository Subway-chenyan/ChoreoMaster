# Transition Path and Prop Pivot Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build direct multi-object transition path editing and persistent center/left/right pivot rotation for ordinary props.

**Architecture:** Extend the shared project contract with frame rotations and prop pivot mode, centralize pivot geometry in a pure utility, and keep scene evaluation as the single source for playback/export state. Upgrade the stage from one selected path to a collection of paths and add a compact selector plus prop rotation controls.

**Tech Stack:** React 19, TypeScript, SVG/DOM stage rendering, React Three Fiber, Electron project JSON, Node test runner.

---

### Task 1: Shared rotation and pivot contracts

**Files:**
- Modify: `electron/project-contract.ts`
- Modify: `electron/project-service.ts`
- Modify: `types.ts`
- Test: `tests/transition-regressions.test.mjs`
- Test: `tests/project-service.test.mjs`

- [ ] Add failing tests for frame rotation normalization, pivot defaults, and round-trip persistence.
- [ ] Run `node --test tests/transition-regressions.test.mjs` and verify failures.
- [ ] Add `Frame.rotations` and `Performer.rotationPivot`, normalize finite angles and valid pivot values.
- [ ] Run transition and project-service tests until green.

### Task 2: Pure pivot geometry and frame-angle scene evaluation

**Files:**
- Create: `utils/prop-pivot.ts`
- Modify: `utils/transitions.ts`
- Test: `tests/transition-regressions.test.mjs`

- [ ] Add failing tests for center/left/right anchor-to-center conversion and visual-position-preserving pivot migration.
- [ ] Add failing tests proving static frames hold their own rotations and gaps interpolate frame rotations.
- [ ] Implement pure stage-coordinate pivot helpers and update scene evaluation fallbacks.
- [ ] Run `node --test tests/transition-regressions.test.mjs` until green.

### Task 3: Persisted pivot migration workflow

**Files:**
- Modify: `App.tsx`
- Modify: `components/PropEditorModal.tsx`
- Modify: `components/Sidebar.tsx`
- Modify: `utils/prop-pivot.ts`

- [ ] Add pivot selector for ordinary props and force platforms to center.
- [ ] Implement all-frame position migration and transition-control-point migration when pivot changes.
- [ ] Ensure new/duplicated/imported frames preserve rotations.
- [ ] Verify production TypeScript build.

### Task 4: Multi-path stage editing

**Files:**
- Modify: `App.tsx`
- Modify: `components/Stage.tsx`
- Modify: `components/Timeline.tsx`
- Modify: `utils/transitions.ts`

- [ ] Build a `transitionPaths` view model for every object present in both frames.
- [ ] Render all paths with selected/unselected visual hierarchy.
- [ ] Make paths and stage objects select the corresponding motion object.
- [ ] Replace the large selector with a compact searchable object list showing path and rotation status.
- [ ] Preserve selected-path control-point dragging.

### Task 5: Prop rotation editing and unified pivot rendering

**Files:**
- Modify: `App.tsx`
- Modify: `components/Stage.tsx`
- Modify: `components/Timeline.tsx`
- Modify: `3d_components/Prop3D.tsx`
- Modify: `utils/OfflineRenderer3D.ts`

- [ ] Add stage rotation handle with pointer-start/final-payload undo semantics.
- [ ] Add draft-string numeric angle input and target-frame selection in transition mode.
- [ ] Apply pivot offsets in 2D DOM, Canvas export, live 3D and offline 3D.
- [ ] Verify playback and export use shared scene rotations.

### Task 6: End-to-end verification

**Files:**
- Modify: `tests/desktop-regressions.test.mjs`
- Modify: `.trellis/spec/frontend/react-pitfalls.md` if a reusable rule emerges

- [ ] Run `node --test tests/transition-regressions.test.mjs`.
- [ ] Run `npm run build:main && npm run test:project`.
- [ ] Run `npm run test:desktop`, distinguishing pre-existing failures.
- [ ] Run `npm run build`.
- [ ] Browser-test multi-path selection, curve dragging, pivot switching, rotation handle, numeric input and persistence.
