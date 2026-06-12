# Portable Project Files

## Scenario: Managed Projects and Portable Packages

### 1. Scope / Trigger

Use this contract whenever project content references binary assets or crosses the renderer, preload, main-process, and filesystem boundaries.

The live editing format is a managed directory. A portable `.choreo` file is a ZIP archive of that directory and is only created for import/export.

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

