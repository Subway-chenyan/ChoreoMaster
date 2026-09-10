import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, Position, ProjectModelAsset, StageConfig } from '../types';
import { mapTo3D, mapTo2D, degToRad, getTotalStageWidth } from '../utils/coordinates';
import {
  canStartThreeObjectDrag,
  isMatchingCapturedPointer,
} from '../utils/three-interaction';
import DirectionArrow3D from './DirectionArrow3D';
import { getPropAnchorFromCenter, getPropCenterFromAnchor } from '../utils/prop-pivot';
import { getStageLabelFontSize } from '../electron/stage-defaults';
import ModelAsset3D from './ModelAsset3D';

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

interface Prop3DProps {
  performer: Performer;
  modelAsset?: ProjectModelAsset;
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
  immediateTransform?: boolean;
}

const Prop3D: React.FC<Prop3DProps> = ({
  performer,
  modelAsset,
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
  immediateTransform = false,
}) => {
  const { camera, raycaster, pointer, gl } = useThree();
  const meshRef = useRef<THREE.Group>(null);
  const [hovered, setHover] = useState(false);
  const currentPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const currentRotationRef = useRef<THREE.Quaternion>(new THREE.Quaternion());

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
    if (!isPlaneDraggingRef.current) return;
    const finalPosition = lastPlanePositionRef.current ?? undefined;
    isPlaneDraggingRef.current = false;
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

  const dims = { width: performer.width || 1, height: performer.height || 1, depth: performer.depth || 1 };
  const labelFontSize = getStageLabelFontSize(
    performer,
    stageConfig.performerLabelFontSize,
    stageConfig.propLabelFontSize,
  );

  const edgesGeometry = useMemo(() => {
    const geometry = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
    const edges = new THREE.EdgesGeometry(geometry);
    geometry.dispose();
    return edges;
  }, [dims.width, dims.height, dims.depth]);

  useEffect(() => () => edgesGeometry.dispose(), [edgesGeometry]);

  // Initialize position on mount or when position changes significantly
  const centerPosition = getPropCenterFromAnchor(position, rotationDeg, performer, stageConfig);

  useEffect(() => {
    const [targetX, targetY, targetZ] = mapTo3D({
      ...centerPosition,
      z: (centerPosition.z || 0) + platformLift,
    }, stageConfig);
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
  }, [performer.id, centerPosition.x, centerPosition.y, centerPosition.z, platformLift, stageConfig, dims.height]);

  const [targetX, targetY, targetZ] = mapTo3D({
    ...centerPosition,
    z: (centerPosition.z || 0) + platformLift,
  }, stageConfig);

  useFrame(() => {
    if (meshRef.current) {
      // Smoothly interpolate current position to target (with height offset)
      const target = new THREE.Vector3(targetX, targetY + dims.height / 2, targetZ);
      if (immediateTransform) currentPositionRef.current.copy(target);
      else currentPositionRef.current.lerp(target, 0.1);
      meshRef.current.position.copy(currentPositionRef.current);

      // Smoothly interpolate rotation
      const targetRotation = new THREE.Euler(0, -degToRad(rotationDeg), 0);
      const targetQ = new THREE.Quaternion().setFromEuler(targetRotation);
      if (immediateTransform) currentRotationRef.current.copy(targetQ);
      else currentRotationRef.current.slerp(targetQ, 0.1);
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

        const movedCenter = mapTo2D(
          clampedPoint.x,
          position.z || 0,
          clampedPoint.z,
          stageConfig,
        );
        const newPos = getPropAnchorFromCenter(
          movedCenter,
          rotationDeg,
          performer,
          stageConfig,
        );
        lastPlanePositionRef.current = newPos;
        onPositionChange(newPos);
      }
    }
  });

  // Plane drag handlers
  const handlePlanePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
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
  }, [camera, capturePointer, dragEnabled, onDragStart, onPositionChange, pointer, raycaster]);

  const handlePlanePointerUp = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!isPlaneDraggingRef.current) return;
    if (!isMatchingCapturedPointer(capturedPointerRef.current?.pointerId, event.pointerId)) return;
    event.stopPropagation();
    finishActiveDrag();
  }, [finishActiveDrag]);

  const handlePlanePointerCancel = handlePlanePointerUp;

  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!isPlaneDraggingRef.current) {
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
      onPointerCancel={handlePlanePointerCancel}
      onLostPointerCapture={handlePlanePointerCancel}
    >
      {showDirectionArrows && <DirectionArrow3D scale={Math.max(0.75, Math.min(1.5, dims.width))} y={-dims.height / 2 + 0.06} />}
      {modelAsset ? (
        <ModelAsset3D
          asset={modelAsset}
          width={dims.width}
          height={dims.height}
          depth={dims.depth}
          selected={isSelected}
        />
      ) : (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[dims.width, dims.height, dims.depth]} />
          <meshStandardMaterial color={isSelected ? '#60a5fa' : performer.color} transparent opacity={hovered ? 0.9 : 1} />
        </mesh>
      )}
      {!modelAsset && isSelected && edgesGeometry && (
        <lineSegments geometry={edgesGeometry}>
          <lineBasicMaterial color="#fbbf24" linewidth={2} />
        </lineSegments>
      )}

      {showLabels && (
        <Html position={[0, dims.height / 2 + 0.5, 0]} center distanceFactor={10} zIndexRange={[40, 0]}>
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

export default Prop3D;
