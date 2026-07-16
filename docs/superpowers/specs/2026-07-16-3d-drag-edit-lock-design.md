# 3D Drag Editing Safety Lock

## Status

Approved for implementation on 2026-07-16.

## Problem

The live 3D stage is primarily used for preview. Today, a primary-pointer gesture that starts on a performer or prop can start both object movement and `OrbitControls` camera rotation. Rotating the preview can therefore write an unintended position into the active formation, create project changes, and affect undo history.

The 3D stage needs an explicit interaction mode so preview navigation is safe by default and object movement is available only after the user deliberately enables it.

## Goals

- Make 3D object movement opt-in and disabled by default.
- Keep camera rotation available in the default preview mode, including when an object is selected.
- When editing is enabled, allow performers and props to move on the stage and allow performer height adjustment.
- Never let one primary-pointer gesture rotate the camera and move an object at the same time.
- Preserve playback read-only behavior, grid snapping, prop pivot semantics, undo grouping, and project dirty-state semantics.
- Make the mode visible and accessible without treating it as project data.

## Non-goals

- Changing 2D stage editing.
- Persisting the mode in project JSON, project packages, choreography JSON, or global preferences.
- Adding multi-selection movement to the 3D stage.
- Redesigning camera controls beyond the arbitration needed to remove the gesture conflict.

## UX Design

The expanded floating stage toolbar shows a `3D 拖动编辑` lock button only while the 3D view is active.

### Preview mode (default)

- The button is unpressed and visually locked.
- Primary drag rotates the camera, even when it starts on or after selecting an object.
- Secondary drag pans the camera and the wheel zooms.
- Performer plane movement, prop plane movement, and performer height adjustment are unavailable.
- Clicking an object still selects it.

### Drag editing mode

- The button is pressed and visually unlocked.
- Primary drag on a performer or prop moves that object.
- The performer height handle is available for a selected performer.
- Camera primary-drag rotation is disabled for the whole mode, preventing a gesture from starting both behaviors.
- Secondary drag still pans and the wheel still zooms.
- The button title and accessible label describe the action that will happen next: enable editing while locked, or lock objects while enabled.

### Playback and project transitions

- Playback remains read-only regardless of the requested drag mode. During playback, the effective mode is preview/navigation and no position callback can run.
- The requested mode may remain visibly enabled during playback, but the control is disabled and explains that playback temporarily locks editing. Pausing restores the requested mode.
- Application start and every project-session transition (create, open, import, or recovery) reset drag editing to off.
- Switching between 2D and 3D within the same project keeps the current session choice.

The mode is transient UI state. Toggling it must not mark the project dirty, create an undo entry, or appear in any exported format.

## Interaction Policy

The renderer uses one explicit policy instead of inferring editability from the presence of a selection.

```typescript
interface ThreeInteractionPolicyInput {
  dragEnabled: boolean;
  readonly: boolean;
  isDragging: boolean;
}

interface ThreeInteractionPolicy {
  canDragObjects: boolean;
  enableRotate: boolean;
  enablePan: boolean;
  enableZoom: boolean;
}

function resolveThreeInteractionPolicy(
  input: ThreeInteractionPolicyInput,
): ThreeInteractionPolicy;

function canStartThreeObjectDrag(input: {
  dragEnabled: boolean;
  readonly: boolean;
  button: number;
}): boolean;
```

Required policy:

| State | Object movement | Camera rotate | Camera pan | Camera zoom |
| --- | --- | --- | --- | --- |
| Drag off | No | Yes | Yes | Yes |
| Drag on | Yes, primary pointer only | No | Yes when not actively dragging | Yes |
| Playback/read-only | No | Yes | Yes | Yes |

Selection alone never disables camera rotation in preview mode.

## Component and Data Flow

`App.tsx` owns `is3DDragEnabled`, initialized to `false`, and renders the toolbar control. It passes the requested capability through a dedicated prop rather than overloading `readonly`:

```text
App
  -> Stage3D dragEnabled
    -> Scene3D dragEnabled + readonly
      -> Performer3D/Prop3D effective movement callbacks
      -> OrbitControls interaction policy
```

`Scene3D` computes the effective policy from `dragEnabled`, `readonly`, and active drag state. It exposes position-changing callbacks to the object components only when `canDragObjects` is true. This single gate disables performer plane movement, prop plane movement, and the performer height handle in preview mode.

`Performer3D` and `Prop3D` accept only primary-pointer movement starts. They acquire pointer capture for an accepted drag and release it on pointer up or pointer cancel. Rejected gestures return before calling `stopPropagation`, so `OrbitControls` can receive preview gestures.

Every accepted plane drag reports its latest valid position to the drag coordinator. Drag end or pointer cancellation clears all transient state and supplies the final position to the existing undo boundary. This ensures one gesture creates at most one move undo action and grid snapping receives the actual final coordinate.

Prop movement continues to store the configured pivot anchor, not the displayed geometry center. Center-to-anchor conversion must use the shared prop-pivot utilities before writing a hinged prop position.

## State and Failure Handling

- A missing or false `dragEnabled` prop means preview mode.
- `readonly` always overrides `dragEnabled`.
- Non-primary mouse buttons never start object movement.
- Pointer cancellation commits the last position already rendered, emits one drag end, releases capture, and clears drag state.
- Disabling permission during an active gesture performs the same cleanup and prevents further writes.
- A gesture with no valid movement produces no undo action.
- Missing position callbacks make the object non-draggable without breaking click selection.
- The control uses a semantic `button`, `aria-pressed`, a Chinese `aria-label`, and a dynamic `title`.

## Verification Strategy

### Unit policy tests

Add a pure interaction-policy test to the standard desktop suite. It covers:

- Default drag-off behavior.
- Selected-preview camera rotation policy.
- Drag-on primary-button permission.
- Secondary and middle button rejection.
- Read-only override.
- Active-drag pan arbitration.

### Renderer regression tests

Assert that:

- `is3DDragEnabled` initializes to `false`.
- The 3D-only toolbar button has `aria-pressed`, an accessible Chinese label, and no persistence write.
- The explicit prop flows through `App -> Stage3D -> Scene3D`.
- Performer and prop movement starts consult the policy before propagation is stopped.
- Orbit rotation is enabled in preview mode regardless of selection.
- Pointer-up and pointer-cancel cleanup paths exist.
- Playback/read-only overrides the switch.

### Runtime smoke test

Run the built desktop application with an isolated project profile:

1. Open 3D view and confirm the lock is off.
2. Drag from a visible performer while locked; confirm the camera view changes but the saved project position, undo state, and dirty state do not.
3. Select a performer and repeat; camera rotation must still work and the position must remain unchanged.
4. Enable drag editing and move a performer and a prop; confirm camera rotation does not occur and each position changes exactly once per gesture.
5. Cancel a drag outside the object/canvas and confirm no movement continues.
6. Start playback with the switch enabled and confirm all position writes remain blocked.

### Quality gates

- Targeted unit and renderer regression tests.
- `npm run typecheck`.
- `npm run test:desktop`.
- `npm test`.
- Production Vite/Electron packaging and the existing release dry run.

## Acceptance Criteria

- A fresh app and a newly entered project session always start with 3D drag editing off.
- In the default state, no primary drag on any performer, prop, or height handle can change project coordinates.
- In the default state, primary camera rotation works before and after object selection.
- Enabling the control restores performer, prop, and height movement without simultaneous camera rotation.
- Playback cannot write positions regardless of the switch state.
- Pointer cancellation cannot leave a continuing drag.
- The control is session-only and never changes exported project data.
- Existing project management, pause selection, version management, and release tests remain green.
