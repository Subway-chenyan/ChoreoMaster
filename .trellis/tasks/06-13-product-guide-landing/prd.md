# Product Introduction and Guide Landing Page

## Goal

Add a polished in-app landing page that explains CosStage, presents its core
capabilities, and gives users a practical getting-started guide without leaving
the current Electron/React application.

## Requirements

* Add a dedicated product guide view rendered inside the existing React app.
* Add a visible top-bar entry that switches from the editor to the guide.
* Preserve all editor state while the guide is open.
* Provide in-page navigation for product introduction, feature overview, and
  usage instructions.
* Merge the existing F1 help content into a detailed operations section covering
  general shortcuts, stage editing, timeline/formations, and export guidance.
* Add a clear action to return to the editor.
* Describe only capabilities that exist in the repository:
  project management, performer and prop management, grouping, formation
  editing, timeline playback, music, 2D/3D views, stage/LED configuration,
  presets/AI choreography, project packages, and video export.
* Match the existing slate/blue visual language and support both dark and light
  themes.
* Support desktop and compact/mobile layouts.
* Respect reduced-motion preferences and provide visible keyboard focus states.
* Keep the existing F1 shortcut help modal available.

## Acceptance Criteria

* [ ] A product guide button is available in the editor top bar.
* [ ] Clicking it opens the full in-app guide without reloading or losing editor state.
* [ ] The guide contains complete product introduction, feature overview, and usage sections.
* [ ] The guide includes the existing detailed keyboard and editing instructions.
* [ ] Guide navigation scrolls to the corresponding section.
* [ ] The return action restores the editor with its previous state.
* [ ] The guide is usable in dark theme, light theme, and narrow viewports.
* [ ] Existing shortcuts and editing behavior continue to work.
* [ ] TypeScript build and project tests pass.

## Definition of Done

* Implementation follows frontend project guidelines.
* Build and relevant automated checks are green.
* The page is visually verified in the running application.
* No new runtime dependency is introduced.

## Technical Approach

Create a standalone `components/ProductGuide.tsx` component. Keep navigation
state in `App.tsx` so the editor's existing state remains mounted in the parent
and survives view switching. Render the guide as the root application view when
selected, with semantic sections and native anchor scrolling. Reuse the existing
Lucide icon dependency and Tailwind utility styling.

## Decision (ADR-lite)

**Context**: The application has no router and the editor stores substantial
session state in `App.tsx`.

**Decision**: Use an in-app view state rather than adding a routing dependency or
opening an external page.

**Consequences**: The implementation stays small and preserves editor state.
The guide URL is not independently addressable, which is acceptable for this
desktop-first product surface.

## Out of Scope

* Public website deployment or SEO work.
* Changes to editor workflows, project formats, or backend APIs.
* Replacing the existing shortcut help modal.
* Adding screenshots that may become stale as the editor evolves.

## Technical Notes

* Main shell: `App.tsx`
* Existing quick help: `components/HelpModal.tsx`
* Theme source: `contexts/ThemeContext.tsx`
* Styling entry: `index.css`
* Relevant specs: `.trellis/spec/frontend/index.md`,
  `.trellis/spec/frontend/components.md`,
  `.trellis/spec/frontend/css-design.md`,
  `.trellis/spec/frontend/react-pitfalls.md`,
  `.trellis/spec/frontend/type-safety.md`,
  `.trellis/spec/frontend/quality.md`
