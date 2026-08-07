# Fix Desktop Import for Web JSON Exports

## Goal

Allow JSON exported from the Web app's "导出项目 (JSON)" flow to import successfully in the Desktop app as a new managed project.

## What I Already Know

- Web export writes a plain `ProjectDocument` JSON blob from `buildProjectDocument`.
- Desktop "编排 JSON" import currently accepts only `format: "cosstage-choreography"` with `schemaVersion: 1`.
- A Web-exported plain project JSON therefore reaches the desktop choreography importer and is rejected as an unsupported format.
- Desktop imports should still create a new managed project and should not overwrite the active project.

## Requirements

- Desktop choreography JSON import must accept both the explicit `ChoreographyDocument` format and the Web-exported plain `ProjectDocument` shape.
- Plain `ProjectDocument` imports must be normalized through the same project parsing path as managed projects.
- Imported JSON must not preserve binary asset references that cannot be portable from Web JSON.
- Invalid JSON or JSON missing required `performers` / `frames` arrays must still be rejected without installing a partial project.

## Acceptance Criteria

- [ ] A test importing plain Web-style project JSON through `importChoreographyDocument` passes.
- [ ] Existing choreography JSON import/export tests still pass.
- [ ] The importer continues to reject invalid choreography/project JSON without creating a managed project.

## Out of Scope

- Restoring missing audio/video/image asset files from Web JSON.
- Changing desktop project package `.zip` / `.choreo` import behavior.
- Changing the Web export UI labels in this task.

## Technical Notes

- Primary files: `electron/project-service.ts`, `tests/project-service.test.mjs`.
- Relevant specs: `.trellis/spec/backend/project-files.md`, `.trellis/spec/frontend/ipc-electron.md`, `.trellis/spec/shared/typescript.md`.
- Local `npm run build:main` currently fails before this task because `electron-updater` is not installed in `node_modules`.
