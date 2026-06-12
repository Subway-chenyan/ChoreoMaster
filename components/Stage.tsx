
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Performer, Position, SelectionBox, ToolMode, PerformerGroup, StageConfig } from '../types';
import {
  getStageXBounds,
  getTotalStageWidth,
  getWingWidth,
  stageXToViewPercent,
  viewPercentToStageX,
} from '../utils/coordinates';
import { buildPlatformOccupancy, isPlatformProp } from '../utils/platforms';

interface StageProps {
  performers: Performer[];
  performerGroups?: PerformerGroup[];
  hiddenGroupIds?: string[]; // IDs of groups hidden in current frame
  positions: Record<string, Position>;
  selectedPerformerIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onPositionChange: (updates: { id: string; pos: Position }[]) => void;
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: (ids: string[]) => void;
  onUpdatePerformer?: (id: string, updates: Partial<Performer>) => void;
  readonly?: boolean;
  mode?: ToolMode;
  showLabels?: boolean;
  gridScale?: number;
  onZoom?: (delta: number) => void;
  stageConfig: StageConfig;
}

const ShapeIcon: React.FC<{ shape: string; color: string; size: number; className?: string }> = ({ shape, color, size, className }) => {
  const style = { fill: color, stroke: 'white', strokeWidth: 2 };

  if (shape === 'square') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
        <rect x="4" y="4" width="16" height="16" style={style} />
      </svg>
    );
  }
  if (shape === 'triangle') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
        <polygon points="12,4 20,20 4,20" style={style} />
      </svg>
    );
  }
  // Default Circle
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9" style={style} />
    </svg>
  );
};

interface DragState {
  startX: number;
  startY: number;
  initialPositions: Record<string, Position>;
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
  hiddenGroupIds = [],
  positions,
  selectedPerformerIds,
  onSelectionChange,
  onPositionChange,
  onDragStart,
  onDragEnd,
  onUpdatePerformer,
  readonly = false,
  mode = ToolMode.SELECT,
  showLabels = true,
  gridScale = 1,
  onZoom,
  stageConfig
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [availableSize, setAvailableSize] = useState({ width: 0, height: 0 });
  const stageXBounds = useMemo(() => getStageXBounds(stageConfig), [stageConfig]);
  const wingWidth = getWingWidth(stageConfig);
  const totalStageWidth = getTotalStageWidth(stageConfig);
  const leftMainEdge = stageXToViewPercent(0, stageConfig);
  const rightMainEdge = stageXToViewPercent(100, stageConfig);
  const visualAspectRatio = totalStageWidth / stageConfig.depth;
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

