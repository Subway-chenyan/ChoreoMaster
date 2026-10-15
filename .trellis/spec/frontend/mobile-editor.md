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

## Landscape workspace and precision editing (2026-10-13)

### Scope and signatures

`MobileSequence`, `MobileTools` and `MobileSelectionBar` own the reusable controls. CSS imports in `mobile.css` are ordered base -> editor -> landscape, so base modal styles cannot override landscape drawers.

```ts
nudgeActors(document: ProjectDocument, frameId: string, ids: string[], dxMeters: number, dyMeters: number): ProjectDocument
```

### Contracts

- Landscape workspace uses `(orientation: landscape) and (min-width: 600px) and (max-height: 600px)`. Width guard prevents a portrait phone's keyboard from causing the landscape layout. No React editor remount or schema change.
- Layout: compact header, left tool rail, central stage, right formation rail. Collapsing the formation rail retains previous/play/next controls and only changes UI state. Portrait always exposes the filmstrip regardless of this preference.
- Formation list scrolls its own `scrollTop`/`scrollLeft` to reveal the active card; a ResizeObserver handles rotation and expansion. Do not use global `scrollIntoView`, which can move the entire editor. Playback/scrubbing highlights the displayed formation; “编辑当前队形” selects its start position before editing.
- Landscape sheets remain modal with focus trap/restore, now presented as right drawers. Content scrolls independently of their close header. They do not allow editing the stage behind the modal.
- Selection/status footers have equal 48px minimum height to avoid moving the stage under the pointer on selection. Snap remains available in the stage header even with actors selected.
- In touch-enabled Stage only, displacement below 6 CSS pixels is a tap: no position preview, no snapping and no history commit. Once a drag crosses the threshold it remains a drag even if it returns to the origin. Pointer cancellation/pinch still discards the preview. Desktop pointer behavior remains unchanged.
- Precision steps are 0.1 / 0.5 / 1 meter, independent of snap preference. Convert X by main-stage width and Y by depth, retain Z, skip effectively locked actors (including group locks), and constrain the common delta against stage/wing bounds so movable members preserve their spacing. No-op returns the original document and creates no history entry.
- Android back closes a panel, then clears active selection, then flushes and leaves the editor. Hardware behavior remains a pending device check.

### Validation and cases

| Case | Required result |
| --- | --- |
| Tap or 3px jitter while snapping is on | Actor coordinates/history unchanged |
| Move 0.14m on a 14m-wide stage | X increases by 1 percentage point |
| Group member reaches stage/wing boundary | All movable members stop with the same delta |
| Only locked/missing actors, zero delta, non-finite meter input | Same document reference |
| Collapse and portrait/landscape rotation | Project, history and selection retained; playback reachable |
| More formations than the rail can display | Active formation fully visible inside its own scroll container |

### Verification

`tests/mobile-core.test.ts` asserts meter conversion, Z/lock retention, group boundary behavior and no-op references. `tests/mobile-ui/landscape.spec.ts` covers 640x360, 812x375, 915x412, portrait return, collapsed playback/history, long lists, preview-to-edit, side-drawer focus, precision undo and tap/jitter without snapping. Keep the existing mobile gesture and desktop regressions.

Wrong: snap every `pointerup` after a performer `pointerdown`. Correct: distinguish a selection tap from an actual drag before invoking `onPositionChange` / `onDragEnd`.

## Read-only member rehearsal (2026-10-13)

### Scope and signatures

Applies to `MobileRehearsal`, `useRehearsalPlayback`, package import and local project routing.

```ts
readRehearsalPackage(file: Blob, name?: string): Promise<PortableProject>
rehearsalWarnings(document: ProjectDocument, assets: Record<string, Blob>): string[]
saveMobileProject(id: string, document: ProjectDocument, assets?: Record<string, Blob>, mode?: 'rehearsal'): Promise<void>
```

### Contracts

