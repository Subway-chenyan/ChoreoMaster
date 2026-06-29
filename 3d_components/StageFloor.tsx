import React, { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { StageConfig } from '../types';
import { getWingWidth } from '../utils/coordinates';
import { createCenteredStageGridMarks, STAGE_THIRD_POSITIONS } from '../utils/stage-grid';
import { resolveStageBackgroundUrl } from '../utils/stage-config';

interface StageFloorProps {
  stageConfig: StageConfig;
  mediaCache?: Record<string, string>;
  gridScale?: number;
}

const StageFloor: React.FC<StageFloorProps> = ({ stageConfig, mediaCache = {}, gridScale = 1 }) => {
  const { width, depth } = stageConfig;
  const wingWidth = getWingWidth(stageConfig);
  const totalWidth = width + wingWidth * 2;
  const gridMarks = createCenteredStageGridMarks(totalWidth, gridScale);
  const showStageLines = stageConfig.showStageLines !== false;
  const backgroundUrl = resolveStageBackgroundUrl(stageConfig, mediaCache);
  const [backgroundTexture, setBackgroundTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    setBackgroundTexture(null);
    if (!backgroundUrl) {
      return undefined;
    }
    let disposed = false;
    let loadedTexture: THREE.Texture | null = null;
    new THREE.TextureLoader().load(
      backgroundUrl,
      (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        loadedTexture = texture;
        setBackgroundTexture(texture);
      },
      undefined,
      (error) => console.warn('舞台底图纹理加载失败：', error),
    );
    return () => {
      disposed = true;
      loadedTexture?.dispose();
    };
  }, [backgroundUrl]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.8} metalness={0.2} />
      </mesh>
      {wingWidth > 0 && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-(width + wingWidth) / 2, -0.01, 0]} receiveShadow>
            <planeGeometry args={[wingWidth, depth]} />
            <meshStandardMaterial color="#0f172a" roughness={0.9} metalness={0.1} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(width + wingWidth) / 2, -0.01, 0]} receiveShadow>
            <planeGeometry args={[wingWidth, depth]} />
            <meshStandardMaterial color="#0f172a" roughness={0.9} metalness={0.1} />
          </mesh>
        </>
      )}

      {backgroundTexture && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
          <planeGeometry args={[totalWidth, depth]} />
          <meshBasicMaterial
            map={backgroundTexture}
            transparent
            opacity={stageConfig.background?.opacity ?? 0.5}
            toneMapped={false}
          />
        </mesh>
      )}

      {gridMarks.map((mark) => (
        <mesh key={`meter-${mark.offsetMeters}`} position={[mark.offsetMeters, 0.01, 0]}>
          <boxGeometry args={[mark.offsetMeters === 0 ? 0.035 : 0.02, 0.018, depth]} />
          <meshBasicMaterial
            color={mark.offsetMeters === 0 ? '#cbd5e1' : '#475569'}
            transparent
            opacity={mark.offsetMeters === 0 ? 0.8 : 0.55}
          />
        </mesh>
      ))}
      {showStageLines && STAGE_THIRD_POSITIONS.map((position) => (
        <mesh
          key={`third-${position}`}
          position={[0, 0.025, -depth / 2 + position * depth]}
        >
          <boxGeometry args={[totalWidth, 0.035, 0.065]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.85} />
        </mesh>
      ))}
      {showStageLines && wingWidth > 0 && (
        <>
          <mesh position={[-width / 2, 0.025, 0]}>
            <boxGeometry args={[0.06, 0.05, depth]} />
            <meshBasicMaterial color="#f59e0b" />
          </mesh>
          <mesh position={[width / 2, 0.025, 0]}>
            <boxGeometry args={[0.06, 0.05, depth]} />
            <meshBasicMaterial color="#f59e0b" />
          </mesh>
        </>
      )}

      {/* Red line at front (z = -depth/2, towards camera) */}
      <mesh position={[0, 0.02, -depth / 2]}>
        <boxGeometry args={[totalWidth, 0.05, 0.1]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      {/* Blue line at back (z = depth/2, away from camera) */}
      <mesh position={[0, 0.02, depth / 2]}>
        <boxGeometry args={[totalWidth, 0.05, 0.1]} />
        <meshBasicMaterial color="#3b82f6" />
      </mesh>
    </group>
  );
};

export default StageFloor;
