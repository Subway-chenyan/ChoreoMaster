import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, Position, ExtrudedTextures } from '../types';
import { mapTo3D, degToRad } from '../utils/coordinates';
import { useDragContext } from './Scene3D';
import { denormalizePoints } from '../components/prop-editor/PolygonUtils';

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

  // Plane drag state
  const isPlaneDraggingRef = useRef(false);
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());

  const dims = { width: performer.width || 1, height: performer.height || 1, depth: performer.depth || 1 };

  const isExtruded = performer.propGeometryType === 'extruded' &&
    performer.polygonPoints && performer.polygonPoints.length >= 3;

  const boxMaterials = useMemo(() => {
    if (isExtruded) return null;
    const hasTextures = performer.boxTextures && Object.keys(performer.boxTextures).length > 0;
    if (!hasTextures) return null;
    const c = isSelected ? '#60a5fa' : performer.color;
    return [
      createFaceMaterial(performer.boxTextures?.right, c),
      createFaceMaterial(performer.boxTextures?.left, c),
      createFaceMaterial(performer.boxTextures?.top, c),
      createFaceMaterial(performer.boxTextures?.bottom, c),
      createFaceMaterial(performer.boxTextures?.front, c),
      createFaceMaterial(performer.boxTextures?.back, c),
    ];
  }, [performer.boxTextures, performer.color, isSelected]);

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

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
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
    >
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
      {isSelected && (
        <lineSegments>
          <edgesGeometry args={isExtruded && extrudeGeometry ? [extrudeGeometry] : [new THREE.BoxGeometry(dims.width, dims.height, dims.depth)]} />
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
