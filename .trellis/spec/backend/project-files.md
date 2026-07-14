# Portable Project Files

## Scenario: Managed Projects and Portable Packages

### 1. Scope / Trigger

Use this contract whenever project content references binary assets or crosses the renderer, preload, main-process, and filesystem boundaries.

The live editing format is a managed directory. A portable `.choreo` file is a ZIP archive of that directory and is only created for import/export. Desktop export defaults to a `.zip` package so users can recognize it as a compressed archive, while `.choreo` remains supported. Desktop import dialogs may also accept `.zip` files with the same archive layout.

### 2. Signatures

```typescript
type ProjectAssetKind = 'audio' | 'background';

project.load(projectId: string): Promise<ProjectLoadResult>;
project.save(projectId: string, document: ProjectDocument): Promise<ProjectLoadResult>;
project.ingestAsset(
  projectId: string,
  sourcePath: string,
  kind: ProjectAssetKind,
): Promise<ProjectAssetResult>;
project.exportPackage(projectId: string): Promise<string | null>;
project.importPackage(): Promise<ProjectImportResult | null>;
project.importLegacy(): Promise<ProjectImportResult | null>;
```

All filesystem and archive operations belong in the main process. IPC handlers must remain thin.

### 3. Contracts

`ProjectDocument` stores project content only:

- choreography entities, groups, frames, and stage configuration
- `musicAsset`: project-relative path or `null`
- LED media reference: project-relative path in `stageConfig.ledContent.value`
- prop textures: `assetPath` references

Binary assets must not be embedded in IPC payloads or portable JSON as base64 after migration. The renderer receives `choreo-asset://` URLs for playback/rendering.

Desktop's primary import/export controls must call `project.importPackage()` and `project.exportPackage(projectId)` so project JSON and all managed assets move together. Legacy loose JSON import is compatibility-only and must remain visually separate from the primary package path.

Import always creates a new managed project ID and automatically opens that project. It never overwrites the active project.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Missing or invalid `project.json` | Reject import and remove staging output |
| Missing performers or frames arrays | Reject import |
| Absolute path or `..` archive entry | Reject import before installation |
| Missing audio/background/texture | Continue import and return a structured warning |
| Duplicate import | Create another unique local project ID |
| Save before project switch fails | Cancel the switch/create operation |
| User cancels native dialog | Return `null`; do not mutate project state |

Archive extraction must occur under a temporary staging directory. Move the directory into managed storage only after the manifest is valid.

### 5. Good / Base / Bad Cases

- Good: package contains `project.json` and all assets; restore returns no warnings.
- Base: package has valid choreography but a missing texture; project opens with a fallback and warning.
- Bad: archive contains `../outside.txt`; import fails and no project directory is installed.

### 6. Tests Required

- Save a data-URL prop texture and assert it becomes `assets/props/*`.
- Export and import a project with an audio asset; assert a new ID and resolvable asset URL.
- Import the same package twice; assert unique IDs.
- Load a project with a missing asset; assert choreography remains available and a warning is returned.
- Build an archive with a traversal entry; assert rejection.
- Fail import before manifest validation; assert no partial project remains.
- Import legacy JSON; assert it becomes a managed project and reports unavailable legacy media.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Sends a potentially huge audio/video payload through IPC.
await window.electronAPI.project.save(id, {
  audioBase64,
  backgroundVideoBase64,
});
```

#### Correct

```typescript
// Main process copies the selected file into managed storage.
const asset = await window.electronAPI.project.ingestAsset(id, sourcePath, 'audio');
document.musicAsset = asset.relativePath;
```

The renderer uses the returned project URL, while the manifest keeps only the relative asset path.

## Scenario: Reset-Time Project Backup

### 1. Scope / Trigger

Use this contract when the renderer offers to back up the current editor state before clearing/resetting it.

### 2. Signatures

```typescript
project.exportPackage(projectId: string): Promise<string | null>;
saveFile(defaultName: string, filters?: Electron.FileFilter[]): Promise<string | null>;
writeFile(filePath: string, content: string): Promise<void>;
```

### 3. Contracts

- Reset-time backup must be a user-confirmed step. Closing/canceling the backup dialog returns to editing and must not clear state.
- If the editor is attached to a valid managed desktop project, try `project.exportPackage(projectId)` first so JSON and assets are preserved together.
- If there is no current managed project ID, or the package export fails, offer a JSON backup using the current renderer `ProjectDocument` snapshot.
- JSON backup is a fallback safety copy only; it may not include managed binary assets as files.
- Clearing/resetting is allowed only after a backup succeeds or after the user explicitly clicks a destructive "clear without backup" action.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| User closes the reset backup prompt | Keep editing state; do not clear |
| User cancels native package save dialog | Keep editing state; offer/allow fallback JSON backup |
| Missing `currentProjectId` | Skip package export and offer JSON backup |
| Package export throws | Surface the real error message and offer JSON backup |
| JSON backup save path is canceled | Keep editing state; show the backup-incomplete prompt |
| User explicitly confirms clear without backup | Clear editor state |

### 5. Good / Base / Bad Cases

- Good: managed project exports a `.zip`; reset then clears the editor.
- Base: unsaved/local editor state exports a `.json`; reset then clears the editor.
- Bad: user cancels the backup path and the editor clears anyway.

### 6. Tests Required

- Desktop regression asserts reset backup uses a dedicated backup function rather than the primary package export directly.
- Desktop regression asserts JSON backup uses `saveFile(..., json filter)` plus `writeFile`.
- Desktop regression asserts cancel/return text is non-destructive and legacy English `window.confirm` copy is absent.

### 7. Wrong vs Correct

#### Wrong

```typescript
if (window.confirm('Export before reset?')) {
  handleExportProject();
}
resetProject();
```

#### Correct

```typescript
const exported = await exportResetBackup();
if (exported) {
  resetProject();
} else {
  showBackupIncompletePrompt();
}
```

