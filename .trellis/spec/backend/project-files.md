# Portable Project Files

## Scenario: Managed Projects and Portable Packages

### 1. Scope / Trigger

Use this contract whenever project content references binary assets or crosses the renderer, preload, main-process, and filesystem boundaries.

The live editing format is a managed directory. A portable `.choreo` file is a ZIP archive of that directory and is only created for import/export. Desktop export defaults to a `.zip` package so users can recognize it as a compressed archive, while `.choreo` remains supported. Desktop import dialogs may also accept `.zip` files with the same archive layout.

### 2. Signatures

```typescript
type ProjectAssetKind = 'audio' | 'background' | 'stage-background';

project.load(projectId: string): Promise<ProjectLoadResult>;
project.save(projectId: string, document: ProjectDocument): Promise<void>;
project.ingestAsset(
  projectId: string,
  sourcePath: string,
  kind: ProjectAssetKind,
): Promise<ProjectAssetResult>;
project.exportPackage(projectId: string): Promise<string | null>;
project.importPackage(): Promise<ProjectImportResult | null>;
project.exportChoreography(projectId: string): Promise<string | null>;
project.importChoreography(): Promise<ProjectImportResult | null>;
```

All filesystem and archive operations belong in the main process. IPC handlers must remain thin.

### 3. Contracts

`ProjectDocument` stores project content only:

- choreography entities, groups, frames, and stage configuration
- `musicAsset`: project-relative path or `null`
- LED media reference: project-relative path in `stageConfig.ledContent.value`
- prop textures: `assetPath` references

Binary assets must not be embedded in IPC payloads or portable JSON as base64 after migration. The renderer receives `choreo-asset://` URLs for playback/rendering.

Desktop exposes one import button and one export button. Each opens a choice between a complete project package and choreography-only JSON. Loose legacy project JSON import is not supported.

Import always creates a new managed project ID and automatically opens that project. It never overwrites the active project.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Missing or invalid `project.json` | Reject import and remove staging output |
| Missing performers or frames arrays | Reject import |
| Invalid project ID, absolute path, or `..` archive entry | Reject before filesystem access |
| More than 500 archive entries | Reject before extracting further files |
| Extracted archive content exceeds 512 MiB | Abort extraction and remove staging output |
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
- Build an archive with 501 entries; assert rejection before installation.
- Fail import before manifest validation; assert no partial project remains.
- Assert the renderer, preload, and main process do not expose a legacy project JSON import method.

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
saveTextFile(defaultName: string, content: string, filters?: Electron.FileFilter[]): Promise<string | null>;
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
- Desktop regression asserts JSON backup uses `saveTextFile(..., json, json filter)`.
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

## Scenario: Choreography-Only JSON Exchange

### 1. Scope / Trigger

Use this contract when users exchange formation/choreography data without a complete managed project or binary assets.

### 2. Signatures

```typescript
interface ChoreographyDocument {
  format: 'cosstage-choreography';
  schemaVersion: 1;
  name: string;
  performers: Performer[];
  performerGroups: PerformerGroup[];
  frames: Frame[];
  transitions: TransitionSegment[];
  audioMarkers: AudioMarker[];
  stageConfig: StageConfig;
  performerNotes: PerformerNote[];
}

project.exportChoreography(projectId: string): Promise<string | null>;
project.importChoreography(): Promise<ProjectImportResult | null>;
```

### 3. Contracts

- The main process validates and normalizes the JSON before installing a project.
- Import always creates and opens a new managed project ID. It never merges into or replaces the active project.
- The renderer must save a dirty active project before opening an import dialog or applying an import result.
- Export omits `musicAsset`, stage/background media, performer texture paths, texture data URLs, and face texture maps.
- Non-media stage geometry, groups, frames, transitions, audio markers, and notes remain portable.
- The merged import/export menus must label the two choices explicitly as `项目压缩包` and `编排 JSON`.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| `format` is not `cosstage-choreography` | Reject without creating a project |
| `schemaVersion` is not `1` | Reject without creating a project |
| Missing performers or frames array | Reject without creating a project |
| Asset references appear in input | Strip them during normalization |
| Dirty active project cannot save | Cancel import and keep the active project |
| Native dialog is canceled | Return `null`; do not change editor state |
| Creation/save fails after validation | Remove the incomplete managed directory |

