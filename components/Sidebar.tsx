
import React, { useState, useMemo } from 'react';
import { Performer, Frame, PerformerShape } from '../types';
import { Plus, Users, Trash2, Download, Grid, Music, Sparkles, Wand2, Film, Copy, Search, Settings, Scaling, Upload, FilePlus, Circle, Square, Triangle, UserCheck, UserX, Eye, EyeOff } from 'lucide-react';
import { PRESET_SHAPES, DEFAULT_COLORS } from '../constants';
import { generateFormationCoordinates } from '../services/geminiService';

interface SidebarProps {
  performers: Performer[];
  frames: Frame[];
  currentFrameId: string;
  onAddPerformer: (name: string, color: string, shape: PerformerShape) => void;
  onRemovePerformer: (id: string) => void;
  onUpdatePerformer: (id: string, updates: Partial<Performer>) => void;
  onTogglePerformerInFrame: (id: string) => void;
  onDuplicateSelected: () => void;
  onApplyPreset: (coords: {x: number, y: number}[]) => void;
  onImportMusic: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onImportProject: (e: React.ChangeEvent<HTMLInputElement>) => void;
  selectedPerformerIds: string[];
  onSelectionChange: (ids: string[]) => void;
  musicName: string | null;
  onSelectFrame: (id: string) => void;
  onAddFrame: () => void;
  onDeleteFrame: (id: string) => void;
  onDuplicateFrame: (id: string) => void;
  onReorderFrame: (id: string, direction: 'up' | 'down') => void;
  onResetProject: () => void;
}

type Tab = 'project' | 'formations' | 'performers' | 'presets';

const FormationThumbnail: React.FC<{ positions: any }> = ({ positions }) => {
    return (
        <div className="w-full h-full relative bg-slate-950 rounded overflow-hidden border border-slate-800">
            {Object.values(positions).map((p: any, i) => (
                <div key={i} className="absolute w-0.5 h-0.5 bg-blue-400 rounded-full" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
            ))}
        </div>
    )
}

