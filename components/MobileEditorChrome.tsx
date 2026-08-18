import React, { useEffect, useRef, type RefObject } from 'react';
import { PanelLeftOpen, Pause, Play, SlidersHorizontal } from 'lucide-react';
import {
  isRenderedFocusabilitySnapshot,
  resolveFocusTrapTargetIndex,
} from '../utils/adaptive-layout';

export const MOBILE_TOOLS_DRAWER_ID = 'mobile-tools-drawer';
export const MOBILE_TOOLS_DRAWER_LABEL_ID = 'mobile-tools-drawer-label';

type MobileToolsDialogBindings = {
  triggerRef: RefObject<HTMLButtonElement | null>;
  drawerRef: RefObject<HTMLDivElement | null>;
  backgroundRef: RefObject<HTMLDivElement | null>;
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => {
      const computedStyle = window.getComputedStyle(element);
      return isRenderedFocusabilitySnapshot({
        isDisabled: element.matches(':disabled') || element.hasAttribute('disabled'),
        inputType: element instanceof HTMLInputElement ? element.type : null,
        hasHiddenAncestor: element.closest('[hidden]') !== null,
        hasInertAncestor: element.closest('[inert]') !== null,
        hasAriaHiddenAncestor: element.closest('[aria-hidden="true"]') !== null,
        display: computedStyle.display,
        visibility: computedStyle.visibility,
        hasClientRects: element.getClientRects().length > 0,
      });
    });
}

export function useMobileToolsDialog(isOpen: boolean): MobileToolsDialogBindings {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const drawerElement = drawerRef.current;
    const backgroundElement = backgroundRef.current;
    const triggerElement = triggerRef.current;
    if (!drawerElement || !backgroundElement) return;

    const wasInert = backgroundElement.inert;
    const previousAriaHidden = backgroundElement.getAttribute('aria-hidden');
    backgroundElement.inert = true;
    backgroundElement.setAttribute('aria-hidden', 'true');

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const focusableElements = getFocusableElements(drawerElement);
      const activeIndex = focusableElements.findIndex((element) => element === document.activeElement);
      const targetIndex = resolveFocusTrapTargetIndex({
        activeIndex,
        focusableCount: focusableElements.length,
        shiftKey: event.shiftKey,
      });
      if (targetIndex === null) return;
      event.preventDefault();
      focusableElements[targetIndex]?.focus();
    };

    drawerElement.addEventListener('keydown', handleKeyDown);
    const firstFocusableElement = getFocusableElements(drawerElement)[0];
    (firstFocusableElement ?? drawerElement).focus();

    return () => {
      drawerElement.removeEventListener('keydown', handleKeyDown);
      backgroundElement.inert = wasInert;
      if (previousAriaHidden === null) {
        backgroundElement.removeAttribute('aria-hidden');
      } else {
        backgroundElement.setAttribute('aria-hidden', previousAriaHidden);
      }
      triggerElement?.focus();
    };
  }, [isOpen]);

  return { triggerRef, drawerRef, backgroundRef };
}

type MobileEditorChromeProps = {
  isPlaying: boolean;
  viewMode: '2d' | '3d';
  isToolsOpen: boolean;
  isStageSettingsOpen: boolean;
  toolsButtonRef: RefObject<HTMLButtonElement | null>;
  onOpenTools: () => void;
  onPlayPause: () => void;
  onToggleViewMode: () => void;
  onToggleStageSettings: () => void;
};

export function MobileEditorChrome({
  isPlaying,
  viewMode,
  isToolsOpen,
  isStageSettingsOpen,
  toolsButtonRef,
  onOpenTools,
  onPlayPause,
  onToggleViewMode,
  onToggleStageSettings,
}: MobileEditorChromeProps): React.ReactElement {
  return (
    <div className="mobile-editor-chrome pointer-events-none absolute inset-x-0 top-0 z-[60] flex items-start justify-between">
      <button
        ref={toolsButtonRef}
        type="button"
        className="mobile-editor-chrome__touch-target pointer-events-auto flex items-center justify-center rounded-xl border border-slate-600/70 bg-slate-950/80 text-slate-100 shadow-lg backdrop-blur"
        onClick={onOpenTools}
        aria-label="打开完整工具面板"
        aria-expanded={isToolsOpen}
        aria-controls={MOBILE_TOOLS_DRAWER_ID}
      >
        <PanelLeftOpen size={18} />
      </button>
      <div className="pointer-events-auto flex items-center rounded-xl border border-slate-600/70 bg-slate-950/80 shadow-lg backdrop-blur">
        <button
          type="button"
          className="mobile-editor-chrome__touch-target flex items-center justify-center text-slate-100"
          onClick={onPlayPause}
          aria-label={isPlaying ? '暂停播放' : '开始播放'}
        >
          {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <button
          type="button"
          className="mobile-editor-chrome__touch-target flex items-center justify-center text-sm text-slate-100"
          onClick={onToggleViewMode}
          aria-label={viewMode === '2d' ? '切换到 3D 视图' : '切换到 2D 视图'}
        >
          {viewMode === '2d' ? '3D' : '2D'}
        </button>
        <button
          type="button"
          className={`mobile-editor-chrome__touch-target flex items-center justify-center ${isStageSettingsOpen ? 'text-blue-300' : 'text-slate-100'}`}
          onClick={onToggleStageSettings}
          aria-label={isStageSettingsOpen ? '关闭舞台设置' : '打开舞台设置'}
          aria-pressed={isStageSettingsOpen}
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}
