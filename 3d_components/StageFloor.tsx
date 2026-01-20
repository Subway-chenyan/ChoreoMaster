import React from 'react';
import * as THREE from 'three';

interface StageFloorProps {
  width: number;
  depth: number;
}

const StageFloor: React.FC<StageFloorProps> = ({ width, depth }) => {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} metalness={0.2} />
      </mesh>
      <gridHelper args={[width, Math.floor(width), 0x444444, 0x222222]} position={[0, 0.01, 0]} />
      <mesh position={[0, 0.02, depth / 2]}>
        <boxGeometry args={[width, 0.05, 0.1]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      <mesh position={[0, 0.02, -depth / 2]}>
        <boxGeometry args={[width, 0.05, 0.1]} />
        <meshBasicMaterial color="#3b82f6" />
      </mesh>
    </group>
  );
};

export default StageFloor;