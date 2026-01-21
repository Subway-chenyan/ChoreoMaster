import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { StageConfig } from '../types';

interface LEDTVProps {
  config: StageConfig;
  mediaCache?: Record<string, string>;
}

const LEDTV: React.FC<LEDTVProps> = ({ config, mediaCache = {} }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);

  const height = config.ledHeight || 6;
  const width = config.width;
  const depth = config.depth;
  const content = config.ledContent;

  // Configure texture to stretch to fill the LED screen
  const configureTexture = (texture: THREE.Texture) => {
    // Ensure texture stretches to fill the entire surface
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    // Center the texture and repeat once (full stretch)
    texture.center.set(0.5, 0.5);
    texture.repeat.set(1, 1);
    return texture;
  };

  useEffect(() => {
    if (content?.type === 'video' && content.value && mediaCache[content.value]) {
      const video = document.createElement('video');
      video.src = mediaCache[content.value];
      video.loop = content.loop ?? true;
      video.muted = true;
      video.playsInline = true;

      const onLoadedData = () => { video.play().catch(console.error); };
      video.addEventListener('loadeddata', onLoadedData);

      const texture = new THREE.VideoTexture(video);
      configureTexture(texture);
      setVideoTexture(texture);

      return () => {
        video.removeEventListener('loadeddata', onLoadedData);
        video.pause();
        texture.dispose();
      };
    } else {
      setVideoTexture(null);
    }
  }, [content, mediaCache]);

  const imageTexture = useMemo(() => {
    if (content?.type === 'image' && content.value && mediaCache[content.value]) {
      const loader = new THREE.TextureLoader();
      try {
        const texture = loader.load(mediaCache[content.value]);
        configureTexture(texture);
        return texture;
      } catch (e) {
        console.error('Failed to load image texture:', e);
      }
    }
    return null;
  }, [content, mediaCache]);

  const getTexture = () => {
    if (content?.type === 'video') return videoTexture;
    if (content?.type === 'image') return imageTexture;
    return null;
  };

  const getColor = () => {
    if (content?.type === 'color' && content.value) return content.value;
    return '#111111';
  };

  return (
    <mesh ref={meshRef} position={[0, height / 2, -depth / 2 - 0.1]} receiveShadow>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={getTexture() || undefined}
        color={getColor()}
        emissive={getTexture() ? '#ffffff' : '#222222'}
        emissiveIntensity={getTexture() ? 1 : 0.3}
        emissiveMap={getTexture() || undefined}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

export default LEDTV;