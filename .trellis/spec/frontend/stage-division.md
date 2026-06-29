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

## Scenario: Persisted Stage Background, LED Depth, and Direction Indicators

### 1. Scope / Trigger

- Trigger: adding or changing stage background media, stage line visibility, LED depth, or object-facing indicators.
- The contract spans project JSON, managed project assets, React state, live 2D/3D, and both export renderers.

### 2. Signatures

```typescript
interface StageBackground {
  value: string;
  opacity: number;
  pixelWidth: number;
  pixelHeight: number;
}

interface StageConfig {
  background?: StageBackground;
  showStageLines?: boolean;
  ledDistanceFromBack?: number;
}

calculateStageDimensionsFromImage(totalWidth, wingWidth, pixelWidth, pixelHeight);
getLedDistanceFromBack(stageConfig);
getLedStageYPercent(stageConfig);
getLedZPosition(stageConfig);
```

### 3. Contracts

- A stage background spans the total physical width: main stage plus both wings.
- Upload confirmation derives `main width = total width - 2 * wing width` and `depth = total width * pixel height / pixel width`.
- `background.value` is either a browser data URL or a managed-project relative path. Renderers resolve it through `mediaCache[value] ?? value`.
- Managed projects externalize data URLs to `assets/stage-backgrounds/` and hydrate the relative path into `mediaUrls` on load.
- `showStageLines !== false` is the compatibility default. It gates wing boundary lines and the two horizontal third-division lines, but not the vertical meter grid.
- `ledDistanceFromBack` uses meters, defaults to `0`, and is clamped to `0..stage depth`.
- Performer and prop direction arrows consume the same per-frame rotation used by geometry in live 2D/3D and exports.
- Rotation `0deg` means facing the stage front. In the 2D editor/canvas this is visually downward; in 3D it is the same world direction used by `mapTo3D` for the front edge. Do not flip only one renderer.
- Direction indicators are operational cues, not decorative marks. Keep them legible at the default zoom: use a fixed SVG arrow in the 2D editor, a thicker canvas arrow in 2D export, and matching larger geometry in live/offline 3D.

### 4. Validation & Error Matrix

- Missing background -> render the normal dark stage.
- Non-image, undecodable image, or zero image dimensions -> reject the upload and retain the previous background.
- Total width less than or equal to both wings -> disable confirmation and retain the previous stage dimensions.
- Non-finite opacity -> `0.5`; finite opacity -> clamp to `0..1`.
- Missing/non-finite LED distance -> `0`; out-of-range value -> clamp to `0..depth`.
- Missing managed background asset -> return a `missing_asset` warning and continue loading the project.
- 3D export texture load failure -> warn once and continue with the dark floor.

### 5. Good/Base/Bad Cases

- Good: a 1200x800 image with 24m total width and 3m wings produces an 18m x 16m main stage, appears in every renderer, and survives project reload.
- Base: a legacy project without the new fields renders with no image, stage lines visible, and LED at the back edge.
- Bad: 2D uses `background.value` directly while 3D requires `mediaCache`, causing managed project images to disappear in only one renderer.

### 6. Tests Required

- Pure utility tests assert dimension derivation, invalid widths, opacity normalization, and LED clamping/coordinate conversion.
- Project-service tests assert data URL externalization, `mediaUrls` hydration, exact option persistence, and legacy defaults.
- Desktop regression tests assert all four renderer paths reference the shared URL/LED helpers and both actor/prop components include direction arrows.
- Desktop regression tests assert 2D direction arrows default toward the stage front and canvas export rotates arrows with the same sign as the editor.
- Desktop regression tests assert the 2D arrow uses a visible SVG size/stroke and the live/offline 3D arrows use matching enlarged geometry.
- Browser verification asserts the settings controls render, the stage-line toggle removes wing boundaries, and no console errors are emitted.
- Production build must pass after shared contract changes.

### 7. Wrong vs Correct

#### Wrong

```typescript
const ledZ = -stageConfig.depth / 2 + (stageConfig.ledDistanceFromBack ?? 0);
const backgroundUrl = stageConfig.background?.value;
```

This duplicates clamping and fails for managed project asset paths.

#### Correct

```typescript
const ledZ = getLedZPosition(stageConfig);
const backgroundUrl = resolveStageBackgroundUrl(stageConfig, mediaCache);
```
