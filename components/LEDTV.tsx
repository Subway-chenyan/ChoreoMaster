import React, { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { StageConfig } from '../types';
import { getLedBottomHeight, getLedZPosition, resolveStageMediaUrl } from '../utils/stage-config';

interface LEDTVProps {
  config: StageConfig;
  mediaCache?: Record<string, string>;
  currentTime?: number;
  isPlaying?: boolean;
}

const LEDTV: React.FC<LEDTVProps> = ({ config, mediaCache = {}, currentTime = 0, isPlaying = false }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoTextureRef = useRef<THREE.VideoTexture | null>(null);
  const desiredTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);
  const [imageTexture, setImageTexture] = useState<THREE.Texture | null>(null);

  const height = config.ledHeight || 6;
  const width = config.ledWidth ?? config.width;
  const bottomHeight = getLedBottomHeight(config);
  const content = config.ledContent;
  const contentUrl = resolveStageMediaUrl(content?.value, mediaCache);

  useEffect(() => {
    desiredTimeRef.current = currentTime / 1000;
  }, [currentTime]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;

    if (isPlaying) {
      const desired = getTimelineVideoTime(video, desiredTimeRef.current, video.loop);
      if (Math.abs(video.currentTime - desired) > 0.15) {
        try { video.currentTime = desired; } catch { }
      }
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying]);

  // Configure texture to stretch to fill the LED screen
  const configureTexture = (texture: THREE.Texture) => {
    // Ensure texture stretches to fill the entire surface
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    // Center the texture and repeat once (full stretch)
    texture.center.set(0.5, 0.5);
    texture.repeat.set(1, 1);
    return texture;
  };

  useEffect(() => {
    if (content?.type === 'video' && contentUrl) {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.src = contentUrl;
      video.loop = content.loop ?? true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      const texture = new THREE.VideoTexture(video);
      configureTexture(texture);
      videoTextureRef.current = texture;

      let textureAttached = false;
      const attachVideoTexture = () => {
        if (textureAttached) return;
        textureAttached = true;
        setVideoTexture(texture);
      };
      const syncVideoToTimeline = () => {
        const desired = getTimelineVideoTime(video, desiredTimeRef.current, video.loop);
        if (Number.isFinite(desired)) {
          try { video.currentTime = desired; } catch { }
        }
        if (isPlayingRef.current) {
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
        attachVideoTexture();
        texture.needsUpdate = true;
      };
      const refreshTexture = () => {
        attachVideoTexture();
        texture.needsUpdate = true;
      };
      video.addEventListener('loadedmetadata', syncVideoToTimeline);
      video.addEventListener('loadeddata', syncVideoToTimeline);
      video.addEventListener('seeked', refreshTexture);

      videoRef.current = video;
      video.load();

      return () => {
        video.removeEventListener('loadedmetadata', syncVideoToTimeline);
        video.removeEventListener('loadeddata', syncVideoToTimeline);
        video.removeEventListener('seeked', refreshTexture);
        video.pause();
        video.removeAttribute('src');
        video.load();
        if (videoRef.current === video) videoRef.current = null;
        if (videoTextureRef.current === texture) videoTextureRef.current = null;
        setVideoTexture(current => current === texture ? null : current);
        texture.dispose();
      };
    } else {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current = null;
      }
      videoTextureRef.current = null;
      setVideoTexture(null);
    }
  }, [content, contentUrl]);

  useEffect(() => {
    if (content?.type !== 'image' || !contentUrl) {
      setImageTexture(null);
      return;
    }

    let texture: THREE.Texture | null = null;
    new THREE.TextureLoader().load(
      contentUrl,
      (loadedTexture) => {
        texture = loadedTexture;
        configureTexture(loadedTexture);
        loadedTexture.needsUpdate = true;
        setImageTexture(loadedTexture);
      },
      undefined,
      (error) => {
        console.error('Failed to load LED image texture:', error);
      },
    );

    return () => {
      setImageTexture(current => current === texture ? null : current);
      texture?.dispose();
    };
  }, [content, contentUrl]);

  const getTimelineVideoTime = (video: HTMLVideoElement, timelineTimeSec: number, shouldLoop: boolean) => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, timelineTimeSec);
    if (shouldLoop) return timelineTimeSec % duration;
    return Math.min(Math.max(0, timelineTimeSec), Math.max(0, duration - 0.001));
  };

  useFrame(() => {
    const video = videoRef.current;
    if (!video || content?.type !== 'video') return;
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const desired = getTimelineVideoTime(video, desiredTimeRef.current, video.loop);
    if (!Number.isFinite(desired)) return;

    const drift = Math.abs(video.currentTime - desired);
    if (!isPlayingRef.current) {
      if (!video.paused) video.pause();
      if (drift > 0.03) {
        try { video.currentTime = desired; } catch { }
        if (videoTextureRef.current) videoTextureRef.current.needsUpdate = true;
      }
      return;
    }

    if (drift > 0.5) {
      try { video.currentTime = desired; } catch { }
      if (videoTextureRef.current) videoTextureRef.current.needsUpdate = true;
    }
    if (video.paused) {
      video.play().catch(() => {
        if (Math.abs(video.currentTime - desired) > 0.03) {
          try { video.currentTime = desired; } catch { }
        }
      });
    }
  });

  const getTexture = () => {
    if (content?.type === 'video') return videoTexture;
    if (content?.type === 'image') return imageTexture;
    return null;
  };

  const getColor = () => {
    if (content?.type === 'color' && content.value) return content.value;
    return '#111111';
  };
  const texture = getTexture();
  const color = texture ? '#ffffff' : getColor();
  const materialKey = `${content?.type || 'none'}-${content?.value || 'empty'}-${texture?.uuid || 'no-texture'}`;

  return (
    <mesh ref={meshRef} position={[0, bottomHeight + height / 2, getLedZPosition(config) - 0.1]} receiveShadow>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        key={materialKey}
        map={texture || undefined}
        color={color}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
};

export default LEDTV;
