import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMobileHistoryMarkerController,
  isRenderedFocusabilitySnapshot,
  resolveAdaptiveLayout,
  resolveCompactPhoneTimelineGeometry,
  resolveMobileBackAction,
  resolvePhoneTimelineHeight,
  resolvePhoneTimelinePanelHeight,
  resolveFocusTrapTargetIndex,
  retainAdaptiveLayoutState,
  type MobileHistoryAdapter,
} from '../utils/adaptive-layout.ts';

function boundsHeight(bounds: { top: number; bottom: number }): number {
  return bounds.bottom - bounds.top;
}

test('phone layout follows compact width and coarse-pointer compact height', () => {
  assert.equal(resolveAdaptiveLayout({ width: 599, layoutViewportHeight: 900, hasCoarsePointer: false }), 'phone');
  assert.equal(resolveAdaptiveLayout({ width: 915, layoutViewportHeight: 479, hasCoarsePointer: true }), 'phone');
  assert.equal(resolveAdaptiveLayout({ width: 915, layoutViewportHeight: 479, hasCoarsePointer: false }), 'compact');
});

test('keyboard-reduced visual height does not turn a coarse tablet into a phone', () => {
  assert.equal(resolveAdaptiveLayout({
    width: 800,
    layoutViewportHeight: 1280,
    hasCoarsePointer: true,
  }), 'compact');
  assert.equal(resolveAdaptiveLayout({
    width: 915,
    layoutViewportHeight: 479,
    hasCoarsePointer: true,
  }), 'phone');
});

test('compact and desktop boundaries preserve tablet and desktop layouts', () => {
  assert.equal(resolveAdaptiveLayout({ width: 600, layoutViewportHeight: 480, hasCoarsePointer: true }), 'compact');
  assert.equal(resolveAdaptiveLayout({ width: 800, layoutViewportHeight: 1280, hasCoarsePointer: true }), 'compact');
  assert.equal(resolveAdaptiveLayout({ width: 1100, layoutViewportHeight: 900, hasCoarsePointer: false }), 'compact');
  assert.equal(resolveAdaptiveLayout({ width: 1101, layoutViewportHeight: 900, hasCoarsePointer: false }), 'desktop');
  assert.equal(resolveAdaptiveLayout({ width: 1440, layoutViewportHeight: 900, hasCoarsePointer: false }), 'desktop');
});

test('mobile back action closes the topmost editor surface first', () => {
  assert.equal(resolveMobileBackAction({ hasTransitionEditor: true, hasModal: true, isToolsOpen: true, isTimelineExpanded: true }), 'close-modal');
  assert.equal(resolveMobileBackAction({ hasTransitionEditor: true, hasModal: false, isToolsOpen: true, isTimelineExpanded: true }), 'close-tools');
  assert.equal(resolveMobileBackAction({ hasTransitionEditor: true, hasModal: false, isToolsOpen: false, isTimelineExpanded: true }), 'close-transition');
  assert.equal(resolveMobileBackAction({ hasTransitionEditor: false, hasModal: true, isToolsOpen: true, isTimelineExpanded: true }), 'close-modal');
  assert.equal(resolveMobileBackAction({ hasTransitionEditor: false, hasModal: false, isToolsOpen: true, isTimelineExpanded: true }), 'close-tools');
  assert.equal(resolveMobileBackAction({ hasTransitionEditor: false, hasModal: false, isToolsOpen: false, isTimelineExpanded: true }), 'collapse-timeline');
  assert.equal(resolveMobileBackAction({ hasTransitionEditor: false, hasModal: false, isToolsOpen: false, isTimelineExpanded: false }), 'navigate');
});

test('manual last-layer close and phone disable remove the scoped history marker', async (t) => {
  for (const cleanup of ['manual-close', 'disable-phone'] as const) {
    await t.test(cleanup, () => {
      const entries: unknown[] = [{ route: 'previous' }, { route: 'editor' }];
      let currentIndex = 1;
      let closeCalls = 0;
      let handlePopState = (): void => {};
      const history: MobileHistoryAdapter = {
        get state(): unknown {
          return entries[currentIndex];
        },
        pushState(state: unknown): void {
          entries.splice(currentIndex + 1, entries.length, state);
          currentIndex += 1;
        },
        back(): void {
          if (currentIndex === 0) return;
          currentIndex -= 1;
          handlePopState();
        },
      };
      const controller = createMobileHistoryMarkerController(history, `marker-${cleanup}`);
      handlePopState = () => {
        if (controller.handlePopState()) closeCalls += 1;
      };

      controller.sync({ enabled: true, hasClosableLayer: true });
      assert.equal(currentIndex, 2);

      controller.sync({
        enabled: cleanup !== 'disable-phone',
        hasClosableLayer: cleanup !== 'manual-close',
      });
      assert.equal(currentIndex, 1);
      assert.equal(closeCalls, 0);

      history.back();
      assert.equal(currentIndex, 0);
      assert.equal(closeCalls, 0);
    });
  }
});

test('remounted history controller adopts a stale CosStage marker without stacking another entry', () => {
  const entries: unknown[] = [{ route: 'editor' }];
  let currentIndex = 0;
  let handlePopState = (): void => {};
  const history: MobileHistoryAdapter = {
    get state(): unknown {
      return entries[currentIndex];
    },
    pushState(state: unknown): void {
      entries.splice(currentIndex + 1, entries.length, state);
      currentIndex += 1;
    },
    back(): void {
      if (currentIndex === 0) return;
      currentIndex -= 1;
      handlePopState();
    },
  };

  const previousController = createMobileHistoryMarkerController(history, 'marker-before-reload');
  previousController.sync({ enabled: true, hasClosableLayer: true });
  assert.equal(currentIndex, 1);

  const remountedController = createMobileHistoryMarkerController(history, 'marker-after-reload');
  let consumedBack = false;
  handlePopState = () => {
    consumedBack = remountedController.handlePopState();
  };
  remountedController.sync({ enabled: true, hasClosableLayer: true });

  assert.equal(entries.length, 2);
  assert.equal(currentIndex, 1);
  history.back();
  assert.equal(consumedBack, true);
  assert.equal(currentIndex, 0);
});

