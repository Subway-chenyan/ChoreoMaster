import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, Position, StageConfig } from '../types';
import { mapTo3D, mapTo2D, degToRad, getTotalStageWidth } from '../utils/coordinates';
import {
  canStartThreeObjectDrag,
  isMatchingCapturedPointer,
  resolveThreeHeightFromPointerDrag,
} from '../utils/three-interaction';
import DirectionArrow3D from './DirectionArrow3D';
import { getPerformerDimensions, getStageLabelFontSize } from '../electron/stage-defaults';

interface PointerCaptureApi extends EventTarget {
  hasPointerCapture(pointerId: number): boolean;
  releasePointerCapture(pointerId: number): void;
  setPointerCapture(pointerId: number): void;
}

function getPointerCaptureApi(
  event: ThreeEvent<PointerEvent>,
): PointerCaptureApi | null {
  const target = event.target;
  if (
    !target
    || !('hasPointerCapture' in target)
    || typeof target.hasPointerCapture !== 'function'
    || !('releasePointerCapture' in target)
    || typeof target.releasePointerCapture !== 'function'
    || !('setPointerCapture' in target)
    || typeof target.setPointerCapture !== 'function'
  ) return null;
  return target as PointerCaptureApi;
}

interface Performer3DProps {
  performer: Performer;
  position: Position;
  rotationDeg?: number;
  platformLift?: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  stageConfig: StageConfig;
  showLabels?: boolean;
  showDirectionArrows?: boolean;
  dragEnabled?: boolean;
  onDragStart?: () => void;
  onDragEnd?: (position?: Position) => void;
  onPositionChange?: (pos: Position) => void;
  onOpenEditor?: (id: string) => void;
}

