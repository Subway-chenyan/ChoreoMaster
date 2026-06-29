import React from 'react';

interface DirectionArrow3DProps {
  scale?: number;
  y?: number;
}

export const DirectionArrow3D: React.FC<DirectionArrow3DProps> = ({ scale = 1, y = 0.06 }) => (
  <group position={[0, y, 0]} scale={scale}>
    <mesh position={[0, 0, 0.18]}>
      <boxGeometry args={[0.08, 0.035, 0.42]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </mesh>
    <mesh position={[0, 0, 0.5]} rotation={[Math.PI / 2, 0, 0]}>
      <coneGeometry args={[0.16, 0.3, 12]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </mesh>
  </group>
);

export default DirectionArrow3D;
