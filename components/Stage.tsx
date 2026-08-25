
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Performer, Position, SelectionBox, ToolMode, PerformerGroup, StageConfig, TransitionPathDisplay } from '../types';
import {
  getStageXBounds,
  getTotalStageWidth,
  getWingWidth,
  stageXToViewPercent,
  viewPercentToStageX,
} from '../utils/coordinates';
import { buildPlatformOccupancy, isPlatformProp } from '../utils/platforms';
import { getPropCenterFromAnchor } from '../utils/prop-pivot';
import {
  createCenteredStageGridMarks,
  formatStageGridLabel,
  shouldShowStageGridLabels,
  snapStagePosition,
  STAGE_THIRD_POSITIONS,
} from '../utils/stage-grid';
import { getLedStageYPercent, resolveStageBackgroundUrl } from '../utils/stage-config';
import { getPerformerDimensions, getStageLabelFontSize } from '../electron/stage-defaults';

interface StageProps {
  performers: Performer[];
  performerGroups?: PerformerGroup[];
  lockedPerformerIds?: string[];
  hiddenGroupIds?: string[]; // IDs of groups hidden in current frame
  positions: Record<string, Position>;
  rotations?: Record<string, number>;
  transitionPaths?: TransitionPathDisplay[];
  selectedPerformerIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onPositionChange: (updates: { id: string; pos: Position }[]) => void;
  onTransitionControlPointChange?: (index: number, pos: Position) => void;
  onTransitionStartPointChange?: (pos: Position) => void;
  onTransitionObjectSelect?: (performerId: string) => void;
  onRotationStart?: (performerId: string) => void;
  onRotationChange?: (performerId: string, rotation: number) => void;
  onRotationEnd?: (performerId: string, rotation: number) => void;
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: (ids: string[], finalUpdates?: { id: string; pos: Position }[]) => void;
  onUpdatePerformer?: (id: string, updates: Partial<Performer>) => void;
  readonly?: boolean;
  mode?: ToolMode;
  showLabels?: boolean;
  showDirectionArrows?: boolean;
  gridScale?: number;
  snapToGrid?: boolean;
  onZoom?: (delta: number) => void;
  stageConfig: StageConfig;
  mediaCache?: Record<string, string>;
  onOpenNoteDrawer?: (performerId: string) => void;
  onPerformerContextMenu?: (performerId: string) => void;
}

const ShapeIcon: React.FC<{ shape: string; color: string; width: number | string; height: number | string; className?: string }> = ({ shape, color, width, height, className }) => {
  const style = { fill: color, stroke: 'white', strokeWidth: 2 };

  if (shape === 'square') {
    return (
      <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <rect x="4" y="4" width="16" height="16" style={style} />
      </svg>
    );
  }
  if (shape === 'triangle') {
    return (
      <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <polygon points="12,4 20,20 4,20" style={style} />
      </svg>
    );
  }
  // Default Circle
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9" style={style} />
    </svg>
  );
};

const DirectionArrow: React.FC = () => (
  <svg
    data-direction-arrow
    aria-hidden="true"
    viewBox="0 0 32 44"
    className="pointer-events-none absolute bottom-[-16px] left-1/2 z-20 h-11 w-8 -translate-x-1/2 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]"
  >
    <path
      d="M16 4v28"
      stroke="#ffffff"
      strokeWidth="5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M5 24l11 16 11-16z"
      fill="#ffffff"
      stroke="#0f172a"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);

interface DragState {
  startX: number;
  startY: number;
  initialPositions: Record<string, Position>;
}

interface PanState {
  startX: number;
  startY: number;
  initialOffsetX: number;
  initialOffsetY: number;
}

