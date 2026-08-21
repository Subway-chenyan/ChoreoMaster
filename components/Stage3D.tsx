import React from 'react';
import { Canvas } from '@react-three/fiber';
import Scene3D from '../3d_components/Scene3D';
import { Performer, Position, StageConfig } from '../types';
import { getTotalStageWidth } from '../utils/coordinates';

interface Stage3DProps {
  performers: Performer[];
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
  showDirectionArrows?: boolean;
  readonly?: boolean;
  dragEnabled?: boolean;
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: (ids: string[], finalUpdates?: { id: string; pos: Position }[]) => void;
  onOpenPerformerEditor?: (id: string) => void;
}

const Stage3D: React.FC<Stage3DProps> = ({
  performers,
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
  showDirectionArrows = true,
  readonly = false,
  dragEnabled = false,
  onDragStart,
  onDragEnd,
  onOpenPerformerEditor,
}) => {
  const handleSelect = (id: string) => { onSelect(id === '' ? [] : [id]); };
  const totalWidth = getTotalStageWidth(stageConfig);
  const cameraDistance = Math.max(20, totalWidth * 0.85, stageConfig.depth * 1.35);

  return (
    <div
      className="flex-1 bg-slate-950 relative"
      onContextMenu={(event) => event.preventDefault()}
    >
      <Canvas
        key={`${totalWidth}-${stageConfig.depth}`}
        shadows
        camera={{ position: [0, cameraDistance * 0.75, cameraDistance], fov: 50 }}
        gl={{ antialias: true }}
      >
        <Scene3D
          performers={performers}
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
          showDirectionArrows={showDirectionArrows}
          onPositionChange={onPositionChange}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          readonly={readonly}
          dragEnabled={dragEnabled}
          onOpenPerformerEditor={onOpenPerformerEditor}
        />
      </Canvas>
    </div>
  );
};

export default Stage3D;
