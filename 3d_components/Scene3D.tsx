import React, { useRef, createContext, useContext } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import StageFloor from './StageFloor';
import Performer3D from './Performer3D';
import Prop3D from './Prop3D';
import LEDTV from '../components/LEDTV';
import { Performer, Position, StageConfig } from '../types';

interface DragContextType {
  isDragging: boolean;
  hasSelection: boolean;
  dragPlane: THREE.Plane | null;
  onPlaneDragStart: (id: string) => void;
  onPlaneDragMove: (id: string, point: THREE.Vector3) => void;
  onPlaneDragEnd: () => void;
  registerDraggable: (id: string, mesh: THREE.Object3D) => void;
  unregisterDraggable: (id: string) => void;
}

interface Scene3DProps {
  performers: Performer[];
  positions: Record<string, Position>;
  selectedIds: string[];
  onSelect: (id: string) => void;
  stageConfig: StageConfig;
  mediaCache?: Record<string, string>;
  hiddenGroupIds?: string[];
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onPositionChange?: (updates: { id: string; pos: Position }[]) => void;
  readonly?: boolean;
}

interface DragContextType {
  isDragging: boolean;
  dragPlane: THREE.Plane | null;
  onPlaneDragStart: (id: string) => void;
  onPlaneDragMove: (id: string, point: THREE.Vector3) => void;
  onPlaneDragEnd: () => void;
  registerDraggable: (id: string, mesh: THREE.Object3D) => void;
  unregisterDraggable: (id: string) => void;
}

const DragContext = createContext<DragContextType>({
  isDragging: false,
  hasSelection: false,
  dragPlane: null,
  onPlaneDragStart: () => {},
  onPlaneDragMove: () => {},
  onPlaneDragEnd: () => {},
  registerDraggable: () => {},
  unregisterDraggable: () => {}
});

export const useDragContext = () => useContext(DragContext);

const Scene3D: React.FC<Scene3DProps> = ({
  performers,
  positions,
  selectedIds,
  onSelect,
  stageConfig,
  mediaCache,
  hiddenGroupIds = [],
  onDragStart,
  onDragEnd,
  onPositionChange,
  readonly = false
}) => {
  const { camera, raycaster, pointer } = useThree();
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const draggingIdRef = useRef<string | null>(null);
  const draggablesRef = useRef<Map<string, THREE.Object3D>>(new Map());

  const onPlaneDragStart = (id: string) => {
    if (readonly) return;
    draggingIdRef.current = id;
    onDragStart?.();
  };

  const onPlaneDragMove = (id: string, point: THREE.Vector3) => {
    if (readonly || !onPositionChange || draggingIdRef.current !== id) return;

    // Convert 3D position to 2D percentage
    // Using the same logic as mapTo2D
    const newPos = {
      x: ((point.x / (stageConfig.width / 2)) * 50) + 50,
      y: ((point.z / (stageConfig.depth / 2)) * 50) + 50,
      z: positions[id]?.z || 0
    };

    // Clamp to stage bounds
    newPos.x = Math.max(0, Math.min(100, newPos.x));
    newPos.y = Math.max(0, Math.min(100, newPos.y));

    onPositionChange([{ id, pos: newPos }]);
  };

  const onPlaneDragEnd = () => {
    draggingIdRef.current = null;
    onDragEnd?.();
  };

  const registerDraggable = (id: string, mesh: THREE.Object3D) => {
    draggablesRef.current.set(id, mesh);
  };

  const unregisterDraggable = (id: string) => {
    draggablesRef.current.delete(id);
  };

  const contextValue: DragContextType = {
    isDragging: draggingIdRef.current !== null,
    hasSelection: selectedIds.length > 0,
    dragPlane: dragPlaneRef.current,
    onPlaneDragStart,
    onPlaneDragMove,
    onPlaneDragEnd,
    registerDraggable,
    unregisterDraggable
  };

  const visiblePerformers = performers.filter(p => !p.groupId || !hiddenGroupIds.includes(p.groupId));

  const handlePositionChange = (id: string, pos: Position) => {
    if (onPositionChange) {
      onPositionChange([{ id, pos }]);
    }
  };

  const handleHeightDragStart = () => {
    onDragStart?.();
  };

  const handleHeightDragEnd = () => {
    onDragEnd?.();
  };

  return (
    <DragContext.Provider value={contextValue}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
      <OrbitControls
        makeDefault
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2}
        maxDistance={50}
        minDistance={5}
        target={[0, 0, 0]}
        enableRotate={!contextValue.isDragging && !contextValue.hasSelection}
        enablePan={!contextValue.isDragging}
      />
      <LEDTV config={stageConfig} mediaCache={mediaCache} />
      <StageFloor width={stageConfig.width} depth={stageConfig.depth} />
      {visiblePerformers.map(p => {
        const pos = positions[p.id]; if (!pos) return null;
        const commonProps = {
          key: p.id,
          performer: p,
          position: pos,
          isSelected: selectedIds.includes(p.id),
          onSelect,
          stageConfig: { width: stageConfig.width, depth: stageConfig.depth },
          onDragStart: handleHeightDragStart,
          onDragEnd: handleHeightDragEnd,
          onPositionChange: readonly ? undefined : (newPos: Position) => handlePositionChange(p.id, newPos)
        };
        if (p.type === 'prop') return <Prop3D {...commonProps} />;
        return <Performer3D {...commonProps} />;
      })}
      <mesh position={[0, 0, -stageConfig.depth / 2 - 5]} scale={[100, 100, 1]} visible={false} onClick={() => onSelect('')}>
        <planeGeometry />
      </mesh>
    </DragContext.Provider>
  );
};

export default Scene3D;