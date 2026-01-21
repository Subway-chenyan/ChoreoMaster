import React from 'react';
import * as THREE from 'three';

interface StageFloorProps {
  width: number;
  depth: number;
  gridScale?: number;
}

const StageFloor: React.FC<StageFloorProps> = ({ width, depth, gridScale = 1 }) => {
  // Use same grid density calculation as 2D view
  const divisions = Math.round(4 * gridScale);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} metalness={0.2} />
      </mesh>
      <gridHelper args={[width, divisions, 0x444444, 0x222222]} position={[0, 0.01, 0]} />
      {/* Red line at front (z = -depth/2, towards camera) */}
      <mesh position={[0, 0.02, -depth / 2]}>
        <boxGeometry args={[width, 0.05, 0.1]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      {/* Blue line at back (z = depth/2, away from camera) */}
      <mesh position={[0, 0.02, depth / 2]}>
        <boxGeometry args={[width, 0.05, 0.1]} />
        <meshBasicMaterial color="#3b82f6" />
      </mesh>
    </group>
  );
};

export default StageFloor;