import React, { useRef, useState, useEffect } from 'react';
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
  stageConfig: { width: number; depth: number };
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onPositionChange?: (pos: Position) => void;
}

const Prop3D: React.FC<Prop3DProps> = ({
  performer,
  position,
  isSelected,
  onSelect,
  stageConfig,
  onDragStart,
  onDragEnd,
  onPositionChange
}) => {
  const meshRef = useRef<THREE.Group>(null);
  const [hovered, setHover] = useState(false);
  const currentPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const currentRotationRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);

  const dims = { width: performer.width || 1, height: performer.height || 1, depth: performer.depth || 1 };

  // Initialize position on mount or when position changes significantly
  useEffect(() => {
    const [targetX, targetY, targetZ] = mapTo3D(position, stageConfig);
    // Only jump if this is a large change (not smooth animation)
    const current = currentPositionRef.current;
    const targetWithHeight = new THREE.Vector3(targetX, targetY + dims.height / 2, targetZ);
    const dist = current.distanceTo(targetWithHeight);
    if (dist > 5) {
      currentPositionRef.current.copy(targetWithHeight);
      if (meshRef.current) {
        meshRef.current.position.copy(targetWithHeight);
      }
    }
  }, [performer.id, stageConfig, dims.height]);

  const [targetX, targetY, targetZ] = mapTo3D(position, stageConfig);

  useFrame(() => {
    if (meshRef.current) {
      // Smoothly interpolate current position to target (with height offset)
      const target = new THREE.Vector3(targetX, targetY + dims.height / 2, targetZ);
      currentPositionRef.current.lerp(target, 0.1);
      meshRef.current.position.copy(currentPositionRef.current);

      // Smoothly interpolate rotation
      const targetRotation = new THREE.Euler(0, -degToRad(performer.rotation || 0), 0);
      const targetQ = new THREE.Quaternion().setFromEuler(targetRotation);
      currentRotationRef.current.slerp(targetQ, 0.1);
      meshRef.current.quaternion.copy(currentRotationRef.current);
    }
  });

  const handleDragStart = (e: any) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    dragStartYRef.current = e.nativeEvent.clientY;
    dragStartHeightRef.current = position.z || 0;
    onDragStart?.();
  };

  const handleDragMove = (e: any) => {
    if (!isDraggingRef.current || !onPositionChange) return;
    e.stopPropagation();

    const deltaY = e.nativeEvent.clientY - dragStartYRef.current;
    const heightChange = deltaY * 0.01;
    const newHeight = Math.max(0, Math.min(10, dragStartHeightRef.current + heightChange));

    onPositionChange({
      x: position.x,
      y: position.y,
      z: newHeight
    });
  };

  const handleDragEnd = (e: any) => {
    e.stopPropagation();
    isDraggingRef.current = false;
    onDragEnd?.();
  };

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (!isDraggingRef.current) {
      onSelect(performer.id);
    }
  };

  return (
    <group
      ref={meshRef}
      onClick={handleClick}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
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

      {/* Height adjustment arrow (shown when selected) */}
      {isSelected && onPositionChange && (
        <group
          position={[0, dims.height / 2 + 0.5, 0]}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
        >
          <mesh>
            <coneGeometry args={[0.15, 0.3, 8]} />
            <meshStandardMaterial color="#fbbf24" />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 0.4, 8]} />
            <meshStandardMaterial color="#fbbf24" />
          </mesh>
          <mesh position={[0, -0.2, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.15, 0.3, 8]} />
            <meshStandardMaterial color="#fbbf24" />
          </mesh>
        </group>
      )}

      {isSelected && (
        <Html position={[0, dims.height / 2 + 1.2, 0]} center>
          <div className="bg-yellow-400 text-black px-2 py-0.5 rounded text-xs font-bold">{performer.name}</div>
        </Html>
      )}
    </group>
  );
};

export default Prop3D;