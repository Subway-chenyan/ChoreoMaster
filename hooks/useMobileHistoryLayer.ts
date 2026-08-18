import { useEffect, useRef } from 'react';
import {
  createMobileHistoryMarkerController,
  resolveMobileBackAction,
  type MobileHistoryMarkerController,
} from '../utils/adaptive-layout';

export type MobileHistoryLayerOptions = {
  enabled: boolean;
  hasTransitionEditor: boolean;
  hasModal: boolean;
  isToolsOpen: boolean;
  isTimelineExpanded: boolean;
  onCloseTransition: () => void;
  onCloseModal: () => void;
  onCloseTools: () => void;
  onCollapseTimeline: () => void;
};

export function useMobileHistoryLayer(options: MobileHistoryLayerOptions): void {
  const latestOptionsRef = useRef(options);
  const markerIdRef = useRef(`mobile-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const controllerRef = useRef<MobileHistoryMarkerController | null>(null);

  useEffect(() => {
    latestOptionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const controller = controllerRef.current
      ?? createMobileHistoryMarkerController(window.history, markerIdRef.current);
    controllerRef.current = controller;
    const handlePopState = (): void => {
      const latest = latestOptionsRef.current;
      if (!controller.handlePopState()) {
        controller.sync({
          enabled: latest.enabled,
          hasClosableLayer: latest.hasTransitionEditor || latest.hasModal || latest.isToolsOpen || latest.isTimelineExpanded,
        });
        return;
      }
      const action = resolveMobileBackAction({
        hasTransitionEditor: latest.hasTransitionEditor,
        hasModal: latest.hasModal,
        isToolsOpen: latest.isToolsOpen,
        isTimelineExpanded: latest.isTimelineExpanded,
      });
      switch (action) {
        case 'close-transition':
          latest.onCloseTransition();
          break;
        case 'close-modal':
          latest.onCloseModal();
          break;
        case 'close-tools':
          latest.onCloseTools();
          break;
        case 'collapse-timeline':
          latest.onCollapseTimeline();
          break;
        case 'navigate':
          break;
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      controller.release();
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.sync({
      enabled: options.enabled,
      hasClosableLayer: options.hasTransitionEditor || options.hasModal || options.isToolsOpen || options.isTimelineExpanded,
    });
  }, [options.enabled, options.hasModal, options.hasTransitionEditor, options.isTimelineExpanded, options.isToolsOpen]);
}
