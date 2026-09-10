# Rebuild the 3D Model Asset Library

## Goal

Replace the legacy per-prop geometry editor with a reusable desktop asset library, immutable project snapshots, a multi-part parametric modeler, and calibrated GLB import while keeping choreography, project packaging, 2D/3D rendering, and offline export consistent.

## Requirements

- Upgrade managed projects to schema version 4.0 with project-scoped model asset snapshots.
- Keep instance width, height, depth, usage, rotation pivot, groups, locks, bindings, and frame choreography semantics.
- Provide twelve built-in offline parametric stage presets and a reusable user asset library under the configured storage root.
- Place assets through a 2D or 3D ghost-placement mode into the current and later frames.
- Provide a full-screen multi-part parametric modeler for boxes, cylinders, spheres, cones, and manually drawn extrusions.
- Import self-contained GLB files with validation, calibration, grounding, dimension controls, warnings, and authored material preservation.
- Reuse one model runtime across live 3D, modeler preview, and offline 3D export.
- Generate real front and transparent top-view renders for GLB and parametric assets; use the top view in the live 2D stage and 2D video export.
- Keep projects self-contained and isolate existing project snapshots from later global-library edits.
- Preserve high-platform lifting by using model footprints.
- Degrade clearly in web mode without exposing native file capabilities.

## Acceptance Criteria

- [x] Built-in and user assets can be placed from both 2D and 3D views.
- [x] Parametric assets can be created, edited, duplicated, deleted, and reused.
- [x] Valid GLB files can be imported, calibrated, stored, rendered, and exported.
- [x] Invalid, external-resource, oversized, and over-triangle-limit GLB files are rejected safely.
- [x] Projects survive save/reload and package export/import with identical model snapshots.
- [x] Global asset edits or deletion do not mutate existing projects.
- [x] Legacy v3 props migrate to the v4 unit-box fallback while preserving choreography and dimensions.
- [x] Live 3D and offline exports use the same geometry/model loader behavior.
- [x] Asset cards use a real front render, while the 2D stage and 2D export use the model's real top render at its instance dimensions.
- [x] Type-check, automated tests, and production frontend builds pass. Backend pytest is environment-blocked because no Python interpreter is installed.

## Definition of Done

- Shared contracts and IPC are validated on both sides of the Electron boundary.
- Unit, service, interaction, migration, and export regression tests are updated.
- Desktop packaging includes all model runtime files and decoder assets required by the implementation.
- User-facing strings remain zh-CN and browser-only mode presents an explicit unavailable state.

## Technical Approach

Use an asset-definition -> project-snapshot -> performer-instance architecture. Asset manifests are revisioned by content hash. Parametric recipes are serializable, while GLB and texture files remain project-relative assets. Performer dimensions remain canonical for choreography and derive runtime model scale from the snapshot's intrinsic dimensions. Native storage, import staging, materialization, transfer, and deletion live in the Electron main process behind typed IPC and constrained custom protocols.

## Decision (ADR-lite)

**Context**: Legacy performers directly own box/extrusion data and face textures, causing duplicated render logic and non-portable instances.

**Decision**: Separate reusable global assets from immutable project snapshots and thin stage instances; share a single Three.js runtime across all render outlets.

**Consequences**: Projects remain portable and stable across library edits, but updating a placed asset is explicit. Schema v3 custom geometry and textures are intentionally discarded during migration.

## Out of Scope

- FBX/OBJ import, cloud/community libraries, collaboration, Boolean modeling, vertex-level editing, and PNG outline extraction.
- Animated GLB playback, imported cameras, imported lights, and backend agent changes.
- Full local asset-library support in the browser build.

## Technical Notes

- Current baseline is clean at `0a7ff1c7d48eb4bf00756232904b28f32046ec01`, matching `origin/main` on 2026-09-09.
- Relevant layers: Electron contract/service/IPC/protocol, React sidebars and workspaces, R3F live rendering, 2D stage footprints, project portability, and offline export.
- Reference architecture: `pascalorg/editor` item schema, item catalog placement flow, and cached model renderer.
- The Trellis Python scripts cannot run because this host has no Python or uv installation; task metadata is maintained manually.
