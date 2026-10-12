# Mobile Editor and Portable Project Contract

## 1. Scope / Trigger

Applies to `mobile/`, `components/mobile/`, opt-in touch changes in `components/Stage.tsx`, the shared parser, and Capacitor Android packaging. Mobile edits must remain readable by the existing desktop project service.

The reference APK exposes module names and assets, not verified runnable screens or original source. Interaction design is original; never ship extracted third-party artwork/code.

## 2. Signatures

```ts
parseProjectDocument(value: unknown, fallbackName: string): ProjectDocument // electron/project-document.ts; pure
parseMobileDocument(value: unknown, name?: string): ProjectDocument
readProjectPackage(file: Blob, name?: string): Promise<PortableProject>
writeProjectPackage(document: ProjectDocument, assets: Record<string, Blob>): Promise<Blob>
saveMobileProject(id: string, document: ProjectDocument, assets?: Record<string, Blob>): Promise<void>
loadMobileProject(id: string): Promise<PortableProject>
pinchViewport(start: StageViewport, startPoints: [Point, Point], points: [Point, Point]): StageViewport
```

IndexedDB `cosstage-mobile`, version 1: `projects` keyPath `id` stores `{ id, name, updatedAt, actors, formations, document }`; `assets` uses out-of-line project ID keys and maps relative paths to Blobs. Future schema changes require an upgrade migration.

Commands: `npm run dev:mobile`, `test:mobile`, `test:mobile:ui`, `android:sync`, `android:build`, `android:open`. Native build needs Node 22+, JDK 21, SDK 36, `JAVA_HOME` and `ANDROID_HOME`. UI tests accept optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## 3. Contracts

- `mobile/entry.tsx` chooses a shell once per launch: Electron always uses DesktopApp; Capacitor native, `?mobile=1`, or a coarse-pointer viewport with minimum dimension <= 900 uses MobileApp. Rotation cannot remount the shell.
- Shared schema version remains 4.0. Extracted parser contains no Node/Electron runtime imports. It must also appear in `electron-builder.config.cjs`'s explicit file allowlist.
- ZIP root `project.json`; relative assets retain original bytes, including assets with no mobile editing UI. `meta.json` is desktop-local metadata. Strip `runtimeUrl`; Blob URLs exist only in render copies.
- Import generates a new local ID. File interchange is not cloud sync or automatic conflict resolution.
- Document + new assets save in one IndexedDB transaction. Catch synchronous `put` exceptions, abort the transaction, and consume its rejection before propagating the original error. Otherwise the document may commit without its assets.
- Serialize saves. Only the latest save request updates UI status. Remember an asset map as persisted only after a successful write, so ordinary later edits retry missing assets. Failed flush blocks navigation.
- Stage `touchMode` is opt-in. Single drag uses temporary preview and one history commit at pointer-up; a second pointer cancels that preview. Suppress edit events until all pointers lift. Pinch affects viewport only, anchored at the two-finger midpoint, scale 0.5–4.
- Respect shared actor/group locks. Position updates preserve Z. Duplicate formation shifts later frames and preserves outgoing motion on the cloned formation; duration changes retain transition gaps.
- Android bundles web assets locally, shares cache files through FileProvider, and keeps shared files after the share sheet closes so recipients can read them. Browser preview needs a server for page loads; native cold start is bundled.

## 4. Validation & Error Matrix

| Input / failure | Behavior |
| --- | --- |
| >64 MiB input/output, >128 MiB extracted, >500 entries | Reject before import storage mutation |
| Absolute/traversal/backslash/control/prototype paths | Reject |
| Encrypted/multipart/unsupported ZIP, bad CRC/size/header | Reject with visible error |
| Future schema, malformed actors/frames/groups, non-finite coordinates | Reject; leave library unchanged |
| Missing referenced asset | Import document with visible missing-asset warning |
| Storage/quota error | Keep in-memory document/assets, show retry, prevent exit until flush succeeds |
| Second touch during drag / pointercancel | Discard preview, no actor-coordinate/history mutation |
| Unsupported music codec | Show error and pause playback |

## 5. Good / Base / Bad Cases

- Good: desktop export -> mobile drag -> mobile export -> desktop import preserves transitions, rotations, elevations, model snapshots, notes and all asset bytes; imported ID differs.
- Base: new offline project with no music saves/reopens, plays silent choreography, exports a valid project package.
- Bad: a failed asset write must not persist a document referencing that asset; an invalid import must not replace an existing project.

## 6. Tests Required

`tests/mobile-core.test.ts`: real desktop-service round trip, CRC/path/size rejection, transactional save failure, IndexedDB asset retention/isolation, locked actor/elevation preservation, history/timing, pinch anchoring.

`tests/mobile-ui/editor.spec.ts`: touch drag and pinch cancellation, multi-drag, lock, undo/redo, portrait/landscape, offline editing/reload, music clock, quota failure followed by ordinary document edit, ZIP download/import. Native file picker/share/back and cold-start remain device checks; do not describe browser tests as Android device tests.

Run existing `test:project`, `test:desktop`, typecheck, release checks and build when changing the shared parser/Stage. Full `npm test` includes mobile core tests. Android preview CI produces a debug APK; never claim it ran merely because its YAML exists.

## 7. Wrong vs Correct

```ts
// Wrong: a synchronous assets.put error can still commit the earlier document put.
projects.put(document);
assets.put(blobs, id);

// Correct: keep both stores atomic on synchronous and asynchronous failures.
try {
  projects.put(document);
  assets.put(blobs, id);
} catch (error) {
  transaction.abort();
  await completion.catch(() => undefined);
  throw error;
}
await completion;
```

Do not set `previousAssets = assets` before persistence succeeds. Do not implement a second independent schema migrator in the mobile shell.
