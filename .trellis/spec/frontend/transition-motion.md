# Transition Motion and Prop Pivot Contract

## Scenario: Persisted formation rotation and hinged prop motion

### 1. Scope / Trigger

- Trigger: adding or changing per-frame rotation, transition paths, or non-center prop rotation.
- The contract spans project JSON, renderer state, 2D/3D preview, and export.

### 2. Signatures

```typescript
type PropRotationPivot = 'center' | 'left' | 'right';

interface Performer {
  rotation?: number;
  rotationPivot?: PropRotationPivot;
}

interface Frame {
  positions: Record<string, Position>;
  rotations?: Record<string, number>;
}
```

### 3. Contracts

- `Frame.rotations[id]` is the held angle for that formation.
- Missing frame rotation falls back to `Performer.rotation`, then `0`.
- Transition rotation interpolates from source-frame angle to target-frame angle unless `ObjectMotion` explicitly overrides it.
- `center` positions describe geometry centers.
- `left | right` positions describe local hinge points.
- Platforms always normalize to `center`.
- Playback, 2D, live 3D, Canvas export, and offline 3D must consume the same scene-state angle.

### 4. Validation & Error Matrix

- Missing or non-record frame rotations -> `{}`.
- Non-finite angle -> discard that entry.
- Invalid pivot -> `center`.
- Platform with `left | right` -> normalize to `center`.
- Missing legacy fields -> preserve legacy center-rotation behavior.

### 5. Good/Base/Bad Cases

- Good: a left-hinged prop moves along a Bezier hinge path and keeps the hinge fixed while rotating.
- Base: an old project without rotations or pivot fields renders exactly as before.
- Bad: DOM preview offsets a hinged prop but export still rotates around its center.

### 6. Tests Required

- Pure geometry tests assert anchor-to-center conversion for all pivot modes.
- Scene evaluation tests assert static frame holds and gap interpolation.
- Project-service tests assert exact pivot and rotation persistence.
- Browser tests assert all transition paths render, selected control points appear, and prop rotation controls are available.
- Production build covers renderer and Electron shared contracts.

### 7. Wrong vs Correct

#### Wrong

```typescript
const rotation = performer.rotation ?? 0;
mesh.position.copy(mapTo3D(frame.positions[id]));
```

This ignores frame rotation and treats a hinge anchor as a center.

#### Correct

```typescript
const rotation = frame.rotations?.[id] ?? performer.rotation ?? 0;
const center = getPropCenterFromAnchor(frame.positions[id], rotation, performer, stageConfig);
mesh.position.copy(mapTo3D(center));
```

## Scenario: Short formation keyframes

### 1. Scope / Trigger

- Trigger: changing formation frame duration editing, timeline frame rendering, or sidebar formation-list rendering.
- The contract spans renderer state, timeline drag/resize behavior, and formation-management UI.

### 2. Signatures

```typescript
const KEYFRAME_DURATION_THRESHOLD_MS = 500;
const MIN_FRAME_DURATION_MS = 100;

function isKeyframeFrame(frame: Pick<Frame, 'duration'>): boolean;
function normalizeFrameDuration(durationMs: number): number;
function formatFrameDuration(durationMs: number): string;
```

### 3. Contracts

- A formation frame is a keyframe when `frame.duration < 500`.
- Keyframe status is derived from duration. Do not persist a separate keyframe flag in project JSON.
- Frame resize must allow durations below `500ms`; clamp only to `MIN_FRAME_DURATION_MS`.
- Timeline rendering must keep very short keyframes visibly selectable with a minimum visual width while preserving the real duration for playback and gap calculations.
- Timeline and sidebar formation management must both label keyframes as `关键帧` and use a distinct visual treatment from normal formation clips.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Non-finite edited duration | Normalize to `500ms` |
| Duration below `100ms` | Clamp to `100ms` |
| Duration `100ms` through `499ms` | Treat as keyframe |
| Duration `500ms` or greater | Treat as normal formation frame |

### 5. Good/Base/Bad Cases

- Good: resizing a frame to `0.3s` displays a compact keyframe marker in the timeline and a `关键帧` badge in the sidebar.
- Base: an existing `2.0s` frame remains a normal formation clip.
- Bad: adding a persisted `isKeyframe` field that can drift out of sync with `duration`.

### 6. Tests Required

- Unit: keyframe utility asserts threshold, minimum duration clamp, and duration formatting.
- Desktop regression: Timeline imports the keyframe helper, uses minimum visual width for keyframes, and renders the `关键帧` label.
- Desktop regression: Sidebar imports the keyframe helper, renders the `关键帧` badge, and formats duration via the shared helper.
- Production build covers JSX and CSS-class integration.

### 7. Wrong vs Correct

#### Wrong

```typescript
const newDur = Math.max(500, draggingState.originalDuration + deltaTime);
const keyframe = frame.isKeyframe;
```

This makes it impossible to create a sub-`0.5s` keyframe and introduces state that can drift from duration.

#### Correct

```typescript
const newDur = normalizeFrameDuration(draggingState.originalDuration + deltaTime);
const keyframe = isKeyframeFrame(frame);
```