test('phone timeline uses fixed compact heights and clamped expanded height', () => {
  assert.equal(resolvePhoneTimelineHeight({
    density: 'compact',
    viewportWidth: 360,
    viewportHeight: 800,
    visualViewportHeight: 320,
  }), 104);
  assert.equal(resolvePhoneTimelineHeight({
    density: 'compact',
    viewportWidth: 430,
    viewportHeight: 360,
    visualViewportHeight: 320,
  }), 88);
  assert.equal(resolvePhoneTimelineHeight({
    density: 'compact',
    viewportWidth: 599,
    viewportHeight: 400,
    visualViewportHeight: 400,
  }), 88);
  assert.equal(resolvePhoneTimelineHeight({
    density: 'expanded',
    viewportWidth: 360,
    viewportHeight: 800,
    visualViewportHeight: 412,
  }), 220);
  assert.equal(resolvePhoneTimelineHeight({
    density: 'expanded',
    viewportWidth: 360,
    viewportHeight: 800,
    visualViewportHeight: 800,
  }), 352);
  assert.equal(resolvePhoneTimelineHeight({
    density: 'expanded',
    viewportWidth: 412,
    viewportHeight: 915,
    visualViewportHeight: 915,
  }), 360);
});

test('88px compact timeline keeps toolbar and track hit geometry inside the panel', () => {
  const geometry = resolveCompactPhoneTimelineGeometry(88);

  assert.deepEqual(geometry.toolbarVisual, { top: 0, bottom: 40 });
  assert.deepEqual(geometry.toolbarHit, { top: 0, bottom: 48 });
  assert.deepEqual(geometry.trackVisual, { top: 40, bottom: 88 });
  assert.deepEqual(geometry.trackHit, { top: 40, bottom: 88 });
  assert.equal(boundsHeight(geometry.toolbarHit), 48);
  assert.equal(boundsHeight(geometry.trackHit), 48);
  assert.ok(geometry.toolbarHit.top >= 0 && geometry.toolbarHit.bottom <= 88);
  assert.ok(geometry.trackHit.top >= 0 && geometry.trackHit.bottom <= 88);
  assert.equal(geometry.hitOverlap, 8);
  assert.ok(geometry.hitOverlap <= 8);

  const portraitGeometry = resolveCompactPhoneTimelineGeometry(104);
  assert.equal(boundsHeight(portraitGeometry.trackVisual), 64);
  assert.ok(boundsHeight(portraitGeometry.trackHit) >= 48);
  assert.ok(portraitGeometry.trackHit.bottom <= 104);
});

test('safe bottom extends the panel without shrinking compact timeline content geometry', () => {
  const contentGeometry = resolveCompactPhoneTimelineGeometry(88);

  assert.equal(boundsHeight(contentGeometry.trackHit), 48);
  assert.equal(resolvePhoneTimelinePanelHeight(contentGeometry.panelHeight, 24), 112);
});

test('drawer focus trap wraps at both edges and captures focus entering from outside', () => {
  assert.equal(resolveFocusTrapTargetIndex({ activeIndex: 2, focusableCount: 3, shiftKey: false }), 0);
  assert.equal(resolveFocusTrapTargetIndex({ activeIndex: 0, focusableCount: 3, shiftKey: true }), 2);
  assert.equal(resolveFocusTrapTargetIndex({ activeIndex: 1, focusableCount: 3, shiftKey: false }), null);
  assert.equal(resolveFocusTrapTargetIndex({ activeIndex: -1, focusableCount: 3, shiftKey: false }), 0);
  assert.equal(resolveFocusTrapTargetIndex({ activeIndex: -1, focusableCount: 3, shiftKey: true }), 2);
  assert.equal(resolveFocusTrapTargetIndex({ activeIndex: -1, focusableCount: 0, shiftKey: false }), null);
});

test('drawer focus candidates exclude controls that are not actually rendered or operable', () => {
  const renderedControl = {
    isDisabled: false,
    inputType: null,
    hasHiddenAncestor: false,
    hasInertAncestor: false,
    hasAriaHiddenAncestor: false,
    display: 'block',
    visibility: 'visible',
    hasClientRects: true,
  };

  assert.equal(isRenderedFocusabilitySnapshot(renderedControl), true);
  for (const excludedState of [
    { isDisabled: true },
    { inputType: 'hidden' },
    { hasHiddenAncestor: true },
    { hasInertAncestor: true },
    { hasAriaHiddenAncestor: true },
    { display: 'none' },
    { visibility: 'hidden' },
    { visibility: 'collapse' },
    { hasClientRects: false },
  ]) {
    assert.equal(isRenderedFocusabilitySnapshot({ ...renderedControl, ...excludedState }), false);
  }
});

test('adaptive viewport state retains its previous reference when measured values are unchanged', () => {
  const previous = {
    mode: 'phone' as const,
    viewportHeight: 412,
    layoutViewportWidth: 915,
    layoutViewportHeight: 412,
    isCoarsePointer: true,
  };
  const equalMeasurement = { ...previous };
  const changedMeasurement = { ...previous, viewportHeight: 220 };

  assert.equal(retainAdaptiveLayoutState(previous, equalMeasurement), previous);
  assert.equal(retainAdaptiveLayoutState(previous, changedMeasurement), changedMeasurement);
});
