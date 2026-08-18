# CosStage Mobile Android Adaptation Design

## Summary

CosStage will gain a stage-first phone layout that preserves the complete editing workflow without squeezing its desktop sidebar, stage, and timeline into the same narrow row. On phones, the stage occupies most of the viewport, a visually small tools button opens the existing sidebar as a drawer, and a reduced-height timeline remains visible at the bottom with an explicit detailed-editing expansion.

The implementation will reuse the current renderer, state, and editor components. After the responsive renderer is verified, a thin Capacitor 8 Android shell will package the same Vite output for debug installation. It will not replace the editor with a separate native UI or change project data, backend APIs, or Electron IPC.

## Goals

- Make the complete choreography workflow usable on phone-sized Android touch screens.
- Keep the stage as the dominant phone surface.
- Keep a compact timeline visible at the bottom and allow explicit expansion for detailed editing.
- Open all existing tools from a small top-left icon without permanently narrowing the stage.
- Follow Android expectations for window adaptation, system insets, touch targets, soft keyboard behavior, and back navigation.
- Preserve existing tablet, desktop web, and Electron behavior.

## Non-Goals

- Native iOS packaging or a separate native Android UI implementation.
- Installable PWA work.
- Backend, persistence, project format, or IPC changes.
- An unrelated desktop visual redesign.
- Gesture-driven workspace paging or a draggable bottom sheet.

## Research Basis

Android window size classes define compact width below 600 dp and compact height below 480 dp. Android guidance also recommends keeping one primary compact surface useful, adapting supporting panes to the available window, avoiding interactive targets beneath system gesture areas, and providing at least 48 dp touch targets.

For this web renderer, CSS pixels are used as the practical viewport equivalent:

- Phone portrait: width below 600 CSS px.
- Phone landscape: coarse pointer and height below 480 CSS px.
- Tablet/compact: the existing compact behavior outside the phone conditions, up to the established 1100 px breakpoint.
- Desktop: existing behavior above 1100 px.

The detailed source review is recorded in `.trellis/tasks/08-16-mobile-editor-adaptation/research/android-adaptive-editor-patterns.md`.

## Chosen Layout

### Phone Default

The desktop-oriented top bar is removed from the phone composition. The stage fills the available area above the compact timeline.

- Top-left: a small tools icon with a minimum 48 px interactive area.
- Top-right: essential playback, view switch, and overflow actions in compact floating controls.
- Center: the existing 2D or 3D stage.
- Bottom: a persistent compact timeline showing playback, current time, and formation clips.

The tools icon opens the existing `Sidebar` inside an overlay drawer. The drawer has a scrim, uses the visual viewport height, respects top/bottom safe-area insets, and scrolls internally.

### Timeline Densities

The timeline has three presentation paths while retaining the same editing state:

1. Default desktop/tablet presentation: existing controls and sizing.
2. Phone compact presentation: approximately 96–112 px including the toolbar, with only the primary playback/time controls and formation track visible.
3. Phone expanded presentation: temporarily receives enough height for detailed editing controls and larger clips.

Expansion uses an explicit button. The design does not use a vertical drag handle because it would compete with Android navigation gestures and stage editing gestures.

### Landscape and Tablet

Compact-height phone landscape uses the same stage-first structure with a shorter compact timeline. Medium-width tablets retain the current multi-pane compact layout, because they have enough space for a persistent supporting pane.

## Architecture

### Android Packaging Boundary

Capacitor 8 hosts the existing `dist` directory in a native Android WebView. The Android application ID remains `com.choreomaster.app` to match the established desktop identity, while the visible product name remains CosStage. The native project is limited to lifecycle/system-bar integration, Android Back dispatch, debug-only local HTTP access, icons, and the Gradle build wrapper.

The first artifact is a debug APK. Release keystores, Play Store AAB publication, and production signing are separate credentialed release work. The committed production configuration keeps cleartext disabled; a debug manifest overlay may allow `10.0.2.2` for local emulator testing.

Capacitor's App plugin forwards Android Back into the renderer's existing close-priority contract. The System Bars plugin injects Android inset CSS variables; the renderer resolves safe padding from both standard `env(safe-area-inset-*)` values and the injected `--safe-area-inset-*` variables.

The AI backend remains remote by contract. The settings UI exposes the backend URL and member token because `127.0.0.1` inside Android is the device itself. Emulator-only local testing may use `http://10.0.2.2:8000`; a physical device uses a reachable LAN or HTTPS service URL.

### Adaptive Layout State

A small adaptive-layout utility and hook will own viewport classification instead of scattering additional `matchMedia` checks through components.

The pure classification function receives width, height, and coarse-pointer state and returns `phone`, `compact`, or `desktop`. A React hook observes window resizing, orientation changes, pointer media changes, and `visualViewport` resizing. The hook exposes the layout mode and current usable viewport height.

The application shell uses a single layout-mode class/data attribute so CSS and React behavior switch together. Existing desktop sidebar collapse and timeline height preferences remain independent from mobile-only drawer and timeline-expansion state.

### Mobile Editor Chrome

Phone-only chrome is isolated from the large `App.tsx` render body in a focused component. It renders the tools button and essential stage actions, but receives callbacks and state from `App`; it does not own choreography data.

This separation keeps mobile presentation replaceable without duplicating stage, playback, or project logic.

### Sidebar Reuse

The current `Sidebar` remains the only tools implementation.