export const Sidebar: React.FC<SidebarProps> = ({
  performers,
  frames,
  currentFrameId,
  onAddPerformer,
  onRemovePerformer,
  onUpdatePerformer,
  onTogglePerformerInFrame,
  onDuplicateSelected,
  onApplyPreset,
  onImportMusic,
  onExport,
  onImportProject,
  selectedPerformerIds,
  onSelectionChange,
  musicName,
  onSelectFrame,
  onAddFrame,
  onDeleteFrame,
  onDuplicateFrame,
  onReorderFrame,
  onResetProject
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('performers');
  
  // Add Performer State
  const [newPerformerName, setNewPerformerName] = useState('');
  const [newPerformerShape, setNewPerformerShape] = useState<PerformerShape>('circle');
  const [newPerformerColor, setNewPerformerColor] = useState<string>(DEFAULT_COLORS[0]);
  
  // Preset State
  const [presetScale, setPresetScale] = useState(0.8); // Default 80% size to be safe

  const [searchQuery, setSearchQuery] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const filteredPerformers = useMemo(() => {
      return performers.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [performers, searchQuery]);

  // Frames sorted by time for display
  const sortedFrames = useMemo(() => {
      return [...frames].sort((a,b) => a.startTime - b.startTime);
  }, [frames]);

  const currentFrame = useMemo(() => {
      return frames.find(f => f.id === currentFrameId);
  }, [frames, currentFrameId]);

  const handleAdd = () => {
    if (newPerformerName.trim()) {
      onAddPerformer(newPerformerName, newPerformerColor, newPerformerShape);
      setNewPerformerName('');
      const nextColorIndex = (DEFAULT_COLORS.indexOf(newPerformerColor) + 1) % DEFAULT_COLORS.length;
      setNewPerformerColor(DEFAULT_COLORS[nextColorIndex]);
    }
  };

  const handlePerformerClick = (e: React.MouseEvent, id: string) => {
    if (e.ctrlKey || e.metaKey) {
        if (selectedPerformerIds.includes(id)) {
            onSelectionChange(selectedPerformerIds.filter(pid => pid !== id));
        } else {
            onSelectionChange([...selectedPerformerIds, id]);
        }
    } else {
        onSelectionChange([id]);
    }
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim() || selectedPerformerIds.length === 0) return;
    setIsGenerating(true);
    try {
      const coords = await generateFormationCoordinates(aiPrompt, selectedPerformerIds.length);
      onApplyPreset(coords);
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col shadow-xl z-20">
        {/* Top Tabs */}
        <div className="flex items-center bg-slate-950 border-b border-slate-800 px-1 pt-1">
            <button onClick={() => setActiveTab('project')} className={`flex-1 py-3 flex justify-center ${activeTab === 'project' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`}>
                <Settings size={18} />
            </button>
            <button onClick={() => setActiveTab('formations')} className={`flex-1 py-3 flex justify-center ${activeTab === 'formations' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`}>
                <Film size={18} />
            </button>
            <button onClick={() => setActiveTab('performers')} className={`flex-1 py-3 flex justify-center ${activeTab === 'performers' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`}>
                <Users size={18} />
            </button>
            <button onClick={() => setActiveTab('presets')} className={`flex-1 py-3 flex justify-center ${activeTab === 'presets' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`}>
                <Grid size={18} />
            </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-900 p-4">
            
            {/* PROJECT TAB */}
            {activeTab === 'project' && (
                <div className="space-y-6">
                     <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Project Settings</h2>
                     
                     <div className="space-y-3">
                        <button onClick={onResetProject} className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 transition-colors text-sm">
                            <FilePlus size={16} /> New Project
                        </button>
                        <label className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 transition-colors text-sm cursor-pointer">
                            <Upload size={16} /> Import Project (JSON)
                            <input type="file" accept=".json" className="hidden" onChange={onImportProject} />
                        </label>
                        <button onClick={onExport} className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 transition-colors text-sm">
                            <Download size={16} /> Export Project (JSON)
                        </button>
                     </div>

                     <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 mt-4">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
                                <Music size={12} /> Soundtrack
                            </label>
                        </div>
                        {musicName ? (
                            <div className="text-sm text-blue-300 truncate mb-3 font-medium">{musicName}</div>
                        ) : (
                            <div className="text-sm text-slate-500 italic mb-3">No music loaded</div>
                        )}
                        <label className="block w-full text-center px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded text-xs cursor-pointer transition-colors text-white">
                            Import Audio File
                            <input type="file" accept="audio/*" className="hidden" onChange={onImportMusic} />
                        </label>
                    </div>
                </div>
            )}

            {/* FORMATIONS TAB */}
            {activeTab === 'formations' && (
                <div className="h-full flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-bold text-slate-400 uppercase">Timeline Frames</h2>
                        <span className="text-xs text-slate-600">{frames.length} frames</span>
                    </div>
                    
                    <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                        {sortedFrames.map((f, idx) => (
                            <div 
                                key={f.id} 
                                onClick={() => onSelectFrame(f.id)}
                                className={`group relative flex gap-3 p-2 rounded-lg border transition-all cursor-pointer ${f.id === currentFrameId ? 'bg-slate-800 border-blue-500 shadow-md' : 'bg-slate-900 border-slate-800 hover:bg-slate-800'}`}
                            >
                                {/* Thumbnail */}
                                <div className="w-16 h-12 shrink-0">
                                    <FormationThumbnail positions={f.positions} />
                                </div>
                                
                                {/* Info */}
                                <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <div className={`text-sm font-medium truncate ${f.id === currentFrameId ? 'text-blue-400' : 'text-slate-300'}`}>
                                        {f.name}
                                    </div>
                                    <div className="text-[10px] text-slate-500 flex gap-2">
                                        <span>Start: {(f.startTime/1000).toFixed(1)}s</span>
                                        <span>Dur: {(f.duration/1000).toFixed(1)}s</span>
                                    </div>
                                </div>

                                {/* Quick Actions */}
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                     <button onClick={(e) => { e.stopPropagation(); onDuplicateFrame(f.id); }} className="p-1 bg-slate-800 hover:bg-blue-900 rounded text-slate-400 hover:text-blue-400"><Copy size={12} /></button>
                                     <button onClick={(e) => { e.stopPropagation(); onDeleteFrame(f.id); }} className="p-1 bg-slate-800 hover:bg-red-900 rounded text-slate-400 hover:text-red-400"><Trash2 size={12} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    <button onClick={onAddFrame} className="mt-4 w-full py-3 bg-green-600 hover:bg-green-500 rounded font-bold text-sm text-white shadow-lg shadow-green-900/20 uppercase tracking-wide">
                        Capture Formation (Current Time)
                    </button>
                </div>
            )}

            {/* PERFORMERS TAB */}
            {activeTab === 'performers' && (
                <div className="h-full flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-bold text-slate-400 uppercase">Cast List</h2>
                        <span className="text-xs text-slate-500">{performers.length} total</span>
                    </div>

                    {/* Search */}
                    <div className="relative mb-4">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input 
                            type="text" 
                            placeholder="Search performers..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-full py-1.5 pl-9 pr-4 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                        />
                    </div>

                    {/* Add New Section */}
                    <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 mb-4">
                        <div className="flex gap-2 mb-3">
                             <input
                                type="text"
                                placeholder="Name"
                                className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                value={newPerformerName}
                                onChange={(e) => setNewPerformerName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                             />
                             <button onClick={handleAdd} className="bg-blue-600 hover:bg-blue-500 px-3 rounded text-white">
                                <Plus size={18} />
                             </button>
                        </div>
                        
                        <div className="flex items-center justify-between gap-2">
                             {/* Shape Toggle */}
                             <div className="flex bg-slate-900 rounded p-1 gap-1 border border-slate-600">
                                <button 
                                    onClick={() => setNewPerformerShape('circle')} 
                                    className={`p-1.5 rounded ${newPerformerShape === 'circle' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                    title="Circle Shape"
                                >
                                    <Circle size={14} fill={newPerformerShape === 'circle' ? 'currentColor' : 'none'} />
                                </button>
                                <button 
                                    onClick={() => setNewPerformerShape('triangle')} 
                                    className={`p-1.5 rounded ${newPerformerShape === 'triangle' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                    title="Triangle Shape"
                                >
                                    <Triangle size={14} fill={newPerformerShape === 'triangle' ? 'currentColor' : 'none'} />
                                </button>
                                <button 
                                    onClick={() => setNewPerformerShape('square')} 
                                    className={`p-1.5 rounded ${newPerformerShape === 'square' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                    title="Square Shape"
                                >
                                    <Square size={14} fill={newPerformerShape === 'square' ? 'currentColor' : 'none'} />
                                </button>
                             </div>

                             {/* Color Picker */}
                             <div className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded px-2 py-1">
                                <input 
                                    type="color" 
                                    value={newPerformerColor} 
                                    onChange={(e) => setNewPerformerColor(e.target.value)}
                                    className="w-6 h-6 bg-transparent border-none cursor-pointer"
                                    title="Customize Color"
                                />
                                <span className="text-[10px] text-slate-400 font-mono">{newPerformerColor.toUpperCase()}</span>
                             </div>
                        </div>
                    </div>

                    {/* Selection Actions */}
                    {selectedPerformerIds.length > 0 && (
                        <div className="flex items-center gap-2 mb-3 animate-in slide-in-from-top-2 fade-in duration-200">
                            <button 
                                onClick={onDuplicateSelected}
                                className="flex-1 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/50 text-blue-200 text-xs py-1.5 rounded flex items-center justify-center gap-2 transition-colors"
                            >
                                <Copy size={12} /> Duplicate ({selectedPerformerIds.length})
                            </button>
                            <button 
                                onClick={() => selectedPerformerIds.forEach(id => onRemovePerformer(id))}
                                className="px-3 bg-red-900/20 hover:bg-red-900/40 border border-red-500/50 text-red-300 text-xs py-1.5 rounded transition-colors"
                                title="Delete Selected"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    )}

                    {/* List */}
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                        {filteredPerformers.map(p => {
                            const inFrame = currentFrame?.positions[p.id] !== undefined;
                            return (
                                <div 
                                    key={p.id} 
                                    onClick={(e) => handlePerformerClick(e, p.id)}
                                    className={`flex items-center gap-4 p-3 rounded-lg transition-all cursor-pointer ${
                                        selectedPerformerIds.includes(p.id) 
                                            ? 'bg-slate-800 border border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.1)]' 
                                            : inFrame 
                                                ? 'hover:bg-slate-800 border border-transparent'
                                                : 'opacity-50 hover:opacity-80 hover:bg-slate-800 border border-dashed border-slate-700'
                                    }`}
                                >
                                    {/* Icon */}
                                    {p.shape === 'circle' && <div className="w-4 h-4 rounded-full border-2 shrink-0" style={{ borderColor: p.color, backgroundColor: selectedPerformerIds.includes(p.id) ? p.color : 'transparent' }} />}
                                    {p.shape === 'square' && <div className="w-4 h-4 border-2 shrink-0" style={{ borderColor: p.color, backgroundColor: selectedPerformerIds.includes(p.id) ? p.color : 'transparent' }} />}
                                    {p.shape === 'triangle' && <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[10px] border-transparent shrink-0" style={{ borderBottomColor: p.color }} />}
                                    
                                    {/* Editable Name Input */}
                                    <input 
                                        type="text"
                                        value={p.name}
                                        onChange={(e) => onUpdatePerformer(p.id, { name: e.target.value })}
                                        onClick={(e) => e.stopPropagation()} // Prevent selecting row when clicking input
                                        className={`flex-1 text-sm font-medium bg-transparent border-none focus:ring-0 focus:outline-none p-0 ${selectedPerformerIds.includes(p.id) ? 'text-white' : 'text-slate-300'}`}
                                    />

                                    {/* Actions: Toggle In/Out of Frame, Delete */}
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onTogglePerformerInFrame(p.id); }}
                                            className={`p-1 rounded ${inFrame ? 'text-blue-400 hover:text-white hover:bg-blue-600' : 'text-slate-600 hover:text-white hover:bg-green-600'}`}
                                            title={inFrame ? "Remove from this formation" : "Add to this formation"}
                                        >
                                            {inFrame ? <UserCheck size={14} /> : <UserX size={14} />}
                                        </button>
                                        
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onRemovePerformer(p.id); }} 
                                            className="text-slate-600 hover:text-red-400 p-1 rounded hover:bg-slate-700"
                                            title="Delete Globally"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                         {performers.length === 0 && <div className="text-slate-600 text-center text-sm py-10 italic">No performers added</div>}
                    </div>
                </div>
            )}

            {/* PRESETS TAB */}
            {activeTab === 'presets' && (
                <div className="space-y-6">
                    {/* AI Box */}
                    <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-4 rounded-lg border border-slate-700/50">
                         <div className="flex items-center gap-2 mb-2 text-purple-400">
                            <Sparkles size={14} />
                            <span className="text-xs font-bold uppercase">AI Choreographer</span>
                         </div>
                         <textarea
                            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white mb-2 focus:outline-none focus:border-purple-500 resize-none h-16"
                            placeholder="e.g. 'A flying wedge formation'"
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                        />
                        <button 
                            onClick={handleAiGenerate}
                            disabled={isGenerating}
                            className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-xs font-bold text-white flex items-center justify-center gap-2"
                        >
                            <Wand2 size={12} /> {isGenerating ? 'Thinking...' : 'Generate'}
                        </button>
                    </div>

                    {/* Preset Size Slider */}
                    <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 text-slate-400">
                                <Scaling size={14} />
                                <span className="text-xs font-bold uppercase">Preset Size</span>
                            </div>
                            <span className="text-xs font-mono text-blue-400">{Math.round(presetScale * 100)}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="0.2" 
                            max="1.5" 
                            step="0.1" 
                            value={presetScale} 
                            onChange={(e) => setPresetScale(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                    </div>

                    {/* Categorized Presets */}
                    {[
                        { id: 'Fill', keys: Object.keys(PRESET_SHAPES).filter(k => k.includes('Fill')) },
                        { id: 'Outline', keys: Object.keys(PRESET_SHAPES).filter(k => k.includes('Outline')) },
                        { id: 'Lines', keys: Object.keys(PRESET_SHAPES).filter(k => k.includes('Line')) },
                    ].map(group => (
                        <div key={group.id}>
                            <h3 className="text-xs font-bold text-slate-500 uppercase mb-2 px-1">{group.id}</h3>
                            <div className="grid grid-cols-2 gap-2">
                                {group.keys.map(shape => (
                                    <button
                                        key={shape}
                                        onClick={() => onApplyPreset(PRESET_SHAPES[shape](selectedPerformerIds.length > 0 ? selectedPerformerIds.length : performers.length, presetScale))}
                                        className="group relative py-4 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 rounded flex flex-col items-center justify-center gap-2 transition-all"
                                    >
                                        <div className="opacity-50 group-hover:opacity-100 transition-opacity">
                                            {/* Simple Visual Representation */}
                                            {shape.includes('Horizontal') && <div className="w-8 h-0.5 bg-slate-400" />}
                                            {shape.includes('Vertical') && <div className="w-0.5 h-8 bg-slate-400" />}
                                            {shape.includes('Diagonal') && <div className="w-8 h-0.5 bg-slate-400 transform -rotate-45" />}
                                            
                                            {shape.includes('Circle (Outline)') && <div className="w-6 h-6 border-2 border-slate-400 rounded-full" />}
                                            {shape.includes('Square (Outline)') && <div className="w-6 h-6 border-2 border-slate-400" />}
                                            {shape.includes('Triangle (Outline)') && <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[10px] border-transparent border-b-slate-400" />}
                                            
                                            {shape.includes('Circle (Fill)') && <div className="w-6 h-6 bg-slate-400 rounded-full" />}
                                            {shape.includes('Square (Fill)') && <div className="w-6 h-6 bg-slate-400" />}
                                            {shape.includes('Triangle (Fill)') && <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[10px] border-transparent border-b-slate-400" />}
                                        </div>
                                        <span className="text-[10px] font-medium text-slate-400 group-hover:text-white text-center">{shape.split('(')[0].trim()}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    </div>
  );
};
