# 3D Interaction Safety Contract

## 1. Scope / Trigger

Use this contract whenever changing the live 3D stage toolbar, object selection or dragging, camera controls, playback read-only behavior, project-session transitions, grid snapping, undo grouping, or prop pivot handling.

The live 3D stage is a preview surface by default. Object movement is an explicit, transient editing capability; it must never be inferred from selection and must never share a primary-pointer gesture with camera rotation. This contract does not change 2D stage editing or offline 3D rendering.

## 2. Signatures

The policy boundary is exact:

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
): ThreeInteractionPolicy;

export function canStartThreeObjectDrag(input: {
  dragEnabled: boolean;
  readonly: boolean;
  button: number;
}): boolean;
```

The component boundaries are:

```typescript
// Stage3DProps
readonly?: boolean;
dragEnabled?: boolean;
onDragStart?: (ids: string[]) => void;
onDragEnd?: (
  ids: string[],
  finalUpdates?: { id: string; pos: Position }[],
) => void;
onPositionChange: (updates: { id: string; pos: Position }[]) => void;

// Scene3DProps
readonly?: boolean;
dragEnabled?: boolean;
onDragStart?: (ids: string[]) => void;
onDragEnd?: (
  ids: string[],
  finalUpdates?: { id: string; pos: Position }[],
) => void;
onPositionChange?: (updates: { id: string; pos: Position }[]) => void;

// Performer3DProps and Prop3DProps
dragEnabled?: boolean;
onDragStart?: () => void;
onDragEnd?: (position?: Position) => void;
onPositionChange?: (pos: Position) => void;
```

`dragEnabled` defaults to exactly `false` at every optional prop boundary. An object drag may start only when `button === 0`.

## 3. Contracts

### State and reset

- `App.tsx` owns `is3DDragEnabled` as `useState(false)`.
- The value is transient UI state. It must not appear in project documents, project snapshots, exported packages, `localStorage`, preferences, dirty-state serialization, or undo actions.
- `activeProjectClipboardKey` identifies a project session. A change to that key must call `setIs3DDragEnabled(false)`, covering create, open, import, and recovery transitions. Switching 2D/3D view inside the same project does not reset it.
- The control exists only in 3D view and remains a semantic button with `aria-pressed`, a Chinese action label, and a playback-specific disabled title.

### Effective policy and OrbitControls

`readonly` has priority over the requested mode:

```typescript
const canDragObjects = dragEnabled && !readonly;

