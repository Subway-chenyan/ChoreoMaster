# Desktop Project Creation and Full Restore

## Goal

Improve desktop project management so a user can create, save, export, and restore a complete CosStage project, including formation data, audio, stage background image/video, prop textures, and future binary resources. The project must remain editable after restoration without asking the user to locate the original media files.

## What I Already Know

- Desktop project storage already uses `~/.choreo/projects/<project-id>/`.
- Each managed project currently has `project.json`, `audio/`, and `media/`.
- Project duplication already copies the entire directory.
- Standalone JSON export/import restores formation-related state but cannot carry binary resources.
- Audio is currently held as a renderer blob URL and decoded `AudioBuffer`; it is not copied into project storage.
- LED image/video is held in `mediaCache` as a blob URL; only its generated filename is stored in `stageConfig`.
- Prop textures are embedded as `data:` URLs inside performer data.
- Existing project load resets audio and media state instead of resolving assets from the project directory.

## Assumptions (Temporary)

- The desktop application is the primary target for complete portable restore.
- Web/PWA keeps standalone JSON import/export as a reduced-capability fallback.
- Importing an external project package should create a new managed local project rather than mutate an unrelated project in place.
- Large background videos are possible, so archive creation and extraction should avoid loading the whole package into renderer memory.

## Requirements (Evolving)

- Define a versioned project manifest with explicit schema and asset references.
- Store all binary resources under project-owned asset directories using relative references.
- Include project content only: choreography, groups, stage configuration, audio, background media, props, and prop textures.
- Do not include editor/workspace preferences such as 2D/3D mode, label/grid visibility, panel sizing, timeline selection range, or export settings.
- Copy audio and LED background image/video into the active managed project when selected.
- Externalize prop textures from manifest `data:` URLs into project-owned files while preserving compatibility with existing embedded textures.
- Restore audio playback, waveform data, LED background media, and prop textures automatically when a managed project is loaded.
- Export a complete portable project package with a CosStage-specific extension.
- Import a portable package through Electron IPC and install it into managed project storage.
- Always import a portable package as a new managed local project; never replace or overwrite the currently open project.
- Continue importing legacy standalone JSON files through a migration path.
- On desktop, migrate every imported legacy JSON file into a newly created managed project.
- Automatically open the newly created managed project after a successful package or legacy JSON import.
- Validate package structure, manifest version, asset references, and archive paths before installation.
- Avoid partial projects by staging import before final installation.
- Continue importing when non-core assets are missing, unreadable, or unsupported, and surface an actionable warning list.
- Fail import only when the package cannot provide a valid manifest and usable core choreography data.
- Keep normal autosave operating on the managed directory without recompressing the portable package.
- Make the tutorial example load from both HTTP development builds and packaged Electron `file://` builds.
- Keep imported LED background videos synchronized with timeline playback instead of showing only a seeked still frame.
- Treat the configured timeline height as the total panel height so the toolbar and track do not overflow the application viewport.
- Run the Agent as an independently deployed HTTP backend shared by desktop and web clients.
- Exclude the Python Agent executable, desktop Agent launcher, and FFmpeg binary from the Electron application package.

## Acceptance Criteria (Evolving)

- [ ] A project containing formations, audio, LED image/video, and prop textures can be exported and imported on another machine.
- [ ] The restored project opens with all supported resources available without manual re-import.
- [ ] Import creates a managed project visible in the project browser.
- [ ] Importing a package never modifies or overwrites the currently open project.
- [ ] Re-importing the same package creates another project with a unique local ID.
- [ ] Loading a managed project resolves relative asset references through typed IPC.
- [ ] Legacy JSON files remain importable and clearly report resources that cannot be restored.
- [ ] A legacy JSON import creates a new managed project visible in the project browser and can subsequently use normal save/export flows.
- [ ] After successful import, the new project becomes the active project and the user can immediately inspect restored content and warnings.
- [ ] Invalid or malicious archive paths are rejected without writing outside the staging directory.
- [ ] Failed imports leave no partially installed project in the project list.
- [ ] Missing or corrupt audio, background media, or prop textures do not block import when core choreography data is valid.
- [ ] A degraded import reports each affected resource and leaves its feature in a safe empty/fallback state.
- [ ] Duplicate asset file names do not overwrite unrelated resources.
- [ ] Save, duplicate, rename, delete, and open-in-explorer continue to work.
- [ ] Large media files do not cross IPC as base64 strings or full in-memory archive buffers.
- [ ] Importing a project package does not overwrite the user's local editor or export preferences.
- [ ] Clicking the tutorial example creates/loads the example in a packaged Electron build.
- [ ] An imported LED video advances while the timeline is playing and seeks to the selected frame while paused.
- [ ] The timeline panel stays within its configured height without a blank overflow region.
- [ ] Electron startup no longer spawns or manages a Python Agent process.
- [ ] Desktop and web use the same configurable backend URL and member token.
- [ ] `npm run build:electron` does not build or package the Agent backend or FFmpeg.

## Definition of Done

- Tests cover manifest validation, migration, path traversal rejection, asset collision handling, and failed import cleanup.
- Electron main-process build and renderer build pass.
- Existing project management flows remain functional.
- User-facing project import/export states and errors are presented without browser `alert`, `confirm`, or `prompt`.
- Project format and compatibility behavior are documented.

## Research References

- [`research/portable-project-package.md`](research/portable-project-package.md) - Recommends a managed working directory plus a streaming `.choreo` ZIP package and legacy JSON migration.

## Feasible Approaches

### Approach A: Managed directory plus portable `.choreo` archive (Recommended)

