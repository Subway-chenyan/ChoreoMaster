import React from 'react';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import StageFloor from './StageFloor';
import Performer3D from './Performer3D';
import Prop3D from './Prop3D';
import { Entity } from '../types';

interface SceneContentProps {
  entities: Entity[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const SceneContent: React.FC<SceneContentProps> = ({ entities, selectedId, onSelect }) => {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <spotLight 
        position={[0, 15, 10]} 
        angle={0.3} 
        penumbra={0.5} 
        intensity={2} 
        castShadow 
      />
      <pointLight position={[-10, 5, -5]} intensity={0.5} color="blue" />
      <pointLight position={[10, 5, -5]} intensity={0.5} color="red" />

      {/* Environment */}
      <Environment preset="night" />
      
      {/* Camera Controls */}
      <OrbitControls 
        makeDefault 
        minPolarAngle={0} 
        maxPolarAngle={Math.PI / 2.2} 
        maxDistance={30}
        minDistance={5}
        target={[0, 1, 0]}
      />

      {/* Stage */}
      <StageFloor />

      {/* Entities */}
      {entities.map(entity => {
        if (entity.type === 'performer') {
          return (
            <Performer3D 
              key={entity.id} 
              entity={entity} 
              isSelected={entity.id === selectedId} 
              onSelect={onSelect} 
            />
          );
        }
        return (
          <Prop3D 
            key={entity.id} 
            entity={entity} 
            isSelected={entity.id === selectedId} 
            onSelect={onSelect} 
          />
        );
      })}

      {/* Click on background to deselect */}
      <mesh 
        position={[0, 0, -5]} 
        scale={[100, 100, 1]} 
        visible={false} 
        onClick={() => onSelect(null)}
      >
        <planeGeometry />
      </mesh>
      
      <ContactShadows opacity={0.5} scale={30} blur={2} far={10} resolution={256} color="#000000" />
    </>
  );
};

export default SceneContent;