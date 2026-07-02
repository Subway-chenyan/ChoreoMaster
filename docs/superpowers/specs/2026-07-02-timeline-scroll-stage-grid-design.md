# Timeline Scrolling and Stage Grid Design

## Scope

This change fixes timeline scrollbar interactions and extends the stage grid with a shared horizontal/vertical spacing control and optional drop-time snapping.

## Timeline interaction

- The native horizontal scrollbar is a viewport control only. Clicking or dragging it must never seek the playhead.
- Seeking remains available on the actual timeline content surface.
- Pointer-based seek handling belongs to an inner content layer rather than the overflow container so native scrollbar events cannot enter the seek path.
- A vertical mouse-wheel gesture over the timeline viewport scrolls it horizontally.
- Native horizontal touchpad input remains horizontal. When both axes are present, the dominant horizontal delta is preserved; otherwise the vertical delta is converted to horizontal movement.
- Wheel input is normalized for pixel, line, and page delta modes and clamped by the browser's native `scrollLeft` behavior.

## Stage grid

- Horizontal and vertical grid lines share one spacing value.
- Supported spacing starts at `0.1m`, changes in `0.1m` increments, and retains the existing upper bound.
- The stage toolbar uses the approved inline layout: decrement button, editable spacing value, increment button, and a magnet-style snap toggle.
- Horizontal marks are centered in the stage depth in the same way vertical marks are centered across the total stage width.
- Existing major stage division lines remain visually distinct from the new regular horizontal grid.
- When spacing is below `0.5m`, bottom numeric labels are hidden to prevent overlap. Grid lines remain visible.
- Live 2D, live 3D, and exported grid rendering use shared grid calculations where their coordinate systems allow it.

## Snapping

- Grid snapping is a view/edit preference and defaults to off.
- With snapping enabled, performers and props move freely while dragging.
- On pointer release, every moved object is rounded independently to its nearest horizontal and vertical grid intersection.
- The snapped position is clamped to the same stage bounds used by normal dragging.
- The final snapped coordinates are included in the existing move undo transaction, so one undo restores the entire drag.

## Compatibility and failure behavior

- Legacy projects require no migration because grid spacing and snapping remain editor preferences rather than persisted project content.
- Non-finite spacing input falls back to the current valid value; finite input is normalized to the supported range and `0.1m` step.
- A timeline without horizontal overflow ignores wheel-to-horizontal conversion instead of blocking page behavior.

## Verification

- Unit tests cover spacing normalization, centered horizontal and vertical marks, label visibility below `0.5m`, coordinate snapping, and wheel delta normalization.
- Timeline regression coverage verifies that the native scrollbar no longer shares the seek handler while timeline content still seeks.
- Stage regression coverage verifies horizontal grid rendering and drop-time snapping for performers and props.
- Type checking, production build, and relevant desktop regression tests must pass.
