import React from 'react';
import { Entity } from '../types';
import { Box, User, Move3d, RotateCw, Type, Trash2 } from 'lucide-react';

interface EditorPanelProps {
  entity: Entity | undefined;
  onUpdate: (id: string, updates: Partial<Entity> | Partial<Entity['position']>) => void;
  onDelete: (id: string) => void;
}

const EditorPanel: React.FC<EditorPanelProps> = ({ entity, onUpdate, onDelete }) => {
  if (!entity) {
    return (
      <div className="w-80 bg-gray-900 border-l border-gray-800 p-6 flex flex-col items-center justify-center text-gray-500">
        <Box size={48} className="mb-4 opacity-50" />
        <p>Select an object to edit</p>
      </div>
    );
  }

  const handleChange = (field: keyof Entity, value: any) => {
    onUpdate(entity.id, { [field]: value });
  };

  const handlePosChange = (axis: 'x' | 'y' | 'z', value: number) => {
    onUpdate(entity.id, { position: { ...entity.position, [axis]: value } });
  };

  return (
    <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-gray-800 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${entity.type === 'performer' ? 'bg-blue-600' : 'bg-green-600'}`}>
           {entity.type === 'performer' ? <User size={20} /> : <Box size={20} />}
        </div>
        <div>
          <h2 className="text-white font-semibold">{entity.name}</h2>
          <p className="text-xs text-gray-400 uppercase tracking-wider">{entity.type}</p>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Basic Info */}
        <div className="space-y-3">
          <label className="text-xs font-medium text-gray-400 uppercase">Properties</label>
          <div className="space-y-2">
            <div>
              <label className="text-sm text-gray-300 mb-1 block">Name</label>
              <input 
                type="text" 
                value={entity.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-sm text-gray-300 mb-1 block">Color</label>
              <div className="flex gap-2">
                <input 
                  type="color" 
                  value={entity.color}
                  onChange={(e) => handleChange('color', e.target.value)}
                  className="h-8 w-12 bg-transparent border-0 p-0 cursor-pointer"
                />
                <input 
                  type="text" 
                  value={entity.color}
                  onChange={(e) => handleChange('color', e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Position Controls */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase">
            <Move3d size={14} /> Position (2D + Height)
          </div>
          
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-gray-500 text-center block">Stage X%</label>
              <input 
                type="number" 
                value={Math.round(entity.position.x)}
                onChange={(e) => handlePosChange('x', Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-center text-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500 text-center block">Stage Y%</label>
              <input 
                type="number" 
                value={Math.round(entity.position.y)}
                onChange={(e) => handlePosChange('y', Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-center text-white"
              />
            </div>
             <div className="space-y-1">
              <label className="text-xs text-gray-500 text-center block">Height (m)</label>
              <input 
                type="number" 
                step={0.1}
                value={entity.position.z}
                onChange={(e) => handlePosChange('z', Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-center text-white"
              />
            </div>
          </div>

          <div className="space-y-1">
             <label className="text-sm text-gray-300">X Position (Left/Right)</label>
             <input 
              type="range" min="0" max="100" 
              value={entity.position.x} 
              onChange={(e) => handlePosChange('x', Number(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <div className="space-y-1">
             <label className="text-sm text-gray-300">Y Position (Front/Back)</label>
             <input 
              type="range" min="0" max="100" 
              value={entity.position.y} 
              onChange={(e) => handlePosChange('y', Number(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>

        {/* Rotation */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase">
            <RotateCw size={14} /> Orientation
          </div>
          <div className="flex gap-2 items-center">
             <input 
                type="range" min="-180" max="180" 
                value={entity.rotation} 
                onChange={(e) => handleChange('rotation', Number(e.target.value))}
                className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-sm text-gray-300 w-12 text-right">{Math.round(entity.rotation)}°</span>
          </div>
        </div>

        {/* Dimensions (Props only) */}
        {entity.type === 'prop' && entity.dimensions && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase">
              <Type size={14} /> Dimensions
            </div>
             <div className="grid grid-cols-3 gap-2">
                <div>
                   <label className="text-xs text-gray-500 block">Width</label>
                   <input 
                      type="number" step={0.1}
                      value={entity.dimensions.width}
                      onChange={(e) => onUpdate(entity.id, { dimensions: { ...entity.dimensions!, width: Number(e.target.value) } })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
                   />
                </div>
                 <div>
                   <label className="text-xs text-gray-500 block">Height</label>
                   <input 
                      type="number" step={0.1}
                      value={entity.dimensions.height}
                      onChange={(e) => onUpdate(entity.id, { dimensions: { ...entity.dimensions!, height: Number(e.target.value) } })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
                   />
                </div>
                 <div>
                   <label className="text-xs text-gray-500 block">Depth</label>
                   <input 
                      type="number" step={0.1}
                      value={entity.dimensions.depth}
                      onChange={(e) => onUpdate(entity.id, { dimensions: { ...entity.dimensions!, depth: Number(e.target.value) } })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
                   />
                </div>
             </div>
          </div>
        )}

        <div className="pt-6 border-t border-gray-800">
          <button 
            onClick={() => onDelete(entity.id)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded bg-red-900/30 text-red-500 hover:bg-red-900/50 transition-colors border border-red-900"
          >
            <Trash2 size={16} /> Delete Object
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditorPanel;