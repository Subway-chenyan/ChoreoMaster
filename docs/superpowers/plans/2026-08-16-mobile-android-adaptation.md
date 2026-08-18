# CosStage Mobile Android Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete stage-first Android phone editing layout with a compact bottom timeline, top-left tools drawer, safe viewport handling, and Android-style back behavior while preserving tablet and desktop behavior.

**Architecture:** A pure adaptive-layout utility classifies phone, compact, and desktop viewports; a focused React hook observes window, pointer, and visual-viewport changes. `App.tsx` coordinates mobile-only presentation state while continuing to own editor data, `Sidebar` is reused inside a phone drawer, and `Timeline` gains explicit compact/expanded phone densities. Mobile history markers close the active phone surface before normal navigation.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4, Node built-in test runner, Electron renderer APIs.

**Git constraint:** Do not run `git add`, `git commit`, or `git push`. The project agreement requires explicit authorization for each Git write operation, so every checkpoint below leaves changes unstaged for user review.

---

## File Map

**Create**

- `utils/adaptive-layout.ts` — pure viewport classification and mobile close-priority rules.
- `hooks/useAdaptiveLayout.ts` — subscribes to resize, orientation/pointer changes, and `visualViewport` height.
- `hooks/useMobileHistoryLayer.ts` — owns the scoped browser-history marker for Android back.
- `components/MobileEditorChrome.tsx` — phone-only tools and essential stage actions.
- `tests/adaptive-layout.test.ts` — behavior tests for breakpoints and close priority.

**Modify**

- `App.tsx` — coordinates layout mode, drawer/timeline state, phone rendering, viewport height, and back layers.
- `components/Sidebar.tsx` — reports its own agent, prop-editor, and color-picker overlays so Android back closes them before the drawer.
- `components/Timeline.tsx` — adds default, phone-compact, and phone-expanded presentation contracts.
- `index.css` — implements drawer, phone chrome, safe-area, density, and coarse-pointer styling.
- `tests/desktop-regressions.test.mjs` — asserts the mobile wiring and desktop path remain present.
- `package.json` — adds `tests/adaptive-layout.test.ts` to `test:desktop`.
- `.trellis/tasks/08-16-mobile-editor-adaptation/prd.md` — marks acceptance criteria after verified completion.

## Task 1: Install, Start, and Capture a Clean Baseline

**Files:**

- Runtime-generated if missing: `.env` copied by `scripts/start-dev.cjs` from `.env.example`.
- No tracked source changes.

- [ ] **Step 1: Verify required runtimes**

Run:

```powershell
node --version
npm --version
python --version
ffmpeg -version
```

Expected: Node 22-compatible runtime, npm, Python 3.11+, and FFmpeg all return version output. If FFmpeg is missing, report that the multimodal backend launcher cannot start; frontend-only work can still continue with `npm run dev`.

- [ ] **Step 2: Let the launcher create `.env` if needed**

Run:

```powershell
if (-not (Test-Path -LiteralPath '.env')) { npm start }
```

Expected when `.env` is absent: the launcher prints `[setup] 已创建 .env` and exits. When it already exists, the command returns without starting a duplicate service. Do not add secrets; the default `LLM_PROVIDER=rule` path is sufficient for layout work.

- [ ] **Step 3: Install frontend and backend dependencies**

Run:

```powershell
npm run start:setup
```

Expected: npm dependencies and `backend/requirements.txt` install successfully, then Vite listens on `127.0.0.1:5173` and FastAPI listens on `127.0.0.1:8000`. Keep the process running in a managed terminal session.

- [ ] **Step 4: Probe both development services**

Run:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173
Invoke-RestMethod http://127.0.0.1:8000/health
```

Expected: frontend HTTP 200 and backend health JSON indicating the service is available.

- [ ] **Step 5: Capture baseline quality results**

Run:

```powershell
npm run typecheck
npm run test:desktop
npm run build
```

Expected: all commands pass before feature code is written. Record any pre-existing failure separately and do not hide it inside mobile changes.

- [ ] **Step 6: Activate the Trellis task before implementation**

Run:

```powershell
python ./.trellis/scripts/task.py start .trellis/tasks/08-16-mobile-editor-adaptation
```

Expected: task status changes from `planning` to `in_progress`. If the script reports missing session identity, initialize the existing `codex` developer identity and retry without changing the task path.

## Task 2: Build the Adaptive Layout Contract with TDD

**Files:**

- Create: `utils/adaptive-layout.ts`
- Create: `tests/adaptive-layout.test.ts`
- Modify: `package.json`

- [ ] **Step 0: Load implementation rules**

Load `trellis-before-dev`, then read the task PRD and its Android research file completely. Load `superpowers:test-driven-development` before creating the first failing test.

- [ ] **Step 1: Write the failing adaptive-layout tests**

Create `tests/adaptive-layout.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveAdaptiveLayoutMode,
  resolveMobileBackTarget,
} from '../utils/adaptive-layout.ts';

test('adaptive layout follows phone, compact, and desktop boundaries', () => {
  assert.equal(resolveAdaptiveLayoutMode({ width: 599, height: 900, coarsePointer: false }), 'phone');
  assert.equal(resolveAdaptiveLayoutMode({ width: 600, height: 900, coarsePointer: false }), 'compact');
  assert.equal(resolveAdaptiveLayoutMode({ width: 915, height: 479, coarsePointer: true }), 'phone');
  assert.equal(resolveAdaptiveLayoutMode({ width: 915, height: 480, coarsePointer: true }), 'compact');
  assert.equal(resolveAdaptiveLayoutMode({ width: 1100, height: 900, coarsePointer: false }), 'compact');
  assert.equal(resolveAdaptiveLayoutMode({ width: 1101, height: 900, coarsePointer: false }), 'desktop');
});

test('fine-pointer short windows do not masquerade as Android phone landscape', () => {
  assert.equal(resolveAdaptiveLayoutMode({ width: 915, height: 400, coarsePointer: false }), 'compact');
});

test('mobile back closes modal, tools, then expanded timeline', () => {
  assert.equal(resolveMobileBackTarget({ modalOpen: true, toolsOpen: true, timelineExpanded: true }), 'modal');
  assert.equal(resolveMobileBackTarget({ modalOpen: false, toolsOpen: true, timelineExpanded: true }), 'tools');
  assert.equal(resolveMobileBackTarget({ modalOpen: false, toolsOpen: false, timelineExpanded: true }), 'timeline');
  assert.equal(resolveMobileBackTarget({ modalOpen: false, toolsOpen: false, timelineExpanded: false }), 'navigation');
});
```

- [ ] **Step 2: Add the test file to the desktop test command**

Append the new file to `package.json` without changing the existing test order:

```json
"test:desktop": "node --experimental-strip-types --test tests/desktop-regressions.test.mjs tests/desktop-binary-export.test.ts tests/export-progress.test.ts tests/performer-visibility.test.ts tests/performer-locking.test.ts tests/transition-regressions.test.mjs tests/update-contract.test.ts tests/update-preferences.test.ts tests/release-history.test.ts tests/cross-project-clipboard.test.ts tests/performer-grouping.test.ts tests/stage-grid-behavior.test.ts tests/three-interaction.test.ts tests/adaptive-layout.test.ts"
```

- [ ] **Step 3: Run the new test and verify failure**

Run:

```powershell
node --experimental-strip-types --test tests/adaptive-layout.test.ts
```

Expected: FAIL because `utils/adaptive-layout.ts` does not exist.

- [ ] **Step 4: Implement the pure adaptive-layout module**

Create `utils/adaptive-layout.ts`:

```ts
export const PHONE_WIDTH_BREAKPOINT_PX = 600;
export const PHONE_COMPACT_HEIGHT_BREAKPOINT_PX = 480;
export const COMPACT_WIDTH_BREAKPOINT_PX = 1100;

export type AdaptiveLayoutMode = 'phone' | 'compact' | 'desktop';
export type MobileBackTarget = 'modal' | 'tools' | 'timeline' | 'navigation';

export interface AdaptiveViewport {
  width: number;
  height: number;
  coarsePointer: boolean;
}

export interface MobileSurfaceState {
  modalOpen: boolean;
  toolsOpen: boolean;
  timelineExpanded: boolean;
}

export function resolveAdaptiveLayoutMode(viewport: AdaptiveViewport): AdaptiveLayoutMode {
  if (
    viewport.width < PHONE_WIDTH_BREAKPOINT_PX
    || (viewport.coarsePointer && viewport.height < PHONE_COMPACT_HEIGHT_BREAKPOINT_PX)
  ) {
    return 'phone';
  }

  if (viewport.width <= COMPACT_WIDTH_BREAKPOINT_PX) return 'compact';
  return 'desktop';
}

