# Add Rehearsal Export Views

## Goal

Add export-view options that make rendered rehearsal videos easier to use for performers: 2D exports can render with the stage front at the top of the video, and 3D exports can render from a rear 45-degree elevated camera.

## What I Already Know

- The export modal already lets users enable 2D video, 3D video, labels, grid, resolution, and a 3D camera angle.
- `App.tsx` owns the 2D export canvas renderer and the 2D / 3D export workflows.
- `utils/OfflineRenderer3D.ts` owns the offline 3D camera angle enum and camera placement.
- Existing 2D export view maps `y=100` (stage front) to the bottom of the video and labels the lower ruler `舞台前沿`.
- Existing 3D export angles are `judge` and `overhead`; `overhead` is currently a front elevated view.

## Requirements

- Add a 2D export option for `演员排练视角`.
- The 2D rehearsal view must render the stage front at the top of the exported video.
- The 2D default should remain the current audience/judge-oriented view.
- Include the selected 2D view in the generated 2D export filename.
- Add a 3D export camera option for `后方45°俯视`.
- The 3D camera type must be reflected in the generated 3D export filename.
- Existing labels, grid, stage background, LED marker, performers, props, and direction arrows must continue to render.

## Acceptance Criteria

- [ ] Export settings show a 2D view selector when 2D export is enabled.
- [ ] Selecting the 2D rehearsal view places `舞台前沿` at the top of the exported 2D frame.
- [ ] 3D camera options include `后方45°俯视`.
- [ ] Type-check passes.
- [ ] Desktop regression tests cover the new export view options.

## Out of Scope

- Changing live 2D editor orientation.
- Changing live 3D preview camera controls.
- Exporting both 2D views automatically in one click.

## Technical Notes

- Primary files: `App.tsx`, `utils/OfflineRenderer3D.ts`, `tests/desktop-regressions.test.mjs`.
- Relevant specs: `.trellis/spec/frontend/index.md`, `.trellis/spec/frontend/quality.md`, `.trellis/spec/frontend/three-interaction.md`, `.trellis/spec/frontend/react-pitfalls.md`, `.trellis/spec/frontend/components.md`, `.trellis/spec/frontend/type-safety.md`, `.trellis/spec/guides/pre-implementation-checklist.md`.
