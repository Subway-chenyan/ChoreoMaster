import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Performer, Position, StageConfig } from '../types';
import type { ObjectTransformMode } from '../components/three/TransformModeToolbar';
import { getTotalStageWidth, mapTo2D, mapTo3D, radToDeg } from '../utils/coordinates';
import { getPropAnchorFromCenter, getPropCenterFromAnchor } from '../utils/prop-pivot';

interface PerformerDimensions {
  width: number;
  height: number;
  depth: number;
}

interface TransformSession {
  mode: ObjectTransformMode;
  beforeDimensions: PerformerDimensions;
  lastPosition?: Position;
  lastRotation?: number;
  lastDimensions?: PerformerDimensions;
}

interface StageTransformControlsProps {
  performer: Performer;
  position: Position;
  rotationDeg: number;
  platformLift: number;
  stageConfig: StageConfig;
  mode: ObjectTransformMode;
  snap: boolean;
  gridScale: number;
  onPositionChange: (position: Position) => void;
  onDragStart?: () => void;
  onDragEnd?: (position: Position) => void;
  onRotationStart?: () => void;
  onRotationChange?: (rotation: number) => void;
  onRotationEnd?: (rotation: number) => void;
  onResizeStart?: () => void;
  onResizeChange?: (dimensions: PerformerDimensions) => void;
  onResizeEnd?: (dimensions: PerformerDimensions) => void;
  onTransformingChange: (transforming: boolean) => void;
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function normalizeDimension(value: number): number {
  return Math.round(Math.max(0.05, value) * 10_000) / 10_000;
}

const StageTransformControls: React.FC<StageTransformControlsProps> = ({
  performer,
  position,
  rotationDeg,
  platformLift,
  stageConfig,
  mode,
  snap,
  gridScale,
  onPositionChange,
  onDragStart,
  onDragEnd,
  onRotationStart,
  onRotationChange,
  onRotationEnd,
  onResizeStart,
  onResizeChange,
  onResizeEnd,
  onTransformingChange,
}) => {
  const { gl } = useThree();
  const [proxy, setProxy] = useState<THREE.Group | null>(null);
  const sessionRef = useRef<TransformSession | null>(null);

  const getWorldPosition = useCallback((dimensions: PerformerDimensions = {
    width: performer.width || 1,
    height: performer.height || 1,
    depth: performer.depth || 1,
  }) => {
    const center = getPropCenterFromAnchor(
      position,
      rotationDeg,
      { ...performer, width: dimensions.width },
      stageConfig,
    );
    const [x, y, z] = mapTo3D({
      ...center,
      z: (center.z || 0) + platformLift,
    }, stageConfig);
    return new THREE.Vector3(x, y + dimensions.height / 2, z);
  }, [performer, platformLift, position, rotationDeg, stageConfig]);

  useLayoutEffect(() => {
    if (!proxy || sessionRef.current) return;
    proxy.position.copy(getWorldPosition());
    proxy.rotation.set(0, -THREE.MathUtils.degToRad(rotationDeg), 0);
    proxy.scale.set(1, 1, 1);
  }, [getWorldPosition, proxy, rotationDeg]);

  const applyCurrentTransform = useCallback(() => {
    const session = sessionRef.current;
    if (!proxy || !session) return;

    if (session.mode === 'translate') {
      const x = THREE.MathUtils.clamp(proxy.position.x, -getTotalStageWidth(stageConfig) / 2, getTotalStageWidth(stageConfig) / 2);
      const z = THREE.MathUtils.clamp(proxy.position.z, -stageConfig.depth / 2, stageConfig.depth / 2);
      proxy.position.x = x;
      proxy.position.z = z;
      const center = mapTo2D(x, position.z || 0, z, stageConfig);
      const nextPosition = getPropAnchorFromCenter(center, rotationDeg, performer, stageConfig);
      session.lastPosition = nextPosition;
      onPositionChange(nextPosition);
      return;
    }

    if (session.mode === 'rotate') {
      const nextRotation = normalizeDegrees(-radToDeg(proxy.rotation.y));
      session.lastRotation = nextRotation;
      onRotationChange?.(nextRotation);
      return;
    }

    const base = session.beforeDimensions;
    let scaleX = Math.max(0.05 / base.width, Math.abs(proxy.scale.x));
    let scaleY = Math.max(0.05 / base.height, Math.abs(proxy.scale.y));
    let scaleZ = Math.max(0.05 / base.depth, Math.abs(proxy.scale.z));
    if (performer.modelAspectLocked !== false) {
      const ratio = [scaleX, scaleY, scaleZ].reduce((selected, candidate) => (
        Math.abs(candidate - 1) > Math.abs(selected - 1) ? candidate : selected
      ), 1);
      scaleX = ratio;
      scaleY = ratio;
      scaleZ = ratio;
    }
    proxy.scale.set(scaleX, scaleY, scaleZ);
    const dimensions = {
      width: normalizeDimension(base.width * scaleX),
      height: normalizeDimension(base.height * scaleY),
      depth: normalizeDimension(base.depth * scaleZ),
    };
    proxy.position.copy(getWorldPosition(dimensions));
    session.lastDimensions = dimensions;
    onResizeChange?.(dimensions);
  }, [getWorldPosition, onPositionChange, onResizeChange, onRotationChange, performer, position.z, proxy, rotationDeg, stageConfig]);

  const startTransform = useCallback(() => {
    if (!proxy || sessionRef.current) return;
    const beforeDimensions = {
      width: performer.width || 1,
      height: performer.height || 1,
      depth: performer.depth || 1,
    };
    sessionRef.current = { mode, beforeDimensions };
    onTransformingChange(true);
    if (mode === 'translate') onDragStart?.();
    if (mode === 'rotate') onRotationStart?.();
    if (mode === 'scale') onResizeStart?.();
  }, [mode, onDragStart, onResizeStart, onRotationStart, onTransformingChange, performer.depth, performer.height, performer.width, proxy]);

  const finishTransform = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    applyCurrentTransform();
    sessionRef.current = null;
    onTransformingChange(false);
    if (session.mode === 'translate' && session.lastPosition) onDragEnd?.(session.lastPosition);
    if (session.mode === 'rotate' && session.lastRotation !== undefined) onRotationEnd?.(session.lastRotation);
    if (session.mode === 'scale' && session.lastDimensions) onResizeEnd?.(session.lastDimensions);
    if (proxy) proxy.scale.set(1, 1, 1);
  }, [applyCurrentTransform, onDragEnd, onResizeEnd, onRotationEnd, onTransformingChange, proxy]);

  useEffect(() => {
    const canvas = gl.domElement;
    const handlePointerTermination = () => finishTransform();
    canvas.addEventListener('pointercancel', handlePointerTermination);
    canvas.addEventListener('lostpointercapture', handlePointerTermination);
    return () => {
      canvas.removeEventListener('pointercancel', handlePointerTermination);
      canvas.removeEventListener('lostpointercapture', handlePointerTermination);
    };
  }, [finishTransform, gl]);

  return (
    <>
      <group ref={setProxy} visible={false} />
      {proxy && (
        <TransformControls
          object={proxy}
          mode={mode}
          space={mode === 'translate' ? 'world' : 'local'}
          size={0.82}
          showX={mode !== 'rotate'}
          showY={mode !== 'translate'}
          showZ={mode !== 'rotate'}
          translationSnap={snap ? gridScale : null}
          rotationSnap={snap ? THREE.MathUtils.degToRad(5) : null}
          scaleSnap={snap ? 0.1 : null}
          onMouseDown={startTransform}
          onObjectChange={applyCurrentTransform}
          onMouseUp={finishTransform}
        />
      )}
    </>
  );
};

export default StageTransformControls;
