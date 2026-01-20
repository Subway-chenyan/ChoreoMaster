import React from 'react';
import { OrbitControls } from '@react-three/drei';
import StageFloor from './StageFloor';
import Performer3D from './Performer3D';
import Prop3D from './Prop3D';
import LEDTV from '../components/LEDTV';
import { Performer, Position, StageConfig } from '../types';

interface Scene3DProps {
  performers: Performer[];
  positions: Record<string, Position>;
  selectedIds: string[];
  onSelect: (id: string) => void;
  stageConfig: StageConfig;
  mediaCache?: Record<string, string>;
  hiddenGroupIds?: string[];
}

const Scene3D: React.FC<Scene3DProps> = ({ performers, positions, selectedIds, onSelect, stageConfig, mediaCache, hiddenGroupIds = [] }) => {
  const visiblePerformers = performers.filter(p => !p.groupId || !hiddenGroupIds.includes(p.groupId));

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
      <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2} maxDistance={50} minDistance={5} target={[0, 0, 0]} />
      <LEDTV config={stageConfig} mediaCache={mediaCache} />
      <StageFloor width={stageConfig.width} depth={stageConfig.depth} />
      {visiblePerformers.map(p => {
        const pos = positions[p.id]; if (!pos) return null;
        if (p.type === 'prop') return <Prop3D key={p.id} performer={p} position={pos} isSelected={selectedIds.includes(p.id)} onSelect={onSelect} stageConfig={{ width: stageConfig.width, depth: stageConfig.depth }} />;
        return <Performer3D key={p.id} performer={p} position={pos} isSelected={selectedIds.includes(p.id)} onSelect={onSelect} stageConfig={{ width: stageConfig.width, depth: stageConfig.depth }} />;
      })}
      <mesh position={[0, 0, -stageConfig.depth / 2 - 5]} scale={[100, 100, 1]} visible={false} onClick={() => onSelect('')}>
        <planeGeometry />
      </mesh>
    </>
  );
};

export default Scene3D;