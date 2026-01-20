import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, Position } from '../types';
import { mapTo3D, degToRad } from '../utils/coordinates';

interface Prop3DProps {
  performer: Performer;
  position: Position;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const Prop3D: React.FC<Prop3DProps> = ({ performer, position, isSelected, onSelect }) => {
  const meshRef = useRef<THREE.Group>(null);
  const [hovered, setHover] = useState(false);

  const stageConfig = { width: 20, depth: 20 / (16/9) };
  const [targetX, targetY, targetZ] = mapTo3D(position, stageConfig);
  const dims = { width: performer.width || 1, height: performer.height || 1, depth: performer.depth || 1 };

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.lerp(new THREE.Vector3(targetX, targetY + dims.height / 2, targetZ), 0.1);
      const targetRotation = new THREE.Euler(0, -degToRad(performer.rotation || 0), 0);
      meshRef.current.quaternion.slerp(new THREE.Quaternion().setFromEuler(targetRotation), 0.1);
    }
  });

  return (
    <group ref={meshRef} onClick={(e) => { e.stopPropagation(); onSelect(performer.id); }}
      onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[dims.width, dims.height, dims.depth]} />
        <meshStandardMaterial color={isSelected ? '#60a5fa' : performer.color} transparent opacity={hovered ? 0.9 : 1} />
      </mesh>
      {isSelected && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(dims.width, dims.height, dims.depth)]} />
          <lineBasicMaterial color="#fbbf24" linewidth={2} />
        </lineSegments>
      )}
      {isSelected && (
        <Html position={[0, dims.height / 2 + 0.5, 0]} center>
          <div className="bg-yellow-400 text-black px-2 py-0.5 rounded text-xs font-bold">{performer.name}</div>
        </Html>
      )}
    </group>
  );
};

export default Prop3D;