export function resolveMobileBackTarget(state: MobileSurfaceState): MobileBackTarget {
  if (state.modalOpen) return 'modal';
  if (state.toolsOpen) return 'tools';
  if (state.timelineExpanded) return 'timeline';
  return 'navigation';
}
```

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
node --experimental-strip-types --test tests/adaptive-layout.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: Review checkpoint**

Run `git status --short` and confirm only the planned untracked/modified files are present. Leave everything unstaged.

## Task 3: Observe Window and Visual Viewport Changes

**Files:**

- Create: `hooks/useAdaptiveLayout.ts`
- Modify: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add the failing hook regression test**

Append to `tests/desktop-regressions.test.mjs`:

```js
test('adaptive layout observes window, pointer, and visual viewport changes', async () => {
  const source = await read('hooks/useAdaptiveLayout.ts');

  assert.match(source, /resolveAdaptiveLayoutMode/);
  assert.match(source, /matchMedia\('\(pointer: coarse\)'\)/);
  assert.match(source, /visualViewport\?\.height/);
  assert.match(source, /visualViewport\?\.addEventListener\('resize'/);
  assert.match(source, /requestAnimationFrame/);
});
```

- [ ] **Step 2: Run the regression test and verify failure**

Run:

```powershell
node --test tests/desktop-regressions.test.mjs
```

Expected: FAIL because `hooks/useAdaptiveLayout.ts` does not exist.

- [ ] **Step 3: Implement the adaptive-layout hook**

Create `hooks/useAdaptiveLayout.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import {
  resolveAdaptiveLayoutMode,
  type AdaptiveLayoutMode,
  type AdaptiveViewport,
} from '../utils/adaptive-layout';

export interface AdaptiveLayoutSnapshot {
  mode: AdaptiveLayoutMode;
  isPhoneLayout: boolean;
  isCompactLayout: boolean;
  viewportHeight: number;
}

function readViewport(): AdaptiveViewport {
  return {
    width: window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
  };
}

export function useAdaptiveLayout(): AdaptiveLayoutSnapshot {
  const [viewport, setViewport] = useState<AdaptiveViewport>(readViewport);

  useEffect(() => {
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const visualViewport = window.visualViewport;
    let animationFrameId: number | null = null;

    const syncViewport = (): void => {
      animationFrameId = null;
      setViewport(readViewport());
    };

    const scheduleSync = (): void => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(syncViewport);
    };

    window.addEventListener('resize', scheduleSync);
    coarsePointer.addEventListener('change', scheduleSync);
    visualViewport?.addEventListener('resize', scheduleSync);
    visualViewport?.addEventListener('scroll', scheduleSync);

    return () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', scheduleSync);
      coarsePointer.removeEventListener('change', scheduleSync);
      visualViewport?.removeEventListener('resize', scheduleSync);
      visualViewport?.removeEventListener('scroll', scheduleSync);
    };
  }, []);

  return useMemo(() => {
    const mode = resolveAdaptiveLayoutMode(viewport);
    return {
      mode,
      isPhoneLayout: mode === 'phone',
      isCompactLayout: mode !== 'desktop',
      viewportHeight: viewport.height,
    };
  }, [viewport]);
}
```

- [ ] **Step 4: Run regression and type checks**

Run:

```powershell
node --test tests/desktop-regressions.test.mjs
npm run typecheck
```

Expected: hook regression and type checking pass.

## Task 4: Add Phone Chrome and Reuse Sidebar as a Drawer

**Files:**

- Create: `components/MobileEditorChrome.tsx`
- Modify: `App.tsx`
- Modify: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add the failing mobile-shell regression test**

Append to `tests/desktop-regressions.test.mjs`:

```js
test('phone layout keeps the stage primary and reuses the sidebar as a drawer', async () => {
  const [app, chrome] = await Promise.all([
    read('App.tsx'),
    read('components/MobileEditorChrome.tsx'),
  ]);

  assert.match(app, /useAdaptiveLayout\(\)/);
  assert.match(app, /mobileToolsOpen/);
  assert.match(app, /mobile-tools-backdrop/);
  assert.match(app, /mobile-tools-drawer/);
  assert.match(app, /isPhoneLayout \? mobileToolsOpen : !sidebarCollapsed/);
  assert.match(chrome, /aria-label=\{toolsOpen \? '关闭工具' : '打开工具'\}/);
  assert.match(chrome, /aria-label=\{isPlaying \? '暂停播放' : '开始播放'\}/);
  assert.match(chrome, /min-h-12 min-w-12/);
});
```

- [ ] **Step 2: Run the regression test and verify failure**

Run:

```powershell
node --test tests/desktop-regressions.test.mjs
```

Expected: FAIL because the mobile chrome and drawer wiring are absent.

- [ ] **Step 3: Create the focused phone chrome**

Create `components/MobileEditorChrome.tsx`:

```tsx
import React from 'react';
import { Box, Menu, Pause, Play, SlidersHorizontal, Square, X } from 'lucide-react';

interface MobileEditorChromeProps {
  visible: boolean;
  toolsOpen: boolean;
  isPlaying: boolean;
  viewMode: '2d' | '3d';
  onToolsToggle: () => void;
  onPlayPause: () => void;
  onViewModeToggle: () => void;
  onStageToolsOpen: () => void;
}

