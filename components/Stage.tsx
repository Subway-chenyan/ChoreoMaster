
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Performer, Position, SelectionBox, ToolMode } from '../types';
import { STAGE_ASPECT_RATIO } from '../constants';

interface StageProps {
  performers: Performer[];
  positions: Record<string, Position>;
  selectedPerformerIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onPositionChange: (updates: { id: string; pos: Position }[]) => void;
  readonly?: boolean;
  mode?: ToolMode;
  showLabels?: boolean;
  gridScale?: number;
  onZoom?: (delta: number) => void;
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

export const Stage: React.FC<StageProps & { aspectRatio?: number; maxWidthPx?: number }> = ({
  performers,
  positions,
  selectedPerformerIds,
  onSelectionChange,
  onPositionChange,
  readonly = false,
  mode = ToolMode.SELECT,
  showLabels = true,
  gridScale = 1,
  onZoom,
  aspectRatio = STAGE_ASPECT_RATIO,
  maxWidthPx = 1200
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

  // Convert client coordinates to percentage relative to stage
  const getPercentagePos = (clientX: number, clientY: number) => {
    if (!stageRef.current) return { x: 0, y: 0 };
    const rect = stageRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (readonly) return;

    // Start selection box
    if (mode === ToolMode.SELECT && !dragState) {
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

  const handleMouseMove = (e: React.MouseEvent) => {
    if (readonly) return;

    if (dragState && stageRef.current) {
      // Calculate delta in percentage
      const rect = stageRef.current.getBoundingClientRect();
      const deltaXPx = e.clientX - dragState.startX;
      const deltaYPx = e.clientY - dragState.startY;

      const deltaX = (deltaXPx / rect.width) * 100;
      const deltaY = (deltaYPx / rect.height) * 100;

      const updates: { id: string; pos: Position }[] = [];

      Object.entries(dragState.initialPositions).forEach(([id, rawPos]) => {
        const initialPos = rawPos as Position;
        updates.push({
          id,
          pos: {
            x: Math.max(0, Math.min(100, initialPos.x + deltaX)),
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

  const handleMouseUp = (e: React.MouseEvent) => {
    if (readonly) return;

    if (selectionBox && stageRef.current) {
      // Calculate intersection
      const rect = stageRef.current.getBoundingClientRect();
      const sbLeft = Math.min(selectionBox.startX, selectionBox.endX);
      const sbRight = Math.max(selectionBox.startX, selectionBox.endX);
      const sbTop = Math.min(selectionBox.startY, selectionBox.endY);
      const sbBottom = Math.max(selectionBox.startY, selectionBox.endY);

      const boxSelectedIds = performers.filter((p) => {
        const pos = positions[p.id];
        if (!pos) return false; // Skip if not in frame

        const px = rect.left + (pos.x / 100) * rect.width;
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
    setDragState(null);
    setSelectionBox(null);
  };

  const handlePerformerMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (readonly) return;

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
      className="flex-1 bg-slate-900 flex items-center justify-center p-8 overflow-hidden select-none"
      onMouseUp={handleMouseUp}
    >
      {/* Stage Container */}
      <div
        ref={stageRef}
        className="relative bg-slate-800 border border-slate-700 shadow-2xl transition-transform duration-75 ease-out"
        style={{
          aspectRatio: `${aspectRatio}`,
          width: '100%',
          maxWidth: `${maxWidthPx}px`,
          cursor: mode === ToolMode.SELECT ? 'default' : 'crosshair'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
      >
        {/* Dynamic Grid Lines */}
        {gridLines}

        {/* Stage Front Indicator */}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-slate-600 opacity-50 text-center text-[10px] tracking-widest text-white">舞台前沿</div>

        {/* Performers Layer */}
        {performers.map((performer) => {
          // Check if performer exists in the current frame positions
          const pos = positions[performer.id];
          if (!pos) return null; // Don't render if not in current frame/interpolation

          const isSelected = selectedPerformerIds.includes(performer.id);

          return (
            <div
              key={performer.id}
              onMouseDown={(e) => handlePerformerMouseDown(e, performer.id)}
              className={`absolute transform -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10 group`}
              style={{
                left: `${pos.x}%`,
                top: `${pos.y}%`,
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
        {showLabels && performers.map((performer) => {
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
                left: `${pos.x}%`,
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