- `PortableProject` and IndexedDB project records have optional `mode: 'rehearsal'`; absent mode preserves existing editing behavior. This additive record field requires no object-store/version migration. Mode is local metadata, never part of the portable choreography schema.
- Rehearsal import inspects the ZIP directory using existing size/path/header limits, then uses `fflate` filtering to extract and CRC-check `project.json` and the referenced `musicAsset` only. Skipped files are neither decompressed nor stored. Whole-archive limits (64 MiB compressed / 128 MiB declared extracted / 500 entries) still apply; this is not a large-archive bypass.
- Stored JSON remains intact; the read-only render copy clears stage background and LED media, and does not resolve model assets. Missing visual assets are expected and do not generate rehearsal warnings.
- Route rehearsal records to a separate viewer with no edit reducer, autosave hook, export action or actor mutations. Playback, pan/zoom, collapsing the rail and navigation do not write project data.
- Current formation/notes follow the last formation whose start time is <= playback time, with the first formation as fallback. Clicking or stepping to a formation pauses and seeks audio and stage to its start. Notes preserve line breaks and reset scroll on formation changes.
- Music is the playback clock while running; monotonic time continues after audio ends. Playback restarts from zero at the end, pauses on hidden/exit, and invalidates pending play promises on seek/exit. Codec/play failure pauses with a message and permits subsequent silent playback.

### Validation and error matrix

| Case | Result |
| --- | --- |
| Missing referenced music | Warning, silent rehearsal remains usable |
| Corrupt JSON or selected music CRC | Reject before local storage mutation |
| Corrupt skipped model bytes | No extraction; full editor import still rejects CRC failure |
| Old record without mode | Original mobile editor |
| Reopen rehearsal record | Viewer, retained music only, no missing-model warnings |
| Empty formations | Empty-stage message and disabled playback/navigation |

### Good / base / bad cases

Good: ZIP with JSON/music/models -> only music bytes stored -> reopen offline -> read-only animated rehearsal. Base: JSON-only choreography plays silently. Bad: implementing rehearsal by importing all assets and hiding editor buttons leaves unnecessary decompression and mutation paths.

### Tests required

Core: filtering, preserved frames, music byte identity, mode round-trip, missing music and retained-byte CRC errors. Browser: notes/formation navigation, music clock, automatic active formation, collapsing/rotation, attempted actor movement leaves storage unchanged, editor controls absent, offline reopen, missing-music fallback. Device audio interruptions and native back remain manual checks.

### Wrong vs correct

Wrong: `readProjectPackage` followed by dropping image/model Blobs. Correct: filter ZIP extraction before decompression, and select the dedicated viewer from persisted local metadata.

## Android CI, release and download contract (2026-10-14)

### Scope / signatures

Applies to Android Gradle packaging, `.github/workflows/android*.yml`, Desktop Release, `scripts/android/`, and the desktop/web Android download entry.

```ts
androidVersionCode(version: string): number
artifactContract(channel: 'stable' | 'preview', version: string, commit: string, runId?: string): object
parseAndroidDownload(value: unknown): { version: string; url: string } | null
isAndroidDownloadUrl(value: string): boolean
window.electronAPI.getAndroidRelease(): Promise<{ version: string; url: string } | null>
```

### Contracts

