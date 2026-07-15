# Desktop Project Management and Choreography Exchange

## Goal

Restructure the desktop project-management code and provide reliable creation, loading, import, export, duplication, backup, and recovery flows. Distinguish complete portable projects from lightweight choreography-only JSON documents so users always know what data will move or be restored.

## What I already know

- Complete desktop projects are managed directories with `project.json` plus binary assets and are exchanged as ZIP/`.choreo` packages.
- Legacy loose JSON import currently creates a new managed project, but the UI calls it “old JSON” and does not define whether it is a backup, a choreography document, or a full project.
- Project lifecycle orchestration is concentrated in `App.tsx`; list/create/rename/duplicate/delete UI lives in `components/ProjectBrowser.tsx`; filesystem operations live in `electron/project-service.ts` and `electron/ipc-handlers.ts`.
- Existing save coordination already protects project switches with an automatic save and atomic `project.json` replacement.
- The current branch includes uncommitted security hardening: controlled save dialogs, project ID validation, package extraction limits, upload limits, and regression tests.

## Assumptions (temporary)

- Complete project packages include all project data and managed assets.
- Choreography-only JSON excludes binary assets and project identity/storage metadata.
- Imported data must be normalized through the shared project contract before it reaches editor state.
- Recovery should use an automatic local snapshot/history rather than silently overwriting the current project.

## Open Questions

- None.

## Requirements (evolving)

- Separate complete-project package import/export from choreography-only JSON import/export in naming, APIs, dialogs, and UI.
- Importing choreography-only JSON always creates and opens a new managed project; it never merges into or replaces the current project.
- Preserve complete project assets when exporting/importing packages.
- Validate and normalize JSON before creating or changing a project.
- Add explicit project recovery with discoverable recovery candidates and safe restore semantics.
- Keep the five most recent known-good snapshots for each project. Restoring a snapshot always creates and opens a new project.
- Move project lifecycle logic out of `App.tsx` into cohesive services/hooks without duplicating the cross-process contract.
- Keep legacy project compatibility where it can be mapped safely.

## Acceptance Criteria (evolving)

- [x] Users can create, rename, duplicate, delete, and open managed projects from the desktop project manager.
- [x] Users can export/import a complete project package with all referenced assets.
- [x] Users can export/import choreography-only JSON with a documented schema and no binary assets.
- [x] Importing choreography-only JSON creates a distinct project ID and leaves the previous project unchanged.
- [x] Invalid, oversized, or path-escaping imports fail without installing partial projects or changing editor state.
- [x] Interrupted/corrupt current project data can be restored from a valid recovery snapshot.
- [x] The recovery list exposes at most five snapshots per project, newest first.
- [x] Restoring a snapshot never overwrites the source project or its snapshots.
- [x] Filesystem transactions and transfer orchestration are extracted from scattered `App.tsx` handlers; `App.tsx` retains only editor-state hydration and save coordination.
- [x] Type-check, backend tests, project-service tests, desktop regressions, and production build pass.

## Definition of Done

- Tests added or updated for each import/export/recovery path.
- Cross-layer types are shared between renderer, preload, and main process.
- Trellis code-specs describe formats, validation, and recovery behavior.
- Full test suite passes.

## Out of Scope (explicit)

- Cloud synchronization and multi-device project history.
- Collaborative editing or remote project storage.
- Importing arbitrary third-party choreography formats.

## Technical Notes

- Primary files: `App.tsx`, `components/ProjectBrowser.tsx`, `electron/project-contract.ts`, `electron/project-service.ts`, `electron/ipc-handlers.ts`, `electron/preload.ts`, `electron-bridge.d.ts`.
- The current `ProjectDocument` contains project identity fields, stage/media references, performers, groups, frames, transitions, audio markers, and notes; a choreography document needs an explicit subset/version instead of reusing an untyped `any` template/legacy path.
- Recovery writes must remain atomic and must never replace the only known-good snapshot before the new document is durable.

## Decision (ADR-lite)

**Context**: Choreography JSON could either merge into the active project or become an independent project. Merge semantics create ambiguous conflicts for performers, frames, media references, notes, and undo history.

**Decision**: Choreography JSON import always creates a new managed project and opens it after successful validation.

**Consequences**: Import is non-destructive and easy to reason about. Users who want to combine choreography can use explicit copy/paste workflows rather than an implicit import merge.

### Recovery snapshots

**Context**: A single backup cannot protect against multiple bad saves or delayed discovery of corruption.

**Decision**: Before replacing a valid `project.json`, persist the previous document as a timestamped recovery snapshot. Keep the newest five. Restoring a snapshot validates it and creates a new managed project.

**Consequences**: Recovery remains non-destructive and versioned, with bounded disk usage. Binary assets remain in the source managed project and must be copied into the restored project when referenced.