export const MobileEditorChrome: React.FC<MobileEditorChromeProps> = ({
  visible,
  toolsOpen,
  isPlaying,
  viewMode,
  onToolsToggle,
  onPlayPause,
  onViewModeToggle,
  onStageToolsOpen,
}) => {
  if (!visible) return null;

  const buttonClass = 'mobile-chrome-button min-h-12 min-w-12 flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/90 text-slate-100 shadow-lg backdrop-blur';

  return (
    <div className="mobile-editor-chrome pointer-events-none absolute inset-x-0 top-0 z-50 flex items-start justify-between">
      <button
        type="button"
        className={`${buttonClass} pointer-events-auto`}
        onClick={onToolsToggle}
        aria-label={toolsOpen ? '关闭工具' : '打开工具'}
        aria-expanded={toolsOpen}
      >
        {toolsOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      <div className="pointer-events-auto flex gap-1.5">
        <button type="button" className={buttonClass} onClick={onPlayPause} aria-label={isPlaying ? '暂停播放' : '开始播放'}>
          {isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
        </button>
        <button type="button" className={buttonClass} onClick={onViewModeToggle} aria-label={viewMode === '2d' ? '切换到 3D 视图' : '切换到 2D 视图'}>
          {viewMode === '2d' ? <Box size={19} /> : <Square size={19} />}
        </button>
        <button type="button" className={buttonClass} onClick={onStageToolsOpen} aria-label="打开舞台设置">
          <SlidersHorizontal size={19} />
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Replace scattered compact detection in `App.tsx`**

Import and initialize the shared hook and phone chrome:

```tsx
import { MobileEditorChrome } from './components/MobileEditorChrome';
import { useAdaptiveLayout } from './hooks/useAdaptiveLayout';

const { isPhoneLayout, isCompactLayout, viewportHeight } = useAdaptiveLayout();
const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
const [mobileTimelineExpanded, setMobileTimelineExpanded] = useState(false);
```

Remove the old `isCompactLayout` state and its `(max-width: 1100px)` synchronization effect. Keep the existing effect that adjusts desktop/tablet timeline height and toolbar collapse, but depend on `isCompactLayout` from the hook.

- [ ] **Step 5: Add mutually exclusive mobile handlers**

Add to `App.tsx`:

```tsx
const handleMobileToolsToggle = useCallback((): void => {
  setMobileTimelineExpanded(false);
  setMobileToolsOpen((open) => !open);
}, []);

const handleMobileTimelineExpandedChange = useCallback((expanded: boolean): void => {
  setMobileToolsOpen(false);
  setMobileTimelineExpanded(expanded);
}, []);

useEffect(() => {
  if (isPhoneLayout) return;
  setMobileToolsOpen(false);
  setMobileTimelineExpanded(false);
}, [isPhoneLayout]);
```

- [ ] **Step 6: Render the drawer without duplicating `Sidebar` props**

Change the existing sidebar condition and wrap its current `Sidebar` JSX:

```tsx
{isPhoneLayout && mobileToolsOpen && (
  <button
    type="button"
    className="mobile-tools-backdrop absolute inset-0 z-50 bg-black/60"
    onClick={() => setMobileToolsOpen(false)}
    aria-label="关闭工具抽屉"
  />
)}
{(isPhoneLayout ? mobileToolsOpen : !sidebarCollapsed) && (
  <div className={isPhoneLayout ? 'mobile-tools-drawer' : undefined}>
    <Sidebar
      performers={performers}
      performerGroups={performerGroups}
      frames={frames}
      currentFrameId={currentFrameId}
      onAddPerformer={handleAddPerformer}
      onRemovePerformer={requestDeletePerformer}
      onRemovePerformers={requestDeletePerformers}
      onShowPerformersInAllFrames={handleShowPerformersInAllFrames}
      onSetPerformersLocked={handleSetPerformersLocked}
      onUpdatePerformer={handleUpdatePerformer}
      onTogglePerformerInFrame={handleTogglePerformerInFrame}
      onDuplicateSelected={handleDuplicateSelected}
      onApplyPreset={handleApplyPreset}
      onApplyAIPlan={handleApplyAIPlan}
      onImportMusic={handleImportMusic}
      onExport={handleExportProject}
      onImportProject={handleImportProject}
      onImportProjectPackage={projectTransfers.importProjectPackage}
      onImportChoreography={projectTransfers.importChoreography}
      onExportProjectPackage={projectTransfers.exportProjectPackage}
      onExportChoreography={projectTransfers.exportChoreography}
      onRestoreRecovery={projectTransfers.restoreRecoverySnapshot}
      selectedPerformerIds={selectedPerformerIds}
      onSelectionChange={setSelectedPerformerIds}
      musicName={musicName}
      onSelectFrame={handleSelectFrame}
      onAddFrame={handleAddFrame}
      onDeleteFrame={requestDeleteFrame}
      onDuplicateFrame={handleDuplicateFrame}
      onReorderFrame={() => {}}
      onResetProject={handleResetProject}
      onDeletedCurrentProject={performResetProject}
      onRenameFrame={handleRenameFrame}
      widthPx={sidebarWidth}
      onAddGroup={handleAddGroup}
      onRemoveGroup={requestDeleteGroup}
      onShowGroupInAllFrames={handleShowGroupInAllFrames}
      onSetGroupLocked={handleSetGroupLocked}
      onUpdateGroup={handleUpdateGroup}
      onAddPerformersToGroup={handleAddPerformersToGroup}
      onRemovePerformersFromGroup={handleRemovePerformersFromGroup}
      onUpdateGroupPerformers={handleUpdateGroupPerformers}
      onToggleGroupVisibility={handleToggleGroupVisibilityInFrame}
      onToggleGroupCollapsed={handleToggleGroupCollapsed}
      onSelectGroupPerformers={handleSelectGroupPerformers}
      stageConfig={stageConfig}
      onStageConfigChange={handleStageConfigChange}
      onLEDContentUpload={handleLEDContentUpload}
      onClearLEDContent={handleClearLEDContent}
      onStageBackgroundUpload={handleStageBackgroundUpload}
      onClearStageBackground={handleClearStageBackground}
      aiConfig={aiConfig}
      onAiConfigChange={setAiConfig}
      currentProjectId={currentProjectId}
      onLoadProject={handleLoadProject}
      onCreateProject={handleCreateProject}
      onCreateFromPresetTemplate={handleCreateFromPresetTemplate}
      onCreateFromTemplate={handleCreateFromTemplate}
      onLoadTemplate={handleLoadTemplate}
      onSaveProject={handleSaveProject}
      projectHasChanges={projectHasChanges}
      isProjectSaving={isProjectSaving}
      lastSavedAt={lastSavedAt}
      isCompactLayout={isCompactLayout}
      onOpenNoteDrawer={handleOpenNoteDrawer}
      performerNotes={performerNotes}
    />
    {isPhoneLayout && (
      <button
        type="button"
        className="mobile-tools-close min-h-12 min-w-12"
        onClick={() => setMobileToolsOpen(false)}
        aria-label="关闭工具抽屉"
      >
        <X size={20} />
      </button>
    )}
  </div>
)}
```

- [ ] **Step 7: Make phone chrome replace the desktop top bar**

Wrap the existing top bar with this exact conditional opening and add the matching `)}` after its current closing `</div>`:

```tsx
{!isPhoneLayout && (
  <div className={`min-h-12 flex items-center justify-between px-3 sm:px-4 border-b ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-200'}`}>
```

Inside `stageViewportRef`, before the stage status, render:

```tsx
<MobileEditorChrome
  visible={isPhoneLayout}
  toolsOpen={mobileToolsOpen}
  isPlaying={isPlaying}
  viewMode={viewMode}
  onToolsToggle={handleMobileToolsToggle}
  onPlayPause={handlePlayPause}
  onViewModeToggle={() => setViewMode((mode) => mode === '2d' ? '3d' : '2d')}
  onStageToolsOpen={() => setStageToolbarCollapsed(false)}
/>
```

Add `phone-layout` and `--app-visual-height` to the root:

```tsx
<div
  className={`app-shell ${isPhoneLayout ? 'phone-layout' : ''} min-h-[100dvh] h-[100dvh] w-screen flex flex-col safe-top safe-bottom ${theme === 'dark' ? 'bg-slate-950 text-slate-200' : 'bg-gray-50 text-gray-900'} overflow-hidden`}
  style={isPhoneLayout ? { '--app-visual-height': `${viewportHeight}px` } as React.CSSProperties : undefined}
>
```

- [ ] **Step 8: Run regression and type checks**

Run:

```powershell
node --test tests/desktop-regressions.test.mjs
npm run typecheck
```

Expected: mobile-shell regression and type checking pass.

## Task 5: Add Compact and Expanded Phone Timeline Densities

**Files:**

- Modify: `components/Timeline.tsx`
- Modify: `App.tsx`
- Modify: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add the failing timeline-density regression test**

Append to `tests/desktop-regressions.test.mjs`:

```js
test('phone timeline stays compact and exposes explicit detailed expansion', async () => {
  const [app, timeline] = await Promise.all([
    read('App.tsx'),
    read('components/Timeline.tsx'),
  ]);

  assert.match(timeline, /phoneMode\?: boolean/);
  assert.match(timeline, /phoneExpanded\?: boolean/);
  assert.match(timeline, /onPhoneExpandedChange\?: \(expanded: boolean\) => void/);
  assert.match(timeline, /data-density=\{timelineDensity\}/);
  assert.match(timeline, /aria-label=\{phoneExpanded \? '收起详细时间轴' : '展开详细时间轴'\}/);
  assert.match(app, /PHONE_TIMELINE_PORTRAIT_HEIGHT_PX/);
  assert.match(app, /PHONE_TIMELINE_LANDSCAPE_HEIGHT_PX/);
  assert.match(app, /phoneExpanded=\{mobileTimelineExpanded\}/);
});
```

- [ ] **Step 2: Run the regression and verify failure**

Run:

```powershell
node --test tests/desktop-regressions.test.mjs
```

Expected: FAIL because the phone timeline API does not exist.

- [ ] **Step 3: Extend `TimelineProps` and density calculations**

Add to `TimelineProps` and destructuring:

```tsx
phoneMode?: boolean;
phoneExpanded?: boolean;
onPhoneExpandedChange?: (expanded: boolean) => void;
```

Use these defaults and calculations:

```tsx
phoneMode = false,
phoneExpanded = false,
onPhoneExpandedChange,

const timelineDensity = phoneMode
  ? phoneExpanded ? 'phone-expanded' : 'phone-compact'
  : 'default';
const toolbarHeight = phoneMode ? 44 : 48;
const minimumTrackHeight = phoneMode && !phoneExpanded ? 48 : 84;
const trackHeight = Math.max(minimumTrackHeight, heightPx - toolbarHeight);
const clipHeight = phoneMode && !phoneExpanded
  ? Math.min(40, Math.max(32, trackHeight - 16))
  : Math.min(80, Math.max(52, trackHeight - 28));
```

Add these exact attributes to the timeline root:

```tsx
data-density={timelineDensity}
className={`timeline-panel timeline-${timelineDensity} relative flex-none bg-slate-950 border-t border-slate-800 flex flex-col select-none overflow-hidden`}
```

- [ ] **Step 4: Add the explicit expand/collapse control**

Import `ChevronDown` and `ChevronUp`, then add this button to the primary toolbar group after the time:

```tsx
{phoneMode && (
  <button
    type="button"
    onClick={() => onPhoneExpandedChange?.(!phoneExpanded)}
    className="coarse-touch-target phone-timeline-toggle ml-1 flex items-center gap-1 rounded-lg px-2 text-xs text-blue-200 hover:bg-slate-800"
    aria-label={phoneExpanded ? '收起详细时间轴' : '展开详细时间轴'}
    aria-expanded={phoneExpanded}
  >
    {phoneExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
    <span>{phoneExpanded ? '收起' : '展开'}</span>
  </button>
)}
```

Render the existing secondary action group only when `!phoneMode || phoneExpanded`. Do not delete Add, Marker, Zoom, or Export actions; they remain available in expanded mode and desktop mode.

- [ ] **Step 5: Resolve phone timeline heights in `App.tsx`**

Add constants near the existing app constants:

```ts
const PHONE_TIMELINE_PORTRAIT_HEIGHT_PX = 104;
const PHONE_TIMELINE_LANDSCAPE_HEIGHT_PX = 88;
const PHONE_TIMELINE_EXPANDED_MIN_HEIGHT_PX = 220;
```

Compute the height before render:

```tsx
const phoneTimelineCompactHeight = viewportHeight < 480
  ? PHONE_TIMELINE_LANDSCAPE_HEIGHT_PX
  : PHONE_TIMELINE_PORTRAIT_HEIGHT_PX;
const phoneTimelineExpandedHeight = Math.min(
  360,
  Math.max(PHONE_TIMELINE_EXPANDED_MIN_HEIGHT_PX, Math.round(viewportHeight * 0.44)),
);
const resolvedTimelineHeight = isPhoneLayout
  ? mobileTimelineExpanded ? phoneTimelineExpandedHeight : phoneTimelineCompactHeight
  : timelineHeight;
```

Hide the existing draggable timeline resizer in phone mode, always render the timeline in phone mode even if the desktop preference is collapsed, and pass:

```tsx
heightPx={resolvedTimelineHeight}
phoneMode={isPhoneLayout}
phoneExpanded={mobileTimelineExpanded}
onPhoneExpandedChange={handleMobileTimelineExpandedChange}
```

- [ ] **Step 6: Run focused verification**

Run:

```powershell
node --test tests/desktop-regressions.test.mjs
npm run typecheck
```

Expected: timeline-density regression and type checking pass.

## Task 6: Add Scoped Android Back and Keyboard Avoidance

**Files:**

- Create: `hooks/useMobileHistoryLayer.ts`
- Modify: `App.tsx`
- Modify: `components/Sidebar.tsx`
- Modify: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add the failing mobile-history regression test**

Append to `tests/desktop-regressions.test.mjs`:

```js
test('Android back uses a scoped history marker and visual viewport keeps focus visible', async () => {
  const [app, hook] = await Promise.all([
    read('App.tsx'),
    read('hooks/useMobileHistoryLayer.ts'),
  ]);

  assert.match(hook, /history\.pushState/);
  assert.match(hook, /history\.replaceState/);
  assert.match(hook, /addEventListener\('popstate'/);
  assert.match(app, /resolveMobileBackTarget/);
  assert.match(app, /sidebarMobileOverlay/);
  assert.match(await read('components/Sidebar.tsx'), /onMobileOverlayChange/);
  assert.match(app, /scrollIntoView\(\{ block: 'nearest'/);
});
```

- [ ] **Step 2: Run regression and verify failure**

Run:

```powershell
node --test tests/desktop-regressions.test.mjs
```

Expected: FAIL because the scoped history hook and App wiring are absent.

- [ ] **Step 3: Implement the scoped history hook**

Create `hooks/useMobileHistoryLayer.ts`:

```ts
import { useEffect, useRef } from 'react';

const MOBILE_HISTORY_STATE_KEY = '__cosstageMobileLayer';

export interface MobileHistoryLayer {
  key: string;
  onClose: () => void;
}

export function useMobileHistoryLayer(
  enabled: boolean,
  layer: MobileHistoryLayer | null,
): void {
  const layerRef = useRef<MobileHistoryLayer | null>(layer);
  const markerActiveRef = useRef(false);

  useEffect(() => {
    layerRef.current = layer;
  }, [layer]);

  useEffect(() => {
    const handlePopState = (): void => {
      if (!markerActiveRef.current) return;
      markerActiveRef.current = false;
      layerRef.current?.onClose();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const activeKey = enabled ? layer?.key ?? null : null;

    if (activeKey && !markerActiveRef.current) {
      const currentState = typeof history.state === 'object' && history.state !== null
        ? history.state
        : {};
      history.pushState({ ...currentState, [MOBILE_HISTORY_STATE_KEY]: activeKey }, '');
      markerActiveRef.current = true;
      return;
    }

    if (activeKey && markerActiveRef.current) {
      const currentState = typeof history.state === 'object' && history.state !== null
        ? history.state
        : {};
      history.replaceState({ ...currentState, [MOBILE_HISTORY_STATE_KEY]: activeKey }, '');
      return;
    }

    if (!activeKey && markerActiveRef.current) {
      markerActiveRef.current = false;
      history.back();
    }
  }, [enabled, layer?.key]);
}
```

- [ ] **Step 4: Resolve the active close layer in `App.tsx`**

Import `resolveMobileBackTarget`, `useMobileHistoryLayer`, and `MobileHistoryLayer`. Compute `modalOpen` from App-owned overlays:

```tsx
const appModalOpen = Boolean(
  pendingDeleteRequest
  || showExportModal
  || resetProjectDialogMode
  || pendingAIPlan
  || pendingStageBackground
  || noteDrawerOpen
  || showProductGuide
  || showHelp
  || showWebSaveReminder
);

const mobileBackTarget = resolveMobileBackTarget({
  modalOpen: appModalOpen,
  toolsOpen: mobileToolsOpen,
  timelineExpanded: mobileTimelineExpanded,
});

const activeMobileHistoryLayer: MobileHistoryLayer | null = (() => {
  if (mobileBackTarget === 'modal') {
    if (pendingDeleteRequest) return { key: 'delete', onClose: () => setPendingDeleteRequest(null) };
    if (showExportModal) return { key: 'export', onClose: () => setShowExportModal(false) };
    if (resetProjectDialogMode) return { key: 'reset', onClose: handleCancelResetProject };
    if (pendingAIPlan) return { key: 'ai-plan', onClose: () => setPendingAIPlan(null) };
    if (pendingStageBackground) return { key: 'stage-background', onClose: () => setPendingStageBackground(null) };
    if (noteDrawerOpen) return {
      key: 'notes',
      onClose: () => {
        setNoteDrawerOpen(false);
        setNoteDrawerPerformerId(null);
      },
    };
    if (showProductGuide) return { key: 'guide', onClose: () => setShowProductGuide(false) };
    if (showHelp) return { key: 'help', onClose: () => setShowHelp(false) };
    if (showWebSaveReminder) return { key: 'web-reminder', onClose: () => setShowWebSaveReminder(false) };
  }
  if (mobileBackTarget === 'tools') return { key: 'tools', onClose: () => setMobileToolsOpen(false) };
  if (mobileBackTarget === 'timeline') return { key: 'timeline', onClose: () => setMobileTimelineExpanded(false) };
  return null;
})();

useMobileHistoryLayer(isPhoneLayout, activeMobileHistoryLayer);
```

Keep the order in the code identical to the visual stacking priority. Do not close or mutate project data in any history callback.

- [ ] **Step 5: Report Sidebar-owned overlays to the App close stack**

In `components/Sidebar.tsx`, export the descriptor and add the optional prop:

```tsx
export interface SidebarMobileOverlay {
  key: 'choreo-agent' | 'prop-editor' | 'color-picker';
  onClose: () => void;
}

// Add this line to the existing SidebarProps interface:
onMobileOverlayChange?: (overlay: SidebarMobileOverlay | null) => void;
```

Destructure `onMobileOverlayChange`, then add this unconditional effect after the three overlay state declarations:

```tsx
useEffect(() => {
  let overlay: SidebarMobileOverlay | null = null;

  if (propEditorOpen) {
    overlay = {
      key: 'prop-editor',
      onClose: () => {
        setPropEditorOpen(false);
        setPropEditorPerformerId(null);
      },
    };
  } else if (choreoAgentOpen) {
    overlay = { key: 'choreo-agent', onClose: () => setChoreoAgentOpen(false) };
  } else if (colorPickerState.show) {
    overlay = {
      key: 'color-picker',
      onClose: () => setColorPickerState((state) => ({ ...state, show: false })),
    };
  }

  onMobileOverlayChange?.(overlay);
  return () => onMobileOverlayChange?.(null);
}, [choreoAgentOpen, colorPickerState.show, onMobileOverlayChange, propEditorOpen]);
```

In `App.tsx`, import `type SidebarMobileOverlay`, add state, pass the setter to `Sidebar`, and place this descriptor first in the modal branch:

```tsx
const [sidebarMobileOverlay, setSidebarMobileOverlay] = useState<SidebarMobileOverlay | null>(null);

// Sidebar prop
onMobileOverlayChange={isPhoneLayout ? setSidebarMobileOverlay : undefined}

// appModalOpen input
|| sidebarMobileOverlay

// first modal priority
if (sidebarMobileOverlay) return sidebarMobileOverlay;
```

This ensures Back closes the agent, prop editor, or color picker while leaving the tools drawer open.

- [ ] **Step 6: Scroll focused mobile inputs into the visual viewport**

Add an effect to `App.tsx`:

```tsx
useEffect(() => {
  if (!isPhoneLayout || !window.visualViewport) return;

  const keepFocusVisible = (): void => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return;
    requestAnimationFrame(() => activeElement.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  };

  window.visualViewport.addEventListener('resize', keepFocusVisible);
  return () => window.visualViewport?.removeEventListener('resize', keepFocusVisible);
}, [isPhoneLayout]);
```

- [ ] **Step 7: Run regression and type checks**

Run:

```powershell
node --test tests/desktop-regressions.test.mjs
npm run typecheck
```

Expected: Android back/viewport regression and type checking pass.

## Task 7: Implement Android Phone Styling and Touch Targets

**Files:**

- Modify: `index.css`
- Modify: `tests/desktop-regressions.test.mjs`

- [ ] **Step 1: Add the failing CSS regression test**

Append to `tests/desktop-regressions.test.mjs`:

```js
test('phone CSS protects safe areas, drawer width, compact timeline, and 48px targets', async () => {
  const css = await read('index.css');

  assert.match(css, /\.phone-layout/);
  assert.match(css, /--app-visual-height/);
  assert.match(css, /\.mobile-tools-drawer/);
  assert.match(css, /env\(safe-area-inset-left\)/);
  assert.match(css, /\.timeline-phone-compact/);
  assert.match(css, /min-width: 48px/);
  assert.match(css, /min-height: 48px/);
});
```

- [ ] **Step 2: Run the regression and verify failure**

Run:

```powershell
node --test tests/desktop-regressions.test.mjs
```

Expected: FAIL because the phone classes are absent.

- [ ] **Step 3: Add phone shell, drawer, and chrome rules**

Add to `index.css` after the current safe-area helpers:

```css
.app-shell {
  height: var(--app-visual-height, 100dvh);
  min-height: var(--app-visual-height, 100dvh);
}

.mobile-editor-chrome,
.mobile-tools-backdrop,
.mobile-tools-drawer {
  display: none;
}

.phone-layout .mobile-editor-chrome {
  display: flex;
  padding:
    8px
    max(8px, env(safe-area-inset-right))
    8px
    max(8px, env(safe-area-inset-left));
}

.phone-layout .mobile-tools-backdrop {
  display: block;
}

.phone-layout .mobile-tools-drawer {
  display: block;
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 60;
  width: min(88vw, 360px);
  max-width: calc(100vw - 32px);
  padding-left: env(safe-area-inset-left);
  background: #0f172a;
  box-shadow: 18px 0 48px rgb(2 6 23 / 0.55);
}

.phone-layout .mobile-tools-drawer .app-sidebar {
  width: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 100%;
}

.mobile-tools-close {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 3;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: #cbd5e1;
}

.phone-layout .stage-status {
  display: none;
}

.phone-layout .stage-toolbar {
  top: 64px;
  right: max(8px, env(safe-area-inset-right));
  bottom: auto !important;
  max-width: calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right));
  overflow-x: auto;
}
```

- [ ] **Step 4: Add phone timeline density and coarse-pointer rules**

Add:

```css
.timeline-phone-compact .timeline-toolbar {
  min-height: 44px;
  padding-inline: 6px;
}

.timeline-phone-compact .timeline-toolbar-time {
  margin-left: 2px !important;
  font-size: 11px !important;
}

.timeline-phone-compact .timeline-scroll {
  overflow-x: hidden;
}

.timeline-phone-expanded .timeline-toolbar {
  overflow-x: auto;
  scrollbar-width: none;
}

.timeline-phone-expanded .timeline-scroll {
  overflow-x: auto !important;
}

.phone-layout .timeline-resizer {
  display: none;
}

@media (pointer: coarse) {
  .coarse-touch-target,
  .mobile-chrome-button,
  .mobile-tools-close,
  .phone-timeline-toggle {
    min-width: 48px;
    min-height: 48px;
  }
}
```

If Tailwind-generated minimum sizes already win for a specific element, keep this rule as the lower-bound contract and adjust only conflicting selectors.

- [ ] **Step 5: Run regression, type, and production build checks**

Run:

```powershell
node --test tests/desktop-regressions.test.mjs
npm run typecheck
npm run build
```

Expected: all pass with no CSS processing error.

## Task 8: Run the App and Verify Representative Android Viewports

**Files:**

- Modify only if a visual defect is found: `App.tsx`, `components/MobileEditorChrome.tsx`, `components/Timeline.tsx`, `index.css`.

- [ ] **Step 1: Start the app with the installed environment**

Run:

```powershell
npm start
```

Expected: Vite and FastAPI stay running with no startup error.

- [ ] **Step 2: Verify 360x800 portrait**

Open `http://127.0.0.1:5173` at 360x800 and verify:

- desktop top bar is absent;
- tools icon is top-left and opens/closes the full-height drawer;
- stage occupies most of the initial viewport;
- timeline remains at the bottom around 104 px;
- explicit expansion works and closes the tools drawer;
- there is no page-level horizontal scrolling.

- [ ] **Step 3: Verify 412x915 portrait**

Repeat the same flow at 412x915. Drag a performer, select a formation clip, switch 2D/3D, and confirm the state remains selected after expanding/collapsing the timeline.

- [ ] **Step 4: Verify 915x412 landscape**

Use a coarse-pointer/mobile emulation at 915x412. Expected: the stage-first phone composition remains active and the compact timeline uses the 88 px height.

- [ ] **Step 5: Verify 800x1280 tablet**

Expected: existing compact/tablet multi-pane behavior remains; the phone drawer and phone chrome are absent.

- [ ] **Step 6: Verify 1440x900 desktop**

Expected: existing top bar, resizable sidebar, timeline resizer, stage controls, 2D/3D switch, and desktop toolbar behavior remain unchanged.

- [ ] **Step 7: Simulate the Android soft keyboard and back sequence**

At 412x915, focus a lower drawer input and reduce the visual viewport height through mobile emulation. Expected: the input scrolls into view and compact timeline remains visible. Open/close surfaces and verify back order: modal, tools drawer, expanded timeline, then normal navigation.

- [ ] **Step 8: Correct visual defects with a red-green loop**

For every defect, add or tighten a source/unit regression first, run it to observe failure, apply the smallest CSS/React correction, then rerun the focused test. Do not bundle unrelated polish.

## Task 9: Quality Gate and Trellis Completion Review

**Files:**

- Modify: `.trellis/tasks/08-16-mobile-editor-adaptation/prd.md`
- Review: `.trellis/spec/frontend/*.md`, `.trellis/spec/shared/*.md`

- [ ] **Step 1: Run targeted checks from a clean terminal**

Run:

```powershell
node --experimental-strip-types --test tests/adaptive-layout.test.ts
node --test tests/desktop-regressions.test.mjs
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 2: Run the full project quality gate**

Run:

```powershell
npm test
```

Expected: type checking, release tests, backend tests, project service tests, desktop tests, and Vite build all pass in the project-defined order.

- [ ] **Step 3: Run Trellis quality review**

Load `trellis-check` and verify spec compliance, code reuse, React cleanup, TypeScript strictness, touch contracts, desktop preservation, and test coverage. Fix findings with focused red-green cycles and rerun the affected commands.

- [ ] **Step 4: Mark verified acceptance criteria**

In `.trellis/tasks/08-16-mobile-editor-adaptation/prd.md`, change only criteria proven by test output and viewport evidence from `[ ]` to `[x]`. Do not mark unsupported claims.

- [ ] **Step 5: Review whether project specs need an update**

Load `trellis-update-spec`. If the adaptive-layout breakpoint, Android back marker, or mobile drawer convention is reusable project knowledge, add it to the relevant frontend spec; otherwise record that no enduring spec update is needed.

- [ ] **Step 6: Final unstaged handoff**

Run:

```powershell
git status --short
git diff --check
```

Expected: only task-related changes are present and there are no whitespace errors. Leave all files unstaged and report installed services, modified files, verification commands, visual results, and any known limitation.