const Performer3D: React.FC<Performer3DProps> = ({
  performer,
  position,
  rotationDeg = 0,
  platformLift = 0,
  isSelected,
  onSelect,
  stageConfig,
  showLabels = true,
  showDirectionArrows = true,
  dragEnabled = false,
  onDragStart,
  onDragEnd,
  onPositionChange,
  onOpenEditor,
}) => {
  const { camera, raycaster, pointer, gl } = useThree();
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
  const lastPlanePositionRef = useRef<Position | null>(null);
  const capturedPointerRef = useRef<{
    pointerId: number;
    target: PointerCaptureApi;
  } | null>(null);
  const onDragEndRef = useRef(onDragEnd);

  const capturePointer = useCallback((event: ThreeEvent<PointerEvent>) => {
    const target = getPointerCaptureApi(event);
    if (!target) return;
    target.setPointerCapture(event.pointerId);
    capturedPointerRef.current = { pointerId: event.pointerId, target };
  }, []);

  const releaseCapturedPointer = useCallback(() => {
    const captured = capturedPointerRef.current;
    capturedPointerRef.current = null;
    if (!captured || !captured.target.hasPointerCapture(captured.pointerId)) return;
    captured.target.releasePointerCapture(captured.pointerId);
  }, []);

  const finishActiveDrag = useCallback((notifyDragEnd: boolean = true) => {
    if (!isPlaneDraggingRef.current && !isHeightDraggingRef.current) return;
    const finalPosition = lastPlanePositionRef.current ?? undefined;
    isPlaneDraggingRef.current = false;
    isHeightDraggingRef.current = false;
    lastPlanePositionRef.current = null;
    releaseCapturedPointer();
    if (notifyDragEnd) onDragEndRef.current?.(finalPosition);
  }, [releaseCapturedPointer]);

  useEffect(() => {
    onDragEndRef.current = onDragEnd;
  }, [onDragEnd]);

  const handleCanvasPointerTermination = useCallback((event: PointerEvent) => {
    const captured = capturedPointerRef.current;
    if (!isMatchingCapturedPointer(captured?.pointerId, event.pointerId)) return;
    finishActiveDrag();
  }, [finishActiveDrag]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointercancel', handleCanvasPointerTermination);
    canvas.addEventListener('lostpointercapture', handleCanvasPointerTermination);
    return () => {
      canvas.removeEventListener('pointercancel', handleCanvasPointerTermination);
      canvas.removeEventListener('lostpointercapture', handleCanvasPointerTermination);
    };
  }, [gl, handleCanvasPointerTermination]);

  useEffect(() => {
    if (dragEnabled) return;
    finishActiveDrag();
  }, [dragEnabled, finishActiveDrag]);

  useEffect(() => () => {
    finishActiveDrag(false);
  }, [finishActiveDrag]);

  // Initialize position on mount or when position changes significantly
  useEffect(() => {
    const [targetX, targetY, targetZ] = mapTo3D({
      ...position,
      z: (position.z || 0) + platformLift,
    }, stageConfig);
    // Only jump if this is a large change (not smooth animation)
    const current = currentPositionRef.current;
    const dist = current.distanceTo(new THREE.Vector3(targetX, targetY, targetZ));
    if (dist > 5) {
      currentPositionRef.current.set(targetX, targetY, targetZ);
      if (meshRef.current) {
        meshRef.current.position.set(targetX, targetY, targetZ);
      }
    }
  }, [performer.id, position, platformLift, stageConfig]);

  const [targetX, targetY, targetZ] = mapTo3D({
    ...position,
    z: (position.z || 0) + platformLift,
  }, stageConfig);

  useFrame(() => {
    if (meshRef.current) {
      // Smoothly interpolate current position to target
      const target = new THREE.Vector3(targetX, targetY, targetZ);
      currentPositionRef.current.lerp(target, 0.1);
      meshRef.current.position.copy(currentPositionRef.current);

      // Smoothly interpolate rotation
      const targetRotation = new THREE.Euler(0, -degToRad(rotationDeg), 0);
      const targetQ = new THREE.Quaternion().setFromEuler(targetRotation);
      currentRotationRef.current.slerp(targetQ, 0.1);
      meshRef.current.quaternion.copy(currentRotationRef.current);
    }

    // Handle plane dragging
    if (isPlaneDraggingRef.current && dragEnabled && onPositionChange) {
      raycaster.setFromCamera(pointer, camera);
      const intersectionPoint = new THREE.Vector3();
      const intersection = raycaster.ray.intersectPlane(dragPlaneRef.current, intersectionPoint);
      if (intersection) {
        const clampedPoint = intersectionPoint.sub(dragOffsetRef.current);
        // Clamp to the full floor, including both wings.
        const totalWidth = getTotalStageWidth(stageConfig);
        clampedPoint.x = Math.max(-totalWidth / 2, Math.min(totalWidth / 2, clampedPoint.x));
        clampedPoint.z = Math.max(-stageConfig.depth / 2, Math.min(stageConfig.depth / 2, clampedPoint.z));

        const newPos = mapTo2D(clampedPoint.x, position.z || 0, clampedPoint.z, stageConfig);
        lastPlanePositionRef.current = newPos;
        onPositionChange(newPos);
      }
    }
  });

  // Plane drag handlers
  const handlePlanePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (event.button === 2) {
      event.stopPropagation();
      event.nativeEvent.preventDefault();
      onSelect(performer.id);
      onOpenEditor?.(performer.id);
      return;
    }
    if (!onPositionChange || !canStartThreeObjectDrag({
      dragEnabled,
      readonly: false,
      button: event.button,
    })) return;
    event.stopPropagation();
    capturePointer(event);
    isPlaneDraggingRef.current = true;
    lastPlanePositionRef.current = null;

    // Set up drag plane at y=0 (floor level)
    dragPlaneRef.current.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0)
    );

    // Calculate offset from intersection point to object center
    raycaster.setFromCamera(pointer, camera);
    const intersectionPoint = new THREE.Vector3();
    const intersection = raycaster.ray.intersectPlane(dragPlaneRef.current, intersectionPoint);
    if (intersection && meshRef.current) {
      dragOffsetRef.current.copy(intersectionPoint).sub(meshRef.current.position);
    }

    onDragStart?.();
  }, [camera, capturePointer, dragEnabled, onDragStart, onOpenEditor, onPositionChange, onSelect, performer.id, pointer, raycaster]);

  const handlePlanePointerUp = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!isPlaneDraggingRef.current) return;
    if (!isMatchingCapturedPointer(capturedPointerRef.current?.pointerId, event.pointerId)) return;
    event.stopPropagation();
    finishActiveDrag();
  }, [finishActiveDrag]);

  const handlePlanePointerCancel = handlePlanePointerUp;

  // Height drag handlers (vertical arrow)
  const handleHeightDragStart = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!onPositionChange || !canStartThreeObjectDrag({
      dragEnabled,
      readonly: false,
      button: event.button,
    })) return;
    event.stopPropagation();
    capturePointer(event);
    isHeightDraggingRef.current = true;
    lastPlanePositionRef.current = null;
    dragStartPointerYRef.current = event.nativeEvent.clientY;
    dragStartHeightRef.current = position.z || 0;
    onDragStart?.();
  }, [capturePointer, dragEnabled, onDragStart, onPositionChange, position.z]);

  const handleHeightDragMove = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!isHeightDraggingRef.current || !dragEnabled || !onPositionChange) return;
    event.stopPropagation();

    const cameraDistance = camera.position.distanceTo(
      meshRef.current?.position ?? currentPositionRef.current,
    );
    const newHeight = resolveThreeHeightFromPointerDrag({
      startHeight: dragStartHeightRef.current,
      startClientY: dragStartPointerYRef.current,
      currentClientY: event.nativeEvent.clientY,
      cameraDistance,
    });

    const newPosition = {
      x: position.x,
      y: position.y,
      z: newHeight
    };
    lastPlanePositionRef.current = newPosition;
    onPositionChange(newPosition);
  }, [camera.position, dragEnabled, onPositionChange, position.x, position.y]);

  const handleHeightDragEnd = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!isHeightDraggingRef.current) return;
    if (!isMatchingCapturedPointer(capturedPointerRef.current?.pointerId, event.pointerId)) return;
    event.stopPropagation();
    finishActiveDrag();
  }, [finishActiveDrag]);

  const handleHeightPointerCancel = handleHeightDragEnd;

  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!isPlaneDraggingRef.current && !isHeightDraggingRef.current) {
      onSelect(performer.id);
    }
  }, [onSelect, performer.id]);

  const baseColor = new THREE.Color(performer.color);
  const displayColor = isSelected ? '#ffffff' : (hovered ? baseColor.clone().offsetHSL(0, 0, 0.1) : baseColor);
  const performerDimensions = getPerformerDimensions(performer);
  const performerHeight = performerDimensions.height;
  const bodyWidth = Math.max(0.35, performerDimensions.width * 0.45);
  const bodyDepth = Math.max(0.28, performerDimensions.depth * 0.45);
  const bodyHeight = Math.max(0.9, performerHeight - 0.7);
  const headRadius = Math.max(0.16, Math.min(0.34, performerHeight * 0.12));
  const labelFontSize = getStageLabelFontSize(
    performer,
    stageConfig.performerLabelFontSize,
    stageConfig.propLabelFontSize,
  );

  return (
    <group
      ref={meshRef}
      onClick={handleClick}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
      onPointerDown={handlePlanePointerDown}
      onPointerUp={handlePlanePointerUp}
      onPointerCancel={handlePlanePointerCancel}
      onLostPointerCapture={handlePlanePointerCancel}
    >
      {showDirectionArrows && <DirectionArrow3D scale={0.9} />}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.6, 0.7, 32]} />
          <meshBasicMaterial color="#fbbf24" opacity={0.8} transparent />
        </mesh>
      )}
      <group position={[0, 0, 0]}>
        <mesh position={[0, bodyHeight / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[bodyWidth, bodyHeight, bodyDepth]} />
          <meshStandardMaterial color={displayColor} />
        </mesh>
        <mesh position={[0, bodyHeight + headRadius * 0.9, 0]} castShadow>
          <sphereGeometry args={[headRadius, 16, 16]} />
          <meshStandardMaterial color={displayColor} />
        </mesh>
        <mesh position={[0, bodyHeight + headRadius * 0.9, headRadius]}>
          <boxGeometry args={[0.05, 0.05, Math.max(0.08, headRadius * 0.45)]} />
          <meshStandardMaterial color="#333" />
        </mesh>
      </group>

      {/* Height adjustment arrow (shown when selected) */}
      {isSelected && onPositionChange && (
        <group
          position={[0, performerHeight + 0.5, 0]}
          onPointerDown={handleHeightDragStart}
          onPointerMove={handleHeightDragMove}
          onPointerUp={handleHeightDragEnd}
          onPointerCancel={handleHeightPointerCancel}
          onLostPointerCapture={handleHeightPointerCancel}
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

      {showLabels && (
        <Html
          position={[0, performerHeight + 0.5, 0]}
          center
          distanceFactor={10}
          zIndexRange={[40, 0]}
        >
          <div
            className={`px-2 py-1 rounded font-bold whitespace-nowrap select-none ${isSelected ? 'bg-yellow-400 text-black' : 'bg-black/50 text-white'}`}
            style={{ fontSize: `${labelFontSize}px` }}
          >
            {performer.name}
          </div>
        </Html>
      )}
    </group>
  );
};

export default Performer3D;
