import React, { useRef, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import StageFloor from './StageFloor';
import Performer3D from './Performer3D';
import Prop3D from './Prop3D';
import LEDTV from '../components/LEDTV';
import { Performer, Position, ProjectModelAsset, StageConfig } from '../types';
import { buildPlatformOccupancy } from '../utils/platforms';
import { snapStagePosition } from '../utils/stage-grid';
import { resolveThreeInteractionPolicy } from '../utils/three-interaction';
import { getTotalStageWidth, mapTo2D } from '../utils/coordinates';
import ModelAsset3D from './ModelAsset3D';
import StageTransformControls from './StageTransformControls';
import type { StageTransformMode } from '../components/three/TransformModeToolbar';

interface Scene3DProps {
  performers: Performer[];
  modelAssets?: Record<string, ProjectModelAsset>;
  positions: Record<string, Position>;
  rotations?: Record<string, number>;
  selectedIds: string[];
  onSelect: (id: string) => void;
  stageConfig: StageConfig;
  mediaCache?: Record<string, string>;
  currentTime?: number;
  isPlaying?: boolean;
  hiddenGroupIds?: string[];
  lockedPerformerIds?: string[];
  gridScale?: number;
  snapToGrid?: boolean;
  showLabels?: boolean;
  showDirectionArrows?: boolean;
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: (ids: string[], finalUpdates?: { id: string; pos: Position }[]) => void;
  onPositionChange?: (updates: { id: string; pos: Position }[]) => void;
  onOpenPerformerEditor?: (id: string) => void;
  readonly?: boolean;
  dragEnabled?: boolean;
  transformMode?: StageTransformMode;
  onRotationStart?: (id: string) => void;
  onRotationChange?: (id: string, rotation: number) => void;
  onRotationEnd?: (id: string, rotation: number) => void;
  onResizeStart?: (id: string) => void;
  onResizeChange?: (id: string, dimensions: { width: number; height: number; depth: number }) => void;
  onResizeEnd?: (id: string, dimensions: { width: number; height: number; depth: number }) => void;
  placementPreview?: { asset: ProjectModelAsset; width: number; height: number; depth: number } | null;
  onPlaceAsset?: (position: Position) => void;
  onCancelPlacement?: () => void;
}

const Scene3D: React.FC<Scene3DProps> = ({
  performers,
  modelAssets = {},
  positions,
  rotations = {},
  selectedIds,
  onSelect,
  stageConfig,
  mediaCache,
  currentTime = 0,
  isPlaying = false,
  hiddenGroupIds = [],
  lockedPerformerIds = [],
  gridScale = 1,
  snapToGrid = false,
  showLabels = true,
  showDirectionArrows = true,
  onDragStart,
  onDragEnd,
  onPositionChange,
  onOpenPerformerEditor,
  readonly = false,
  dragEnabled = false,
  transformMode = 'navigate',
  onRotationStart,
  onRotationChange,
  onRotationEnd,
  onResizeStart,
  onResizeChange,
  onResizeEnd,
  placementPreview = null,
  onPlaceAsset,
  onCancelPlacement,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isObjectTransforming, setIsObjectTransforming] = useState(false);
  const suppressSceneClickRef = useRef(false);
  const [placementPoint, setPlacementPoint] = useState({ x: 0, z: 0 });
  const interactionPolicy = resolveThreeInteractionPolicy({
    dragEnabled,
    readonly,
    isDragging: isDragging || isObjectTransforming,
  });
  const lockedPerformerIdSet = new Set(lockedPerformerIds);

  const handleDragStart = (id: string) => {
    if (!interactionPolicy.canDragObjects) return;
    setIsDragging(true);
    onDragStart?.([id]);
  };

  const handleDragEnd = (draggedId: string, position?: Position) => {
    setIsDragging(false);
    if (!position) {
      onDragEnd?.([draggedId]);
      return;
    }
    const snappedPosition = snapToGrid
      ? snapStagePosition(position, gridScale, stageConfig)
      : position;
    const committedUpdate = {
      id: draggedId,
      pos: snappedPosition,
    };
    if (snapToGrid) onPositionChange?.([committedUpdate]);
    onDragEnd?.([draggedId], [committedUpdate]);
  };

  const visiblePerformers = performers.filter(p => !p.groupId || !hiddenGroupIds.includes(p.groupId));
  const platformOccupancy = buildPlatformOccupancy(visiblePerformers, positions, stageConfig, modelAssets, rotations);
  const selectedTransformProp = selectedIds.length === 1
    ? visiblePerformers.find((performer) => performer.id === selectedIds[0] && performer.type === 'prop')
    : undefined;
  const selectedTransformPosition = selectedTransformProp ? positions[selectedTransformProp.id] : undefined;
  const canTransformSelectedProp = Boolean(
    selectedTransformProp
    && selectedTransformPosition
    && transformMode !== 'navigate'
    && !readonly
    && !placementPreview
    && !lockedPerformerIdSet.has(selectedTransformProp.id),
  );

  const handlePositionChange = (id: string, pos: Position) => {
    if (onPositionChange) {
      onPositionChange([{ id, pos }]);
    }
  };

  const handleObjectTransformingChange = (transforming: boolean) => {
    setIsObjectTransforming(transforming);
    if (transforming) {
      suppressSceneClickRef.current = true;
      return;
    }
    window.setTimeout(() => {
      suppressSceneClickRef.current = false;
    }, 0);
  };

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
      <OrbitControls
        makeDefault
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2}
        maxDistance={80}
        minDistance={5}
        target={[0, 0, 0]}
        enableRotate={!placementPreview && interactionPolicy.enableRotate}
        enablePan={!placementPreview && interactionPolicy.enablePan}
        enableZoom={!placementPreview && interactionPolicy.enableZoom}
      />
      <LEDTV
        config={stageConfig}
        mediaCache={mediaCache}
        currentTime={currentTime}
        isPlaying={isPlaying}
      />
      <StageFloor stageConfig={stageConfig} mediaCache={mediaCache} gridScale={gridScale} />
      {visiblePerformers.map(p => {
        const pos = positions[p.id]; if (!pos) return null;
        const isLocked = lockedPerformerIdSet.has(p.id);
        const hasTransformControls = canTransformSelectedProp && selectedTransformProp?.id === p.id;
        const commonProps = {
          performer: p,
          position: pos,
          rotationDeg: rotations[p.id] ?? p.rotation ?? 0,
          isSelected: selectedIds.includes(p.id),
          onSelect,
          stageConfig,
          showLabels,
          showDirectionArrows,
          dragEnabled: interactionPolicy.canDragObjects && !isLocked && !hasTransformControls,
          onDragStart: () => handleDragStart(p.id),
          onDragEnd: (position?: Position) => handleDragEnd(p.id, position),
          onPositionChange: interactionPolicy.canDragObjects && !isLocked
            ? (newPos: Position) => handlePositionChange(p.id, newPos)
            : undefined,
        };
        if (p.type === 'prop') {
          return (
            <Prop3D
              key={p.id}
              {...commonProps}
              modelAsset={p.modelAssetId ? modelAssets[p.modelAssetId] : undefined}
              platformLift={platformOccupancy.entityLiftById[p.id] ?? 0}
              immediateTransform={hasTransformControls && isObjectTransforming}
            />
          );
        }
        return (
          <Performer3D
            key={p.id}
            {...commonProps}
            platformLift={platformOccupancy.entityLiftById[p.id] ?? 0}
            onOpenEditor={onOpenPerformerEditor}
          />
        );
      })}
      {canTransformSelectedProp && selectedTransformProp && selectedTransformPosition && transformMode !== 'navigate' && (
        <StageTransformControls
          performer={selectedTransformProp}
          position={selectedTransformPosition}
          rotationDeg={rotations[selectedTransformProp.id] ?? selectedTransformProp.rotation ?? 0}
          platformLift={platformOccupancy.entityLiftById[selectedTransformProp.id] ?? 0}
          stageConfig={stageConfig}
          mode={transformMode}
          snap={snapToGrid}
          gridScale={gridScale}
          onPositionChange={(position) => handlePositionChange(selectedTransformProp.id, position)}
          onDragStart={() => onDragStart?.([selectedTransformProp.id])}
          onDragEnd={(position) => handleDragEnd(selectedTransformProp.id, position)}
          onRotationStart={() => onRotationStart?.(selectedTransformProp.id)}
          onRotationChange={(rotation) => onRotationChange?.(selectedTransformProp.id, rotation)}
          onRotationEnd={(rotation) => onRotationEnd?.(selectedTransformProp.id, rotation)}
          onResizeStart={() => onResizeStart?.(selectedTransformProp.id)}
          onResizeChange={(dimensions) => onResizeChange?.(selectedTransformProp.id, dimensions)}
          onResizeEnd={(dimensions) => onResizeEnd?.(selectedTransformProp.id, dimensions)}
          onTransformingChange={handleObjectTransformingChange}
        />
      )}
      {placementPreview && (
        <>
          <group position={[placementPoint.x, placementPreview.height / 2, placementPoint.z]}>
            <group>
              <ModelAsset3D
                asset={placementPreview.asset}
                width={placementPreview.width}
                height={placementPreview.height}
                depth={placementPreview.depth}
              />
            </group>
            <mesh>
              <boxGeometry args={[placementPreview.width, placementPreview.height, placementPreview.depth]} />
              <meshBasicMaterial color="#22d3ee" transparent opacity={0.18} depthWrite={false} />
            </mesh>
          </group>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.04, 0]}
            onPointerMove={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation();
              setPlacementPoint({
                x: Math.max(-getTotalStageWidth(stageConfig) / 2, Math.min(getTotalStageWidth(stageConfig) / 2, event.point.x)),
                z: Math.max(-stageConfig.depth / 2, Math.min(stageConfig.depth / 2, event.point.z)),
              });
            }}
            onClick={(event: ThreeEvent<MouseEvent>) => {
              event.stopPropagation();
              const x = Math.max(-getTotalStageWidth(stageConfig) / 2, Math.min(getTotalStageWidth(stageConfig) / 2, event.point.x));
              const z = Math.max(-stageConfig.depth / 2, Math.min(stageConfig.depth / 2, event.point.z));
              setPlacementPoint({ x, z });
              onPlaceAsset?.(mapTo2D(x, 0, z, stageConfig));
            }}
            onContextMenu={(event: ThreeEvent<MouseEvent>) => {
              event.stopPropagation();
              onCancelPlacement?.();
            }}
          >
            <planeGeometry args={[getTotalStageWidth(stageConfig), stageConfig.depth]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
      <mesh
        position={[0, 0, -stageConfig.depth / 2 - 5]}
        scale={[100, 100, 1]}
        visible={false}
        onClick={() => {
          if (!suppressSceneClickRef.current) onSelect('');
        }}
      >
        <planeGeometry />
      </mesh>
    </>
  );
};

export default Scene3D;