- Live editing uses a project directory and relative asset references.
- Export streams the directory into a ZIP-compatible `.choreo` file.
- Import validates and installs the archive as a new managed project.
- Pros: fast autosave, portable, scalable to video, inspectable, supports migrations.
- Cons: requires manifest migration and archive import/export services.

### Approach B: Self-contained JSON with base64 resources

- Embed every resource directly in JSON.
- Pros: one file and simple conceptual model.
- Cons: very large files, high memory use, poor video handling, expensive saves, fragile IPC.

### Approach C: User-selected project folder

- The selected folder itself is the portable project.
- Pros: no compression dependency and easy manual inspection.
- Cons: users can move/delete individual assets, sharing is inconvenient, and folder permission/path behavior is more complex.

## Expansion Sweep

### Future Evolution

- Add project thumbnails, package checksums, format migrations, and optional resource deduplication.
- Reserve manifest sections for agent session artifacts, export presets, and additional stage media.

### Related Scenarios

- Keep create, duplicate, template, legacy import, portable import, and export behavior consistent.
- Distinguish "Save" for the live managed project from "Export Package" for sharing or backup.

### Failure and Edge Cases

- Missing manifest, unsupported future version, corrupted ZIP, path traversal, duplicate IDs, duplicate asset names, disk full, permission denial, and cancellation.
- Legacy projects with embedded prop textures or missing external audio/background files.

## Open Questions

- None.

## Decision (ADR-lite)

**Context**: Portable package import could either replace the active project or install a separate managed copy.

**Decision**: Every portable package import creates a new managed local project with a new unique project ID. The current project is never overwritten by import.

**Consequences**: Import is predictable and protects unsaved/current work. Re-importing a package may create duplicate projects, which users can rename or delete through existing project management actions.

### Degraded Asset Restore

**Context**: A portable package can contain valid choreography data even if one binary resource is missing, corrupt, or unsupported.

**Decision**: Import continues when core choreography data is valid. Missing audio, background media, and prop textures are replaced by safe empty/fallback states and reported to the user as warnings. Invalid manifests or unusable core choreography data still fail the import.

**Consequences**: Users retain recoverable work and can repair individual resources later. The import result must carry structured warnings, and the project UI must make degraded resources identifiable.

### Package Scope

**Context**: Some UI and export state is specific to a user's workstation rather than the choreography project itself.

**Decision**: The package contains project content only. Editor layout, view state, timeline range, and export preferences remain local application preferences.

**Consequences**: Opening the same project on another machine restores the production content without unexpectedly changing that user's workspace or export setup.

### Legacy JSON Migration

**Context**: The existing desktop JSON import only replaces renderer state and leaves the result outside managed project storage.

**Decision**: Importing a legacy JSON file on desktop creates a new managed local project, migrates recognized project content, and records warnings for resources that were never present in the JSON.

**Consequences**: Legacy projects immediately gain normal save, rename, duplicate, delete, resource management, and portable package export behavior.

### Post-import Navigation

**Context**: An imported project can either remain only in the project list or become the active workspace immediately.

**Decision**: After a successful portable package or legacy JSON import, automatically open the newly created managed project.

**Consequences**: Users receive immediate feedback that restoration succeeded and can inspect any degraded-resource warnings in context.

### Agent Deployment Boundary

**Context**: Bundling the Python Agent, model dependencies, and FFmpeg into Electron makes the installer large and couples desktop releases to backend releases.

**Decision**: Electron contains only the editor and project-file capabilities. The Agent is deployed as a standalone HTTP service, and both desktop and web clients connect through the same configurable backend URL and member token.

**Consequences**: The desktop installer is smaller and backend deployments can evolve independently. Users or administrators must provide a reachable Agent service URL and access token.

## Technical Approach

- Introduce shared, versioned project manifest and asset reference types with runtime validation.
- Keep live projects as managed directories and migrate their layout toward `manifest.json` plus `assets/audio`, `assets/backgrounds`, and `assets/props`.
- Add an Electron main-process project service for asset ingestion, project loading, legacy migration, package export, staged package import, validation, and cleanup.
- Expose typed, narrow IPC methods through preload; do not move binary archive contents across IPC.
- Resolve project assets to renderer-consumable URLs/paths during load, then decode audio and populate media/texture state.
- Replace embedded prop texture data URLs with asset references for newly saved projects while supporting migration of existing data URLs.
- Use a streaming ZIP implementation for `.choreo` export and guarded extraction for import.
- Return structured import results containing the new project ID and resource warnings.
- Add project-browser actions for importing legacy JSON and portable packages, exporting the active project package, progress state, and non-blocking result/error UI.

## Implementation Plan

1. Define manifest schema, asset reference model, migration rules, and validation tests.
2. Build Electron filesystem/project services for asset ingestion and complete managed-project restoration.
3. Add secure `.choreo` streaming export and staged import with traversal and cleanup tests.
4. Integrate typed preload APIs and renderer project load/save/import/export flows.
5. Add project-browser UI, warning presentation, legacy JSON migration, and compatibility verification.

## Out of Scope (Initial)

- Cloud synchronization and collaborative editing.
- Cross-project global asset deduplication.
- Automatic recovery of media that was never included in a legacy JSON file.
- Password-protected or encrypted project packages.
- Portable editor layout, view preferences, timeline selection range, and export presets.

## Technical Notes

- Likely affected layers: React project browser/state, preload API, Electron IPC handlers, filesystem/archive service, shared project types and validators.
- Current key files: `App.tsx`, `components/ProjectBrowser.tsx`, `electron/ipc-handlers.ts`, `electron/preload.ts`, `electron-bridge.d.ts`, and `types.ts`.
- The implementation should move project-format logic out of the large `App.tsx` component into typed helpers/services.
- Archive extraction must defend against ZIP Slip by normalizing every entry and checking that its resolved path stays under the staging directory.
