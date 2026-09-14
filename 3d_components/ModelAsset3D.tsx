import React, { useEffect, useMemo, useState } from 'react';
import { Html, useProgress } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ProjectModelAsset } from '../types';
import {
  createMissingModelPlaceholder,
  createModelAssetInstance,
  releaseModelAssetInstance,
  tintModelObject,
} from '../utils/model-runtime';

interface ModelAsset3DProps {
  asset: ProjectModelAsset;
  width: number;
  height: number;
  depth: number;
  selected?: boolean;
  tintColor?: string;
  onLoaded?: (size: { width: number; height: number; depth: number }) => void;
}

const ModelAsset3D: React.FC<ModelAsset3DProps> = ({ asset, width, height, depth, selected = false, tintColor, onLoaded }) => {
  const { gl } = useThree();
  const [instance, setInstance] = useState<THREE.Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { active } = useProgress();

  useEffect(() => {
    let cancelled = false;
    let loaded: THREE.Group | null = null;
    setError(null);
    void createModelAssetInstance(asset, gl).then((next) => {
      loaded = next;
      if (cancelled) {
        releaseModelAssetInstance(next);
        return;
      }
      setInstance(next);
      next.updateMatrixWorld(true);
      const measured = new THREE.Box3().setFromObject(next).getSize(new THREE.Vector3());
      onLoaded?.({
        width: Math.max(0.001, measured.x),
        height: Math.max(0.001, measured.y),
        depth: Math.max(0.001, measured.z),
      });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '模型加载失败');
    });
    return () => {
      cancelled = true;
      if (loaded) releaseModelAssetInstance(loaded);
      setInstance(null);
    };
  }, [asset, attempt, gl, onLoaded]);

  // 实例与缓存源共享材质，着色用克隆材质，卸载时只 dispose 克隆出来的部分。
  useEffect(() => {
    if (!instance || !tintColor) return;
    const tintedMaterials = tintModelObject(instance, tintColor);
    return () => {
      tintedMaterials.forEach((material) => material.dispose());
    };
  }, [instance, tintColor]);

  const placeholder = useMemo(
    () => createMissingModelPlaceholder(width, height, depth),
    [depth, height, width],
  );
  useEffect(() => () => {
    placeholder.traverse((object) => {
      if (!(object instanceof THREE.LineSegments)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }, [placeholder]);

  const scale: [number, number, number] = [
    width / asset.intrinsicSize.width,
    height / asset.intrinsicSize.height,
    depth / asset.intrinsicSize.depth,
  ];
  const selectionEdges = useMemo(() => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const edges = new THREE.EdgesGeometry(geometry);
    geometry.dispose();
    return edges;
  }, [depth, height, width]);
  useEffect(() => () => selectionEdges.dispose(), [selectionEdges]);

  return (
    <group>
      {instance ? (
        <primitive object={instance} scale={scale} position={[0, -height / 2, 0]} />
      ) : (
        <primitive object={placeholder} />
      )}
      {selected && (
        <lineSegments geometry={selectionEdges}>
          <lineBasicMaterial color="#fbbf24" />
        </lineSegments>
      )}
      {(error || (!instance && active)) && (
        <Html position={[0, height / 2 + 0.2, 0]} center zIndexRange={[45, 0]}>
          <button
            type="button"
            className="rounded bg-red-950/90 px-2 py-1 text-[11px] text-red-100 shadow"
            onClick={(event) => {
              event.stopPropagation();
              if (error) setAttempt((value) => value + 1);
            }}
          >
            {error ? `加载失败 · 重试` : '加载模型…'}
          </button>
        </Html>
      )}
    </group>
  );
};

export default ModelAsset3D;
