# Stage Division Rendering

## Meter Grid Contract

All stage renderers must use `utils/stage-grid.ts` as the single source of truth.

```typescript
createCenteredStageGridMarks(totalWidth, spacing);
normalizeStageGridSpacing(value);
```

- Spacing defaults to `1m`.
- Valid spacing is `0.5m` through `2.5m` in `0.5m` steps.
- The stage front ruler is centered at `0m`.
- Labels increase outward using absolute distances on both sides.
- Two prominent depth lines at `1/3` and `2/3` divide the stage into front, middle, and back zones.

## Renderer Consistency

Changes to stage division behavior must be applied to:

- `components/Stage.tsx` for the interactive 2D editor.
- `3d_components/StageFloor.tsx` for the interactive 3D editor.
- `App.tsx` for 2D canvas export.
- `utils/OfflineRenderer3D.ts` for offline 3D export.

Do not calculate independent division counts inside a renderer. Physical meter spacing must remain stable when stage dimensions change.

## Required Checks

- Default stage shows a centered `0m` mark.
- Equal labels appear on the left and right at the selected spacing.
- The control clamps to `0.5m` and `2.5m`.
- Exactly two prominent depth division lines are rendered.
- 2D and 3D views render without console errors.
- Export renderers use the same shared grid marks.

## Transformed Pointer Overlays

Pointer state may remain in client coordinates for hit testing, but overlays rendered inside the transformed stage must convert client pixels back into local pixels:

```typescript
const scaleX = stage.offsetWidth / rect.width;
const localX = (clientX - rect.left) * scaleX;
```

Apply the same conversion independently on the Y axis. Using raw client pixel deltas as an absolutely positioned child causes selection overlays to be scaled twice after zooming.
