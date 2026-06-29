import React from 'react';

interface DirectionArrow3DProps {
  scale?: number;
  y?: number;
}

export const DirectionArrow3D: React.FC<DirectionArrow3DProps> = ({ scale = 1, y = 0.06 }) => (
  <group position={[0, y, 0]} scale={scale}>
    <mesh position={[0, 0, 0.28]}>
      <boxGeometry args={[0.14, 0.055, 0.64]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </mesh>
    <mesh position={[0, 0, 0.78]} rotation={[Math.PI / 2, 0, 0]}>
      <coneGeometry args={[0.26, 0.46, 16]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </mesh>
  </group>
);

export default DirectionArrow3D;