interface SelectionBoxStyle {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TransitionStartDragState {
  startClientX: number;
  startClientY: number;
  initialPosition: Position;
}

interface RotationDragState {
  performerId: string;
  startClientX: number;
  startClientY: number;
}

function getPolygonClipPath(points: { x: number; y: number }[] | undefined): string | undefined {
  if (!points || points.length < 3) return undefined;
  return `polygon(${points.map(p =>
    `${Math.max(0, Math.min(100, p.x * 100))}% ${Math.max(0, Math.min(100, p.y * 100))}%`
  ).join(', ')})`;
}

export const Stage: React.FC<StageProps> = ({
  performers,
  performerGroups = [],
  lockedPerformerIds = [],
  hiddenGroupIds = [],
  positions,
  rotations = {},
  transitionPaths = [],
  selectedPerformerIds,
  onSelectionChange,
  onPositionChange,
  onTransitionControlPointChange,
  onTransitionStartPointChange,
  onTransitionObjectSelect,
  onRotationStart,
  onRotationChange,
  onRotationEnd,
  onDragStart,
  onDragEnd,
  onUpdatePerformer,
  readonly = false,
  mode = ToolMode.SELECT,
  showLabels = true,
  showDirectionArrows = true,
  gridScale = 1,
  snapToGrid = false,
  onZoom,
  stageConfig,
  mediaCache = {},
  onOpenNoteDrawer,
  onPerformerContextMenu,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [availableSize, setAvailableSize] = useState({ width: 0, height: 0 });
  const [viewportScale, setViewportScale] = useState(1);
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const stageXBounds = useMemo(() => getStageXBounds(stageConfig), [stageConfig]);
  const lockedPerformerIdSet = useMemo(() => new Set(lockedPerformerIds), [lockedPerformerIds]);
  const wingWidth = getWingWidth(stageConfig);
  const totalStageWidth = getTotalStageWidth(stageConfig);
  const gridMarks = useMemo(
    () => createCenteredStageGridMarks(totalStageWidth, gridScale),
    [gridScale, totalStageWidth],
  );
  const depthGridMarks = useMemo(
    () => createCenteredStageGridMarks(stageConfig.depth, gridScale),
    [gridScale, stageConfig.depth],
  );
  const showGridLabels = shouldShowStageGridLabels(gridScale);

  const getDragUpdates = (clientX: number, clientY: number, state: DragState): { id: string; pos: Position }[] => {
    if (!stageRef.current) return [];
    const rect = stageRef.current.getBoundingClientRect();
    const deltaXPx = clientX - state.startX;
    const deltaYPx = clientY - state.startY;
    const deltaX = (deltaXPx / rect.width) * (stageXBounds.max - stageXBounds.min);
    const deltaY = (deltaYPx / rect.height) * 100;

    return Object.entries(state.initialPositions).map(([id, initialPos]) => ({
      id,
      pos: {
        x: Math.max(stageXBounds.min, Math.min(stageXBounds.max, initialPos.x + deltaX)),
        y: Math.max(0, Math.min(100, initialPos.y + deltaY)),
      },
    }));
  };
  const leftMainEdge = stageXToViewPercent(0, stageConfig);
  const rightMainEdge = stageXToViewPercent(100, stageConfig);
  const visualAspectRatio = totalStageWidth / stageConfig.depth;
  const backgroundUrl = resolveStageBackgroundUrl(stageConfig, mediaCache);
  const showStageLines = stageConfig.showStageLines !== false;
  const ledTop = getLedStageYPercent(stageConfig);
  const ledWidthPercent = Math.min(100, ((stageConfig.ledWidth ?? stageConfig.width) / totalStageWidth) * 100);
  const fittedSize = useMemo(() => {
    if (availableSize.width <= 0 || availableSize.height <= 0) {
      return { width: 0, height: 0 };
    }
    let width = Math.min(1200, availableSize.width);
    let height = width / visualAspectRatio;
    if (height > availableSize.height) {
      height = availableSize.height;
      width = height * visualAspectRatio;
    }
    return { width, height };
  }, [availableSize, visualAspectRatio]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const styles = window.getComputedStyle(container);
      const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      setAvailableSize({
        width: Math.max(0, container.clientWidth - horizontalPadding),
        height: Math.max(0, container.clientHeight - verticalPadding),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  interface ResizeState {
    id: string;
    startClientX: number;
    startClientY: number;
    startWidth: number;
    startHeight: number;
    handle: 'nw' | 'ne' | 'sw' | 'se';
  }
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [controlPointDragIndex, setControlPointDragIndex] = useState<number | null>(null);
  const [startPointDragState, setStartPointDragState] = useState<TransitionStartDragState | null>(null);
  const [rotationDragState, setRotationDragState] = useState<RotationDragState | null>(null);
  const rotationLastAngleRef = useRef<number | null>(null);
  const selectedTransitionPath = transitionPaths.find((path) => path.isSelected) ?? null;

  // Filter performers based on group visibility in current frame
  const visiblePerformers = useMemo(() => {
    return performers.filter(performer => {
      if (!performer.groupId) return true; // Ungrouped performers are always visible
      return !hiddenGroupIds.includes(performer.groupId); // Hide if group is in hiddenGroupIds
    });
  }, [performers, hiddenGroupIds]);
  const platformOccupancy = useMemo(
    () => buildPlatformOccupancy(visiblePerformers, positions, stageConfig),
    [visiblePerformers, positions, stageConfig],
  );

  // Convert client coordinates to percentage relative to stage
  const getPercentagePos = (clientX: number, clientY: number) => {
    if (!stageRef.current) return { x: 0, y: 0 };
    const rect = stageRef.current.getBoundingClientRect();
    const x = viewPercentToStageX(((clientX - rect.left) / rect.width) * 100, stageConfig);
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x, y };
  };

  useEffect(() => {
    if (controlPointDragIndex === null || !selectedTransitionPath || !onTransitionControlPointChange || readonly) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const nextPos = getPercentagePos(event.clientX, event.clientY);
      const currentControlPoint = selectedTransitionPath.controlPoints[controlPointDragIndex];
      onTransitionControlPointChange(controlPointDragIndex, {
        x: Math.max(stageXBounds.min, Math.min(stageXBounds.max, nextPos.x)),
        y: Math.max(0, Math.min(100, nextPos.y)),
        ...(currentControlPoint?.z !== undefined ? { z: currentControlPoint.z } : {}),
      });
    };

    const handlePointerUp = () => {
      setControlPointDragIndex(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [controlPointDragIndex, getPercentagePos, onTransitionControlPointChange, readonly, selectedTransitionPath, stageXBounds.max, stageXBounds.min]);

  useEffect(() => {
    if (!startPointDragState || !selectedTransitionPath || !onTransitionStartPointChange || readonly) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const movement = Math.hypot(
        event.clientX - startPointDragState.startClientX,
        event.clientY - startPointDragState.startClientY,
      );
      if (movement < 3) return;
      const nextPos = getPercentagePos(event.clientX, event.clientY);
      onTransitionStartPointChange({
        x: Math.max(stageXBounds.min, Math.min(stageXBounds.max, nextPos.x)),
        y: Math.max(0, Math.min(100, nextPos.y)),
        ...(startPointDragState.initialPosition.z !== undefined ? { z: startPointDragState.initialPosition.z } : {}),
      });
    };

    const handlePointerUp = () => {
      setStartPointDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [
    getPercentagePos,
    onTransitionStartPointChange,
    readonly,
    selectedTransitionPath,
    startPointDragState,
    stageXBounds.max,
    stageXBounds.min,
  ]);

  useEffect(() => {
    if (!rotationDragState || readonly || !onRotationChange) return undefined;
    const getRotationAngle = (event: PointerEvent): number | null => {
      const element = stageRef.current?.querySelector<HTMLElement>(`[data-performer-id="${rotationDragState.performerId}"]`);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return (Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI) - 90;
    };
    const handleRotationMove = (event: PointerEvent) => {
      const movement = Math.hypot(
        event.clientX - rotationDragState.startClientX,
        event.clientY - rotationDragState.startClientY,
      );
      if (movement < 3) return;
      const angle = getRotationAngle(event);
      if (angle === null) return;
      rotationLastAngleRef.current = angle;
      onRotationChange(rotationDragState.performerId, angle);
    };
    const handleRotationEnd = (event: PointerEvent) => {
      if (rotationLastAngleRef.current !== null && onRotationEnd) {
        const angle = event.type === 'pointerup'
          ? getRotationAngle(event) ?? rotationLastAngleRef.current
          : rotationLastAngleRef.current;
        onRotationEnd(rotationDragState.performerId, angle);
      }
      rotationLastAngleRef.current = null;
      setRotationDragState(null);
    };
    window.addEventListener('pointermove', handleRotationMove);
    window.addEventListener('pointerup', handleRotationEnd);
    window.addEventListener('pointercancel', handleRotationEnd);
    return () => {
      window.removeEventListener('pointermove', handleRotationMove);
      window.removeEventListener('pointerup', handleRotationEnd);
      window.removeEventListener('pointercancel', handleRotationEnd);
    };
  }, [onRotationChange, onRotationEnd, readonly, rotationDragState]);

  const handleRotationPointerDown = (event: React.PointerEvent, performerId: string) => {
    event.stopPropagation();
    event.preventDefault();
    rotationLastAngleRef.current = null;
    onRotationStart?.(performerId);
    setRotationDragState({
      performerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
    });
  };

  const handleResizeStart = (e: React.PointerEvent, id: string, handle: 'nw' | 'ne' | 'sw' | 'se', currentWidth: number, currentHeight: number) => {
    if (lockedPerformerIdSet.has(id)) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizeState({
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWidth: currentWidth || 1,
      startHeight: currentHeight || 1,
      handle
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 2 && e.ctrlKey) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanState({
        startX: e.clientX,
        startY: e.clientY,
        initialOffsetX: viewportOffset.x,
        initialOffsetY: viewportOffset.y,
      });
      return;
    }

    if (readonly) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    // Start selection box
    if (mode === ToolMode.SELECT && !dragState && !resizeState) {
      setSelectionBox({
        startX: e.clientX,
        startY: e.clientY,
        endX: e.clientX,
        endY: e.clientY,
      });

      // If no modifier key, clear selection
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        onSelectionChange([]);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (panState) {
      setViewportOffset({
        x: panState.initialOffsetX + (e.clientX - panState.startX),
        y: panState.initialOffsetY + (e.clientY - panState.startY),
      });
      return;
    }

    if (readonly) return;

    if (resizeState && stageRef.current && onUpdatePerformer) {
      // Resizing Logic
      const rect = stageRef.current.getBoundingClientRect();
      const deltaXPixels = e.clientX - resizeState.startClientX;
      const deltaYPixels = e.clientY - resizeState.startClientY;

      // Convert pixels to meters
      // Ratio: STAGE_WIDTH_METERS / rect.width
      const metersPerPx = totalStageWidth / rect.width;

      let deltaW = 0;
      let deltaH = 0;

      // For symmetric resizing from center (simpler for now):
      // If I drag 'se' to right, width increases by 2 * deltaX
      // Because center stays fixed.
      // Actually, let's do simple symmetric resizing.
      // If handle is right-side ('ne', 'se'), dx > 0 -> grow.
      // If handle is left-side ('nw', 'sw'), dx < 0 -> grow (so -dx).

      if (resizeState.handle.includes('e')) {
        deltaW = deltaXPixels;
      } else {
        deltaW = -deltaXPixels;
      }

      if (resizeState.handle.includes('s')) {
        deltaH = deltaYPixels;
      } else {
        deltaH = -deltaYPixels;
      }

      // We multiply by 2 because growing one side from center implies symmetrical growth in absolute terms to keep center
      // Or conceptually: moving right edge 1px right increases width by 2px if center is fixed?
      // No, if width increases by 1m, and center fixed, right edge moves 0.5m.
      // So if right edge moves 1m (delta), width must have increased by 2m.

      const newWidth = Math.max(0.1, resizeState.startWidth + (deltaW * metersPerPx * 2));
      const newDepth = Math.max(0.1, resizeState.startHeight + (deltaH * metersPerPx * 2));

      // width(长) for 2D x-axis, depth(宽) for 2D y-axis
      onUpdatePerformer(resizeState.id, { width: newWidth, depth: newDepth });
      return;
    }

    if (dragState && stageRef.current) {
      const updates = getDragUpdates(e.clientX, e.clientY, dragState);

      if (updates.length > 0) {
        onPositionChange(updates);
      }

    } else if (selectionBox) {
      setSelectionBox((prev) => prev ? ({ ...prev, endX: e.clientX, endY: e.clientY }) : null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (panState) {
      setPanState(null);
      return;
    }

    if (readonly) return;
    const finalDragUpdates = dragState ? getDragUpdates(e.clientX, e.clientY, dragState) : [];
    const committedDragUpdates = snapToGrid
      ? finalDragUpdates.map((update) => ({
        ...update,
        pos: snapStagePosition(update.pos, gridScale, stageConfig),
      }))
      : finalDragUpdates;
    const draggedIds = dragState ? Object.keys(dragState.initialPositions) : [];
    setResizeState(null);
    setDragState(null);
    setSelectionBox(null);
    if (draggedIds.length > 0) {
      if (committedDragUpdates.length > 0) {
        onPositionChange(committedDragUpdates);
      }
      onDragEnd?.(draggedIds, committedDragUpdates);
    }

    // Context for selection box logic... (retained but moved logic out of if block to be safe, or just keep it)
    if (selectionBox && stageRef.current && !resizeState && !dragState) {
      // ... (selection logic)
      // Since I'm replacing the whole block, I need to include selection box logic here.
      // Wait, replace_content replaces a block. The original block ended at setSelectionBox(null). 
      // I need to be careful not to delete logic I'm not showing.
      // My replacement ends at setSelectionBox(null) ? No. 
      // I'll try to match the end of handleMouseUp.
      const rect = stageRef.current.getBoundingClientRect();
      const sbLeft = Math.min(selectionBox.startX, selectionBox.endX);
      const sbRight = Math.max(selectionBox.startX, selectionBox.endX);
      const sbTop = Math.min(selectionBox.startY, selectionBox.endY);
      const sbBottom = Math.max(selectionBox.startY, selectionBox.endY);

      const boxSelectedIds = visiblePerformers.filter((p) => {
        const pos = positions[p.id];
        if (!pos) return false; // Skip if not in frame

        const px = rect.left + (stageXToViewPercent(pos.x, stageConfig) / 100) * rect.width;
        const py = rect.top + (pos.y / 100) * rect.height;
        return px >= sbLeft && px <= sbRight && py >= sbTop && py <= sbBottom;
      }).map(p => p.id);

      if (boxSelectedIds.length > 0) {
        // If modifier held, merge with existing
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          const merged = Array.from(new Set([...selectedPerformerIds, ...boxSelectedIds]));
          onSelectionChange(merged);
        } else {
          onSelectionChange(boxSelectedIds);
        }
      }
    }
  };

  const handlePerformerPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button === 2 && e.ctrlKey) {
      return;
    }

    if (e.button !== 0) {
      e.preventDefault();
      return;
    }

    e.stopPropagation();
    if (readonly) return;
    if (transitionPaths.length > 0) {
      onTransitionObjectSelect?.(id);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);

    let newSelection = [...selectedPerformerIds];

    if (e.ctrlKey || e.metaKey) {
      // Toggle Selection
      if (selectedPerformerIds.includes(id)) {
        newSelection = selectedPerformerIds.filter(pid => pid !== id);
      } else {
        newSelection = [...selectedPerformerIds, id];
      }
      onSelectionChange(newSelection);

      // If we just deselected the item we clicked, don't drag it
      if (!newSelection.includes(id)) {
        return;
      }
    } else {
      // Normal Click
      if (!selectedPerformerIds.includes(id)) {
        // If clicking an unselected item, select only it
        newSelection = [id];
        onSelectionChange(newSelection);
      }
      // If clicking an already selected item, keep selection (so we can drag the group)
    }

    // Initialize Drag State for ALL selected items (including the one just clicked if it was added)
    const initialPositions: Record<string, Position> = {};
    newSelection.forEach(pid => {
      if (lockedPerformerIdSet.has(pid)) return;
      // Use current positions passed in props
      if (positions[pid]) {
        initialPositions[pid] = { ...positions[pid] };
      }
    });

    if (Object.keys(initialPositions).length > 0) {
      setDragState({
        startX: e.clientX,
        startY: e.clientY,
        initialPositions
      });
      onDragStart?.(Object.keys(initialPositions));
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey && onZoom) {
      e.preventDefault();
      onZoom(e.deltaY > 0 ? -0.5 : 0.5);
      return;
    }

    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const currentScale = viewportScale;
    const scaleFactor = e.deltaY > 0 ? 0.92 : 1.08;
    const nextScale = Math.max(0.6, Math.min(3, currentScale * scaleFactor));
    if (Math.abs(nextScale - currentScale) < 0.0001) return;

    const rect = stage.getBoundingClientRect();
    const focalX = e.clientX - (rect.left + rect.width / 2);
    const focalY = e.clientY - (rect.top + rect.height / 2);
    const ratio = nextScale / currentScale;

    setViewportScale(nextScale);
    setViewportOffset((prev) => ({
      x: prev.x + focalX * (1 - ratio),
      y: prev.y + focalY * (1 - ratio),
    }));
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (e.ctrlKey || panState) {
      e.preventDefault();
    }
  };

  const getSelectionBoxStyle = (): SelectionBoxStyle | undefined => {
    const stage = stageRef.current;
    if (!selectionBox || !stage) return undefined;

    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;

    // The box is rendered inside the transformed stage, so client pixels must
    // be converted back to the stage's untransformed local coordinate space.
    const scaleX = stage.offsetWidth / rect.width;
    const scaleY = stage.offsetHeight / rect.height;
    const left = Math.min(selectionBox.startX, selectionBox.endX);
    const top = Math.min(selectionBox.startY, selectionBox.endY);

    return {
      left: (left - rect.left) * scaleX,
      top: (top - rect.top) * scaleY,
      width: Math.abs(selectionBox.endX - selectionBox.startX) * scaleX,
      height: Math.abs(selectionBox.endY - selectionBox.startY) * scaleY,
    };
  };

  // Generate the meter-based center grid and the front/middle/back divisions.
  const gridLines = useMemo(() => {
    return (
      <svg className="absolute inset-0 h-full w-full pointer-events-none" preserveAspectRatio="none">
        {gridMarks.map((mark) => (
          <line
            key={`meter-${mark.offsetMeters}`}
            x1={`${mark.positionRatio * 100}%`}
            y1="0"
            x2={`${mark.positionRatio * 100}%`}
            y2="100%"
            stroke={mark.offsetMeters === 0 ? '#e2e8f0' : '#94a3b8'}
            strokeWidth={mark.offsetMeters === 0 ? 1.5 : 1}
            opacity={mark.offsetMeters === 0 ? 0.55 : 0.2}
          />
        ))}
        {depthGridMarks.map((mark) => (
          <line
            key={`depth-meter-${mark.offsetMeters}`}
            x1="0"
            y1={`${mark.positionRatio * 100}%`}
            x2="100%"
            y2={`${mark.positionRatio * 100}%`}
            stroke={mark.offsetMeters === 0 ? '#e2e8f0' : '#94a3b8'}
            strokeWidth={mark.offsetMeters === 0 ? 1.5 : 1}
            opacity={mark.offsetMeters === 0 ? 0.55 : 0.2}
          />
        ))}
        {showStageLines && STAGE_THIRD_POSITIONS.map((position) => (
          <line
            key={`third-${position}`}
            x1="0"
            y1={`${position * 100}%`}
            x2="100%"
            y2={`${position * 100}%`}
            stroke="#38bdf8"
            strokeWidth={2.5}
            opacity={0.72}
          />
        ))}
      </svg>
    );
  }, [depthGridMarks, gridMarks, showStageLines]);

  const transitionOverlays = useMemo(() => transitionPaths.map((transitionPath) => {
    const startX = stageXToViewPercent(transitionPath.start.x, stageConfig);
    const endX = stageXToViewPercent(transitionPath.end.x, stageConfig);
    const cp1 = transitionPath.controlPoints[0] ?? transitionPath.start;
    const cp2 = transitionPath.controlPoints[1] ?? transitionPath.end;
    const cp1X = stageXToViewPercent(cp1.x, stageConfig);
    const cp2X = stageXToViewPercent(cp2.x, stageConfig);
    return {
      ...transitionPath,
      pathD: transitionPath.pathType === 'bezier'
        ? `M ${startX} ${transitionPath.start.y} C ${cp1X} ${cp1.y}, ${cp2X} ${cp2.y}, ${endX} ${transitionPath.end.y}`
        : `M ${startX} ${transitionPath.start.y} L ${endX} ${transitionPath.end.y}`,
      startView: { x: startX, y: transitionPath.start.y },
      endView: { x: endX, y: transitionPath.end.y },
      controlPointsView: [{ x: cp1X, y: cp1.y }, { x: cp2X, y: cp2.y }],
    };
  }), [stageConfig, transitionPaths]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 bg-slate-900 flex items-center justify-center p-2 sm:p-4 lg:p-8 overflow-hidden select-none"
    >
      {/* Stage Container */}
      <div
        ref={stageRef}
        className="stage-surface relative bg-slate-800 border border-slate-700 shadow-2xl transition-transform duration-75 ease-out"
        style={{
          width: fittedSize.width > 0 ? `${fittedSize.width}px` : '100%',
          height: fittedSize.height > 0 ? `${fittedSize.height}px` : 'auto',
          aspectRatio: `${visualAspectRatio}`,
          cursor: panState ? 'grabbing' : mode === ToolMode.SELECT ? 'default' : 'crosshair',
          transform: `translate(${viewportOffset.x}px, ${viewportOffset.y}px) scale(${viewportScale})`,
          transformOrigin: 'center center',
          transition: panState ? 'none' : 'transform 75ms ease-out',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      >
        {backgroundUrl && (
          <img
            src={backgroundUrl}
            alt="舞台底图"
            className="pointer-events-none absolute inset-0 h-full w-full select-none"
            style={{ opacity: stageConfig.background?.opacity ?? 0.5 }}
          />
        )}
        <div
          className={`absolute inset-y-0 left-0 bg-slate-950/55 pointer-events-none ${showStageLines ? 'border-r-2 border-dashed border-amber-400/70' : ''}`}
          style={{ width: `${leftMainEdge}%` }}
        />
        <div
          className={`absolute inset-y-0 right-0 bg-slate-950/55 pointer-events-none ${showStageLines ? 'border-l-2 border-dashed border-amber-400/70' : ''}`}
          style={{ width: `${100 - rightMainEdge}%` }}
        />

        {/* Dynamic Grid Lines */}
        {gridLines}

        <div
          className="pointer-events-none absolute z-[3] -translate-y-1/2 border-t-2 border-dashed border-fuchsia-400/90"
          style={{
            left: `${(100 - ledWidthPercent) / 2}%`,
            top: `${ledTop}%`,
            width: `${ledWidthPercent}%`,
          }}
          title={`LED 距舞台后沿 ${Number((stageConfig.ledDistanceFromBack ?? 0).toFixed(2))} 米`}
        />

        {transitionOverlays.length > 0 && (
          <>
            <svg className="absolute inset-0 h-full w-full pointer-events-none z-[15]" preserveAspectRatio="none" viewBox="0 0 100 100">
              {transitionOverlays.map((overlay) => (
                <g key={overlay.performerId}>
                  {overlay.isSelected && overlay.pathType === 'bezier' && (
                    <>
                      <line x1={overlay.startView.x} y1={overlay.startView.y} x2={overlay.controlPointsView[0].x} y2={overlay.controlPointsView[0].y} stroke="#38bdf8" strokeWidth="0.3" strokeDasharray="1.2 0.8" opacity="0.8" />
                      <line x1={overlay.endView.x} y1={overlay.endView.y} x2={overlay.controlPointsView[1].x} y2={overlay.controlPointsView[1].y} stroke="#38bdf8" strokeWidth="0.3" strokeDasharray="1.2 0.8" opacity="0.8" />
                    </>
                  )}
                  <path
                    className="pointer-events-auto cursor-pointer"
                    d={overlay.pathD}
                    fill="none"
                    stroke={overlay.color}
                    strokeWidth={overlay.isSelected ? '0.75' : '0.35'}
                    strokeDasharray={overlay.isSelected ? '1.6 1' : '1 1.4'}
                    opacity={overlay.isSelected ? '1' : '0.38'}
                    pointerEvents="stroke"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onTransitionObjectSelect?.(overlay.performerId);
                    }}
                  />
                  {overlay.isSelected && (
                    <circle cx={overlay.endView.x} cy={overlay.endView.y} r="0.8" fill="#f59e0b" />
                  )}
                </g>
              ))}
            </svg>
            {transitionOverlays
              .filter((overlay) => overlay.isSelected)
              .map((overlay) => (
              <button
                key={`transition-start-${overlay.performerId}`}
                type="button"
                onPointerDown={(event) => {
                  if (readonly) return;
                  event.stopPropagation();
                  event.preventDefault();
                  onTransitionObjectSelect?.(overlay.performerId);
                  setStartPointDragState({
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    initialPosition: { ...overlay.start },
                  });
                }}
                className={`absolute z-[17] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg ring-2 ring-emerald-400/25 ${readonly ? 'cursor-default border-slate-300 bg-slate-600' : 'cursor-grab border-emerald-100 bg-emerald-500 active:cursor-grabbing'}`}
                style={{
                  left: `${overlay.startView.x}%`,
                  top: `${overlay.startView.y}%`,
                }}
                title="拖动调整起始点"
                aria-label="拖动调整过渡起始点"
              />
              ))}
            {transitionOverlays
              .filter((overlay) => overlay.isSelected && overlay.pathType === 'bezier')
              .flatMap((overlay) => overlay.controlPointsView.map((controlPoint, index) => (
              <button
                key={`transition-control-${overlay.performerId}-${index}`}
                type="button"
                onPointerDown={(event) => {
                  if (readonly) return;
                  event.stopPropagation();
                  event.preventDefault();
                  setControlPointDragIndex(index);
                }}
                className={`absolute z-[16] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg ${readonly ? 'cursor-default border-slate-400 bg-slate-600' : 'cursor-grab border-cyan-100 bg-cyan-500 active:cursor-grabbing'}`}
                style={{
                  left: `${controlPoint.x}%`,
                  top: `${controlPoint.y}%`,
                }}
                title={`控制点 ${index + 1}`}
              />
              )))}
          </>
        )}

        {wingWidth > 0 && (
          <>
            <div className="absolute left-0 top-2 pointer-events-none text-[10px] font-medium tracking-widest text-amber-300/80" style={{ width: `${leftMainEdge}%`, textAlign: 'center' }}>左备场区</div>
            <div className="absolute right-0 top-2 pointer-events-none text-[10px] font-medium tracking-widest text-amber-300/80" style={{ width: `${100 - rightMainEdge}%`, textAlign: 'center' }}>右备场区</div>
          </>
        )}
        <div
          className="absolute top-2 pointer-events-none text-center text-[10px] font-medium tracking-wide text-slate-300/75"
          style={{ left: `${leftMainEdge}%`, width: `${rightMainEdge - leftMainEdge}%` }}
        >
          主舞台 {Number(stageConfig.width.toFixed(2))}m × {Number(stageConfig.depth.toFixed(2))}m
        </div>

        {/* Stage Front Ruler */}
        <div className="absolute left-0 right-0 top-full z-20 h-7 border-t border-slate-400/70 bg-slate-950/75 pointer-events-none">
          <div className="absolute inset-x-0 bottom-0 text-center text-[8px] tracking-[0.2em] text-slate-400">舞台前沿</div>
          {gridMarks.map((mark) => (
            <div
              key={`ruler-${mark.offsetMeters}`}
              className="absolute top-0 -translate-x-1/2 text-center font-mono text-[8px] leading-none text-slate-100"
              style={{ left: `${mark.positionRatio * 100}%` }}
            >
              <span className="mx-auto block h-1.5 w-px bg-slate-200" />
              {showGridLabels && <span>{formatStageGridLabel(mark.offsetMeters)}</span>}
            </div>
          ))}
        </div>

        {/* Performers Layer */}
        {[...visiblePerformers]
          .sort((a, b) => {
            const aRank = isPlatformProp(a) ? 0 : a.type === 'prop' ? 1 : 2;
            const bRank = isPlatformProp(b) ? 0 : b.type === 'prop' ? 1 : 2;
            return aRank - bRank;
          })
          .map((performer) => {
          // Check if performer exists in the current frame positions
          const pos = positions[performer.id];
          if (!pos) return null; // Don't render if not in current frame/interpolation

          const isSelected = selectedPerformerIds.includes(performer.id)
            || selectedTransitionPath?.performerId === performer.id;
          const rotation = rotations[performer.id] ?? performer.rotation ?? 0;

          // Render Prop
          if (performer.type === 'prop') {
            const performerDims = getPerformerDimensions(performer);
            const STAGE_DEPTH_METERS = stageConfig.depth;
            const isPlatform = isPlatformProp(performer);
            const isOccupiedPlatform = platformOccupancy.occupiedPlatformIds.has(performer.id);
            const propLift = platformOccupancy.entityLiftById[performer.id] ?? 0;
            const displayPos = getPropCenterFromAnchor(pos, rotation, performer, stageConfig);
            const labelFontSize = getStageLabelFontSize(
              performer,
              stageConfig.performerLabelFontSize,
              stageConfig.propLabelFontSize,
            );

            // width(长) for 2D x-axis, depth(宽) for 2D y-axis
            const widthPct = (performerDims.width / totalStageWidth) * 100;
            const heightPct = (performerDims.depth / STAGE_DEPTH_METERS) * 100;

            return (
              <div
                key={performer.id}
                data-performer-id={performer.id}
                onPointerDown={(e) => handlePerformerPointerDown(e, performer.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectionChange([performer.id]);
                }}
                onDoubleClick={() => onOpenNoteDrawer?.(performer.id)}
                className={`absolute cursor-grab active:cursor-grabbing z-10 group flex items-center justify-center`}
                style={{
                  left: `${stageXToViewPercent(displayPos.x, stageConfig)}%`,
                  top: `${displayPos.y}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                  backgroundColor: performer.color,
                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                  border: isSelected
                    ? '2px solid white'
                    : isPlatform
                      ? '2px dashed rgba(251,191,36,0.85)'
                      : '1px solid rgba(255,255,255,0.3)',
                  boxShadow: isSelected
                    ? '0 0 10px rgba(59,130,246,0.5)'
                    : isOccupiedPlatform
                      ? '0 0 0 2px rgba(251,191,36,0.25)'
                      : 'none',
                  backgroundImage: performer.boxTextures?.front?.dataUrl || performer.textureDataUrl
                    ? `url(${performer.boxTextures?.front?.dataUrl || performer.textureDataUrl})`
                    : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  clipPath: getPolygonClipPath(performer.polygonPoints),
                  zIndex: isPlatform ? (isOccupiedPlatform ? 12 : 10) : propLift > 0 ? 13 : 11,
                }}
              >
                {/* Prop Label (Optional, maybe small text inside or standard label above) */}
                <div
                  className="opacity-0 group-hover:opacity-100 text-white font-mono bg-black/50 px-1 rounded absolute pointer-events-none"
                  style={{ fontSize: `${labelFontSize}px` }}
                >
                  {performer.name}
                </div>
                {showDirectionArrows && <DirectionArrow />}

                {/* Resize Handles */}
                {isSelected && !readonly && !lockedPerformerIdSet.has(performer.id) && (
                  <>
                    {!isPlatform && (
                      <button
                        type="button"
                        className="absolute bottom-[-34px] left-1/2 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-white bg-amber-500 shadow-lg cursor-grab active:cursor-grabbing"
                        style={{ transform: `translateX(-50%) rotate(${-rotation}deg)` }}
                        title="拖动旋转"
                        onPointerDown={(event) => handleRotationPointerDown(event, performer.id)}
                      />
                    )}
                    <div className="absolute top-0 left-0 w-5 h-5 md:w-3 md:h-3 bg-white border border-blue-600 rounded-full cursor-nw-resize -translate-x-1/2 -translate-y-1/2 z-20 shadow-sm hover:scale-125 transition-transform touch-none" onPointerDown={(e) => handleResizeStart(e, performer.id, 'nw', performer.width || 1, performer.depth || 1)} />
                    <div className="absolute top-0 right-0 w-5 h-5 md:w-3 md:h-3 bg-white border border-blue-600 rounded-full cursor-ne-resize translate-x-1/2 -translate-y-1/2 z-20 shadow-sm hover:scale-125 transition-transform touch-none" onPointerDown={(e) => handleResizeStart(e, performer.id, 'ne', performer.width || 1, performer.depth || 1)} />
                    <div className="absolute bottom-0 left-0 w-5 h-5 md:w-3 md:h-3 bg-white border border-blue-600 rounded-full cursor-sw-resize -translate-x-1/2 translate-y-1/2 z-20 shadow-sm hover:scale-125 transition-transform touch-none" onPointerDown={(e) => handleResizeStart(e, performer.id, 'sw', performer.width || 1, performer.depth || 1)} />
                    <div className="absolute bottom-0 right-0 w-5 h-5 md:w-3 md:h-3 bg-white border border-blue-600 rounded-full cursor-se-resize translate-x-1/2 translate-y-1/2 z-20 shadow-sm hover:scale-125 transition-transform touch-none" onPointerDown={(e) => handleResizeStart(e, performer.id, 'se', performer.width || 1, performer.depth || 1)} />
                  </>
                )}
              </div>
            );
          }

          const performerDims = getPerformerDimensions(performer);
          const widthPct = (performerDims.width / totalStageWidth) * 100;
          const heightPct = (performerDims.depth / stageConfig.depth) * 100;

          return (
            <div
              key={performer.id}
              data-performer-id={performer.id}
              onPointerDown={(e) => handlePerformerPointerDown(e, performer.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (lockedPerformerIdSet.has(performer.id)) return;
                onSelectionChange([performer.id]);
                onPerformerContextMenu?.(performer.id);
              }}
              onDoubleClick={() => onOpenNoteDrawer?.(performer.id)}
              className="absolute flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10 group touch-none"
              style={{
                left: `${stageXToViewPercent(pos.x, stageConfig)}%`,
                top: `${pos.y}%`,
                width: `max(${widthPct}%, 32px)`,
                height: `max(${heightPct}%, 32px)`,
                zIndex: (platformOccupancy.entityLiftById[performer.id] ?? 0) > 0 ? 14 : 10,
              }}
            >
              <div className="relative h-full w-full" style={{ transform: `rotate(${rotation}deg)` }}>
                {isSelected && !readonly && !lockedPerformerIdSet.has(performer.id) && (
                  <button
                    type="button"
                    className="absolute bottom-[-34px] left-1/2 z-30 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-white bg-amber-500 shadow-lg cursor-grab active:cursor-grabbing"
                    title="拖动旋转"
                    onPointerDown={(event) => handleRotationPointerDown(event, performer.id)}
                  />
                )}
                <div className={`relative flex h-full w-full items-center justify-center transition-transform duration-100 ${isSelected ? 'scale-110' : 'hover:scale-105'}`}>
                  <ShapeIcon
                    shape={performer.shape}
                    color={performer.color}
                    width="100%"
                    height="100%"
                    className={`drop-shadow-lg ${isSelected ? 'filter brightness-125' : ''}`}
                  />
                  {showDirectionArrows && <DirectionArrow />}

                  {/* Selection Ring */}
                  {isSelected && (
                    <div className="absolute inset-0 -m-1 border-2 border-blue-400 rounded-full animate-pulse opacity-50" />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Labels Layer (Always on Top) */}
        {showLabels && visiblePerformers.map((performer) => {
          const pos = positions[performer.id];
          if (!pos) return null;
          const isSelected = selectedPerformerIds.includes(performer.id);
          const performerDims = getPerformerDimensions(performer);
          const labelOffsetPercent = Math.max((performerDims.depth / stageConfig.depth) * 50, 2.2) + (showDirectionArrows ? 2.8 : 1.4);
          const labelFontSize = getStageLabelFontSize(
            performer,
            stageConfig.performerLabelFontSize,
            stageConfig.propLabelFontSize,
          );

          return (
            <div
              key={`label-${performer.id}`}
              className={`absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20 transition-opacity duration-200
                        ${isSelected ? 'opacity-100' : 'opacity-100'}
                    `}
              style={{
                left: `${stageXToViewPercent(pos.x, stageConfig)}%`,
                top: `${Math.min(98, pos.y + labelOffsetPercent)}%`,
              }}
            >
              <div
                className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 font-medium text-white bg-slate-900/80 px-2 py-0.5 rounded whitespace-nowrap shadow-sm"
                style={{ fontSize: `${labelFontSize}px` }}
              >
                {performer.name}
              </div>
            </div>
          );
        })}

        {/* Selection Box */}
        {selectionBox && (
          <div
            className="absolute border-2 border-dashed border-blue-400 bg-blue-500/20 pointer-events-none z-30"
            style={getSelectionBoxStyle()}
          />
        )}
      </div>
    </div>
  );
};