### 5. Good / Base / Bad Cases

- Good: exported choreography round-trips into a new ID with equivalent formations and no binary references.
- Base: a document without optional transitions, markers, or notes normalizes those collections to empty arrays.
- Bad: a legacy loose project JSON is passed to the choreography importer and is rejected instead of guessed.

### 6. Tests Required

- Export a project containing audio and performer textures; assert the JSON contains the explicit format/version and no asset fields.
- Import the exported JSON; assert a distinct project ID and `musicAsset === null`.
- Import invalid/missing-frame JSON; assert the managed project list remains unchanged.
- Desktop regression asserts the transfer hook saves before import and routes through the choreography IPC methods.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Mutates the active project with ambiguous merge semantics.
setFrames([...frames, ...raw.frames]);
```

#### Correct

```typescript
const imported = await window.electronAPI.project.importChoreography();
if (imported) await applyLoadedProject(imported.projectId, imported);
```

## Scenario: Trusted Remote Project Templates

### 1. Scope / Trigger

Use this contract whenever the new-project flow offers a project package hosted on COS/CDN as an initialization template.

### 2. Signatures

```typescript
interface ProjectTemplateSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  estimatedBytes: number;
}

project.listTemplates(): Promise<ProjectTemplateSummary[]>;
project.createFromTemplate(templateId: string, projectName: string): Promise<ProjectImportResult>;

createProjectFromTemplate(
  storagePath: string,
  cacheRoot: string,
  templateId: string,
  projectName: string,
  fetcher: TemplateFetcher,
): Promise<ProjectImportResult>;
```

### 3. Contracts

- The main process owns a trusted template registry containing the immutable URL, versioned file name, expected byte estimate, and SHA-256 digest.
- The renderer sends only a template ID and project name. It must never supply a URL, cache path, or reusable filesystem capability.
- Template archives live under `public/templates/`, are copied into `dist/templates/`, and are uploaded by the existing Web COS sync.
- Download occurs only when the versioned cache file is missing or its SHA-256 does not match. Write to a temporary file and rename only after size and digest validation.
- Installation must reuse `importProjectPackage(..., { name })`, including its traversal, entry-count, extracted-size, staging, normalization, and unique-ID rules.
- A template contains only source assets that actually exist. Missing references already present in the source project remain structured load warnings; do not invent or silently remove user data.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Unknown template ID | Reject before network or filesystem mutation |
| HTTP response is not successful | Reject and do not create a project |
| Declared or actual download exceeds 64 MiB | Reject and remove the temporary download |
| Empty body or SHA-256 mismatch | Reject and remove the temporary download |
| Cached digest mismatches | Delete the corrupt cache and download the trusted version again |
| Package parsing/import fails | Preserve the active project and remove normal import staging output |
| Valid cached package | Create a new project without another network request |

### 5. Good / Base / Bad Cases

- Good: first selection downloads a verified package, creates a user-named project, and hydrates bundled textures.
- Base: the verified cache already exists, so another independently named project is created without fetching.
- Bad: the renderer passes an arbitrary URL or the service imports a download before checking its digest.

### 6. Tests Required

- Assert `listTemplates()` exposes only summary fields and never exposes the URL or digest.
- Create from a real template archive; assert the user name overrides the manifest name and bundled texture URLs hydrate.
- Create twice; assert only one fetch and unique project IDs.
- Corrupt the cache; assert the next create fetches again and succeeds.
- Desktop regression asserts a fixed versioned COS URL, digest validation, trusted-ID IPC, and absence of URL arguments in preload.
- Web workflow test asserts `dist/templates/<versioned-name>.zip` exists and the deployed CDN object is reachable.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Renderer can make the main process download and import an arbitrary URL.
project.createFromTemplate(userProvidedUrl, name);
```