return {
  canDragObjects,
  enableRotate: !canDragObjects,
  enablePan: !isDragging,
  enableZoom: true,
};
```

| Effective state | Object movement | Camera rotate | Camera pan | Camera zoom |
| --- | --- | --- | --- | --- |
| `dragEnabled=false` | Disabled | Enabled | Enabled | Enabled |
| `dragEnabled=true`, writable, idle | Primary button only | Disabled | Enabled | Enabled |
| `dragEnabled=true`, writable, dragging | Active object only | Disabled | Disabled | Enabled |
| `readonly=true` | Disabled | Enabled | Enabled | Enabled |

`Scene3D` must pass `onPositionChange` to an object only when `canDragObjects` is true. A rejected object gesture must return before `stopPropagation()`, pointer capture, or `onDragStart`, so preview gestures continue to OrbitControls. Selection never changes the Orbit policy.

### Pointer lifecycle and exact final update

- Accepted performer plane, performer height, and prop plane drags attempt `setPointerCapture(event.pointerId)` and retain the matching pointer ID and capture target.
- All termination paths converge on idempotent cleanup: pointer up, `pointercancel`, `lostpointercapture`, `dragEnabled` becoming false, and component unmount. Cleanup clears plane/height flags and the last position, and releases capture when held. Unmount cleanup must not emit a late drag-end callback.
- `pointercancel` and `lostpointercapture` are filtered by captured pointer ID. An unrelated pointer must not finish the active gesture.
- The latest emitted valid `Position` is retained in a ref. Normal end, cancellation, or permission loss passes that exact value to `onDragEnd(position)`. No valid movement passes `undefined` and therefore creates no move undo action.
- `Scene3D` optionally snaps that final value once, supplies the exact `{ id, pos }` in `finalUpdates`, and applies the same snapped value to live position state when snapping is enabled. The App undo boundary must compare the recorded start with this exact final update so one gesture produces at most one move action.

> **R3F 9.5 event trap:** JSX `onPointerCancel` and `onLostPointerCapture` handlers on a Three object are useful local fallbacks but are not a reliable sole termination channel when browser pointer capture ends outside the R3F object event path. `Performer3D` and `Prop3D` must also register native `pointercancel` and `lostpointercapture` listeners on `gl.domElement`, remove both listeners in effect cleanup, and route them to the same idempotent finish function. Listening only through JSX is incorrect for this version.

### Prop pivot preservation

Prop `position` stores its configured rotation-pivot anchor, while the rendered mesh is positioned by its geometry center. A prop drag must convert the moved center back before writing:

```typescript
const movedCenter = mapTo2D(x, position.z || 0, z, stageConfig);
const newAnchor = getPropAnchorFromCenter(
  movedCenter,
  rotationDeg,
  performer,
  stageConfig,
);
```

Never write `movedCenter` directly. The conversion must preserve `left`, `center`, and `right` pivot semantics, rotation, width, and optional `z`.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| `dragEnabled` omitted or `false` | No object/height writes; camera rotate, pan, and zoom remain enabled. |
| `readonly=true`, regardless of `dragEnabled` | `canDragObjects=false`; do not expose a position callback; restore preview Orbit policy. |
| `button !== 0` | Reject before propagation is stopped or capture/drag-start occurs. |
| `onPositionChange` is absent | Object is non-draggable; click selection still works. |
| Accepted primary drag | Stop propagation, attempt capture, record the latest valid position, and start one undo boundary. |
| `pointerup`, matching `pointercancel`, or matching `lostpointercapture` | Finish once, release held capture, clear all drag refs, and report the exact last valid position. |
| Native termination for a different pointer ID | Ignore it; do not finish the captured gesture. |
| Permission becomes false mid-gesture | Finish through the same cleanup path and prevent further frame writes. |
| Component unmounts mid-gesture | Release/clear locally without emitting a stale drag-end callback. |
| Gesture has no valid movement | End with `position=undefined`; no move undo action. |
| Grid snapping is enabled | Snap the final position once and use the identical value for state and `finalUpdates`. |
| Dragging a hinged prop | Convert moved center to stored anchor with `getPropAnchorFromCenter`; never persist the center. |

## 5. Good / Base / Bad Cases

- **Good:** Drag editing is enabled, playback is stopped, and primary button `0` moves a left-pivot prop. The gesture captures the pointer, disables Orbit rotation, converts center to anchor on each valid update, and commits one exact final anchor on pointer up or cancellation.
- **Base:** A fresh or newly entered project session has drag editing off. Primary drag on a selected performer is left to OrbitControls; coordinates, project dirty state, and undo history remain unchanged.
- **Bad:** A right-button gesture starts object movement; playback leaves callbacks writable; a toggle is serialized; selection disables preview rotation; cleanup relies only on JSX cancel/lost-capture handlers; or a prop mesh center is stored as its position.

## 6. Tests Required

- `tests/three-interaction.test.ts` must assert the complete policy objects for default preview, enabled editing, and read-only override; active-drag pan suppression; acceptance of button `0`; rejection of buttons `1`, `2`, and `-1`; and a non-center prop anchor round trip.
- `tests/desktop-regressions.test.mjs` must assert the exact `false` App default, project-session reset dependency, 3D-only accessible control, absence from project/persistence/undo serialization, explicit prop flow, read-only policy gate, Orbit bindings, primary-button checks, pointer capture, and exact final update payload.
- Renderer source-contract tests must assert both native `gl.domElement` listeners and both removals for `pointercancel` and `lostpointercapture`, matching-pointer filtering, permission-loss cleanup, unmount cleanup, and prop center-to-anchor conversion. JSX-only assertions are insufficient.
- Runtime desktop acceptance uses an isolated profile and records: default toolbar state; locked performer/prop gestures without position, undo, or dirty-state changes; enabled performer/prop movement without simultaneous rotation; project-session reset; playback override; cancel/lost-capture cleanup; and before/after project JSON or equivalent coordinate evidence. If a real pointer gesture cannot be automated reliably, report the missing evidence as a concern rather than inferring success from source tests.
- Required gates are `npm run typecheck`, `npm run test:desktop`, `npm test`, and `git diff --check`. This repository has no lint script; these gates provide no lint claim.

## 7. Wrong vs Correct

### Wrong: JSX-only termination and persisted center coordinates

```tsx
<group
  onPointerCancel={finishDrag}
  onLostPointerCapture={finishDrag}
/>

// Wrong for a hinged prop: this is the displayed center, not its stored anchor.
onPositionChange(movedCenter);
```

This can leave R3F 9.5 drag refs active after capture terminates outside the object event path and shifts hinged props because it changes the meaning of stored `position`.

### Correct: native Canvas termination and anchor-safe final data

```typescript
const { gl } = useThree();

useEffect(() => {
  const canvas = gl.domElement;
  canvas.addEventListener('pointercancel', handleCanvasPointerTermination);
  canvas.addEventListener('lostpointercapture', handleCanvasPointerTermination);
  return () => {
    canvas.removeEventListener('pointercancel', handleCanvasPointerTermination);
    canvas.removeEventListener('lostpointercapture', handleCanvasPointerTermination);
  };
}, [gl, handleCanvasPointerTermination]);

const newAnchor = getPropAnchorFromCenter(
  movedCenter,
  rotationDeg,
  performer,
  stageConfig,
);
lastPlanePositionRef.current = newAnchor;
onPositionChange(newAnchor);
```

Keep the JSX handlers as local fallbacks, but make the Canvas listeners authoritative for browser-level termination and pass the exact anchor value through drag end.
