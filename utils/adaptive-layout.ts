export type AdaptiveLayoutMode = 'phone' | 'compact' | 'desktop';

export type AdaptiveLayoutInput = {
  width: number;
  layoutViewportHeight: number;
  hasCoarsePointer: boolean;
};

export type AdaptiveLayoutState = {
  mode: AdaptiveLayoutMode;
  viewportHeight: number;
  layoutViewportWidth: number;
  layoutViewportHeight: number;
  isCoarsePointer: boolean;
};

export type MobileBackState = {
  hasTransitionEditor: boolean;
  hasModal: boolean;
  isToolsOpen: boolean;
  isTimelineExpanded: boolean;
};

export type MobileBackAction = 'close-transition' | 'close-modal' | 'close-tools' | 'collapse-timeline' | 'navigate';

const MOBILE_HISTORY_STATE_KEY = 'cosStageMobileEditor';

export type MobileHistoryAdapter = {
  readonly state: unknown;
  pushState: (state: unknown, unused: string) => void;
  back: () => void;
};

export type MobileHistoryMarkerController = {
  sync: (state: { enabled: boolean; hasClosableLayer: boolean }) => void;
  handlePopState: () => boolean;
  release: () => void;
};

export type PhoneTimelineHeightInput = {
  density: 'compact' | 'expanded';
  viewportWidth: number;
  viewportHeight: number;
  visualViewportHeight: number;
};

export type TimelineBounds = {
  top: number;
  bottom: number;
};

export type CompactPhoneTimelineGeometry = {
  panelHeight: number;
  toolbarVisual: TimelineBounds;
  toolbarHit: TimelineBounds;
  trackVisual: TimelineBounds;
  trackHit: TimelineBounds;
  clipVisual: TimelineBounds;
  hitOverlap: number;
};

export type FocusTrapTargetInput = {
  activeIndex: number;
  focusableCount: number;
  shiftKey: boolean;
};

export type FocusabilitySnapshot = {
  isDisabled: boolean;
  inputType: string | null;
  hasHiddenAncestor: boolean;
  hasInertAncestor: boolean;
  hasAriaHiddenAncestor: boolean;
  display: string;
  visibility: string;
  hasClientRects: boolean;
};

export function resolveAdaptiveLayout({
  width,
  layoutViewportHeight,
  hasCoarsePointer,
}: AdaptiveLayoutInput): AdaptiveLayoutMode {
  if (width < 600 || (hasCoarsePointer && layoutViewportHeight < 480)) {
    return 'phone';
  }
  return width <= 1100 ? 'compact' : 'desktop';
}

export function retainAdaptiveLayoutState(
  previous: AdaptiveLayoutState,
  measured: AdaptiveLayoutState,
): AdaptiveLayoutState {
  return previous.mode === measured.mode
    && previous.viewportHeight === measured.viewportHeight
    && previous.layoutViewportWidth === measured.layoutViewportWidth
    && previous.layoutViewportHeight === measured.layoutViewportHeight
    && previous.isCoarsePointer === measured.isCoarsePointer
    ? previous
    : measured;
}

export function resolveMobileBackAction({
  hasTransitionEditor,
  hasModal,
  isToolsOpen,
  isTimelineExpanded,
}: MobileBackState): MobileBackAction {
  if (hasModal) return 'close-modal';
  if (isToolsOpen) return 'close-tools';
  if (hasTransitionEditor) return 'close-transition';
  if (isTimelineExpanded) return 'collapse-timeline';
  return 'navigate';
}

function hasMobileHistoryMarker(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false;
  return Reflect.has(state, MOBILE_HISTORY_STATE_KEY);
}

