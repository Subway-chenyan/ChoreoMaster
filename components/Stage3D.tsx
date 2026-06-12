import React from 'react';
import { Canvas } from '@react-three/fiber';
import Scene3D from '../3d_components/Scene3D';
import { Performer, Position, StageConfig } from '../types';
import { getTotalStageWidth } from '../utils/coordinates';

interface Stage3DProps {
  performers: Performer[];
  positions: Record<string, Position>;
  selectedIds: string[];
  hiddenGroupIds?: string[];
  onSelect: (ids: string[]) => void;
  onPositionChange: (updates: { id: string; pos: Position }[]) => void;
  onUpdatePerformer: (id: string, updates: Partial<Performer>) => void;
  onRemovePerformer: (id: string) => void;
  stageConfig: StageConfig;
  mediaCache?: Record<string, string>;
  currentTime?: number;
  isPlaying?: boolean;
  gridScale?: number;
  readonly?: boolean;
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: (ids: string[]) => void;
}

const Stage3D: React.FC<Stage3DProps> = ({
  performers,
  positions,
  selectedIds,
  hiddenGroupIds,
  onSelect,
  onPositionChange,
  onUpdatePerformer,
  onRemovePerformer,
  stageConfig,
  mediaCache,
  currentTime = 0,
  isPlaying = false,
  gridScale = 1,
  readonly = false,
  onDragStart,
  onDragEnd
}) => {
  const handleSelect = (id: string) => { onSelect(id === '' ? [] : [id]); };
  const totalWidth = getTotalStageWidth(stageConfig);
  const cameraDistance = Math.max(20, totalWidth * 0.85, stageConfig.depth * 1.35);

  return (
    <div className="flex-1 bg-slate-950 relative">
      <Canvas
        key={`${totalWidth}-${stageConfig.depth}`}
        shadows
        camera={{ position: [0, cameraDistance * 0.75, cameraDistance], fov: 50 }}
        gl={{ antialias: true }}
      >
        <Scene3D
          performers={performers}
          positions={positions}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          stageConfig={stageConfig}
          mediaCache={mediaCache}
          currentTime={currentTime}
          isPlaying={isPlaying}
          hiddenGroupIds={hiddenGroupIds}
          gridScale={gridScale}
          onPositionChange={onPositionChange}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          readonly={readonly}
        />
      </Canvas>
    </div>
  );
};

export default Stage3D;
