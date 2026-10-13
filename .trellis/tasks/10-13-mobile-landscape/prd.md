# Mobile landscape workspace and touch editing

## Goal
Improve the existing mobile editor for landscape rehearsal use: give the stage more vertical space, keep navigation reachable, and reduce repeated panel/mode switching.

## Findings and decision
The existing landscape layout reserves full-width header and bottom toolbar, uses a fixed 265px sequence pane with wrapping cards, and opens wide bottom sheets over the stage. It has no selection quick actions. Keep the same editor/document/storage architecture. Use a left tool rail, central stage and narrow right sequence rail with a collapse control; retain playback while collapsed. Landscape dialogs become right drawers, with scrolling content and a fixed close control. Portrait keeps the familiar bottom tools/sheets.

Alternatives considered: merely shrinking controls (worsens touch targets); full-screen stage only (hides navigation). Chosen: collapsible rails, minimum 44px primary actions, no remount on rotation. Wide-layout breakpoint requires >=600px width to avoid switching layout when a portrait keyboard opens.

## Requirements
- Landscape tool rail, compact header, vertically scrollable formation rows; selected formation auto-reveals and playback stays reachable.
- Collapse/expand sequence without losing playback, selection, document, zoom, or history.
- Selection context: clear selection, complete multi-selection, open actor properties, precision moves in meters with selectable step. Respect effective locks, Z and stage/wing bounds; preserve relative spacing when a group reaches an edge.
- Explicit return from scrub/playback preview to current formation editing.
- Landscape side drawers with focus trap/restore and reachable close control; portrait bottom sheets retained.
- Split new layout/components from the existing large files where practical.

## Acceptance
- [x] 640x360, 812x375, 915x412 landscape and 360x640 portrait fit with reachable primary controls.
- [x] Selecting/duplicating a late formation scrolls it into view, without scrolling stage/page.
- [x] Collapse/rotate preserves document, selected formation and edit history; playback still accessible.
- [x] Precision movements preserve meters, elevation, group spacing, bounds, locks and undo.
- [x] Drawer close/focus and portrait regression pass browser tests; typecheck/core/build checks pass.
- [x] Updated screenshots and user/developer documentation.

## Scope boundaries
No new backend, cloud transport, document schema, dependencies, native API, or APK verification. Native build/device limitations from the previous task remain. Local implementation is authorized by the user's optimization request; no additional design approval is necessary.

## Validation
Typecheck, 7 mobile core tests, 149 desktop regressions and all 8 mobile browser scenarios passed. Production build and Android resource sync passed. Screenshots were reviewed for portrait, landscape and right drawer. APK/device behavior remains unverified.
