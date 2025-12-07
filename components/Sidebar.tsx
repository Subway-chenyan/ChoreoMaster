
import React, { useState, useMemo, useRef } from 'react';
import { Performer, Frame, PerformerShape, PerformerGroup } from '../types';
import { Plus, Users, Trash2, Download, Grid, Music, Sparkles, Wand2, Film, Copy, Search, Settings, Scaling, Upload, FilePlus, Circle, Square, Triangle, UserCheck, UserX, Eye, EyeOff, FolderPlus, Folder, FolderOpen, ChevronRight, ChevronDown, MoreVertical, Palette, Edit2 } from 'lucide-react';
import { PRESET_SHAPES, DEFAULT_COLORS } from '../constants';
import { generateFormationCoordinates } from '../services/geminiService';

interface SidebarProps {
    performers: Performer[];
    performerGroups: PerformerGroup[];
    frames: Frame[];
    currentFrameId: string;
    onAddPerformer: (name: string, color: string, shape: PerformerShape) => void;
    onRemovePerformer: (id: string) => void;
    onUpdatePerformer: (id: string, updates: Partial<Performer>) => void;
    onTogglePerformerInFrame: (id: string) => void;
    onDuplicateSelected: () => void;
    onApplyPreset: (coords: { x: number, y: number }[]) => void;
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
    onRenameFrame: (id: string, name?: string) => void;
    widthPx?: number;
    // Group Management Props
    onAddGroup: (name: string, color: string) => string;
    onRemoveGroup: (groupId: string) => void;
    onUpdateGroup: (groupId: string, updates: Partial<PerformerGroup>) => void;
    onAddPerformerToGroup: (performerId: string, groupId: string) => void;
    onRemovePerformerFromGroup: (performerId: string) => void;
    onAddPerformersToGroup: (performerIds: string[], groupId: string) => void;
    onUpdateGroupPerformers: (groupId: string, updates: Partial<Performer>) => void;
    onToggleGroupVisibility: (groupId: string) => void;
    onToggleGroupCollapsed: (groupId: string) => void;
    onSelectGroupPerformers: (groupId: string) => void;
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
    performerGroups,
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
    onResetProject,
    onRenameFrame,
    widthPx = 320,
    // Group Management Props
    onAddGroup,
    onRemoveGroup,
    onUpdateGroup,
    onAddPerformerToGroup,
    onRemovePerformerFromGroup,
    onAddPerformersToGroup,
    onUpdateGroupPerformers,
    onToggleGroupVisibility,
    onToggleGroupCollapsed,
    onSelectGroupPerformers,
}) => {
    const [activeTab, setActiveTab] = useState<Tab>('performers');
    const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
    const [editingFrameName, setEditingFrameName] = useState<string>('');
    const [editingPerformerId, setEditingPerformerId] = useState<string | null>(null);
    const [editingPerformerName, setEditingPerformerName] = useState<string>('');

    // Add Performer State
    const [newPerformerName, setNewPerformerName] = useState('');
    const [newPerformerShape, setNewPerformerShape] = useState<PerformerShape>('circle');
    const [newPerformerColor, setNewPerformerColor] = useState<string>(DEFAULT_COLORS[0]);

    // Preset State
    const [presetScale, setPresetScale] = useState(0.8); // Default 80% size to be safe

    const [searchQuery, setSearchQuery] = useState('');
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    // Group State
    const [showNewGroupForm, setShowNewGroupForm] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupColor, setNewGroupColor] = useState(DEFAULT_COLORS[0]);
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [editingGroupName, setEditingGroupName] = useState<string>('');
    const [contextMenuState, setContextMenuState] = useState<{
        show: boolean;
        x: number;
        y: number;
        performerId: string | null;
        groupId: string | null;
    }>({ show: false, x: 0, y: 0, performerId: null, groupId: null });
    const [draggedPerformerId, setDraggedPerformerId] = useState<string | null>(null);

    // Ref for context menu click outside detection
    const contextMenuRef = useRef<HTMLDivElement>(null);

    const filteredPerformers = useMemo(() => {
        return performers.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [performers, searchQuery]);

    // Get performers by group
    const performersByGroup = useMemo(() => {
        const grouped: Record<string, Performer[]> = {};
        const ungrouped: Performer[] = [];

        filteredPerformers.forEach(p => {
            if (p.groupId) {
                if (!grouped[p.groupId]) grouped[p.groupId] = [];
                grouped[p.groupId].push(p);
            } else {
                ungrouped.push(p);
            }
        });

        return { grouped, ungrouped };
    }, [filteredPerformers]);

    const shapeLabel = (key: string) => {
        const base = key.split('(')[0].trim();
        if (base.includes('Horizontal')) return '水平线';
        if (base.includes('Vertical')) return '垂直线';
        if (base.includes('Diagonal')) return '对角线';
        if (base.includes('Circle')) return '圆形';
        if (base.includes('Square')) return '方形';
        if (base.includes('Triangle')) return '三角形';
        return base;
    };

    // Frames sorted by time for display
    const sortedFrames = useMemo(() => {
        return [...frames].sort((a, b) => a.startTime - b.startTime);
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

    // Group Handlers
    const handleCreateGroup = () => {
        if (newGroupName.trim()) {
            const groupId = onAddGroup(newGroupName.trim(), newGroupColor);
            // If performers are selected, add them to the new group
            if (selectedPerformerIds.length > 0) {
                onAddPerformersToGroup(selectedPerformerIds, groupId);
            }
            setNewGroupName('');
            setShowNewGroupForm(false);
            const nextColorIndex = (DEFAULT_COLORS.indexOf(newGroupColor) + 1) % DEFAULT_COLORS.length;
            setNewGroupColor(DEFAULT_COLORS[nextColorIndex]);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, performerId: string | null, groupId: string | null = null) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenuState({
            show: true,
            x: e.clientX,
            y: e.clientY,
            performerId,
            groupId,
        });
    };

    const closeContextMenu = () => {
        setContextMenuState({ show: false, x: 0, y: 0, performerId: null, groupId: null });
    };

    // Close context menu when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                closeContextMenu();
            }
        };
        if (contextMenuState.show) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [contextMenuState.show]);

    // Drag and Drop Handlers
    const handleDragStart = (e: React.DragEvent, performerId: string) => {
        setDraggedPerformerId(performerId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', performerId);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDropOnGroup = (e: React.DragEvent, groupId: string) => {
        e.preventDefault();
        if (draggedPerformerId) {
            onAddPerformerToGroup(draggedPerformerId, groupId);
        }
        setDraggedPerformerId(null);
    };

    const handleDropOnUngrouped = (e: React.DragEvent) => {
        e.preventDefault();
        if (draggedPerformerId) {
            onRemovePerformerFromGroup(draggedPerformerId);
        }
        setDraggedPerformerId(null);
    };

    const handleDragEnd = () => {
        setDraggedPerformerId(null);
    };

    // Render performer item (reusable)
    const renderPerformerItem = (p: Performer) => {
        const inFrame = currentFrame?.positions[p.id] !== undefined;
        const isHiddenByGroup = p.groupId && currentFrame?.hiddenGroupIds?.includes(p.groupId);

        return (
            <div
                key={p.id}
                draggable
                onDragStart={(e) => handleDragStart(e, p.id)}
                onDragEnd={handleDragEnd}
                onClick={(e) => handlePerformerClick(e, p.id)}
                onContextMenu={(e) => handleContextMenu(e, p.id)}
                className={`flex items-center gap-3 p-2.5 rounded-lg transition-all cursor-pointer ${selectedPerformerIds.includes(p.id)
                    ? 'bg-slate-800 border border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.1)]'
                    : inFrame
                        ? 'hover:bg-slate-800 border border-transparent'
                        : 'opacity-50 hover:opacity-80 hover:bg-slate-800 border border-dashed border-slate-700'
                    } ${isHiddenByGroup ? 'opacity-30' : ''} ${draggedPerformerId === p.id ? 'opacity-50' : ''}`}
            >
                {/* Icon */}
                {p.shape === 'circle' && <div className="w-4 h-4 rounded-full border-2 shrink-0" style={{ borderColor: p.color, backgroundColor: selectedPerformerIds.includes(p.id) ? p.color : 'transparent' }} />}
                {p.shape === 'square' && <div className="w-4 h-4 border-2 shrink-0" style={{ borderColor: p.color, backgroundColor: selectedPerformerIds.includes(p.id) ? p.color : 'transparent' }} />}
                {p.shape === 'triangle' && <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[10px] border-transparent shrink-0" style={{ borderBottomColor: p.color }} />}

                {/* Editable Name by Double Click */}
                {editingPerformerId === p.id ? (
                    <input
                        autoFocus
                        value={editingPerformerName}
                        onChange={(e) => setEditingPerformerName(e.target.value)}
                        onBlur={() => {
                            const name = editingPerformerName.trim();
                            if (name) onUpdatePerformer(p.id, { name });
                            setEditingPerformerId(null);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const name = editingPerformerName.trim();
                                if (name) onUpdatePerformer(p.id, { name });
                                setEditingPerformerId(null);
                            } else if (e.key === 'Escape') {
                                setEditingPerformerId(null);
                            }
                        }}
                        className={`flex-1 text-sm font-medium bg-slate-900 border border-slate-700 rounded px-2 py-1 ${selectedPerformerIds.includes(p.id) ? 'text-white' : 'text-slate-300'}`}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <div
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingPerformerId(p.id);
                            setEditingPerformerName(p.name);
                        }}
                        className={`flex-1 text-sm font-medium bg-transparent p-0 truncate ${selectedPerformerIds.includes(p.id) ? 'text-white' : 'text-slate-300'}`}
                    >
                        {p.name}
                    </div>
                )}

                {/* Actions: Toggle In/Out of Frame, Delete */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={(e) => { e.stopPropagation(); onTogglePerformerInFrame(p.id); }}
                        className={`p-1 rounded ${inFrame ? 'text-blue-400 hover:text-white hover:bg-blue-600' : 'text-slate-600 hover:text-white hover:bg-green-600'}`}
                        title={inFrame ? "从此队形移除" : "添加到此队形"}
                    >
                        {inFrame ? <UserCheck size={14} /> : <UserX size={14} />}
                    </button>

                    <button
                        onClick={(e) => { e.stopPropagation(); onRemovePerformer(p.id); }}
                        className="text-slate-600 hover:text-red-400 p-1 rounded hover:bg-slate-700"
                        title="全局删除"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div style={{ width: widthPx }} className="bg-slate-900 border-r border-slate-800 flex flex-col shadow-xl z-20">
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
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">项目设置</h2>

                        <div className="space-y-3">
                            <button onClick={onResetProject} className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 transition-colors text-sm">
                                <FilePlus size={16} /> 新建项目
                            </button>
                            <label className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 transition-colors text-sm cursor-pointer">
                                <Upload size={16} /> 导入项目 (JSON)
                                <input type="file" accept=".json" className="hidden" onChange={onImportProject} />
                            </label>
                            <button onClick={onExport} className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 transition-colors text-sm">
                                <Download size={16} /> 导出项目 (JSON)
                            </button>
                        </div>

                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 mt-4">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
                                    <Music size={12} /> 配乐
                                </label>
                            </div>
                            {musicName ? (
                                <div className="text-sm text-blue-300 truncate mb-3 font-medium">{musicName}</div>
                            ) : (
                                <div className="text-sm text-slate-500 italic mb-3">暂无配乐</div>
                            )}
                            <label className="block w-full text-center px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded text-xs cursor-pointer transition-colors text-white">
                                导入音频文件
                                <input type="file" accept="audio/*" className="hidden" onChange={onImportMusic} />
                            </label>
                        </div>
                    </div>
                )}

                {/* FORMATIONS TAB */}
                {activeTab === 'formations' && (
                    <div className="h-full flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-bold text-slate-400 uppercase">时间轴队形</h2>
                            <span className="text-xs text-slate-600">{frames.length} 个队形</span>
                        </div>

                        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                            {sortedFrames.map((f, idx) => (
                                <div
                                    key={f.id}
                                    onClick={() => onSelectFrame(f.id)}
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        setEditingFrameId(f.id);
                                        setEditingFrameName(f.name);
                                    }}
                                    className={`group relative flex gap-3 p-2 rounded-lg border transition-all cursor-pointer ${f.id === currentFrameId ? 'bg-slate-800 border-blue-500 shadow-md' : 'bg-slate-900 border-slate-800 hover:bg-slate-800'}`}
                                >
                                    {/* Thumbnail */}
                                    <div className="w-16 h-12 shrink-0">
                                        <FormationThumbnail positions={f.positions} />
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                                        <div className={`text-sm font-medium truncate ${f.id === currentFrameId ? 'text-blue-400' : 'text-slate-300'}`}>
                                            {editingFrameId === f.id ? (
                                                <input
                                                    autoFocus
                                                    value={editingFrameName}
                                                    onChange={(e) => setEditingFrameName(e.target.value)}
                                                    onBlur={() => {
                                                        const name = editingFrameName.trim();
                                                        if (name) onRenameFrame(f.id, name);
                                                        setEditingFrameId(null);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            const name = editingFrameName.trim();
                                                            if (name) onRenameFrame(f.id, name);
                                                            setEditingFrameId(null);
                                                        } else if (e.key === 'Escape') {
                                                            setEditingFrameId(null);
                                                        }
                                                    }}
                                                    className={`w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs ${f.id === currentFrameId ? 'text-blue-400' : 'text-slate-300'}`}
                                                />
                                            ) : (
                                                f.name
                                            )}
                                        </div>
                                        <div className="text-[10px] text-slate-500 flex gap-2">
                                            <span>Start: {(f.startTime / 1000).toFixed(1)}s</span>
                                            <span>Dur: {(f.duration / 1000).toFixed(1)}s</span>
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
                            创建队形
                        </button>
                    </div>
                )}

                {/* PERFORMERS TAB */}
                {activeTab === 'performers' && (
                    <div className="h-full flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-bold text-slate-400 uppercase">演员列表</h2>
                            <span className="text-xs text-slate-500">{performers.length} 人</span>
                        </div>

                        {/* Search */}
                        <div className="relative mb-3">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                placeholder="搜索演员..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-full py-1.5 pl-9 pr-4 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                            />
                        </div>

                        {/* Add New Performer */}
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 mb-3">
                            <div className="flex gap-2 mb-2 min-w-0 items-stretch">
                                <input
                                    type="text"
                                    placeholder="演员名称"
                                    className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                    value={newPerformerName}
                                    onChange={(e) => setNewPerformerName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                                />
                                <button onClick={handleAdd} className="bg-blue-600 hover:bg-blue-500 px-3 rounded text-white">
                                    <Plus size={18} />
                                </button>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex bg-slate-900 rounded p-1 gap-1 border border-slate-600">
                                    <button onClick={() => setNewPerformerShape('circle')} className={`p-1.5 rounded ${newPerformerShape === 'circle' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`} title="圆形">
                                        <Circle size={14} fill={newPerformerShape === 'circle' ? 'currentColor' : 'none'} />
                                    </button>
                                    <button onClick={() => setNewPerformerShape('triangle')} className={`p-1.5 rounded ${newPerformerShape === 'triangle' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`} title="三角形">
                                        <Triangle size={14} fill={newPerformerShape === 'triangle' ? 'currentColor' : 'none'} />
                                    </button>
                                    <button onClick={() => setNewPerformerShape('square')} className={`p-1.5 rounded ${newPerformerShape === 'square' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`} title="方形">
                                        <Square size={14} fill={newPerformerShape === 'square' ? 'currentColor' : 'none'} />
                                    </button>
                                </div>
                                <div className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded px-2 py-1">
                                    <input type="color" value={newPerformerColor} onChange={(e) => setNewPerformerColor(e.target.value)} className="w-6 h-6 bg-transparent border-none cursor-pointer" title="自定义颜色" />
                                    <span className="text-[10px] text-slate-400 font-mono">{newPerformerColor.toUpperCase()}</span>
                                </div>
                            </div>
                        </div>

                        {/* Add New Group Button */}
                        <div className="mb-3">
                            {!showNewGroupForm ? (
                                <button onClick={() => setShowNewGroupForm(true)} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 hover:border-slate-600 rounded text-slate-300 hover:text-white transition-colors text-xs">
                                    <FolderPlus size={14} /> 创建分组
                                </button>
                            ) : (
                                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                                    <div className="flex gap-2 mb-2">
                                        <input
                                            type="text"
                                            placeholder="分组名称"
                                            className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                            value={newGroupName}
                                            onChange={(e) => setNewGroupName(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                                            autoFocus
                                        />
                                        <input type="color" value={newGroupColor} onChange={(e) => setNewGroupColor(e.target.value)} className="w-10 h-10 bg-transparent border border-slate-600 rounded cursor-pointer" />
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={handleCreateGroup} className="flex-1 bg-green-600 hover:bg-green-500 px-3 py-1.5 rounded text-white text-xs">创建</button>
                                        <button onClick={() => { setShowNewGroupForm(false); setNewGroupName(''); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 text-xs">取消</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Selection Actions */}
                        {selectedPerformerIds.length > 0 && (
                            <div className="flex items-center gap-2 mb-3 animate-in slide-in-from-top-2 fade-in duration-200">
                                <button onClick={onDuplicateSelected} className="flex-1 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/50 text-blue-200 text-xs py-1.5 rounded flex items-center justify-center gap-2 transition-colors">
                                    <Copy size={12} /> 复制 ({selectedPerformerIds.length})
                                </button>
                                <button onClick={() => selectedPerformerIds.forEach(id => onRemovePerformer(id))} className="px-3 bg-red-900/20 hover:bg-red-900/40 border border-red-500/50 text-red-300 text-xs py-1.5 rounded transition-colors" title="删除选中">
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        )}

                        {/* Performers List with Groups */}
                        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                            {/* Groups */}
                            {performerGroups.map(group => {
                                const groupPerformers = performersByGroup.grouped[group.id] || [];
                                if (groupPerformers.length === 0 && searchQuery) return null; // Hide empty groups when searching

                                return (
                                    <div key={group.id} className="mb-2">
                                        {/* Group Header */}
                                        <div
                                            onDragOver={handleDragOver}
                                            onDrop={(e) => handleDropOnGroup(e, group.id)}
                                            onContextMenu={(e) => handleContextMenu(e, null, group.id)}
                                            className="flex items-center gap-2 p-2 bg-slate-800/50 hover:bg-slate-800 rounded-lg border border-slate-700 cursor-pointer group/header transition-colors"
                                        >
                                            <button onClick={() => onToggleGroupCollapsed(group.id)} className="text-slate-400 hover:text-white">
                                                {group.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                            </button>
                                            {group.collapsed ? <Folder size={14} style={{ color: group.color }} /> : <FolderOpen size={14} style={{ color: group.color }} />}

                                            {editingGroupId === group.id ? (
                                                <input
                                                    autoFocus
                                                    value={editingGroupName}
                                                    onChange={(e) => setEditingGroupName(e.target.value)}
                                                    onBlur={() => {
                                                        const name = editingGroupName.trim();
                                                        if (name) onUpdateGroup(group.id, { name });
                                                        setEditingGroupId(null);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            const name = editingGroupName.trim();
                                                            if (name) onUpdateGroup(group.id, { name });
                                                            setEditingGroupId(null);
                                                        } else if (e.key === 'Escape') {
                                                            setEditingGroupId(null);
                                                        }
                                                    }}
                                                    className="flex-1 text-sm font-medium bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <div
                                                    onDoubleClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingGroupId(group.id);
                                                        setEditingGroupName(group.name);
                                                    }}
                                                    onClick={() => onSelectGroupPerformers(group.id)}
                                                    className="flex-1 text-sm font-medium text-slate-200 truncate"
                                                >
                                                    {group.name} <span className="text-xs text-slate-500">({groupPerformers.length})</span>
                                                </div>
                                            )}

                                            <button onClick={(e) => { e.stopPropagation(); onToggleGroupVisibility(group.id); }} className={`p-1 rounded ${!(currentFrame?.hiddenGroupIds?.includes(group.id)) ? 'text-blue-400 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-700'}`} title={!(currentFrame?.hiddenGroupIds?.includes(group.id)) ? "隐藏分组" : "显示分组"}>
                                                {!(currentFrame?.hiddenGroupIds?.includes(group.id)) ? <Eye size={14} /> : <EyeOff size={14} />}
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handleContextMenu(e, null, group.id); }} className="p-1 text-slate-500 hover:text-white hover:bg-slate-700 rounded opacity-0 group-hover/header:opacity-100 transition-opacity">
                                                <MoreVertical size={14} />
                                            </button>
                                        </div>

                                        {/* Group Members */}
                                        {!group.collapsed && (
                                            <div className="ml-4 mt-1 space-y-1 border-l-2 border-slate-700 pl-2">
                                                {groupPerformers.map(p => renderPerformerItem(p))}
                                                {groupPerformers.length === 0 && (
                                                    <div className="text-slate-600 text-xs py-2 italic text-center">拖动演员到此处</div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Ungrouped Performers */}
                            {performersByGroup.ungrouped.length > 0 && (
                                <div>
                                    <div
                                        onDragOver={handleDragOver}
                                        onDrop={handleDropOnUngrouped}
                                        className="flex items-center gap-2 p-2 mb-1 text-xs text-slate-500 uppercase tracking-wider"
                                    >
                                        <Users size={12} /> 未分组 ({performersByGroup.ungrouped.length})
                                    </div>
                                    <div className="space-y-1">
                                        {performersByGroup.ungrouped.map(p => renderPerformerItem(p))}
                                    </div>
                                </div>
                            )}

                            {performers.length === 0 && <div className="text-slate-600 text-center text-sm py-10 italic">尚未添加演员</div>}
                        </div>
                    </div>
                )}

                {/* Context Menu */}
                {contextMenuState.show && (
                    <div
                        ref={contextMenuRef}
                        style={{ position: 'fixed', left: contextMenuState.x, top: contextMenuState.y, zIndex: 9999 }}
                        className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
                    >
                        {contextMenuState.performerId && (
                            <>
                                <div className="px-3 py-1 text-xs text-slate-500 uppercase tracking-wider">移动到分组</div>
                                {performerGroups.map(group => (
                                    <button
                                        key={group.id}
                                        onClick={() => {
                                            if (contextMenuState.performerId) {
                                                onAddPerformerToGroup(contextMenuState.performerId, group.id);
                                            }
                                            closeContextMenu();
                                        }}
                                        className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                                    >
                                        <Folder size={12} style={{ color: group.color }} />
                                        {group.name}
                                    </button>
                                ))}
                                {performerGroups.length === 0 && (
                                    <div className="px-3 py-2 text-xs text-slate-600 italic">暂无分组</div>
                                )}
                                <div className="h-px bg-slate-700 my-1"></div>
                                <button
                                    onClick={() => {
                                        if (contextMenuState.performerId) {
                                            onRemovePerformerFromGroup(contextMenuState.performerId);
                                        }
                                        closeContextMenu();
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-700"
                                >
                                    移出分组
                                </button>
                            </>
                        )}
                        {contextMenuState.groupId && (
                            <>
                                <button
                                    onClick={() => {
                                        if (contextMenuState.groupId) {
                                            setEditingGroupId(contextMenuState.groupId);
                                            const group = performerGroups.find(g => g.id === contextMenuState.groupId);
                                            if (group) setEditingGroupName(group.name);
                                        }
                                        closeContextMenu();
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                                >
                                    <Edit2 size={12} /> 重命名
                                </button>
                                <button
                                    onClick={() => {
                                        if (contextMenuState.groupId) {
                                            const group = performerGroups.find(g => g.id === contextMenuState.groupId);
                                            if (group) {
                                                const newColor = prompt('输入新颜色 (hex)', group.color);
                                                if (newColor) onUpdateGroup(group.id, { color: newColor });
                                            }
                                        }
                                        closeContextMenu();
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                                >
                                    <Palette size={12} /> 更改颜色
                                </button>
                                <div className="h-px bg-slate-700 my-1"></div>
                                <button
                                    onClick={() => {
                                        if (contextMenuState.groupId && window.confirm('确定要删除此分组吗？演员将移至未分组。')) {
                                            onRemoveGroup(contextMenuState.groupId);
                                        }
                                        closeContextMenu();
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-slate-700"
                                >
                                    删除分组
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* PRESETS TAB */}
                {activeTab === 'presets' && (
                    <div className="space-y-6">
                        {/* AI Box */}
                        <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-4 rounded-lg border border-slate-700/50">
                            <div className="flex items-center gap-2 mb-2 text-purple-400">
                                <Sparkles size={14} />
                                <span className="text-xs font-bold uppercase">AI 编舞</span>
                            </div>
                            <textarea
                                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white mb-2 focus:outline-none focus:border-purple-500 resize-none h-16"
                                placeholder="例如：“飞行楔形队形”"
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                            />
                            <button
                                onClick={handleAiGenerate}
                                disabled={isGenerating}
                                className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-xs font-bold text-white flex items-center justify-center gap-2"
                            >
                                <Wand2 size={12} /> {isGenerating ? '思考中...' : '生成'}
                            </button>
                        </div>

                        {/* Preset Size Slider */}
                        <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-slate-400">
                                    <Scaling size={14} />
                                    <span className="text-xs font-bold uppercase">预设大小</span>
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
                            { id: '填充', keys: Object.keys(PRESET_SHAPES).filter(k => k.includes('Fill')) },
                            { id: '轮廓', keys: Object.keys(PRESET_SHAPES).filter(k => k.includes('Outline')) },
                            { id: '线条', keys: Object.keys(PRESET_SHAPES).filter(k => k.includes('Line')) },
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
                                            <span className="text-[10px] font-medium text-slate-400 group-hover:text-white text-center">{shapeLabel(shape)}</span>
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
