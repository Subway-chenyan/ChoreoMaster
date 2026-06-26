# Transition Segments Design

## Goal

Add an explicit transition layer between formation frames so each performer or prop can:

- follow a custom path between two frames
- rotate during the transition instead of using a single global rotation value
- stay backward compatible with existing projects that only store frame positions

This design keeps `Frame` as the key formation snapshot and introduces a new `TransitionSegment` model for motion.

## Current Problem

The current project model stores:

- `frames[].positions[id] = { x, y, z? }`
- `performers[].rotation`

This causes three limits:

1. position is time-varying, but rotation is global
2. gaps between frames can only use built-in linear interpolation
3. there is no persistent place to store a drawn path

## Target Model

### Frame

`Frame` remains the source of truth for formation snapshots:

- formation name
- start time
- hold duration
- per-object anchor position
- hidden groups

Frames do not store motion paths.

### TransitionSegment

Add an explicit transition record for a frame pair:

```ts
interface TransitionSegment {
  id: string;
  fromFrameId: string;
  toFrameId: string;
  duration?: number;
  objectMotions: Record<string, ObjectMotion>;
}
```

`duration` is optional. When absent, runtime uses the actual gap between the two frames.

### ObjectMotion

Each performer or prop can override the default motion:

```ts
type MotionPathType = 'linear' | 'bezier';
type RotationMode = 'fixed' | 'lerp';

interface MotionControlPoint {
  x: number;
  y: number;
  z?: number;
}

interface ObjectMotion {
  pathType?: MotionPathType;
  controlPoints?: MotionControlPoint[];
  rotationMode?: RotationMode;
  startRotation?: number;
  endRotation?: number;
}
```

Semantics:

- `linear`: runtime interpolates start/end anchors directly
- `bezier`: runtime uses cubic bezier with two control points
- `fixed`: use `startRotation` for the whole transition
- `lerp`: interpolate from `startRotation` to `endRotation`

## Backward Compatibility

Existing projects do not contain `transitions`.

Compatibility strategy:

1. parser accepts missing `transitions`
2. runtime builds a default virtual transition for every frame gap
3. default motion stays equivalent to current behavior:
   - linear path
   - ease-in-out timing
   - only interpolate objects that exist in both frames
   - keep previous hidden groups during gap
   - use performer rotation as fallback when no per-transition rotation is configured

This keeps old projects rendering the same before any transition is edited.

## Runtime Data Flow

### Input

- `performers`
- `frames`
- `transitions`
- `currentTime`

### Output

Runtime computes a scene state:

```ts
interface SceneObjectState {
  position: Position;
  rotation: number;
}

interface SceneState {
  positions: Record<string, Position>;
  rotations: Record<string, number>;
  hiddenGroupIds: string[];
}
```

### Resolution Rules

1. Sort frames by `startTime`
2. If time is inside a frame hold window, use the frame positions directly
3. If time is inside a gap:
   - resolve `fromFrame` and `toFrame`
   - find matching `TransitionSegment`
   - for each object present in both frames, evaluate motion path
   - evaluate rotation using transition motion or performer fallback
4. If there is no saved transition, use default linear motion

## Playback Algorithm

### Position

For gap progress `t` after easing:

- `linear`: `lerp(start, end, t)`
- `bezier`: cubic bezier using:
  - `P0 = start anchor`
  - `P1 = controlPoints[0]`
  - `P2 = controlPoints[1]`
  - `P3 = end anchor`

`z` follows the same rule as `x/y`.

### Rotation

Rotation resolution priority:

1. transition motion `startRotation/endRotation`
2. fallback to `performer.rotation`

Mode behavior:

- `fixed`: return `startRotation`
- `lerp`: interpolate `startRotation -> endRotation`

## UI Design

### Timeline

Timeline gaps become first-class transition segments:

- still rendered in the gap area
- selectable
- highlight when active or configured
- click opens transition editor

### Transition Editor

MVP editor lives beside the timeline and controls one selected transition plus one selected object:

- choose path type: `linear | bezier`
- edit start rotation
- edit end rotation
- choose rotation mode: `fixed | lerp`
- quick actions:
  - reset to default motion
  - convert linear to bezier
  - fill control points from current linear path

MVP does not include canvas path drawing yet. Control points are edited numerically.

### Stage Rendering

2D stage receives:

- `positions`
- `rotations`

so props can rotate during playback without mutating `performers[].rotation`.

### 3D Rendering

3D scene also reads runtime rotations instead of only performer defaults so preview and export stay aligned.

## File-Level Implementation Plan

### Shared contract

Update:

- `electron/project-contract.ts`
- `types.ts`

Add:

- `TransitionSegment`
- `ObjectMotion`
- `SceneState`

### Storage

Update:

- `electron/project-service.ts`

Responsibilities:

- parse transitions safely
- default missing transitions to `[]`
- persist transitions in `project.json`

### Runtime evaluation

Update:

- `App.tsx`

Responsibilities:

- replace duplicated position-only interpolation with one scene-state evaluator
- expose `currentSceneState`
- keep `computePositionsAtTime()` compatibility by reading from scene-state evaluator

### UI

Update:

- `components/Timeline.tsx`
- `components/Stage.tsx`
- `3d_components/Scene3D.tsx`
- `3d_components/Performer3D.tsx`
- `3d_components/Prop3D.tsx`
- `utils/OfflineRenderer3D.ts`

Responsibilities:

- timeline selects and edits transition segments
- 2D/3D renderers consume runtime rotation overrides
- exporter uses the same runtime evaluator

## MVP Scope

Included:

- persistent `transitions`
- path type `linear | bezier`
- rotation mode `fixed | lerp`
- per-object transition editor with numeric control points
- backward compatibility for old projects

Excluded:

- freehand drawing directly on stage
- polyline, arc, or look-at-path rotation
- easing presets per object
- transition-specific visibility fades

## Risks

### Risk 1: Renderer and exporter diverge

Mitigation:

- use one shared scene-state evaluator

### Risk 2: Old projects change behavior

Mitigation:

- default transition generation must reproduce current interpolation logic

### Risk 3: UI becomes too large inside `App.tsx`

Mitigation:

- extract transition helpers and editor component instead of adding more inline logic

## Acceptance Criteria

1. old projects load and play exactly as before
2. a transition segment can persist per-object motion settings
3. a prop can rotate between two formations during playback
4. a bezier transition changes the movement path during the gap
5. 2D preview, 3D preview, and export use the same transition result