  const handleResizeStart = (e: React.PointerEvent, id: string, handle: 'nw' | 'ne' | 'sw' | 'se', currentWidth: number, currentHeight: number) => {
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
      // Calculate delta in percentage
      const rect = stageRef.current.getBoundingClientRect();
      const deltaXPx = e.clientX - dragState.startX;
      const deltaYPx = e.clientY - dragState.startY;

      const deltaX = (deltaXPx / rect.width) * (stageXBounds.max - stageXBounds.min);
      const deltaY = (deltaYPx / rect.height) * 100;

      const updates: { id: string; pos: Position }[] = [];

      Object.entries(dragState.initialPositions).forEach(([id, rawPos]) => {
        const initialPos = rawPos as Position;
        updates.push({
          id,
          pos: {
            x: Math.max(stageXBounds.min, Math.min(stageXBounds.max, initialPos.x + deltaX)),
            y: Math.max(0, Math.min(100, initialPos.y + deltaY)),
          }
        });
      });

      if (updates.length > 0) {
        onPositionChange(updates);
      }

    } else if (selectionBox) {
      setSelectionBox((prev) => prev ? ({ ...prev, endX: e.clientX, endY: e.clientY }) : null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (readonly) return;
    const draggedIds = dragState ? Object.keys(dragState.initialPositions) : [];
    setResizeState(null);
    setDragState(null);
    setSelectionBox(null);
    if (draggedIds.length > 0) {
      onDragEnd?.(draggedIds);
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
    e.stopPropagation();
    if (readonly) return;
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
      onZoom(e.deltaY > 0 ? -0.1 : 0.1);
    }
  };

  // Generate Dynamic Grid
  const gridLines = useMemo(() => {
    const divisions = Math.round(4 * gridScale);
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20" preserveAspectRatio="none">
        {/* Vertical Lines */}
        {Array.from({ length: divisions + 1 }).map((_, i) => (
          <line
            key={`v-${i}`}
            x1={`${(i / divisions) * 100}%`}
            y1="0"
            x2={`${(i / divisions) * 100}%`}
            y2="100%"
            stroke="#94a3b8"
            strokeWidth={1}
          />
        ))}
        {/* Horizontal Lines */}
        {Array.from({ length: divisions + 1 }).map((_, i) => (
          <line
            key={`h-${i}`}
            x1="0"
            y1={`${(i / divisions) * 100}%`}
            x2="100%"
            y2={`${(i / divisions) * 100}%`}
            stroke="#94a3b8"
            strokeWidth={1}
          />
        ))}
      </svg>
    );
  }, [gridScale]);

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
          cursor: mode === ToolMode.SELECT ? 'default' : 'crosshair'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div
          className="absolute inset-y-0 left-0 bg-slate-950/55 border-r-2 border-dashed border-amber-400/70 pointer-events-none"
          style={{ width: `${leftMainEdge}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-slate-950/55 border-l-2 border-dashed border-amber-400/70 pointer-events-none"
          style={{ width: `${100 - rightMainEdge}%` }}
        />

        {/* Dynamic Grid Lines */}
        {gridLines}

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

        {/* Stage Front Indicator */}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-slate-600 opacity-50 text-center text-[10px] tracking-widest text-white">舞台前沿</div>

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

          const isSelected = selectedPerformerIds.includes(performer.id);

          // Render Prop
          if (performer.type === 'prop') {
            const STAGE_DEPTH_METERS = stageConfig.depth;
            const isPlatform = isPlatformProp(performer);
            const isOccupiedPlatform = platformOccupancy.occupiedPlatformIds.has(performer.id);
            const propLift = platformOccupancy.entityLiftById[performer.id] ?? 0;

            // width(长) for 2D x-axis, depth(宽) for 2D y-axis
            const widthPct = ((performer.width || 1) / totalStageWidth) * 100;
            const heightPct = ((performer.depth || 1) / STAGE_DEPTH_METERS) * 100;

            return (
              <div
                key={performer.id}
                onPointerDown={(e) => handlePerformerPointerDown(e, performer.id)}
                className={`absolute cursor-grab active:cursor-grabbing z-10 group flex items-center justify-center`}
                style={{
                  left: `${stageXToViewPercent(pos.x, stageConfig)}%`,
                  top: `${pos.y}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                  backgroundColor: performer.color,
                  transform: `translate(-50%, -50%) rotate(${performer.rotation || 0}deg)`,
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
                <div className="opacity-0 group-hover:opacity-100 text-[8px] text-white font-mono bg-black/50 px-1 rounded absolute pointer-events-none">
                  {performer.name}
                </div>

                {/* Resize Handles */}
                {isSelected && !readonly && (
                  <>
                    <div className="absolute top-0 left-0 w-5 h-5 md:w-3 md:h-3 bg-white border border-blue-600 rounded-full cursor-nw-resize -translate-x-1/2 -translate-y-1/2 z-20 shadow-sm hover:scale-125 transition-transform touch-none" onPointerDown={(e) => handleResizeStart(e, performer.id, 'nw', performer.width || 1, performer.depth || 1)} />
                    <div className="absolute top-0 right-0 w-5 h-5 md:w-3 md:h-3 bg-white border border-blue-600 rounded-full cursor-ne-resize translate-x-1/2 -translate-y-1/2 z-20 shadow-sm hover:scale-125 transition-transform touch-none" onPointerDown={(e) => handleResizeStart(e, performer.id, 'ne', performer.width || 1, performer.depth || 1)} />
                    <div className="absolute bottom-0 left-0 w-5 h-5 md:w-3 md:h-3 bg-white border border-blue-600 rounded-full cursor-sw-resize -translate-x-1/2 translate-y-1/2 z-20 shadow-sm hover:scale-125 transition-transform touch-none" onPointerDown={(e) => handleResizeStart(e, performer.id, 'sw', performer.width || 1, performer.depth || 1)} />
                    <div className="absolute bottom-0 right-0 w-5 h-5 md:w-3 md:h-3 bg-white border border-blue-600 rounded-full cursor-se-resize translate-x-1/2 translate-y-1/2 z-20 shadow-sm hover:scale-125 transition-transform touch-none" onPointerDown={(e) => handleResizeStart(e, performer.id, 'se', performer.width || 1, performer.depth || 1)} />
                  </>
                )}
              </div>
            );
          }

          return (
            <div
              key={performer.id}
              onPointerDown={(e) => handlePerformerPointerDown(e, performer.id)}
              className={`absolute min-w-11 min-h-11 flex items-center justify-center transform -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10 group touch-none`}
              style={{
                left: `${stageXToViewPercent(pos.x, stageConfig)}%`,
                top: `${pos.y}%`,
                zIndex: (platformOccupancy.entityLiftById[performer.id] ?? 0) > 0 ? 14 : 10,
              }}
            >
              <div className={`relative transition-transform duration-100 ${isSelected ? 'scale-125' : 'hover:scale-110'}`}>
                <ShapeIcon
                  shape={performer.shape}
                  color={performer.color}
                  size={32}
                  className={`drop-shadow-lg ${isSelected ? 'filter brightness-125' : ''}`}
                />

                {/* Selection Ring */}
                {isSelected && (
                  <div className="absolute inset-0 -m-1 border-2 border-blue-400 rounded-full animate-pulse opacity-50" />
                )}
              </div>
            </div>
          );
        })}

        {/* Labels Layer (Always on Top) */}
        {showLabels && visiblePerformers.map((performer) => {
          const pos = positions[performer.id];
          if (!pos) return null;
          const isSelected = selectedPerformerIds.includes(performer.id);

          return (
            <div
              key={`label-${performer.id}`}
              className={`absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20 transition-opacity duration-200
                        ${isSelected ? 'opacity-100' : 'opacity-100'}
                    `}
              style={{
                left: `${stageXToViewPercent(pos.x, stageConfig)}%`,
                top: `${pos.y}%`,
              }}
            >
              <div className={`absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-medium text-white bg-slate-900/80 px-2 py-0.5 rounded whitespace-nowrap shadow-sm`}>
                {performer.name}
              </div>
            </div>
          );
        })}

        {/* Selection Box */}
        {selectionBox && (
          <div
            className="absolute border-2 border-dashed border-blue-400 bg-blue-500/20 pointer-events-none z-30"
            style={{
              left: Math.min(selectionBox.startX, selectionBox.endX) - (stageRef.current?.getBoundingClientRect().left || 0),
              top: Math.min(selectionBox.startY, selectionBox.endY) - (stageRef.current?.getBoundingClientRect().top || 0),
              width: Math.abs(selectionBox.endX - selectionBox.startX),
              height: Math.abs(selectionBox.endY - selectionBox.startY),
            }}
          />
        )}
      </div>
    </div>
  );
};
