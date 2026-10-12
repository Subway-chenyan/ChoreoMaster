# Android mobile choreography editor

## Goal
Build a usable Android choreography editor with a touch-first stage and reliable desktop project interchange, inspired by ArrangeUs interaction patterns. Keep the existing desktop editor and shared project format.

## Confirmed context
React 19/Vite 6, Electron desktop, schema 4.0 ProjectDocument, .zip/.choreo packages with project.json and relative binary assets. Existing Stage and scene interpolation are reusable. The provided ArrangeUs binary reveals module names and assets, not a complete runnable reference app; interaction details are design proposals rather than claims of observed behavior.

## Implementation
- Separate mobile shell, lazy-loaded for native Android or narrow touch browsers; desktop retains existing App. Explicit ?mobile=1 preview.
- Shared Stage with opt-in touch navigation/multi-selection, accessible large controls, formation filmstrip and bottom sheets, undo/redo, actor and formation editing, music playback and stage settings.
- IndexedDB local project library with transactional imports and serialized autosave, visible errors and safe switching.
- Shared pure project parser; preserve frames, transitions, notes, model assets and all imported binary assets. Desktop/mobile ZIP round-trip tests.
- Capacitor 8 Android project, local bundled assets, native share, Android back behavior; no remote website runtime dependency.

## Data interchange decision
Asked user preference asynchronously. Default: offline-first full project packages, including music/assets; cloud sync needs a separate account/server decision and is not implied by compatible files.

## Acceptance
- [x] Create/open/edit/reload local mobile projects; failed saves remain visible and block navigation.
- [x] Single/multi actor drag and two-finger navigation do not conflict; locked actors stay locked.
- [x] Formation switching/duplication/timing, undo/redo, playback, music import.
- [x] Desktop-produced package imports on mobile and mobile export imports with desktop service, assets byte-identical.
- [x] Reject unsafe/oversized archives, preserve active document on bad import.
- [x] Portrait/landscape touch browser validation and desktop regressions.
- [x] Android project sync/build commands and honest build/device validation report.

## Boundaries
No cloud account infrastructure, simultaneous collaborative merge, AI backend on device, or mobile video rendering in this iteration. Desktop-only advanced data remains preserved. No ArrangeUs branding or extracted artwork is shipped.

## Research
See research/architecture.md. Future cloud/nearby transports can reuse portable package/storage boundaries. Imports create new IDs to avoid accidental overwrites.

## Delivery status
Implementation and browser/core/desktop regression validation completed. Android native project synchronizes successfully. APK build and physical-device acceptance remain unverified because this ARM64 host has no JDK/SDK and no attached device. See docs/mobile/VALIDATION.md; no cloud sync or APK completion is claimed.
