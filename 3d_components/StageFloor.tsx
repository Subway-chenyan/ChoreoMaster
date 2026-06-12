import React from 'react';
import * as THREE from 'three';

interface StageFloorProps {
  width: number;
  depth: number;
  wingWidth?: number;
  gridScale?: number;
}

const StageFloor: React.FC<StageFloorProps> = ({ width, depth, wingWidth = 0, gridScale = 1 }) => {
  // Use same grid density calculation as 2D view
  const totalWidth = width + wingWidth * 2;
  const divisions = Math.max(1, Math.round(4 * gridScale * (totalWidth / width)));

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} metalness={0.2} />
      </mesh>
      {wingWidth > 0 && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-(width + wingWidth) / 2, -0.01, 0]} receiveShadow>
            <planeGeometry args={[wingWidth, depth]} />
            <meshStandardMaterial color="#0f172a" roughness={0.9} metalness={0.1} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(width + wingWidth) / 2, -0.01, 0]} receiveShadow>
            <planeGeometry args={[wingWidth, depth]} />
            <meshStandardMaterial color="#0f172a" roughness={0.9} metalness={0.1} />
          </mesh>
        </>
      )}

      {/* 
          Grid helper is square by default. 
          We scale it on the Z axis to match the stage's aspect ratio (depth/width).
          This ensures the grid divisions match the 2D view's rectangular grid.
      */}
      <gridHelper
        args={[totalWidth, divisions, 0x444444, 0x222222]}
        position={[0, 0.01, 0]}
        scale={[1, 1, depth / totalWidth]}
      />
      {wingWidth > 0 && (
        <>
          <mesh position={[-width / 2, 0.025, 0]}>
            <boxGeometry args={[0.06, 0.05, depth]} />
            <meshBasicMaterial color="#f59e0b" />
          </mesh>
          <mesh position={[width / 2, 0.025, 0]}>
            <boxGeometry args={[0.06, 0.05, depth]} />
            <meshBasicMaterial color="#f59e0b" />
          </mesh>
        </>
      )}

      {/* Red line at front (z = -depth/2, towards camera) */}
      <mesh position={[0, 0.02, -depth / 2]}>
        <boxGeometry args={[totalWidth, 0.05, 0.1]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      {/* Blue line at back (z = depth/2, away from camera) */}
      <mesh position={[0, 0.02, depth / 2]}>
        <boxGeometry args={[totalWidth, 0.05, 0.1]} />
        <meshBasicMaterial color="#3b82f6" />
      </mesh>
    </group>
  );
};

export default StageFloor;
