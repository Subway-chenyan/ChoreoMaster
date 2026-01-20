import React from 'react';
import { Canvas } from '@react-three/fiber';
import Scene3D from '../3d_components/Scene3D';
import EditorPanel3D from './EditorPanel3D';
import { Performer, Position, StageConfig } from '../types';

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
  readonly?: boolean;
}

const Stage3D: React.FC<Stage3DProps> = ({ performers, positions, selectedIds, hiddenGroupIds, onSelect, onPositionChange, onUpdatePerformer, onRemovePerformer, stageConfig, mediaCache, readonly = false }) => {
  const handleSelect = (id: string) => { onSelect(id === '' ? [] : [id]); };
  const handleUpdatePosition = (id: string, pos: Position) => { onPositionChange([{ id, pos }]); };
  const selectedPerformer = selectedIds.length === 1 ? performers.find(p => p.id === selectedIds[0]) || null : null;
  const selectedPosition = selectedIds.length === 1 ? positions[selectedIds[0]] || null : null;

  return (
    <div className="flex-1 flex bg-slate-950 relative">
      <div className="flex-1">
        <Canvas shadows camera={{ position: [0, 15, 20], fov: 50 }} gl={{ antialias: true }}>
          <Scene3D performers={performers} positions={positions} selectedIds={selectedIds} onSelect={handleSelect} stageConfig={stageConfig} mediaCache={mediaCache} hiddenGroupIds={hiddenGroupIds} />
        </Canvas>
      </div>
      {!readonly && (
        <EditorPanel3D performer={selectedPerformer} position={selectedPosition} onUpdatePosition={handleUpdatePosition} onUpdatePerformer={onUpdatePerformer} onDelete={onRemovePerformer} />
      )}
    </div>
  );
};

export default Stage3D;