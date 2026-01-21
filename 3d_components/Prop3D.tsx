import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, Position } from '../types';
import { mapTo3D, degToRad } from '../utils/coordinates';
import { useDragContext } from './Scene3D';

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
  const { camera, raycaster, pointer } = useThree();
  const dragContext = useDragContext();
  const meshRef = useRef<THREE.Group>(null);
  const [hovered, setHover] = useState(false);
  const currentPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const currentRotationRef = useRef<THREE.Quaternion>(new THREE.Quaternion());

  // Height drag (vertical arrow) state
  const isHeightDraggingRef = useRef(false);
  const dragStartPointerYRef = useRef(0);
  const dragStartHeightRef = useRef(0);

  // Plane drag state
  const isPlaneDraggingRef = useRef(false);
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const arrowMeshRef = useRef<THREE.Group>(null);

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

    // Handle plane dragging
    if (isPlaneDraggingRef.current && onPositionChange) {
      raycaster.setFromCamera(pointer, camera);
      const intersectionPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlaneRef.current, intersectionPoint);
      if (intersectionPoint) {
        const clampedPoint = intersectionPoint.sub(dragOffsetRef.current);
        // Clamp to stage bounds
        clampedPoint.x = Math.max(-stageConfig.width / 2, Math.min(stageConfig.width / 2, clampedPoint.x));
        clampedPoint.z = Math.max(-stageConfig.depth / 2, Math.min(stageConfig.depth / 2, clampedPoint.z));

        const newPos = {
          x: ((clampedPoint.x / (stageConfig.width / 2)) * 50) + 50,
          y: ((clampedPoint.z / (stageConfig.depth / 2)) * 50) + 50,
          z: position.z || 0
        };
        onPositionChange(newPos);
      }
    }
  });

  // Plane drag handlers
  const handlePlanePointerDown = useCallback((e: any) => {
    if (!onPositionChange) return;
    e.stopPropagation();
    isPlaneDraggingRef.current = true;

    // Set up drag plane at y=0 (floor level)
    dragPlaneRef.current.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0)
    );

    // Calculate offset from intersection point to object center
    raycaster.setFromCamera(pointer, camera);
    const intersectionPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlaneRef.current, intersectionPoint);
    if (intersectionPoint && meshRef.current) {
      dragOffsetRef.current.copy(intersectionPoint).sub(meshRef.current.position);
    }

    dragContext.onPlaneDragStart(performer.id);
  }, [onPositionChange, camera, raycaster, pointer, dragContext, performer.id]);

  const handlePlanePointerUp = useCallback((e: any) => {
    e.stopPropagation();
    isPlaneDraggingRef.current = false;
    dragContext.onPlaneDragEnd();
  }, [dragContext]);

  // Height drag handlers (vertical arrow)
  const handleHeightDragStart = useCallback((e: any) => {
    e.stopPropagation();
    isHeightDraggingRef.current = true;
    dragStartPointerYRef.current = e.pointer.y;
    dragStartHeightRef.current = position.z || 0;
    onDragStart?.();
  }, [position.z, onDragStart]);

  const handleHeightDragMove = useCallback((e: any) => {
    if (!isHeightDraggingRef.current || !onPositionChange) return;
    e.stopPropagation();

    const deltaY = e.pointer.y - dragStartPointerYRef.current;
    // Use camera distance to scale the movement appropriately
    const { camera } = useThree();
    const scaleFactor = Math.abs(camera.position.z || 20) / 500;
    const heightChange = -deltaY * scaleFactor; // Negative because dragging up (negative y) should increase height
    const newHeight = Math.max(0, Math.min(10, dragStartHeightRef.current + heightChange));

    onPositionChange({
      x: position.x,
      y: position.y,
      z: newHeight
    });
  }, [onPositionChange, position.x, position.y]);

  const handleHeightDragEnd = useCallback((e: any) => {
    e.stopPropagation();
    isHeightDraggingRef.current = false;
    onDragEnd?.();
  }, [onDragEnd]);

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    if (!isPlaneDraggingRef.current && !isHeightDraggingRef.current) {
      onSelect(performer.id);
    }
  }, [onSelect, performer.id]);

  return (
    <group
      ref={meshRef}
      onClick={handleClick}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
      onPointerDown={handlePlanePointerDown}
      onPointerUp={handlePlanePointerUp}
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
          onPointerDown={handleHeightDragStart}
          onPointerMove={handleHeightDragMove}
          onPointerUp={handleHeightDragEnd}
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