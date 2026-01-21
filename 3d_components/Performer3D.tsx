import React, { useRef, useState, useEffect } from 'react';
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
  stageConfig: { width: number; depth: number };
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onPositionChange?: (pos: Position) => void;
}

const Performer3D: React.FC<Performer3DProps> = ({
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

  // Initialize position on mount or when position changes significantly
  useEffect(() => {
    const [targetX, targetY, targetZ] = mapTo3D(position, stageConfig);
    // Only jump if this is a large change (not smooth animation)
    const current = currentPositionRef.current;
    const dist = current.distanceTo(new THREE.Vector3(targetX, targetY, targetZ));
    if (dist > 5) {
      currentPositionRef.current.set(targetX, targetY, targetZ);
      if (meshRef.current) {
        meshRef.current.position.set(targetX, targetY, targetZ);
      }
    }
  }, [performer.id, stageConfig]);

  const [targetX, targetY, targetZ] = mapTo3D(position, stageConfig);

  useFrame(() => {
    if (meshRef.current) {
      // Smoothly interpolate current position to target
      const target = new THREE.Vector3(targetX, targetY, targetZ);
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

  const baseColor = new THREE.Color(performer.color);
  const displayColor = isSelected ? '#ffffff' : (hovered ? baseColor.clone().offsetHSL(0, 0, 0.1) : baseColor);
  const performerHeight = 1.8; // Average human height in meters

  return (
    <group
      ref={meshRef}
      onClick={handleClick}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.6, 0.7, 32]} />
          <meshBasicMaterial color="#fbbf24" opacity={0.8} transparent />
        </mesh>
      )}
      <group position={[0, (performerHeight || 1.8) / 2, 0]}>
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

      {/* Height adjustment arrow (shown when selected) */}
      {isSelected && onPositionChange && (
        <group
          position={[0, performerHeight + 0.5, 0]}
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

      <Html position={[0, performerHeight + 0.5, 0]} center distanceFactor={10}>
        <div className={`px-2 py-1 rounded text-xs font-bold whitespace-nowrap select-none ${isSelected ? 'bg-yellow-400 text-black' : 'bg-black/50 text-white'}`}>
          {performer.name}
        </div>
      </Html>
    </group>
  );
};

export default Performer3D;