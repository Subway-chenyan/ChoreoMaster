import React, { useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import StageFloor from './StageFloor';
import Performer3D from './Performer3D';
import Prop3D from './Prop3D';
import LEDTV from '../components/LEDTV';
import { Performer, Position, StageConfig } from '../types';
import { buildPlatformOccupancy } from '../utils/platforms';
import { snapStagePosition } from '../utils/stage-grid';
import { resolveThreeInteractionPolicy } from '../utils/three-interaction';

interface Scene3DProps {
  performers: Performer[];
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
  showDirectionArrows?: boolean;
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: (ids: string[], finalUpdates?: { id: string; pos: Position }[]) => void;
  onPositionChange?: (updates: { id: string; pos: Position }[]) => void;
  onOpenPerformerEditor?: (id: string) => void;
  readonly?: boolean;
  dragEnabled?: boolean;
}

const Scene3D: React.FC<Scene3DProps> = ({
  performers,
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
  showDirectionArrows = true,
  onDragStart,
  onDragEnd,
  onPositionChange,
  onOpenPerformerEditor,
  readonly = false,
  dragEnabled = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const interactionPolicy = resolveThreeInteractionPolicy({
    dragEnabled,
    readonly,
    isDragging,
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
  const platformOccupancy = buildPlatformOccupancy(visiblePerformers, positions, stageConfig);

  const handlePositionChange = (id: string, pos: Position) => {
    if (onPositionChange) {
      onPositionChange([{ id, pos }]);
    }
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
        enableRotate={interactionPolicy.enableRotate}
        enablePan={interactionPolicy.enablePan}
        enableZoom={interactionPolicy.enableZoom}
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
        const commonProps = {
          key: p.id,
          performer: p,
          position: pos,
          rotationDeg: rotations[p.id] ?? p.rotation ?? 0,
          isSelected: selectedIds.includes(p.id),
          onSelect,
          stageConfig,
          showDirectionArrows,
          dragEnabled: interactionPolicy.canDragObjects && !isLocked,
          onDragStart: () => handleDragStart(p.id),
          onDragEnd: (position?: Position) => handleDragEnd(p.id, position),
          onPositionChange: interactionPolicy.canDragObjects && !isLocked
            ? (newPos: Position) => handlePositionChange(p.id, newPos)
            : undefined,
        };
        if (p.type === 'prop') {
          return <Prop3D {...commonProps} platformLift={platformOccupancy.entityLiftById[p.id] ?? 0} />;
        }
        return (
          <Performer3D
            {...commonProps}
            platformLift={platformOccupancy.entityLiftById[p.id] ?? 0}
            onOpenEditor={onOpenPerformerEditor}
          />
        );
      })}
      <mesh position={[0, 0, -stageConfig.depth / 2 - 5]} scale={[100, 100, 1]} visible={false} onClick={() => onSelect('')}>
        <planeGeometry />
      </mesh>
    </>
  );
};

export default Scene3D;