#### Correct

```typescript
// Main process resolves the trusted ID to a versioned URL and digest.
const result = await window.electronAPI.project.createFromTemplate('chinajoy', name);
await applyLoadedProject(result.projectId, result);
```

## Scenario: Managed Project Lifecycle and Recovery

### 1. Scope / Trigger

Use this contract for project creation, rename, duplication, deletion, save history, and restoring a known-good local version.

### 2. Signatures

```typescript
createPersistedDesktopProject(
  name: string,
  document: ProjectDocument,
): Promise<{ id: string; path: string }>;

listManagedProjects(storagePath: string): Promise<ProjectMeta[]>;
renameManagedProject(storagePath: string, projectId: string, newName: string): Promise<void>;
duplicateManagedProject(storagePath: string, projectId: string): Promise<{ id: string; path: string }>;
deleteManagedProject(storagePath: string, projectId: string): Promise<void>;
project.listRecoverySnapshots(projectId?: string): Promise<ProjectRecoverySnapshot[]>;
project.restoreRecoverySnapshot(snapshotId: string): Promise<ProjectImportResult>;
```

`ProjectRecoverySnapshot.createdAt` is a Unix-millisecond number.

### 3. Contracts

- New-project UI state becomes active only after its default `ProjectDocument` is durably saved.
- A failed create/save transaction removes the incomplete managed directory.
- Before replacing a non-blank valid `project.json`, save that previous document as a recovery snapshot.
- Blank initialization documents do not create recovery noise. Keep the newest five snapshots per source project.
- Restore validates the snapshot, copies available source assets, creates a new project ID, and never overwrites the source project.
- Rename uses the normal atomic save path. Duplicate copies through a staging directory and supports Chinese project names.
- Delete removes both the managed project and its recovery directory after custom UI confirmation.
- Renderer lifecycle/transfer services own save guards and orchestration; IPC handlers remain thin filesystem adapters.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Invalid project ID or snapshot ID | Reject before resolving a filesystem path |
| Initial project save fails | Delete the new directory and keep the previous editor active |
| Current project save fails before create/load/import/restore/export | Cancel the requested operation |
| Corrupt recovery file | Omit it from the recovery list; keep other valid snapshots |
| Source assets are missing during restore | Restore choreography and report structured missing-asset warnings on load |
| Duplicate copy/write fails | Remove staging output; do not expose a partial duplicate |
| Project deletion succeeds | Remove its snapshots and clear active editor identity when applicable |

### 5. Good / Base / Bad Cases

- Good: six meaningful saves leave five snapshots, newest first; restore opens a distinct project with copied assets.
- Base: the first save after `project.create()` persists the default frame and creates no blank snapshot.
- Bad: renderer marks a new project saved before `project.save()` succeeds, so reopening shows an empty frame list.

### 6. Tests Required

- Assert blank initialization produces zero snapshots and the next replacement produces one.
- Save seven versions; assert only five snapshots remain and restoring one returns a new ID.
- Rename and duplicate a Chinese-named project; assert valid IDs, names, and atomic service paths.
- Delete a project; assert its managed directory and recovery list entry disappear.
- Desktop regression asserts create-and-persist precedes `setCurrentProjectId` and browser dialogs are absent.

### 7. Wrong vs Correct

#### Wrong

```typescript
const created = await project.create(name);
setCurrentProjectId(created.id);
setProjectHasChanges(false); // The default editor document is not on disk yet.
```

#### Correct

```typescript
const created = await createPersistedDesktopProject(name, initialDocument);
setCurrentProjectId(created.id);
setProjectHasChanges(false);
```