- PR mobile changes build debug artifacts without secrets or COS writes. Main mobile changes upload previews to commit/run/attempt-specific paths. Stable APK builds are called directly by Desktop Release and gate its publish job alongside Windows; do not rely on GITHUB_TOKEN tag events to start another workflow.
- Formal application ID is `com.cosstage.mobile`; debug ID adds `.preview`. Version follows package.json; code is major*1,000,000 + minor*1,000 + patch (minor/patch <=999, code 1..2,100,000,000). Stable signing uses PKCS12 secrets and the public fingerprint in `data/android-signing.json`.
- APKs must pass apksigner and aapt identity/version/debuggable checks before artifact upload. Signing material lives only in RUNNER_TEMP and is removed under `always()`.
- Stable objects live under `downloads/android/releases/<version>/`; previews under `downloads/android/preview/<commit>/<run>-<attempt>/`. Manifest keys are schemaVersion, channel, version, versionCode, commit, applicationId, name, path, url, sha256, size.
- `publishAndroid` validates all local bytes and object conflicts before upload, uses forbid-overwrite for immutable keys, re-reads stored bytes, verifies public APK bytes before stable pointer writes, purges CDN and verifies pointers. Reject stable downgrade and same-version different content. Preview must never write stable aliases/manifest.
- Full build retries may reuse COS artifacts only when version/commit/metadata/hash match; still revalidate native APK identity and fixed certificate. A partial upload without manifest requires the original build artifact (rerun failed jobs), never overwrite immutable bytes.
- Stable metadata is `downloads/android/latest.json`; fixed APK alias is `downloads/CosStage-Android.apk`. Renderer uses validated versioned APK URL, never an arbitrary URL from remote JSON. Electron fetches fixed metadata using main-process net.fetch with timeout and no redirects, avoiding file:// CORS. The external-window handler allows only exact official APK URLs.
- Legacy release tags without the Android signing contract retain Windows-only repair behavior. Windows rollback does not downgrade Android.

### Validation / error matrix

| Case | Required outcome |
| --- | --- |
| Missing fixed signing secrets / wrong certificate | Build fails, no stable publish |
| APK hash/sidecar mismatch / remote immutable conflict | Fail before pointers |
| Lost upload response with identical remote bytes | Recover and continue |
| COS read denied / outage | Fail, never interpret as missing object |
| APK CDN verification fails | Keep existing stable pointers |
| No Android release (HTTP 404) | Disabled pending-release UI |
| Invalid manifest / unavailable network | Disabled download UI, no untrusted link |
| Older release lacks Android artifacts | Existing Windows repair/skip still works |

### Good / base / bad cases

Good: version PR -> parallel builds -> verified signed APK on COS -> existing Windows/GitHub/web publication -> both clients show the released version. Base: PR preview artifact without privileges. Bad: publish debug APK at stable alias, overwrite same version, or expose generic fetch/openExternal IPC.

### Tests required

`tests/android-release.test.mjs` covers version limits, workflow isolation, upload order, retries, collisions, integrity and downgrade protection. `tests/android-download.test.ts` checks URL/manifest allowlists. `tests/mobile-ui/android-download.spec.ts` verifies published and unpublished entries. Keep existing release/desktop tests, actionlint, typecheck and production build. Local mocks are not a real signed APK/COS/GitHub deployment.

### Wrong / correct

Wrong: attach a random runner debug key to `com.cosstage.mobile`, or publish based solely on HTTP 200. Correct: fixed fingerprint-pinned release signing, isolated preview package, byte checks before publication and after CDN.

## Rehearsal visual sizing and highlighted paths (2026-10-15)

- `Stage.performerDisplayScale` scales the inner performer visual after the minimum touch target is applied; it must not scale stored dimensions or shrink the 44px touch target. Default 1 preserves editor rendering. Props retain their sizes.
- `Stage.performerLabelScale` applies after `getStageLabelFontSize` normalizes the project baseline. Rehearsal permits 20–200% display scale without changing the document font or the shared editor minimum.
- `rehearsalTransitionPaths(time, frames, performers, transitions, highlightId)` returns at most one selected path, only between the previous formation end (inclusive) and next formation start (exclusive). Hold times, absent highlights/endpoints and hidden performers return an empty list. Path endpoints and Bézier control points match playback interpolation; missing control points fall back to endpoints in Stage.
- Read-only paths never expose edit handles, control guides or pointer targets. They remain aligned under actor-view rotation and viewport pan/zoom, and cannot mutate choreography data.
- Regression checks must measure the visible performer node, not only its hit rectangle. Exercise native range drag (including touch), sub-6px rendered labels, persistence, linear/Bézier paths, exact interval boundaries, highlight toggling and unchanged IndexedDB contents.
- Wrong: scaling performer width under `max(width, 44px)` or reducing a font before its 6px clamp. Correct: apply display scales after these baseline constraints.
