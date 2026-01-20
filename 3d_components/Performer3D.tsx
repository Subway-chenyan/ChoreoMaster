import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, Position } from '../types';
import { mapTo3D, degToRad } from '../utils/coordinates';

interface Performer3DProps {
  performer: Performer;
  position: Position;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const Performer3D: React.FC<Performer3DProps> = ({ performer, position, isSelected, onSelect }) => {
  const meshRef = useRef<THREE.Group>(null);
  const [hovered, setHover] = useState(false);

  const stageConfig = { width: 20, depth: 20 / (16/9) };
  const [targetX, targetY, targetZ] = mapTo3D(position, stageConfig);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.1);
      const targetRotation = new THREE.Euler(0, -degToRad(performer.rotation || 0), 0);
      const targetQ = new THREE.Quaternion().setFromEuler(targetRotation);
      meshRef.current.quaternion.slerp(targetQ, 0.1);
    }
  });

  const baseColor = new THREE.Color(performer.color);
  const displayColor = isSelected ? '#ffffff' : (hovered ? baseColor.clone().offsetHSL(0, 0, 0.1) : baseColor);

  return (
    <group ref={meshRef} onClick={(e) => { e.stopPropagation(); onSelect(performer.id); }}
      onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.6, 0.7, 32]} />
          <meshBasicMaterial color="#fbbf24" opacity={0.8} transparent />
        </mesh>
      )}
      <group position={[0, 0.9, 0]}>
        <mesh position={[0, -0.4, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.25, 0.25, 1, 16]} />
          <meshStandardMaterial color={displayColor} />
        </mesh>
        <mesh position={[0, 0.25, 0]} castShadow>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color={displayColor} />
        </mesh>
        <mesh position={[0, 0.25, 0.2]}>
          <boxGeometry args={[0.05, 0.05, 0.1]} />
          <meshStandardMaterial color="#333" />
        </mesh>
      </group>
      <Html position={[0, 2.2, 0]} center distanceFactor={10}>
        <div className={`px-2 py-1 rounded text-xs font-bold whitespace-nowrap select-none ${isSelected ? 'bg-yellow-400 text-black' : 'bg-black/50 text-white'}`}>
          {performer.name}
        </div>
      </Html>
    </group>
  );
};

export default Performer3D;