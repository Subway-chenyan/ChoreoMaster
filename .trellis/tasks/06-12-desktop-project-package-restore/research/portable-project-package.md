# Portable Project Package Research

## Current Repository Findings

- Desktop projects already use a managed directory:
  - `project.json`
  - `audio/`
  - `media/`
- The renderer currently imports audio and LED media as runtime blob URLs. Those files are not copied into the managed project.
- Prop textures are stored as `data:` URLs inside performer records, so they travel with JSON but inflate and couple the manifest to binary assets.
- Legacy export/import writes and reads a standalone JSON file. It cannot carry audio or LED image/video files.
- Project duplication already copies the complete managed project directory, which is a useful basis for package export/import.

## Comparable Patterns

### Managed working directory

Keep the editable project as a normal directory with a small manifest and asset subdirectories. This supports autosave, direct media access, duplication, and inspection without rewriting a large archive on every change.

### Portable archive

Export or import the managed directory as a ZIP-compatible archive with an application-specific extension such as `.choreo`. Electron's native dialogs support extension filters. ZIP libraries can preserve a folder tree containing the manifest and binary resources.

### Legacy manifest import

Treat standalone JSON as a compatibility format. Import it into a newly created managed project, migrate recognized fields, and report resources that could not exist in the old file.

## Library Notes

- Electron provides native open/save dialogs suitable for selecting project packages.
- Node's filesystem APIs provide the primitives needed for staging directories and atomic-ish final moves.
- `archiver` generates ZIP archives through streams and is a better fit for projects containing large audio/video files.
- `adm-zip` offers simple create/extract APIs but commonly reads archives into memory; this is less suitable for potentially large video-backed projects.

## Recommended Approach

Use a hybrid model:

1. Keep the existing managed project directory as the live editing format.
2. Add a versioned manifest with relative asset references.
3. Copy imported audio, LED media, and prop texture files into deterministic asset directories.
4. Export the complete directory as a streaming ZIP archive with a `.choreo` extension.
5. Import into a temporary staging directory, validate paths and manifest, then move/copy into managed storage as a new project.
6. Continue accepting legacy `.json` files through a migration path.

This avoids repeatedly compressing media during normal saves, keeps projects portable, and leaves room for future schema migrations.

## Suggested Package Layout

```text
project-name.choreo
  manifest.json
  assets/
    audio/
    backgrounds/
    props/
  preview/
    thumbnail.png
```

The live managed directory may use the same layout so export is a direct archive operation.

## Security and Integrity Requirements

- Reject archive entries with absolute paths or `..` traversal.
- Validate the manifest before installing the project.
- Extract into a temporary directory first.
- Never partially overwrite an existing project.
- Generate a new local project ID on import.
- Preserve original asset file names only as display metadata; use collision-safe stored names.
- Report missing, unreadable, unsupported, or duplicate assets.

## Sources

- Electron dialog API: https://electronjs.org/docs/latest/api/dialog
- Node.js filesystem API: https://nodejs.org/api/fs.html
- Archiver repository: https://github.com/archiverjs/node-archiver
- ADM-ZIP repository: https://github.com/cthackers/adm-zip

