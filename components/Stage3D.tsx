import React, { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import Scene3D from '../3d_components/Scene3D';
import { Performer, Position, ProjectModelAsset, StageConfig } from '../types';
import { getTotalStageWidth } from '../utils/coordinates';
import TransformModeToolbar, { type StageTransformMode } from './three/TransformModeToolbar';

const STAGE_SHORTCUT_MODES: Partial<Record<string, StageTransformMode>> = {
  q: 'navigate',
  w: 'translate',
  e: 'rotate',
  r: 'scale',
};

interface Stage3DProps {
  performers: Performer[];
  modelAssets?: Record<string, ProjectModelAsset>;
  positions: Record<string, Position>;
  rotations?: Record<string, number>;
  selectedIds: string[];
  hiddenGroupIds?: string[];
  lockedPerformerIds?: string[];
  onSelect: (ids: string[]) => void;
  onPositionChange: (updates: { id: string; pos: Position }[]) => void;
  onUpdatePerformer: (id: string, updates: Partial<Performer>) => void;
  onRemovePerformer: (id: string) => void;
  stageConfig: StageConfig;
  mediaCache?: Record<string, string>;
  currentTime?: number;
  isPlaying?: boolean;
  gridScale?: number;
  snapToGrid?: boolean;
  showLabels?: boolean;
  showDirectionArrows?: boolean;
  readonly?: boolean;
  dragEnabled?: boolean;
  transformMode?: StageTransformMode;
  onTransformModeChange?: (mode: StageTransformMode) => void;
  onSnapToGridChange?: (enabled: boolean) => void;
  shortcutsEnabled?: boolean;
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: (ids: string[], finalUpdates?: { id: string; pos: Position }[]) => void;
  onRotationStart?: (id: string) => void;
  onRotationChange?: (id: string, rotation: number) => void;
  onRotationEnd?: (id: string, rotation: number) => void;
  onResizeStart?: (id: string) => void;
  onResizeEnd?: (id: string, dimensions: { width: number; height: number; depth: number }) => void;
  onOpenPerformerEditor?: (id: string) => void;
  placementPreview?: { asset: ProjectModelAsset; width: number; height: number; depth: number } | null;
  onPlaceAsset?: (position: Position) => void;
  onCancelPlacement?: () => void;
}

const Stage3D: React.FC<Stage3DProps> = ({
  performers,
  modelAssets,
  positions,
  rotations = {},
  selectedIds,
  hiddenGroupIds,
  lockedPerformerIds = [],
  onSelect,
  onPositionChange,
  onUpdatePerformer,
  onRemovePerformer,
  stageConfig,
  mediaCache,
  currentTime = 0,
  isPlaying = false,
  gridScale = 1,
  snapToGrid = false,
  showLabels = true,
  showDirectionArrows = true,
  readonly = false,
  dragEnabled = false,
  transformMode = 'navigate',
  onTransformModeChange,
  onSnapToGridChange,
  shortcutsEnabled = true,
  onDragStart,
  onDragEnd,
  onRotationStart,
  onRotationChange,
  onRotationEnd,
  onResizeStart,
  onResizeEnd,
  onOpenPerformerEditor,
  placementPreview = null,
  onPlaceAsset,
  onCancelPlacement,
}) => {
  const handleSelect = (id: string) => { onSelect(id === '' ? [] : [id]); };
  const totalWidth = getTotalStageWidth(stageConfig);
  const cameraDistance = Math.max(20, totalWidth * 0.85, stageConfig.depth * 1.35);
  const selectedPerformer = selectedIds.length === 1
    ? performers.find((performer) => performer.id === selectedIds[0])
    : undefined;
  const selectedIsLocked = selectedPerformer
    ? lockedPerformerIds.includes(selectedPerformer.id)
    : false;
  const editingDisabled = readonly || Boolean(placementPreview);

  useEffect(() => {
    if (!shortcutsEnabled || !onTransformModeChange) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase();
        if (target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
      const nextMode = STAGE_SHORTCUT_MODES[event.key.toLowerCase()];
      if (nextMode) {
        if (editingDisabled && nextMode !== 'navigate') return;
        event.preventDefault();
        onTransformModeChange(nextMode);
      } else if (event.key.toLowerCase() === 's' && !editingDisabled && onSnapToGridChange) {
        event.preventDefault();
        onSnapToGridChange(!snapToGrid);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingDisabled, onSnapToGridChange, onTransformModeChange, shortcutsEnabled, snapToGrid]);

  const transformHint = readonly
    ? '播放中：3D 编辑已锁定'
    : selectedIds.length > 1
      ? '请只选择一个道具进行变换'
      : !selectedPerformer
        ? '选择道具后可使用彩色控制轴'
        : selectedIsLocked
          ? `${selectedPerformer.name} 已锁定`
          : selectedPerformer.type !== 'prop'
            ? '演员可在“位移”模式直接拖动'
            : `${selectedPerformer.name} · ${transformMode === 'navigate' ? '观察视角' : transformMode === 'translate' ? '拖动控制轴移动' : transformMode === 'rotate' ? '拖动圆环旋转' : '拖动方块缩放'}`;

  return (
    <div
      className="flex-1 bg-slate-950 relative"
      onContextMenu={(event) => {
        event.preventDefault();
        if (placementPreview) onCancelPlacement?.();
      }}
    >
      <Canvas
        key={`${totalWidth}-${stageConfig.depth}`}
        shadows
        camera={{ position: [0, cameraDistance * 0.75, cameraDistance], fov: 50 }}
        gl={{ antialias: true }}
      >
        <Scene3D
          performers={performers}
          modelAssets={modelAssets}
          positions={positions}
          rotations={rotations}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          stageConfig={stageConfig}
          mediaCache={mediaCache}
          currentTime={currentTime}
          isPlaying={isPlaying}
          hiddenGroupIds={hiddenGroupIds}
          lockedPerformerIds={lockedPerformerIds}
          gridScale={gridScale}
          snapToGrid={snapToGrid}
          showLabels={showLabels}
          showDirectionArrows={showDirectionArrows}
          onPositionChange={onPositionChange}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          readonly={readonly}
          dragEnabled={dragEnabled}
          transformMode={transformMode}
          onRotationStart={onRotationStart}
          onRotationChange={onRotationChange}
          onRotationEnd={onRotationEnd}
          onResizeStart={onResizeStart}
          onResizeChange={(id, dimensions) => onUpdatePerformer(id, dimensions)}
          onResizeEnd={onResizeEnd}
          onOpenPerformerEditor={onOpenPerformerEditor}
          placementPreview={placementPreview}
          onPlaceAsset={onPlaceAsset}
          onCancelPlacement={onCancelPlacement}
        />
      </Canvas>
      {!placementPreview && onTransformModeChange && onSnapToGridChange && (
        <div
          className="pointer-events-auto absolute left-1/2 top-3 z-20 max-w-[calc(100%-1.5rem)] -translate-x-1/2 overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/92 p-1.5 shadow-2xl backdrop-blur max-[1100px]:left-3 max-[1100px]:top-16 max-[1100px]:translate-x-0"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <TransformModeToolbar
            mode={transformMode}
            onModeChange={onTransformModeChange}
            snap={snapToGrid}
            onSnapChange={onSnapToGridChange}
            editingDisabled={editingDisabled}
          />
          <div className="px-2 pb-1 pt-1.5 text-center text-[10px] text-slate-400">
            {transformHint}
          </div>
        </div>
      )}
    </div>
  );
};

export default Stage3D;