export function createMobileHistoryMarkerController(
  history: MobileHistoryAdapter,
  markerId: string,
): MobileHistoryMarkerController {
  let markerActive = hasMobileHistoryMarker(history.state);
  let suppressNextPopState = false;

  const removeMarker = (): void => {
    if (!markerActive) return;
    const isCurrentEntry = hasMobileHistoryMarker(history.state);
    markerActive = false;
    if (!isCurrentEntry) return;
    suppressNextPopState = true;
    history.back();
  };

  return {
    sync: ({ enabled, hasClosableLayer }): void => {
      if (!enabled || !hasClosableLayer) {
        removeMarker();
        return;
      }
      if (markerActive || suppressNextPopState) return;
      const existingState = typeof history.state === 'object' && history.state !== null
        ? history.state
        : {};
      history.pushState({ ...existingState, [MOBILE_HISTORY_STATE_KEY]: markerId }, '');
      markerActive = true;
    },
    handlePopState: (): boolean => {
      if (suppressNextPopState) {
        suppressNextPopState = false;
        return false;
      }
      if (!markerActive) return false;
      markerActive = false;
      return true;
    },
    release: removeMarker,
  };
}

export function resolvePhoneTimelineHeight({
  density,
  viewportWidth,
  viewportHeight,
  visualViewportHeight,
}: PhoneTimelineHeightInput): number {
  if (density === 'compact') {
    return viewportWidth > viewportHeight ? 88 : 104;
  }
  return Math.min(360, Math.max(220, Math.round(visualViewportHeight * 0.44)));
}

export function resolvePhoneTimelinePanelHeight(contentHeight: number, safeBottom: number): number {
  return Math.max(0, Math.round(contentHeight)) + Math.max(0, Math.round(safeBottom));
}

export function resolveFocusTrapTargetIndex({
  activeIndex,
  focusableCount,
  shiftKey,
}: FocusTrapTargetInput): number | null {
  if (focusableCount <= 0) return null;
  if (activeIndex < 0) return shiftKey ? focusableCount - 1 : 0;
  if (shiftKey && activeIndex === 0) return focusableCount - 1;
  if (!shiftKey && activeIndex === focusableCount - 1) return 0;
  return null;
}

export function isRenderedFocusabilitySnapshot({
  isDisabled,
  inputType,
  hasHiddenAncestor,
  hasInertAncestor,
  hasAriaHiddenAncestor,
  display,
  visibility,
  hasClientRects,
}: FocusabilitySnapshot): boolean {
  return !isDisabled
    && inputType !== 'hidden'
    && !hasHiddenAncestor
    && !hasInertAncestor
    && !hasAriaHiddenAncestor
    && display !== 'none'
    && visibility !== 'hidden'
    && visibility !== 'collapse'
    && hasClientRects;
}

export function resolveCompactPhoneTimelineGeometry(panelHeight: number): CompactPhoneTimelineGeometry {
  const normalizedPanelHeight = Math.max(0, Math.round(panelHeight));
  const toolbarVisual: TimelineBounds = {
    top: 0,
    bottom: Math.min(40, normalizedPanelHeight),
  };
  const toolbarHit: TimelineBounds = {
    top: 0,
    bottom: Math.min(48, normalizedPanelHeight),
  };
  const trackVisual: TimelineBounds = {
    top: toolbarVisual.bottom,
    bottom: normalizedPanelHeight,
  };
  const trackVisualHeight = Math.max(0, trackVisual.bottom - trackVisual.top);
  const clipVisualHeight = Math.min(32, trackVisualHeight);
  const clipVisualTop = trackVisual.top + Math.max(0, (trackVisualHeight - clipVisualHeight) / 2);
  const clipVisual: TimelineBounds = {
    top: clipVisualTop,
    bottom: clipVisualTop + clipVisualHeight,
  };
  const trackHitCenter = clipVisual.top + (clipVisualHeight / 2);
  const trackHit: TimelineBounds = {
    top: Math.max(trackVisual.top, trackHitCenter - 24),
    bottom: Math.min(trackVisual.bottom, trackHitCenter + 24),
  };
  const hitOverlap = Math.max(
    0,
    Math.min(toolbarHit.bottom, trackHit.bottom) - Math.max(toolbarHit.top, trackHit.top),
  );

  return {
    panelHeight: normalizedPanelHeight,
    toolbarVisual,
    toolbarHit,
    trackVisual,
    trackHit,
    clipVisual,
    hitOverlap,
  };
}
