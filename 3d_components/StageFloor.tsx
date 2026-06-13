import React from 'react';
import { createCenteredStageGridMarks, STAGE_THIRD_POSITIONS } from '../utils/stage-grid';

interface StageFloorProps {
  width: number;
  depth: number;
  wingWidth?: number;
  gridScale?: number;
}

const StageFloor: React.FC<StageFloorProps> = ({ width, depth, wingWidth = 0, gridScale = 1 }) => {
  const totalWidth = width + wingWidth * 2;
  const gridMarks = createCenteredStageGridMarks(totalWidth, gridScale);

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

      {gridMarks.map((mark) => (
        <mesh key={`meter-${mark.offsetMeters}`} position={[mark.offsetMeters, 0.01, 0]}>
          <boxGeometry args={[mark.offsetMeters === 0 ? 0.035 : 0.02, 0.018, depth]} />
          <meshBasicMaterial
            color={mark.offsetMeters === 0 ? '#cbd5e1' : '#475569'}
            transparent
            opacity={mark.offsetMeters === 0 ? 0.8 : 0.55}
          />
        </mesh>
      ))}
      {STAGE_THIRD_POSITIONS.map((position) => (
        <mesh
          key={`third-${position}`}
          position={[0, 0.025, -depth / 2 + position * depth]}
        >
          <boxGeometry args={[totalWidth, 0.035, 0.065]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.85} />
        </mesh>
      ))}
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
