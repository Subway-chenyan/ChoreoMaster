# Mobile Editor Adaptation

## Goal

Make the existing CosStage choreography editor usable on phone-sized and tablet-sized touch screens without degrading the established desktop workflow, then produce and smoke-test an Android debug package. Prepare a separate macOS desktop artifact on a real macOS build host.

## What I Already Know

- The user asked to install and run the project, then modify the code to add mobile adaptation.
- The renderer is React 19 + Vite + Tailwind CSS v4 and is also hosted by Electron.
- The editor already has a compact breakpoint at 1100 px, safe-area padding, coarse-pointer target sizing, compact toolbar behavior, touch gestures, and reduced timeline defaults.
- The central editor still renders the sidebar, stage, and timeline in one desktop-derived composition on compact screens, so narrow phones remain space-constrained.
- `App.tsx` owns the top-level layout and compact-state orchestration; `Sidebar.tsx`, `Timeline.tsx`, `Stage.tsx`, and `index.css` contain the main responsive surfaces.
- The local Windows host has Node 22.22.0 and JDK 17. Android SDK command-line tools, ADB, API 36 build tools, and an API 36 Google Play x86_64 image are installed under the user-local SDK directory but are not on PATH; no AVD is configured yet.
- The project has no existing Capacitor or native Android wrapper.
- The default renderer backend URL is `http://127.0.0.1:8000`; inside an Android WebView, that address refers to the Android device rather than the development PC.
- The requested `aliyun` host is Ubuntu 24.04 on x86_64. It can coordinate builds but is not a valid host for macOS signing or notarization.
- The Mac forwarded through `aliyun` port 2222 is reachable directly from Windows with ProxyJump. Its malformed `authorized_keys` directory was preserved as a backup and replaced with a correct authorization file; key-only login now succeeds.

## Assumptions (Temporary)

- Desktop behavior at widths above 1100 px should remain unchanged.
- No backend, Electron IPC, project-data, or persistence contract changes are needed.
- Mobile adaptation should prioritize touch operation and usable editing space rather than reproduce every desktop control simultaneously.

## Open Questions

- None for the current test-artifact scope. A later distribution release would require a separate decision and credentials for Android signing/AAB plus Apple signing/notarization.

## Requirements (Evolving)

- Preserve existing desktop behavior.
- Support the complete editing workflow on phone-sized devices.
- Follow Android interaction conventions for compact navigation, back behavior, touch targets, and system insets.
- Include portrait/landscape adaptation, system-safe insets, soft-keyboard avoidance, and Android-style back behavior in the first release.
- Keep the stage as the dominant phone workspace instead of using a persistent bottom destination bar.
- Place a visually small tools icon at the top-left of the stage; its touch target opens the complete tools drawer.
- Keep a reduced-height timeline visible at the bottom of the phone layout, with a way to expand it for detailed editing.
- Expand the compact timeline through an explicit button rather than a drag gesture, avoiding conflicts with Android system navigation gestures.
- When expanded, the timeline temporarily receives additional height for detailed editing and can return to the persistent compact state.
- Use a phone layout below 600 CSS px width, plus coarse-pointer windows below 480 CSS px height for phone landscape; keep the existing compact/tablet layout outside those conditions.
- Android-style back behavior closes the topmost editor surface first: modal, tools drawer, expanded timeline, then normal browser/app navigation.
- Use the visual viewport to keep focused form controls visible when the Android soft keyboard reduces available height.
- Support touch-friendly controls and safe-area insets.
- Prevent horizontal page overflow and unusably compressed editor regions on small screens.
- Reuse the existing editor state and components rather than create a separate mobile application.
- Add a thin Capacitor Android shell around the existing Vite renderer instead of duplicating editor code.
- Produce a signed-by-debug-key APK suitable for direct installation and smoke testing.
- Make the packaged Android backend endpoint configurable and never silently assume that device-local `127.0.0.1:8000` reaches the desktop backend.
- Build the Electron macOS artifact on the actual macOS host forwarded to `aliyun:127.0.0.1:2222`. The Ubuntu host relays source and retains the result but must not perform the final macOS build/signing step itself.

## Acceptance Criteria (Evolving)

