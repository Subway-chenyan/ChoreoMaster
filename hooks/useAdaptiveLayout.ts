import { useEffect, useState } from 'react';
import {
  retainAdaptiveLayoutState,
  resolveAdaptiveLayout,
  type AdaptiveLayoutState,
} from '../utils/adaptive-layout';

export type AdaptiveLayout = AdaptiveLayoutState & {
  isPhoneLayout: boolean;
  isCompactLayout: boolean;
};

function readAdaptiveLayout(): AdaptiveLayoutState {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const layoutViewportWidth = window.innerWidth;
  const layoutViewportHeight = window.innerHeight;
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  return {
    mode: resolveAdaptiveLayout({
      width: layoutViewportWidth,
      layoutViewportHeight,
      hasCoarsePointer: isCoarsePointer,
    }),
    viewportHeight,
    layoutViewportWidth,
    layoutViewportHeight,
    isCoarsePointer,
  };
}

function scrollFocusedControlIntoView(): void {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return;
  if (!activeElement.matches('input, textarea, select, [contenteditable="true"]')) return;
  activeElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function useAdaptiveLayout(): AdaptiveLayout {
  const [layout, setLayout] = useState<AdaptiveLayoutState>(readAdaptiveLayout);

  useEffect(() => {
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const visualViewport = window.visualViewport;
    let animationFrame: number | null = null;
    let shouldRevealFocusedControl = false;

    const scheduleUpdate = (revealFocusedControl = false): void => {
      shouldRevealFocusedControl ||= revealFocusedControl;
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        setLayout((previous) => retainAdaptiveLayoutState(previous, readAdaptiveLayout()));
        if (shouldRevealFocusedControl) scrollFocusedControlIntoView();
        shouldRevealFocusedControl = false;
      });
    };
    const handleWindowResize = (): void => scheduleUpdate();
    const handlePointerChange = (): void => scheduleUpdate();
    const handleVisualViewportResize = (): void => scheduleUpdate(true);

    window.addEventListener('resize', handleWindowResize, { passive: true });
    coarsePointer.addEventListener('change', handlePointerChange);
    visualViewport?.addEventListener('resize', handleVisualViewportResize, { passive: true });

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      coarsePointer.removeEventListener('change', handlePointerChange);
      visualViewport?.removeEventListener('resize', handleVisualViewportResize);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return {
    ...layout,
    isPhoneLayout: layout.mode === 'phone',
    isCompactLayout: layout.mode !== 'desktop',
  };
}
