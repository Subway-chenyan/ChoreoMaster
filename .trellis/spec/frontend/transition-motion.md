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