- Desktop/tablet: render it as the existing pane.
- Phone closed: do not occupy layout width.
- Phone open: render it as an overlay drawer with a backdrop and close control.

The drawer passes `isCompactLayout` and existing callbacks exactly as today. It does not introduce a parallel mobile settings model.

### Timeline Reuse

`Timeline` receives an explicit mobile density/expansion contract. All frame selection, dragging, playback, zoom, keyframe, and edit state stays in the existing component and parent callbacks. Presentation-only branches hide secondary toolbar content in compact density and expose the expansion action.

### Visual Viewport

On supported Android browsers, the adaptive hook reads `window.visualViewport.height` and updates a root CSS custom property. Updates are animation-frame throttled to avoid resize floods.

The mobile drawer and app shell use this value so the soft keyboard reduces their usable height. If focus is inside a mobile scroll surface, the focused control is scrolled to the nearest visible position after a viewport resize. If `visualViewport` is unavailable, the shell falls back to `100dvh`.

## Interaction and State Flow

### Initial State

- Tools drawer closed.
- Timeline compact.
- Stage active and fully interactive.
- Current formation, selection, view mode, playback time, and project state unchanged.

### Mutual Exclusion

Opening the tools drawer first collapses the expanded timeline. Expanding the timeline first closes the tools drawer. This guarantees that only one secondary mobile surface competes with the stage.

### Close and Back Priority

Mobile close behavior follows this priority:

1. Close the topmost application modal when it already exposes a close callback.
2. Close the tools drawer.
3. Collapse the expanded timeline.
4. Allow normal browser or host navigation.

Opening a mobile-only secondary surface adds a scoped history marker. Android back consumes that marker and closes the surface. Explicit close actions remove the matching marker without creating duplicate history entries. Leaving phone mode clears only mobile presentation markers and preserves editor state.

### Rotation

Rotation recalculates layout mode and available height. It does not reset the current frame, selected performers, playhead, undo stack, view mode, project edits, or timeline scroll state.

### Keyboard

While the Android soft keyboard is visible:

- The timeline remains compact.
- The tools drawer scrolls internally.
- The focused input is moved into the visual viewport when necessary.
- Safe-area padding remains applied to interactive controls.

## Styling and Accessibility

- Use `env(safe-area-inset-top)`, `env(safe-area-inset-right)`, `env(safe-area-inset-bottom)`, and `env(safe-area-inset-left)` around phone chrome.
- Backgrounds may extend edge-to-edge, but buttons and drag targets remain outside system inset and gesture zones.
- Coarse-pointer buttons and timeline handles have a minimum 48 px interactive area; icons may remain visually smaller.
- Tool, playback, expand/collapse, view, and close controls have Chinese `aria-label` text and visible pressed/expanded state where applicable.
- Drawers and overlays use appropriate dialog/navigation semantics, focus entry, and focus restoration.
- Page-level horizontal scrolling is prohibited. The timeline keeps its own horizontal scrolling behavior.
- Reduced-motion preferences continue to be honored.

## Failure and Fallback Behavior

- Missing `visualViewport`: use `100dvh` and existing safe-area CSS.
- Missing coarse-pointer media support: width-based classification still handles phone portrait.
- Very small height: keep the compact timeline at its minimum height and prioritize stage visibility; tools remain available through the drawer.
- Layout-mode changes while a surface is open: close mobile-only presentation surfaces without mutating choreography state.
- History state not available: close buttons and the backdrop remain functional; the feature does not block editing.

## Testing Strategy

### Automated Tests

- Unit-test layout classification at boundaries around 600 px width, 480 px height, and 1100 px compact/desktop width.
- Unit-test mobile surface priority and mutual-exclusion transitions.
- Add source-level UI regression assertions, matching the project's existing test style, for:
  - phone tools drawer wiring;
  - compact and expanded timeline contracts;
  - 48 px touch-target class/rules;
  - Chinese accessible labels;
  - desktop layout path remaining present.
- Run TypeScript type checking, relevant desktop regression tests, and the Vite production build.
- Run the full `npm test` suite when the targeted checks are green.
- Build and synchronize the Vite output with Capacitor.
- Build a Gradle debug APK, install it with the SDK-local `adb`, and verify the package is reported by `pm path`.
- Capture Android logcat during launch and reject uncaught renderer/native errors.

### Visual Verification

Verify the running application at:

- 360x800: small Android portrait.
- 412x915: common Android portrait.
- 915x412: Android landscape.
- 800x1280: tablet portrait regression.
- 1440x900: desktop regression.

At each applicable size, confirm no page-level horizontal overflow, usable stage gestures, reachable tools, scrollable drawer content, compact timeline selection, expansion/collapse, safe-area spacing, and state preservation. Simulate a reduced visual viewport to check soft-keyboard avoidance.

## Acceptance Criteria

- The full editing workflow remains reachable on phone portrait and landscape.
- The stage occupies most of the default phone viewport.
- The tools drawer and expanded timeline are mutually exclusive and preserve editor state.
- Android back closes the topmost mobile surface before leaving the editor.
- System UI and the soft keyboard do not obscure required controls.
- Coarse-pointer actions provide at least 48 px touch areas.
- Tested viewports have no page-level horizontal overflow.
- Tablet and desktop layouts retain their existing behavior.
- Type checking, relevant tests, and production build pass.
- A debug APK installs and launches on an API 36 emulator or a connected Android device.
- Android Back, system insets, rotation, soft-keyboard handling, and the configurable backend endpoint work inside the native WebView.
