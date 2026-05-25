import React from 'react';
import { Move3d, RotateCw, Box, Trash2, Maximize2 } from 'lucide-react';
import { Performer, Position } from '../types';

interface EditorPanel3DProps {
  performer: Performer | null;
  position: Position | null;
  onUpdatePosition: (id: string, pos: Position) => void;
  onUpdatePerformer: (id: string, updates: Partial<Performer>) => void;
  onDelete: (id: string) => void;
}

const EditorPanel3D: React.FC<EditorPanel3DProps> = ({ performer, position, onUpdatePosition, onUpdatePerformer, onDelete }) => {
  if (!performer || !position) return (
    <div className="w-72 bg-slate-900 border-l border-slate-700 flex flex-col items-center justify-center text-slate-500 h-full">
      <Box size={48} className="mb-4 opacity-50" /><p className="text-sm">选择对象进行编辑</p>
    </div>
  );

  const handlePosChange = (axis: 'x' | 'y' | 'z', value: number) => onUpdatePosition(performer.id, { ...position, [axis]: value });
  const isProp = performer.type === 'prop';

  return (
    <div className="w-72 bg-slate-900 border-l border-slate-700 flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-slate-700 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isProp ? 'bg-green-600' : 'bg-blue-600'}`}>
          {isProp ? <Box size={18} /> : <Maximize2 size={18} />}
        </div>
        <div className="flex-1 min-w-0"><h2 className="text-white font-semibold truncate">{performer.name}</h2><p className="text-xs text-slate-400 uppercase">{isProp ? '道具' : '演员'}</p></div>
      </div>
      <div className="p-4 space-y-6">
        <div className="space-y-2"><label className="text-xs text-slate-400">名称</label><input type="text" value={performer.name} onChange={(e) => onUpdatePerformer(performer.id, { name: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white" /></div>
        <div className="space-y-3"><div className="flex items-center gap-2 text-xs font-medium text-slate-400"><Move3d size={14} /> 位置 (2D + 高度)</div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1"><label className="text-xs text-slate-500 text-center block">X %</label><input type="number" step={0.1} value={position.x.toFixed(1)} onChange={(e) => handlePosChange('x', Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-center text-white" /></div>
            <div className="space-y-1"><label className="text-xs text-slate-500 text-center block">Y %</label><input type="number" step={0.1} value={position.y.toFixed(1)} onChange={(e) => handlePosChange('y', Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-center text-white" /></div>
            <div className="space-y-1"><label className="text-xs text-slate-500 text-center block">Z 米</label><input type="number" step={0.1} value={(position.z || 0).toFixed(1)} onChange={(e) => handlePosChange('z', Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-center text-white" /></div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between"><label className="text-sm text-slate-300">高度 (Z轴)</label><span className="text-xs text-blue-400">{(position.z || 0).toFixed(1)}m</span></div>
            <input type="range" min={0} max={10} step={0.1} value={position.z || 0} onChange={(e) => handlePosChange('z', Number(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
          </div>
        </div>
        <div className="space-y-3"><div className="flex items-center gap-2 text-xs font-medium text-slate-400"><RotateCw size={14} /> 旋转</div>
          <div className="flex gap-2 items-center">
            <input type="range" min={-180} max={180} value={performer.rotation || 0} onChange={(e) => onUpdatePerformer(performer.id, { rotation: Number(e.target.value) })} className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            <span className="text-sm text-slate-300 w-12 text-right">{Math.round(performer.rotation || 0)}°</span>
          </div>
        </div>
        {isProp && (
          <div className="space-y-3"><div className="flex items-center gap-2 text-xs font-medium text-slate-400"><Box size={14} /> 尺寸</div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-xs text-slate-500 block">宽</label><input type="number" step={0.1} value={performer.width || 1} onChange={(e) => onUpdatePerformer(performer.id, { width: Number(e.target.value) })} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white" /></div>
              <div><label className="text-xs text-slate-500 block">高</label><input type="number" step={0.1} value={performer.height || 1} onChange={(e) => onUpdatePerformer(performer.id, { height: Number(e.target.value) })} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white" /></div>
              <div><label className="text-xs text-slate-500 block">深</label><input type="number" step={0.1} value={performer.depth || 1} onChange={(e) => onUpdatePerformer(performer.id, { depth: Number(e.target.value) })} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white" /></div>
            </div>
          </div>
        )}
        {isProp && performer.propGeometryType === 'extruded' && (
          <div className="text-xs text-amber-400 bg-amber-400/10 rounded px-2 py-1 mt-2">
            异形道具 ({(performer.polygonPoints?.length || 0)} 顶点)
          </div>
        )}
        {isProp && performer.boxTextures && Object.keys(performer.boxTextures).length > 0 && (
          <div className="text-xs text-blue-400 bg-blue-400/10 rounded px-2 py-1 mt-2">
            {Object.keys(performer.boxTextures).length} 面贴图
          </div>
        )}
        <div className="space-y-2"><label className="text-xs text-slate-400">颜色</label>
          <div className="flex gap-2">
            <input type="color" value={performer.color} onChange={(e) => onUpdatePerformer(performer.id, { color: e.target.value })} className="h-8 w-12 bg-transparent border-0 p-0 cursor-pointer" />
            <input type="text" value={performer.color} onChange={(e) => onUpdatePerformer(performer.id, { color: e.target.value })} className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-1 text-sm text-white" />
          </div>
        </div>
        <div className="pt-4 border-t border-slate-700">
          <button onClick={() => onDelete(performer.id)} className="w-full flex items-center justify-center gap-2 py-2 rounded bg-red-900/30 text-red-500 hover:bg-red-900/50 transition-colors border border-red-900">
            <Trash2 size={16} /> 删除对象
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditorPanel3D;