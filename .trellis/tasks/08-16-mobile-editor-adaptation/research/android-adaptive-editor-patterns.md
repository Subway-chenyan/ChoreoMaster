# Android Adaptive Editor Patterns

## Sources

- [Android layouts and navigation patterns](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns) — compact layouts should use a navigation bar for three to five peer destinations; larger layouts should adapt to a rail or another suitable form rather than stretch the phone bar.
- [Android adaptive do's and don'ts](https://developer.android.com/develop/adaptive-apps/guides/adaptive-dos-and-donts) — layout decisions should react to available window size and preserve useful content space rather than scale a single fixed composition.
- [Android window size classes](https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes) — compact width is below 600 dp, medium width is 600–839 dp, and compact height is below 480 dp; width and height should be considered independently when the workflow is sensitive to orientation.
- [Android edge-to-edge design](https://developer.android.com/design/ui/mobile/guides/layout-and-content/edge-to-edge) — backgrounds may extend edge-to-edge, while interactive targets must avoid system bars, display cutouts, and gesture insets.
- [Android accessibility for Views](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views) — interactive targets should provide at least a 48 dp by 48 dp focusable/touch area.

## Common Conventions

1. Use bottom navigation for three to five destinations of equal hierarchy on compact screens.
2. Keep one primary task surface prominent instead of compressing several desktop panes into the same narrow viewport.
3. Move secondary or contextual actions into drawers, sheets, or overflow surfaces.
4. Adapt navigation at larger window sizes rather than keeping phone navigation everywhere.
5. Draw passive backgrounds edge-to-edge, but inset tappable controls away from system bars and gesture areas.
6. Use at least 48 CSS px for coarse-pointer targets as the practical web analogue of Android's 48 dp recommendation.

## Mapping to CosStage

- Treat project tools, the stage, and the timeline as the three compact destinations.
- Preserve the stage as the default destination because performer manipulation is the editor's primary task.
- Keep playback controls persistently reachable, but place less frequent stage configuration in a modal sheet or collapsible overlay.
- Use the existing desktop panes at larger widths; introduce a dedicated phone breakpoint instead of replacing the current 1100 px compact/tablet behavior.
- Treat width below 600 CSS px as phone portrait. Also use the stage-first phone composition for coarse-pointer windows with compact height below 480 CSS px so phone landscape does not fall back to a vertically unusable desktop-derived layout.
- Apply `env(safe-area-inset-*)` padding to the top bar and bottom navigation, and avoid drag handles at the left/right system-gesture edges.
- Ensure compact icon buttons and timeline handles have a minimum 48 px touch area on coarse pointers.

## Feasible Approaches

### A. Three-Destination Navigation Bar

- Phone portrait shows one full workspace at a time: Tools, Stage, or Timeline.
- A persistent Android-style bottom bar switches destinations; Stage is the default.
- Contextual panels open as full-height or bottom sheets and Android back closes the topmost surface first.
- Best balance of complete functionality, usable canvas size, and familiar Android navigation.

### B. Stage Plus Persistent Compact Timeline (Selected)

- Stage remains visible while a reduced-height timeline stays at the bottom and the tools panel opens from a top-left icon.
- Preserves context between the canvas and controls.
- An explicit timeline expand button avoids competing vertical/system gestures while keeping detailed editing available.

### C. Horizontal Workspace Pager

- Swipe between Tools, Stage, and Timeline; keep a page indicator or compact navigation bar.
- Fast for experienced users.
- Conflicts with stage and timeline gestures, is less discoverable, and makes accidental navigation likely.

## Recommendation

Use the user-selected Approach B with an explicit expand button rather than a draggable sheet. Retain the current multi-pane compact layout for tablets where width and height are sufficient. Apply the stage-first composition to both phone portrait and compact-height phone landscape.