- [ ] The editor remains usable without page-level horizontal scrolling at the agreed phone viewport.
- [ ] Primary choreography tasks remain reachable through touch controls.
- [ ] The stage retains most of the phone viewport while the compact timeline stays visible at the bottom.
- [ ] The complete tools panel is reachable from the top-left icon without permanently narrowing the stage.
- [ ] The compact timeline can be explicitly expanded and collapsed without losing the current frame or playhead state.
- [ ] Phone portrait and landscape layouts follow the agreed stage-first composition.
- [ ] System bars, cutouts, and gesture areas do not obscure tappable controls.
- [ ] Opening the Android soft keyboard does not hide the focused editor control behind the compact timeline.
- [ ] Back navigation closes the topmost mobile-only surface before leaving the editor.
- [ ] Sidebar, stage, and timeline can each receive useful screen space on compact viewports.
- [ ] Visual checks pass at 360x800, 412x915, 915x412, 800x1280, and 1440x900 CSS pixel viewports.
- [ ] No tested viewport has page-level horizontal overflow.
- [ ] Existing desktop layout and tests remain green.
- [ ] Type-check and production build pass.
- [ ] A debug APK builds from the same Vite assets and installs on an Android emulator or connected device.
- [ ] Android smoke testing covers launch, portrait/landscape layout, tools drawer, compact/expanded timeline, back behavior, keyboard avoidance, and project save/reload where supported.
- [ ] The packaged Android app reports a clear configuration/connectivity state when its AI backend is unavailable.
- [ ] A macOS build executed on a real Mac produces the agreed Electron artifact and its unsigned/test-only or signed distribution status is documented.

## Definition of Done

- Tests are added or updated where responsive behavior can be verified deterministically.
- Type-check, relevant tests, and production build pass.
- Mobile layout is visually checked at representative phone and tablet viewports.
- The Android debug package is installed and smoke-tested on an emulator or physical device.
- The macOS build host, architecture, signing status, and output artifact are recorded.
- Behavior changes and exclusions are documented in this PRD and the design spec.

## Technical Approach

- Introduce a shared adaptive-layout hook/state at the application shell. Phone mode applies below 600 CSS px width or on coarse-pointer windows below 480 CSS px height; existing compact/tablet and desktop paths remain intact.
- In phone mode, replace the persistent sidebar pane with an overlay drawer that renders the existing `Sidebar` component and closes through its icon, backdrop, or back navigation.
- Hide the desktop-oriented top bar in phone mode and expose essential controls as stage overlays: tools at top-left and playback/view/overflow actions at top-right.
- Extend `Timeline` with explicit phone compact and phone expanded densities while preserving its existing frame, selection, playback, and editing contracts.
- Coordinate the tools drawer, timeline expansion, visual viewport, and back behavior in the shell rather than distributing competing overlay state across child components.
- Keep the phone default state stage-first: tools closed and timeline compact.
- Make tools and expanded timeline mutually exclusive so only one secondary surface can reduce or cover the stage at a time.
- Close surfaces in Android back order: modal, tools drawer, expanded timeline, then normal navigation.
- Preserve choreography selection/playback state across rotation and layout-mode changes.
- When the soft keyboard opens, retain compact timeline density and scroll the focused drawer/form control into the visual viewport.
- Keep icons visually compact while providing at least 48 px touch targets and Chinese accessible names.
- Unit-test the pure layout-mode and mobile-surface-priority logic, add source-level UI regression coverage consistent with the existing test suite, and run viewport-based visual checks before completion.
- Add Capacitor as a minimal native shell, keep generated Android files in source control, and make Vite build output the single renderer source for both Electron and Android.
- Use a debug APK for the first Android installation test; defer release keystore and Play Store AAB work until explicitly requested.
- Run the macOS Electron build on the forwarded Mac using a dedicated relay-only Ed25519 identity; keep Apple signing and notarization as an explicit credential-dependent release step.

## Out of Scope (Explicit)

- Replacing the web/Electron renderer with a native Android application.
- Play Store publication, production Android keystore management, Apple App Store submission, or Apple signing/notarization unless separately authorized and credentialed.
- Backend or data-model changes.
- Unrelated visual redesign of the desktop editor.

## Decision (ADR-lite)

**Context**: The existing compact layout reduces control density but still compresses a desktop three-pane editor on phone screens. Android navigation conventions favor a focused compact surface, but choreography editing benefits from keeping both the stage and a minimal timeline visible.

**Decision**: Use a stage-first phone composition. A small top-left tools icon opens the complete tools drawer, and a reduced-height timeline remains visible at the bottom with an explicit expand/collapse action. Do not use a permanent bottom destination bar or swipe pager.

**Consequences**: The stage retains useful space and gesture conflicts are minimized. The implementation needs explicit overlay/back-stack coordination and two timeline densities, but existing editor state and components remain shared with desktop.

## Technical Notes

- Likely entry points: `App.tsx`, `index.css`, `components/Sidebar.tsx`, `components/Timeline.tsx`, and responsive layout tests.
- Existing compact threshold: `window.matchMedia('(max-width: 1100px)')`.
- Existing CSS includes `.compact-only`, `.desktop-only`, `.app-sidebar`, safe-area helpers, and coarse-pointer sizing.
- The Trellis `uv` command could not read the global uv cache in this environment; equivalent project scripts are being run with `python`.
