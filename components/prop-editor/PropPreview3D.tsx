// ---------------------------------------------------------------------------
// PropPreview3D.tsx – Real-time 3D preview for the prop editor
// Shows either a box or an extruded polygon depending on propGeometryType.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, BoxTextures, PropGeometryType, FaceTexture } from '../../types';
import { Point, denormalizePoints } from './PolygonUtils';

// ── Public props ──────────────────────────────────────────────────────────

interface PropPreview3DProps {
  performer: Partial<Performer>;
  boxTextures?: BoxTextures;
  sideTexture?: FaceTexture;
  topTexture?: FaceTexture;
  bottomTexture?: FaceTexture;
  polygonPoints?: Point[];
  propGeometryType: PropGeometryType;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Create a MeshStandardMaterial for a single face.
 * If a faceTexture with a dataUrl is provided, it is applied as a map.
 * Otherwise a flat fallbackColor is used.
 */
function createFaceMaterial(
  faceTexture?: FaceTexture,
  fallbackColor: string = '#475569',
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: fallbackColor,
    transparent: true,
  });
  if (faceTexture?.dataUrl) {
    const texture = new THREE.TextureLoader().load(faceTexture.dataUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    mat.map = texture;
    mat.color.set('#ffffff');
  }
  return mat;
}

// ── BoxPreview ────────────────────────────────────────────────────────────

function BoxPreview({
  performer,
  boxTextures,
}: {
  performer: Partial<Performer>;
  boxTextures?: BoxTextures;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  const w = performer.width ?? 1;
  const h = performer.height ?? 1;
  const d = performer.depth ?? 1;

  // Material order for boxGeometry: +X, -X, +Y, -Y, +Z, -Z
  const materials = useMemo(() => {
    return [
      createFaceMaterial(boxTextures?.right, '#475569'),   // +X right
      createFaceMaterial(boxTextures?.left, '#475569'),    // -X left
      createFaceMaterial(boxTextures?.top, '#64748b'),     // +Y top
      createFaceMaterial(boxTextures?.bottom, '#334155'),   // -Y bottom
      createFaceMaterial(boxTextures?.front, '#475569'),   // +Z front
      createFaceMaterial(boxTextures?.back, '#475569'),    // -Z back
    ];
  }, [boxTextures]);

  // Dispose materials and their textures when they change
  useEffect(() => {
    return () => {
      materials.forEach(mat => {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      });
    };
  }, [materials]);

  useFrame(() => {
    if (meshRef.current) {
      const targetQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 6, Math.PI / 4, 0),
      );
      meshRef.current.quaternion.slerp(targetQ, 0.05);
    }
  });

  return (
    <mesh ref={meshRef} material={materials}>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

// ── ExtrudedPreview ──────────────────────────────────────────────────────

function ExtrudedPreview({
  performer,
  polygonPoints,
  sideTexture,
  topTexture,
  bottomTexture,
}: {
  performer: Partial<Performer>;
  polygonPoints?: Point[];
  sideTexture?: FaceTexture;
  topTexture?: FaceTexture;
  bottomTexture?: FaceTexture;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  const w = performer.width ?? 1;
  const h = performer.height ?? 1;
  const d = performer.depth ?? 1;

  const geometry = useMemo(() => {
    if (!polygonPoints || polygonPoints.length < 3) {
      // Fallback to a simple box if no valid polygon
      return new THREE.BoxGeometry(w, h, d);
    }

    // Denormalize points from [0,1] to physical dimensions
    const pts = denormalizePoints(polygonPoints, w, d);

    // Compute centroid and center the shape
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

    // Build THREE.Shape
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x - cx, pts[0].y - cy);
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(pts[i].x - cx, pts[i].y - cy);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: h,
      bevelEnabled: false,
    });

    // Rotate so extrusion goes up (along Y axis)
    geo.rotateX(-Math.PI / 2);

    // Translate so the mesh sits on the ground plane
    geo.translate(0, h / 2, 0);

    return geo;
  }, [polygonPoints, w, h, d]);

  const materials = useMemo(() => {
    return [
      createFaceMaterial(sideTexture, '#475569'),    // group 0 = sides
      createFaceMaterial(topTexture, '#64748b'),      // group 1 = top cap
      createFaceMaterial(bottomTexture, '#334155'),   // group 2 = bottom cap
    ];
  }, [sideTexture, topTexture, bottomTexture]);

  // Dispose materials and their textures when they change
  useEffect(() => {
    return () => {
      materials.forEach(mat => {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      });
    };
  }, [materials]);

  useFrame(() => {
    if (meshRef.current) {
      const targetQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 6, Math.PI / 4, 0),
      );
      meshRef.current.quaternion.slerp(targetQ, 0.05);
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry} material={materials} />
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function PropPreview3D({
  performer,
  boxTextures,
  sideTexture,
  topTexture,
  bottomTexture,
  polygonPoints,
  propGeometryType,
}: PropPreview3DProps) {
  return (
    <Canvas
      camera={{ position: [5, 5, 5], fov: 50 }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#0f172a']} />

      <ambientLight intensity={0.6} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={0.8}
        castShadow
      />

      <OrbitControls enablePan={false} enableZoom enableRotate />

      <gridHelper args={[20, 40]} />

      {propGeometryType === 'box' ? (
        <BoxPreview performer={performer} boxTextures={boxTextures} />
      ) : (
        <ExtrudedPreview
          performer={performer}
          polygonPoints={polygonPoints}
          sideTexture={sideTexture}
          topTexture={topTexture}
          bottomTexture={bottomTexture}
        />
      )}
    </Canvas>
  );
}
