import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, Position, ExtrudedTextures, StageConfig } from '../types';
import { mapTo3D, mapTo2D, degToRad, getTotalStageWidth } from '../utils/coordinates';
import { canStartThreeObjectDrag } from '../utils/three-interaction';
import DirectionArrow3D from './DirectionArrow3D';
import { denormalizePoints } from '../components/prop-editor/PolygonUtils';
import { getPropAnchorFromCenter, getPropCenterFromAnchor } from '../utils/prop-pivot';

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

function createFaceMaterial(faceTexture?: { dataUrl?: string }, fallbackColor: string = '#475569'): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: fallbackColor, transparent: true, opacity: 1, side: THREE.FrontSide });
  if (faceTexture?.dataUrl) {
    const texture = new THREE.TextureLoader().load(faceTexture.dataUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    mat.map = texture;
    mat.color.set('#ffffff');
  }
  return mat;
}

interface Prop3DProps {
  performer: Performer;
  position: Position;
  rotationDeg?: number;
  platformLift?: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  stageConfig: StageConfig;
  showDirectionArrows?: boolean;
  dragEnabled?: boolean;
  onDragStart?: () => void;
  onDragEnd?: (position?: Position) => void;
  onPositionChange?: (pos: Position) => void;
}

const Prop3D: React.FC<Prop3DProps> = ({
  performer,
  position,
  rotationDeg = 0,
  platformLift = 0,
  isSelected,
  onSelect,
  stageConfig,
  showDirectionArrows = true,
  dragEnabled = false,
  onDragStart,
  onDragEnd,
  onPositionChange
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
    if (!captured || captured.pointerId !== event.pointerId) return;
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

  const isExtruded = performer.propGeometryType === 'extruded' &&
    performer.polygonPoints && performer.polygonPoints.length >= 3;

  const boxMaterials = useMemo(() => {
    if (isExtruded) return null;
    const hasTextures = (performer.boxTextures && Object.keys(performer.boxTextures).length > 0) || performer.textureDataUrl;
    if (!hasTextures) return null;
    const c = isSelected ? '#60a5fa' : performer.color;
    return [
      createFaceMaterial(performer.boxTextures?.right, c),
      createFaceMaterial(performer.boxTextures?.left, c),
      createFaceMaterial(performer.boxTextures?.top, c),
      createFaceMaterial(performer.boxTextures?.bottom, c),
      createFaceMaterial(performer.boxTextures?.front || (performer.textureDataUrl ? { dataUrl: performer.textureDataUrl } : undefined), c),
      createFaceMaterial(performer.boxTextures?.back, c),
    ];
  }, [performer.boxTextures, performer.textureDataUrl, performer.color, isSelected]);

  const extrudeGeometry = useMemo(() => {
    if (!isExtruded || !performer.polygonPoints) return null;
    const w = dims.width, d = dims.depth;
    const h = performer.extrudeHeight || dims.height;
    const denorm = denormalizePoints(performer.polygonPoints, w, d);
    const cx = denorm.reduce((s, p) => s + p.x, 0) / denorm.length;
    const cy = denorm.reduce((s, p) => s + p.y, 0) / denorm.length;
    const shape = new THREE.Shape();
    shape.moveTo(denorm[0].x - cx, denorm[0].y - cy);
    for (let i = 1; i < denorm.length; i++) shape.lineTo(denorm[i].x - cx, denorm[i].y - cy);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, h / 2, 0);
    return geo;
  }, [isExtruded, performer.polygonPoints, dims.width, dims.depth, performer.extrudeHeight, dims.height]);

  const extrudeMaterials = useMemo(() => {
    if (!isExtruded) return null;
    const c = isSelected ? '#60a5fa' : performer.color;
    const hasTextures = performer.extrudedTextures;
    if (!hasTextures) return null;
    return [
      createFaceMaterial(hasTextures.side, c),   // group 0 = sides
      createFaceMaterial(hasTextures.top, c),    // group 1 = top cap
      createFaceMaterial(hasTextures.bottom, c), // group 2 = bottom cap
    ];
  }, [isExtruded, performer.extrudedTextures, performer.color, isSelected]);

  // Collect materials for cleanup
  const materialsToCleanup = useMemo(() => {
    const mats: THREE.MeshStandardMaterial[] = [];
    if (boxMaterials) mats.push(...boxMaterials);
    if (extrudeMaterials) mats.push(...extrudeMaterials);
    return mats;
  }, [boxMaterials, extrudeMaterials]);

  // Dispose materials and their textures when they change
  useEffect(() => {
    return () => {
      materialsToCleanup.forEach(mat => {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      });
    };
  }, [materialsToCleanup]);

  // Memoize edges geometry instead of creating every render
  const edgesGeometry = useMemo(() => {
    if (isExtruded && extrudeGeometry) return new THREE.EdgesGeometry(extrudeGeometry);
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(dims.width, dims.height, dims.depth));
  }, [isExtruded, extrudeGeometry, dims.width, dims.height, dims.depth]);

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
      {isExtruded && extrudeGeometry ? (
        <mesh castShadow receiveShadow geometry={extrudeGeometry}>
          {extrudeMaterials ? (
            extrudeMaterials.map((mat, i) => <primitive key={i} object={mat} attach={`material-${i}`} />)
          ) : (
            <meshStandardMaterial color={isSelected ? '#60a5fa' : performer.color} transparent opacity={hovered ? 0.9 : 1} />
          )}
        </mesh>
      ) : (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[dims.width, dims.height, dims.depth]} />
          {boxMaterials ? (
            boxMaterials.map((mat, i) => <primitive key={i} object={mat} attach={`material-${i}`} />)
          ) : (
            <meshStandardMaterial color={isSelected ? '#60a5fa' : performer.color} transparent opacity={hovered ? 0.9 : 1} />
          )}
        </mesh>
      )}
      {isSelected && edgesGeometry && (
        <lineSegments geometry={edgesGeometry}>
          <lineBasicMaterial color="#fbbf24" linewidth={2} />
        </lineSegments>
      )}

      {isSelected && (
        <Html position={[0, dims.height / 2 + 0.5, 0]} center zIndexRange={[40, 0]}>
          <div className="bg-yellow-400 text-black px-2 py-0.5 rounded text-xs font-bold">{performer.name}</div>
        </Html>
      )}
    </group>
  );
};

export default Prop3D;
