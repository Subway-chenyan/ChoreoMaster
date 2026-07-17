
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Performer, Frame, PerformerShape, PerformerGroup, PerformerType, PropCategory, AIConfig, AIChoreoPlan, ProjectTemplateData } from '../types';
import { Plus, Users, Trash2, Download, Grid, Music, Sparkles, Wand2, Film, Copy, Search, Settings, Scaling, Upload, FilePlus, Circle, Square, Triangle, UserCheck, UserX, Eye, EyeOff, FolderPlus, Folder, FolderOpen, ChevronRight, ChevronDown, MoreVertical, Palette, Edit2, Box, Library, Save, StickyNote } from 'lucide-react';
import { PRESET_SHAPES, DEFAULT_COLORS } from '../constants';
import { StageConfig } from '../types';
import { ProjectBrowser } from './ProjectBrowser';
import { PropEditorModal } from './PropEditorModal';
import { ChoreoAgentModal } from './ChoreoAgentModal';
import { EditableNumberInput, SelectField, StepperNumberField } from './FormControls';
import { validateAgentAccess } from '../services/choreoAgentService';
import { isPerformerGroupCompatible, resolveGroupAction, type GroupablePerformerType } from '../utils/performer-grouping';
import { formatFrameDuration, isKeyframeFrame } from '../utils/frame-keyframes';

interface SidebarProps {
    performers: Performer[];
    performerGroups: PerformerGroup[];
    frames: Frame[];
    currentFrameId: string;
    onAddPerformer: (name: string, color: string, shape: PerformerShape, extra?: Partial<Performer>) => void;
    onRemovePerformer: (id: string) => void;
    onUpdatePerformer: (id: string, updates: Partial<Performer>) => void;
    onTogglePerformerInFrame: (id: string) => void;
    onDuplicateSelected: () => void;
    onApplyPreset: (coords: { x: number, y: number }[]) => void;
    onApplyAIPlan: (plan: AIChoreoPlan) => void;
    onImportMusic: (e?: React.ChangeEvent<HTMLInputElement>) => void;
    onExport: () => void;
    onImportProject: (e?: React.ChangeEvent<HTMLInputElement>) => void;
    onImportProjectPackage?: () => void;
    onImportChoreography?: () => void;
    onExportProjectPackage?: () => void;
    onExportChoreography?: () => void;
    onRestoreRecovery?: (snapshotId: string) => Promise<boolean>;
    selectedPerformerIds: string[];
    onSelectionChange: (ids: string[]) => void;
    musicName: string | null;
    onSelectFrame: (id: string) => void;
    onAddFrame: () => void;
    onDeleteFrame: (id: string) => void;
    onDuplicateFrame: (id: string) => void;
    onReorderFrame: (id: string, direction: 'up' | 'down') => void;
    onResetProject: () => void;
    onDeletedCurrentProject: () => void;
    onRenameFrame: (id: string, name?: string) => void;
    widthPx?: number;
    isCompactLayout?: boolean;
    // Group Management Props
    onAddGroup: (name: string, color: string, type?: 'performer' | 'prop') => string;
    onRemoveGroup: (groupId: string) => void;
    onUpdateGroup: (groupId: string, updates: Partial<PerformerGroup>) => void;
    onAddPerformersToGroup: (performerIds: string[], groupId: string) => void;
    onRemovePerformersFromGroup: (performerIds: string[]) => void;
    onUpdateGroupPerformers: (groupId: string, updates: Partial<Performer>) => void;
    onToggleGroupVisibility: (groupId: string) => void;
    onToggleGroupCollapsed: (groupId: string) => void;
    onSelectGroupPerformers: (groupId: string) => void;
    // 新增 3D 相关 props
    stageConfig?: StageConfig;
    onStageConfigChange: (updates: Partial<StageConfig>) => void;
    onLEDContentUpload: (e?: React.ChangeEvent<HTMLInputElement>) => void;
    onClearLEDContent: () => void;
    onStageBackgroundUpload: (e?: React.ChangeEvent<HTMLInputElement>) => void;
    onClearStageBackground: () => void;
    aiConfig: AIConfig;
    onAiConfigChange: (config: AIConfig) => void;
    // Project storage props
    currentProjectId?: string | null;
    onLoadProject?: (projectId: string) => void;
    onCreateProject?: (name: string) => Promise<string>;
    onCreateFromPresetTemplate?: (name: string, templateId: string) => Promise<string>;
    onCreateFromTemplate?: (templateData: ProjectTemplateData) => Promise<string>;
    onLoadTemplate?: (templateData: ProjectTemplateData) => void;
    onSaveProject?: () => Promise<boolean>;
    projectHasChanges?: boolean;
    isProjectSaving?: boolean;
    lastSavedAt?: number | null;
    performerNotes?: import('../types').PerformerNote[];
    onOpenNoteDrawer?: (performerId: string) => void;
}

type Tab = 'library' | 'project' | 'formations' | 'performers' | 'props' | 'presets';

// Storage Settings Component
const StorageSettings: React.FC = () => {
    const [storagePath, setStoragePath] = useState<string>('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadSettings = async () => {
            if (!window.electronAPI?.isElectron) return;
            try {
                const settings = await window.electronAPI.project.getSettings();
                setStoragePath(settings.storagePath);
            } catch (error) {
                console.error('Failed to load settings:', error);
            } finally {
                setLoading(false);
            }
        };
        loadSettings();
    }, []);

    const handleChangeStoragePath = async () => {
        if (!window.electronAPI?.isElectron) return;
        try {
            const newPath = await window.electronAPI.selectDirectory();
            if (newPath) {
                await window.electronAPI.project.setStoragePath(newPath);
                setStoragePath(newPath);
            }
        } catch (error) {
            console.error('Failed to change storage path:', error);
        }
    };

    const handleOpenStorageFolder = async () => {
        if (!window.electronAPI?.isElectron) return;
        try {
            await window.electronAPI.project.openStorageFolder();
        } catch (error) {
            console.error('Failed to open storage folder:', error);
        }
    };

    if (loading) {
        return <div className="text-xs text-slate-500">加载中...</div>;
    }

    return (
        <div className="space-y-3">
            <div className="space-y-1">
                <label className="text-xs text-slate-400">项目存储位置</label>
                <div className="text-xs text-blue-300 truncate bg-slate-900 px-2 py-1.5 rounded border border-slate-700" title={storagePath}>
                    {storagePath}
                </div>
            </div>
            <div className="flex gap-2">
                <button
                    onClick={handleChangeStoragePath}
                    className="flex-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded text-xs text-white transition-colors"
                >
                    更改路径
                </button>
                <button
                    onClick={handleOpenStorageFolder}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded text-xs text-white transition-colors"
                    title="在文件夹中打开"
                >
                    <FolderOpen size={14} />
                </button>
            </div>
        </div>
    );
};

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
    onApplyAIPlan,
    onImportMusic,
    onExport,
    onImportProject,
    onImportProjectPackage,
    onImportChoreography,
    onExportProjectPackage,
    onExportChoreography,
    onRestoreRecovery,
    selectedPerformerIds,
    onSelectionChange,
    musicName,
    onSelectFrame,
    onAddFrame,
    onDeleteFrame,
    onDuplicateFrame,
    onReorderFrame,
    onResetProject,
    onDeletedCurrentProject,
    onRenameFrame,
    widthPx = 320,
    isCompactLayout = false,
    // Group Management Props
    onAddGroup,
    onRemoveGroup,
    onUpdateGroup,
    onAddPerformersToGroup,
    onRemovePerformersFromGroup,
    onUpdateGroupPerformers,
    onToggleGroupVisibility,
    onToggleGroupCollapsed,
    onSelectGroupPerformers,
    stageConfig,
    onStageConfigChange,
    onLEDContentUpload,
    onClearLEDContent,
    onStageBackgroundUpload,
    onClearStageBackground,
    aiConfig,
    onAiConfigChange,
    // Project storage props
    currentProjectId,
    onLoadProject,
    onCreateProject,
    onCreateFromPresetTemplate,
    onCreateFromTemplate,
    onLoadTemplate,
    onSaveProject,
    projectHasChanges,
    isProjectSaving = false,
    lastSavedAt = null,
    performerNotes = [],
    onOpenNoteDrawer,
}) => {
    const [activeTab, setActiveTab] = useState<Tab>('library');
    const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
    const [editingFrameName, setEditingFrameName] = useState<string>('');
    const [editingPerformerId, setEditingPerformerId] = useState<string | null>(null);
    const [editingPerformerName, setEditingPerformerName] = useState<string>('');

    // Add Performer State
    const [newPerformerName, setNewPerformerName] = useState('');
    const [newPerformerShape, setNewPerformerShape] = useState<PerformerShape>('circle');
    const [newPerformerColor, setNewPerformerColor] = useState<string>(DEFAULT_COLORS[0]);
    // Prop State (长 length, 宽 width, 高 height)
    const [newPropWidth, setNewPropWidth] = useState<number>(0.5); // Default 0.5m (宽)
    const [newPropDepth, setNewPropDepth] = useState<number>(0.5); // Default 0.5m (长)
    const [newPropHeight, setNewPropHeight] = useState<number>(0.5); // Default 0.5m (高)
    const [newPropCategory, setNewPropCategory] = useState<PropCategory>('prop');

    // Preset State
    const [presetScale, setPresetScale] = useState(0.8); // Default 80% size to be safe

    const [searchQuery, setSearchQuery] = useState('');
    const [choreoAgentOpen, setChoreoAgentOpen] = useState(false);
    const [agentAccessError, setAgentAccessError] = useState<string | null>(null);
    const [isValidatingAgentAccess, setIsValidatingAgentAccess] = useState(false);

    // Group State
    const [showAddForm, setShowAddForm] = useState(false);
    const [showNewGroupForm, setShowNewGroupForm] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupColor, setNewGroupColor] = useState(DEFAULT_COLORS[0]);
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [editingGroupName, setEditingGroupName] = useState<string>('');
    const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState<string | null>(null);
    const [contextMenuState, setContextMenuState] = useState<{
        show: boolean;
        x: number;
        y: number;
        performerIds: string[];
        performerType: GroupablePerformerType | null;
        groupId: string | null;
    }>({ show: false, x: 0, y: 0, performerIds: [], performerType: null, groupId: null });
    const [dragState, setDragState] = useState<{
        performerIds: string[];
        performerType: GroupablePerformerType;
        overGroupId: string | null;
        overUngrouped: boolean;
    } | null>(null);

    // Custom Color Picker Modal State
    const [colorPickerState, setColorPickerState] = useState<{
        show: boolean;
        groupId: string | null;
        color: string;
    }>({ show: false, groupId: null, color: '#000000' });

    const [propEditorOpen, setPropEditorOpen] = useState(false);
    const [propEditorPerformerId, setPropEditorPerformerId] = useState<string | null>(null);

    // Ref for context menu click outside detection
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const useSingleColumnPropFields = isCompactLayout || widthPx < 360;

    const filteredPerformers = useMemo(() => {
        let list = performers;
        if (activeTab === 'performers') {
            list = list.filter(p => !p.type || p.type === 'performer');
        } else if (activeTab === 'props') {
            list = list.filter(p => p.type === 'prop');
        }
        return list.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [performers, searchQuery, activeTab]);

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
            setShowAddForm(false);
            const nextColorIndex = (DEFAULT_COLORS.indexOf(newPerformerColor) + 1) % DEFAULT_COLORS.length;
            setNewPerformerColor(DEFAULT_COLORS[nextColorIndex]);
        }
    };

    const handleAddProp = () => {
        if (newPerformerName.trim()) {
            onAddPerformer(newPerformerName, newPerformerColor, 'square', {
                type: 'prop',
                width: newPropWidth,
                depth: newPropDepth,
                height: newPropHeight,
                rotation: 0,
                propCategory: newPropCategory,
            });
            setNewPerformerName('');
            setShowAddForm(false);
            const nextColorIndex = (DEFAULT_COLORS.indexOf(newPerformerColor) + 1) % DEFAULT_COLORS.length;
            setNewPerformerColor(DEFAULT_COLORS[nextColorIndex]);
        }
    };

    const handleOpenChoreoAgent = async () => {
        if (!aiConfig.memberToken.trim()) {
            setAgentAccessError('请输入管理员发放的 Agent 访问 Key。');
            return;
        }
        setIsValidatingAgentAccess(true);
        setAgentAccessError(null);
        try {
            await validateAgentAccess(aiConfig);
            setChoreoAgentOpen(true);
        } catch (error) {
            setAgentAccessError(error instanceof Error ? error.message : 'Agent 访问 Key 校验失败。');
        } finally {
            setIsValidatingAgentAccess(false);
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

    // define filtered groups based on active tab
    const filteredGroups = useMemo(() => {
        return performerGroups.filter(g => {
            if (activeTab === 'props') return g.type === 'prop';
            if (activeTab === 'performers') return !g.type || g.type === 'performer';
            // show all groups in other tabs if needed, or default behavior
            return true;
        });
    }, [performerGroups, activeTab]);

    // Group Handlers
    const handleCreateGroup = () => {
        if (newGroupName.trim()) {
            const type = activeTab === 'props' ? 'prop' : 'performer';
            const groupId = onAddGroup(newGroupName.trim(), newGroupColor, type);
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
        const menuWidth = 208;
        const menuHeight = 320;
        const viewportPadding = 8;
        const action = performerId
            ? resolveGroupAction(performers, selectedPerformerIds, performerId)
            : null;
        if (performerId && !action) return;
        if (performerId && !selectedPerformerIds.includes(performerId)) {
            onSelectionChange([performerId]);
        }
        setContextMenuState({
            show: true,
            x: Math.max(viewportPadding, Math.min(e.clientX, window.innerWidth - menuWidth - viewportPadding)),
            y: Math.max(viewportPadding, Math.min(e.clientY, window.innerHeight - menuHeight - viewportPadding)),
            performerIds: action?.performerIds ?? [],
            performerType: action?.performerType ?? null,
            groupId,
        });
    };

    const closeContextMenu = () => {
        setContextMenuState({ show: false, x: 0, y: 0, performerIds: [], performerType: null, groupId: null });
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
        const action = resolveGroupAction(performers, selectedPerformerIds, performerId);
        if (!action) {
            e.preventDefault();
            return;
        }
        if (!selectedPerformerIds.includes(performerId)) {
            onSelectionChange([performerId]);
        }
        setDragState({ ...action, overGroupId: null, overUngrouped: false });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', action.performerIds.join(','));
    };

    const handleDragOverGroup = (e: React.DragEvent, group: PerformerGroup) => {
        if (!dragState || !isPerformerGroupCompatible(group, dragState.performerType)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragState.overGroupId !== group.id || dragState.overUngrouped) {
            setDragState({ ...dragState, overGroupId: group.id, overUngrouped: false });
        }
    };

    const handleDropOnGroup = (e: React.DragEvent, group: PerformerGroup) => {
        if (!dragState || !isPerformerGroupCompatible(group, dragState.performerType)) return;
        e.preventDefault();
        onAddPerformersToGroup(dragState.performerIds, group.id);
        setDragState(null);
    };

    const handleDragOverUngrouped = (e: React.DragEvent) => {
        if (!dragState) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!dragState.overUngrouped || dragState.overGroupId) {
            setDragState({ ...dragState, overGroupId: null, overUngrouped: true });
        }
    };

    const handleDropOnUngrouped = (e: React.DragEvent) => {
        if (!dragState) return;
        e.preventDefault();
        onRemovePerformersFromGroup(dragState.performerIds);
        setDragState(null);
    };

    const handleDragEnd = () => {
        setDragState(null);
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
                    } ${isHiddenByGroup ? 'opacity-30' : ''} ${dragState?.performerIds.includes(p.id) ? 'opacity-50' : ''}`}
            >
                {/* Icon */}
                {/* Icon */}
                {p.type === 'prop' ? (
                    <div className="w-4 h-4 border-2 shrink-0 flex items-center justify-center rounded-sm" style={{ borderColor: p.color, backgroundColor: selectedPerformerIds.includes(p.id) ? p.color : 'transparent' }}>
                        <Box size={10} color={selectedPerformerIds.includes(p.id) ? '#fff' : p.color} />
                    </div>
                ) : (
                    <>
                        {p.shape === 'circle' && <div className="w-4 h-4 rounded-full border-2 shrink-0" style={{ borderColor: p.color, backgroundColor: selectedPerformerIds.includes(p.id) ? p.color : 'transparent' }} />}
                        {p.shape === 'square' && <div className="w-4 h-4 border-2 shrink-0" style={{ borderColor: p.color, backgroundColor: selectedPerformerIds.includes(p.id) ? p.color : 'transparent' }} />}
                        {p.shape === 'triangle' && <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[10px] border-transparent shrink-0" style={{ borderBottomColor: p.color }} />}
                    </>
                )}

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
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{p.name}</span>
                            {p.type === 'prop' && (
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                                    p.propCategory === 'platform'
                                        ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                                        : 'border-slate-600 bg-slate-800 text-slate-400'
                                }`}>
                                    {p.propCategory === 'platform' ? '高台' : '道具'}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Actions: Toggle In/Out of Frame, Delete */}
                <div className="flex items-center gap-1">
                    {onOpenNoteDrawer && (() => {
                        const noteCount = performerNotes.filter(n => n.performerId === p.id).length;
                        return (
                            <button
                                onClick={(e) => { e.stopPropagation(); onOpenNoteDrawer(p.id); }}
                                className={`p-1 rounded relative ${noteCount > 0 ? 'text-blue-400 hover:text-white hover:bg-blue-600' : 'text-slate-600 hover:text-white hover:bg-slate-600'}`}
                                title="演员笔记"
                            >
                                <StickyNote size={14} />
                                {noteCount > 0 && (
                                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-500 text-[8px] text-white flex items-center justify-center font-bold">
                                        {noteCount > 9 ? '9+' : noteCount}
                                    </span>
                                )}
                            </button>
                        );
                    })()}
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
        <div style={isCompactLayout ? undefined : { width: widthPx, minWidth: widthPx, maxWidth: widthPx }} className="app-sidebar min-h-0 overflow-hidden bg-slate-900 border-r border-slate-800 flex flex-col shadow-xl z-20 flex-shrink-0">
            {/* Top Tabs */}
            <div className="flex items-center bg-slate-950 border-b border-slate-800 px-1 pt-1">
                <button onClick={() => setActiveTab('library')} className={`flex-1 min-h-12 py-3 flex justify-center ${activeTab === 'library' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`} title="项目库">
                    <Library size={18} />
                </button>
                <button onClick={() => setActiveTab('project')} className={`flex-1 min-h-12 py-3 flex justify-center ${activeTab === 'project' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`} title="项目设置">
                    <Settings size={18} />
                </button>
                <button onClick={() => setActiveTab('formations')} className={`flex-1 min-h-12 py-3 flex justify-center ${activeTab === 'formations' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`} title="队形列表">
                    <Film size={18} />
                </button>
                <button onClick={() => setActiveTab('performers')} className={`flex-1 min-h-12 py-3 flex justify-center ${activeTab === 'performers' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`} title="演员管理">
                    <Users size={18} />
                </button>
                <button onClick={() => setActiveTab('props')} className={`flex-1 min-h-12 py-3 flex justify-center ${activeTab === 'props' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`} title="道具管理">
                    <Box size={18} />
                </button>
                <button onClick={() => setActiveTab('presets')} className={`flex-1 min-h-12 py-3 flex justify-center ${activeTab === 'presets' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`} title="AI预设">
                    <Grid size={18} />
                </button>
            </div>

            <div className={`flex-1 min-h-0 overflow-x-hidden custom-scrollbar bg-slate-900 ${
                activeTab === 'performers' || activeTab === 'props'
                    ? 'overflow-y-auto sidebar-tab-scroll'
                    : 'overflow-y-auto p-4'
            }`}>

                {/* LIBRARY TAB */}
                {activeTab === 'library' && (
                    <div className="h-full flex flex-col">
                        <ProjectBrowser
                            currentProjectId={currentProjectId || null}
                            onLoadProject={onLoadProject || (() => {})}
                            onCreateProject={onCreateProject || (async () => '')}
                            onCreateFromPresetTemplate={onCreateFromPresetTemplate}
                            onCreateFromTemplate={onCreateFromTemplate}
                            onLoadTemplate={onLoadTemplate}
                            onDeletedCurrentProject={onDeletedCurrentProject}
                            onImportPackage={onImportProjectPackage}
                            onImportChoreography={onImportChoreography}
                            onExportPackage={onExportProjectPackage}
                            onExportChoreography={onExportChoreography}
                            onRestoreRecovery={onRestoreRecovery}
                        />
                        
                        {/* Project Import/Export Section */}
                        {!window.electronAPI?.isElectron && <div className="mt-4 pt-4 border-t border-slate-800">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">导入 / 导出</h3>
                            <div className="space-y-2">
                                <label className="project-transfer-control w-full h-10 box-border flex items-center justify-start gap-3 px-3 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 transition-colors cursor-pointer">
                                    <Upload size={14} /> 导入项目 (JSON)
                                    <input type="file" accept=".json" className="hidden" onChange={onImportProject} />
                                </label>
                                <button type="button" onClick={onExport} className="project-transfer-control w-full h-10 box-border appearance-none border-0 flex items-center justify-start gap-3 px-3 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 transition-colors">
                                    <Download size={14} /> 导出项目 (JSON)
                                </button>
                            </div>
                        </div>}

                        {/* Storage Settings - Only in Electron */}
                        {window.electronAPI?.isElectron && (
                            <div className="mt-4 pt-4 border-t border-slate-800">
                                <div className="flex items-center gap-2 mb-3">
                                    <Folder size={14} className="text-slate-500" />
                                    <span className="text-xs font-bold text-slate-500 uppercase">存储设置</span>
                                </div>
                                <StorageSettings />
                            </div>
                        )}
                    </div>
                )}

                {/* PROJECT TAB */}
                {activeTab === 'project' && (
                    <div className="space-y-6">
                        {/* Save Button */}
                        {currentProjectId && onSaveProject && (
                            <div className="space-y-2">
                                <button
                                    type="button"
                                    onClick={() => { void onSaveProject(); }}
                                    className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded text-sm font-medium transition-colors ${
                                        projectHasChanges
                                            ? 'bg-green-600 hover:bg-green-500 text-white'
                                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                    } disabled:cursor-wait disabled:opacity-70`}
                                    disabled={isProjectSaving}
                                >
                                    <Save size={16} />
                                    {isProjectSaving ? '保存中…' : projectHasChanges ? '保存项目' : '已保存'}
                                </button>
                                <div className="text-center text-xs text-slate-500">
                                    {lastSavedAt
                                        ? `上次保存：${new Date(lastSavedAt).toLocaleString('zh-CN')}`
                                        : '尚未保存'}
                                </div>
                            </div>
                        )}
                        
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">舞台设置</h2>

                        {/* 配乐 */}
                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
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
                                <input
                                    type="file"
                                    accept="audio/*"
                                    className="hidden"
                                    onClick={(event) => {
                                        if (window.electronAPI?.isElectron) {
                                            event.preventDefault();
                                            onImportMusic();
                                        }
                                    }}
                                    onChange={onImportMusic}
                                />
                            </label>
                        </div>

                        {/* 舞台设置 */}
                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-xs font-bold text-slate-400 uppercase">舞台尺寸与显示</span>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div className="space-y-2">
                                    <label className="text-xs text-slate-400">舞台宽度</label>
                                    <div className="flex items-center gap-2">
                                        <EditableNumberInput
                                            step={0.5}
                                            min={1}
                                            max={100}
                                            value={stageConfig?.width ?? 20}
                                            onChange={(value) => onStageConfigChange({ width: Math.max(1, value) })}
                                            className="min-w-0 flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                        />
                                        <span className="text-xs text-slate-500">米</span>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs text-slate-400">舞台深度</label>
                                    <div className="flex items-center gap-2">
                                        <EditableNumberInput
                                            step={0.5}
                                            min={1}
                                            max={100}
                                            value={stageConfig?.depth ?? 11.25}
                                            onChange={(value) => onStageConfigChange({ depth: Math.max(1, value) })}
                                            className="min-w-0 flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                        />
                                        <span className="text-xs text-slate-500">米</span>
                                    </div>
                                </div>
                            </div>

                            {/* LED 高度 */}
                            <div className="space-y-2 mb-3">
                                <label className="text-xs text-slate-400">左右备场区宽度（每侧）</label>
                                <div className="flex items-center gap-2">
                                    <EditableNumberInput
                                        step={0.5}
                                        min={0}
                                        max={20}
                                        value={stageConfig?.wingWidth ?? 4}
                                        onChange={(value) => onStageConfigChange({ wingWidth: Math.max(0, value) })}
                                        className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                    />
                                    <span className="text-xs text-slate-500">米</span>
                                </div>
                                <p className="text-[10px] leading-4 text-slate-500">备场区参与演员、道具、轨迹和视频导出。</p>
                            </div>

                            <div className="space-y-2 mb-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <label className="text-xs font-medium text-slate-300">舞台底图</label>
                                    {stageConfig?.background && (
                                        <button
                                            type="button"
                                            onClick={onClearStageBackground}
                                            className="text-[11px] text-red-400 hover:text-red-300"
                                        >
                                            清除
                                        </button>
                                    )}
                                </div>
                                <label className="flex cursor-pointer items-center justify-center rounded border border-slate-600 bg-slate-700 px-3 py-2 text-xs text-white transition-colors hover:bg-slate-600">
                                    {stageConfig?.background ? '替换底图' : '上传底图'}
                                    <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        className="hidden"
                                        onClick={(event) => {
                                            if (window.electronAPI?.isElectron) {
                                                event.preventDefault();
                                                onStageBackgroundUpload();
                                            }
                                        }}
                                        onChange={onStageBackgroundUpload}
                                    />
                                </label>
                                {stageConfig?.background && (
                                    <label className="block text-[11px] text-slate-400">
                                        <span className="mb-1 flex justify-between">
                                            <span>底图透明度</span>
                                            <span>{Math.round(stageConfig.background.opacity * 100)}%</span>
                                        </span>
                                        <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={stageConfig.background.opacity}
                                            onChange={(event) => onStageConfigChange({
                                                background: {
                                                    ...stageConfig.background,
                                                    opacity: Number(event.target.value),
                                                },
                                            })}
                                            className="w-full accent-blue-500"
                                        />
                                    </label>
                                )}
                                <label className="flex items-center justify-between gap-3 text-xs text-slate-300">
                                    <span>舞台划线</span>
                                    <input
                                        type="checkbox"
                                        checked={stageConfig?.showStageLines !== false}
                                        onChange={(event) => onStageConfigChange({ showStageLines: event.target.checked })}
                                        className="h-4 w-4 accent-blue-500"
                                    />
                                </label>
                            </div>

                            <div className="space-y-2 mb-3">
                                <label className="text-xs text-slate-400">LED 屏幕宽度</label>
                                <div className="flex items-center gap-2">
                                    <EditableNumberInput
                                        step={0.5}
                                        min={1}
                                        max={60}
                                        value={stageConfig?.ledWidth ?? stageConfig?.width ?? 20}
                                        onChange={(value) => onStageConfigChange({ ledWidth: Math.max(1, value) })}
                                        className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                    />
                                    <span className="text-xs text-slate-500">米</span>
                                </div>
                            </div>

                            <div className="space-y-2 mb-3">
                                <label className="text-xs text-slate-400">LED 屏幕高度</label>
                                <div className="flex items-center gap-2">
                                    <EditableNumberInput
                                        step={0.5}
                                        min={2}
                                        max={15}
                                        value={stageConfig?.ledHeight || 6}
                                        onChange={(value) => onStageConfigChange({ ledHeight: value })}
                                        className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                    />
                                    <span className="text-xs text-slate-500">米</span>
                                </div>
                            </div>

                            <div className="space-y-2 mb-3">
                                <label className="text-xs text-slate-400">LED 底部离地高度</label>
                                <div className="flex items-center gap-2">
                                    <EditableNumberInput
                                        step={0.1}
                                        min={0}
                                        max={30}
                                        value={stageConfig?.ledBottomHeight ?? 0}
                                        onChange={(value) => onStageConfigChange({ ledBottomHeight: value })}
                                        className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                    />
                                    <span className="text-xs text-slate-500">米</span>
                                </div>
                                <p className="text-[10px] leading-4 text-slate-500">0 米表示 LED 底边贴着舞台地面，数值增大时整体向上抬高。</p>
                            </div>

                            <div className="space-y-2 mb-3">
                                <label className="text-xs text-slate-400">LED 距舞台后沿</label>
                                <div className="flex items-center gap-2">
                                    <EditableNumberInput
                                        step={0.1}
                                        min={0}
                                        max={stageConfig?.depth ?? 11.25}
                                        value={stageConfig?.ledDistanceFromBack ?? 0}
                                        onChange={(value) => onStageConfigChange({ ledDistanceFromBack: value })}
                                        className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                    />
                                    <span className="text-xs text-slate-500">米</span>
                                </div>
                                <p className="text-[10px] leading-4 text-slate-500">0 米贴后沿，数值增大时 LED 向舞台前方移动。</p>
                            </div>

                            {/* LED 内容 */}
                            <div className="space-y-2">
                                <label className="text-xs text-slate-400">LED 屏幕内容</label>
                                <div className="flex gap-2">
                                    <label className="flex-1 flex items-center justify-center px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded text-xs cursor-pointer transition-colors text-white">
                                        上传图片/视频
                                        <input
                                            type="file"
                                            accept="image/*,video/*"
                                            className="hidden"
                                            onClick={(event) => {
                                                if (window.electronAPI?.isElectron) {
                                                    event.preventDefault();
                                                    onLEDContentUpload();
                                                }
                                            }}
                                            onChange={onLEDContentUpload}
                                        />
                                    </label>
                                    {(stageConfig?.ledContent?.type !== 'none') && (
                                        <button
                                            onClick={onClearLEDContent}
                                            className="px-3 py-2 bg-red-900/30 hover:bg-red-900/50 border border-red-900 rounded text-xs text-red-400 transition-colors"
                                        >
                                            清除
                                        </button>
                                    )}
                                </div>
                            </div>
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
                            {sortedFrames.map((f, idx) => {
                                const isKeyframe = isKeyframeFrame(f);
                                const isSelectedFrame = f.id === currentFrameId && selectedPerformerIds.length === 0;
                                return (
                                <div
                                    key={f.id}
                                    onClick={() => onSelectFrame(f.id)}
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        setEditingFrameId(f.id);
                                        setEditingFrameName(f.name);
                                    }}
                                    className={`group relative flex gap-3 p-2 rounded-lg border transition-all cursor-pointer ${
                                        isSelectedFrame
                                            ? isKeyframe
                                                ? 'bg-fuchsia-950/60 border-fuchsia-400 shadow-md shadow-fuchsia-950/30'
                                                : 'bg-slate-800 border-blue-500 shadow-md'
                                            : isKeyframe
                                                ? 'bg-fuchsia-950/30 border-fuchsia-500/40 hover:bg-fuchsia-950/50'
                                                : 'bg-slate-900 border-slate-800 hover:bg-slate-800'
                                    }`}
                                >
                                    {isKeyframe && (
                                        <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.65)]" />
                                    )}
                                    {/* Thumbnail */}
                                    <div className="w-16 h-12 shrink-0">
                                        <FormationThumbnail positions={f.positions} />
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                                        <div className={`text-sm font-medium truncate ${isSelectedFrame ? (isKeyframe ? 'text-fuchsia-200' : 'text-blue-400') : 'text-slate-300'}`}>
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
                                                    className={`w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs ${isSelectedFrame ? (isKeyframe ? 'text-fuchsia-200' : 'text-blue-400') : 'text-slate-300'}`}
                                                />
                                            ) : (
                                                f.name
                                            )}
                                        </div>
                                        <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-2">
                                            <span>Start: {(f.startTime / 1000).toFixed(1)}s</span>
                                            <span>Dur: {formatFrameDuration(f.duration)}</span>
                                            {isKeyframe && (
                                                <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-fuchsia-200">
                                                    关键帧
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Quick Actions */}
                                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={(e) => { e.stopPropagation(); onDuplicateFrame(f.id); }} className="p-1 bg-slate-800 hover:bg-blue-900 rounded text-slate-400 hover:text-blue-400"><Copy size={12} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); onDeleteFrame(f.id); }} className="p-1 bg-slate-800 hover:bg-red-900 rounded text-slate-400 hover:text-red-400"><Trash2 size={12} /></button>
                                    </div>
                                </div>
                                );
                            })}
                        </div>

                        <button onClick={onAddFrame} className="mt-4 w-full py-3 bg-green-600 hover:bg-green-500 rounded font-bold text-sm text-white shadow-lg shadow-green-900/20 uppercase tracking-wide">
                            创建队形
                        </button>
                    </div>
                )}

                {/* PERFORMERS & PROPS TAB */}
                {(activeTab === 'performers' || activeTab === 'props') && (
                    <div className="h-full min-h-0 flex flex-col p-4 pb-3">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-bold text-slate-400 uppercase">{activeTab === 'props' ? '道具列表' : '演员列表'}</h2>
                            <span className="text-xs text-slate-500">{filteredPerformers.length} {activeTab === 'props' ? '个' : '人'}</span>
                        </div>

                        {/* Search */}
                        <div className="relative mb-3">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                placeholder={activeTab === 'props' ? "搜索道具..." : "搜索演员..."}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-full py-1.5 pl-9 pr-4 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-3">
                            <button
                                onClick={() => {
                                    setShowAddForm((visible) => !visible);
                                    setShowNewGroupForm(false);
                                }}
                                className={`flex items-center justify-center gap-2 px-3 py-2 rounded border text-xs transition-colors ${
                                    showAddForm
                                        ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                                        : 'bg-slate-800/50 hover:bg-slate-700/60 border-slate-700 text-slate-300'
                                }`}
                            >
                                <Plus size={14} />
                                {showAddForm ? '收起添加' : activeTab === 'props' ? '添加道具' : '添加演员'}
                                <ChevronDown size={13} className={`transition-transform ${showAddForm ? 'rotate-180' : ''}`} />
                            </button>
                            <button
                                onClick={() => {
                                    setShowNewGroupForm((visible) => !visible);
                                    setShowAddForm(false);
                                }}
                                className={`flex items-center justify-center gap-2 px-3 py-2 rounded border text-xs transition-colors ${
                                    showNewGroupForm
                                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200'
                                        : 'bg-slate-800/50 hover:bg-slate-700/60 border-slate-700 text-slate-300'
                                }`}
                            >
                                <FolderPlus size={14} />
                                {showNewGroupForm ? '收起分组' : '创建分组'}
                            </button>
                        </div>

                        {/* Add New Performer / Prop */}
                        {showAddForm && (activeTab === 'props' ? (
                            <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 mb-3">
                                <div className="flex flex-col gap-3">
                                    <input
                                        type="text"
                                        placeholder="道具名称"
                                        className="w-full rounded-xl border border-slate-600 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                        value={newPerformerName}
                                        onChange={(e) => setNewPerformerName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAddProp()}
                                    />
                                    <div className={`grid gap-2 ${useSingleColumnPropFields ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                        <StepperNumberField label="长度" value={newPropWidth} min={0.1} step={0.1} onChange={setNewPropWidth} />
                                        <StepperNumberField label="宽度" value={newPropDepth} min={0.1} step={0.1} onChange={setNewPropDepth} />
                                        <StepperNumberField label="高度" value={newPropHeight} min={0.1} step={0.1} onChange={setNewPropHeight} />
                                        <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3 shadow-sm shadow-slate-950/20">
                                            <label className="mb-2 block text-[11px] font-medium tracking-wide text-slate-400">
                                                颜色
                                            </label>
                                            <div className="flex items-center justify-center rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-3">
                                                <input
                                                    type="color"
                                                    value={newPerformerColor}
                                                    onChange={(e) => setNewPerformerColor(e.target.value)}
                                                    className="h-14 w-20 cursor-pointer rounded-lg border border-slate-500 bg-transparent p-1"
                                                    title="道具颜色"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        <SelectField<PropCategory>
                                            label="类型"
                                            value={newPropCategory}
                                            onChange={setNewPropCategory}
                                            options={[
                                                { value: 'prop', label: '道具' },
                                                { value: 'platform', label: '高台' },
                                            ]}
                                            helperText={
                                                newPropCategory === 'platform'
                                                    ? `演员与高台占地碰撞时，将按当前道具高度 ${newPropHeight.toFixed(1)}m 抬升`
                                                    : '普通道具不抬升演员高度'
                                            }
                                            helperTone={newPropCategory === 'platform' ? 'accent' : 'default'}
                                        />
                                    </div>
                                    <button onClick={handleAddProp} className="w-full rounded-xl bg-blue-600 py-2.5 text-white flex items-center justify-center gap-2 text-sm font-semibold transition-all hover:bg-blue-500 active:scale-[0.99] shadow-lg shadow-blue-900/20">
                                        <Plus size={14} /> 添加道具
                                    </button>
                                </div>
                            </div>
                        ) : (
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
                        ))}

                        {/* Add New Group Button */}
                        <div className={showNewGroupForm ? 'mb-3' : ''}>
                            {!showNewGroupForm ? (
                                <button onClick={() => setShowNewGroupForm(true)} className="hidden">
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
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar space-y-2 pr-1 pb-2">
                            {/* Groups */}
                            {filteredGroups.map(group => {
                                const groupPerformers = performersByGroup.grouped[group.id] || [];
                                if (groupPerformers.length === 0 && searchQuery) return null; // Hide empty groups when searching

                                return (
                                    <div key={group.id} className="mb-2">
                                        {/* Group Header */}
                                        <div
                                            onDragOver={(e) => handleDragOverGroup(e, group)}
                                            onDrop={(e) => handleDropOnGroup(e, group)}
                                            onContextMenu={(e) => handleContextMenu(e, null, group.id)}
                                            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer group/header transition-colors ${dragState?.overGroupId === group.id
                                                ? 'border-blue-400 bg-blue-500/15 ring-1 ring-blue-400/40'
                                                : 'border-slate-700 bg-slate-800/50 hover:bg-slate-800'
                                                }`}
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
                                                    {dragState?.overGroupId === group.id
                                                        ? <span className="text-blue-300">拖入 {dragState.performerIds.length} 项</span>
                                                        : <>{group.name} <span className="text-xs text-slate-500">({groupPerformers.length})</span></>}
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
                            {(performersByGroup.ungrouped.length > 0 || dragState) && (
                                <div>
                                    <div
                                        onDragOver={handleDragOverUngrouped}
                                        onDrop={handleDropOnUngrouped}
                                        className={`flex items-center gap-2 p-2 mb-1 rounded border text-xs uppercase tracking-wider transition-colors ${dragState?.overUngrouped
                                            ? 'border-blue-400 bg-blue-500/15 text-blue-300'
                                            : 'border-transparent text-slate-500'
                                            }`}
                                    >
                                        <Users size={12} /> {dragState?.overUngrouped
                                            ? <>拖入 {dragState.performerIds.length} 项</>
                                            : <>未分组 ({performersByGroup.ungrouped.length})</>}
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
                {contextMenuState.show && createPortal(
                    <div
                        ref={contextMenuRef}
                        style={{ position: 'fixed', left: contextMenuState.x, top: contextMenuState.y, zIndex: 100000 }}
                        className="max-h-[min(70vh,420px)] overflow-y-auto bg-slate-800 border border-slate-700 rounded-lg shadow-2xl py-1 min-w-[176px] animate-in fade-in zoom-in-95 duration-100"
                    >
                        {contextMenuState.performerIds.length > 0 && contextMenuState.performerType && (
                            <>
                                <div className="px-3 py-1 text-xs text-slate-500 uppercase tracking-wider">
                                    移动 {contextMenuState.performerIds.length} 个{contextMenuState.performerType === 'prop' ? '道具' : '演员'}到分组
                                </div>
                                {(() => {
                                    const performerType = contextMenuState.performerType;
                                    if (!performerType) return null;
                                    const relevantGroups = performerGroups.filter(group => (
                                        isPerformerGroupCompatible(group, performerType)
                                    ));

                                    if (relevantGroups.length === 0) {
                                        return <div className="px-3 py-2 text-xs text-slate-600 italic">暂无可用分组</div>;
                                    }

                                    return relevantGroups.map(group => (
                                        <button
                                            key={group.id}
                                            onClick={() => {
                                                onAddPerformersToGroup(contextMenuState.performerIds, group.id);
                                                closeContextMenu();
                                            }}
                                            className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                                        >
                                            <Folder size={12} style={{ color: group.color }} />
                                            {group.name}
                                        </button>
                                    ));
                                })()}
                                <div className="h-px bg-slate-700 my-1"></div>
                                <button
                                    onClick={() => {
                                        onRemovePerformersFromGroup(contextMenuState.performerIds);
                                        closeContextMenu();
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-700"
                                >
                                    移出分组
                                </button>
                                {onOpenNoteDrawer && contextMenuState.performerIds.length === 1 && (
                                    <>
                                        <div className="h-px bg-slate-700 my-1"></div>
                                        <button
                                            onClick={() => {
                                                onOpenNoteDrawer(contextMenuState.performerIds[0]);
                                                closeContextMenu();
                                            }}
                                            className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                                        >
                                            <StickyNote size={12} /> 演员笔记
                                        </button>
                                    </>
                                )}
                                {(() => {
                                    const targetPerformerId = contextMenuState.performerIds[0];
                                    if (contextMenuState.performerIds.length === 1 && contextMenuState.performerType === 'prop') {
                                        return (
                                            <>
                                                <div className="h-px bg-slate-700 my-1"></div>
                                                <button
                                                    onClick={() => {
                                                        setPropEditorPerformerId(targetPerformerId);
                                                        setPropEditorOpen(true);
                                                        closeContextMenu();
                                                    }}
                                                    className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                                                >
                                                    <Edit2 size={12} /> 编辑道具
                                                </button>
                                            </>
                                        );
                                    }
                                    return null;
                                })()}
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
                                                setColorPickerState({
                                                    show: true,
                                                    groupId: group.id,
                                                    color: group.color
                                                });
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
                                        setPendingDeleteGroupId(contextMenuState.groupId);
                                        closeContextMenu();
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-slate-700"
                                >
                                    删除分组
                                </button>
                            </>
                        )}
                    </div>,
                    document.body
                )}

                {pendingDeleteGroupId && createPortal(
                    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="delete-group-dialog-title"
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') setPendingDeleteGroupId(null);
                            }}
                            className="w-full max-w-md rounded-2xl border border-red-500/30 bg-slate-900 p-5 text-white shadow-2xl"
                        >
                            <h2 id="delete-group-dialog-title" className="text-lg font-bold">删除分组？</h2>
                            <p className="mt-3 text-sm leading-6 text-slate-300">
                                删除“{performerGroups.find((group) => group.id === pendingDeleteGroupId)?.name ?? '未命名分组'}”后，组内演员或道具将移至未分组。
                            </p>
                            <div className="mt-5 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setPendingDeleteGroupId(null)}
                                    autoFocus
                                    className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                                >
                                    取消
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onRemoveGroup(pendingDeleteGroupId);
                                        setPendingDeleteGroupId(null);
                                    }}
                                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
                                >
                                    确认删除
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

                {/* PRESETS TAB */}
                {activeTab === 'presets' && (
                    <div className="space-y-6">
                        {/* AI Settings */}
                        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50">
                            <div className="flex items-center justify-between mb-3 text-slate-400">
                                <div className="flex items-center gap-2">
                                    <Settings size={14} />
                                    <span className="text-xs font-bold uppercase">AI 配置</span>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] text-slate-500 uppercase">Agent 访问 Key</label>
                                    <input
                                        type="password"
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                                        placeholder="请输入管理员发放的 Key"
                                        value={aiConfig.memberToken}
                                        onChange={(e) => {
                                            setAgentAccessError(null);
                                            onAiConfigChange({ ...aiConfig, memberToken: e.target.value });
                                        }}
                                    />
                                    <p className="text-[10px] leading-4 text-slate-600">访问地址由应用统一管理，无需手动配置。</p>
                                </div>
                            </div>
                        </div>

                        {/* Multimodal Agent */}
                        <div className="rounded-lg border border-cyan-500/20 bg-slate-900 p-4">
                            <div className="mb-3 flex items-start gap-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-400">
                                    <Sparkles size={15} />
                                </div>
                                <div>
                                    <div className="text-xs font-bold text-slate-200">智能队形编排 Agent</div>
                                    <p className="mt-1 text-[11px] leading-5 text-slate-500">
                                        结合音乐、队形草图和你的创作要求，分阶段完成队形设计。
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={handleOpenChoreoAgent}
                                disabled={isValidatingAgentAccess}
                                className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-wait disabled:opacity-60"
                            >
                                <Wand2 size={13} /> {isValidatingAgentAccess ? '正在校验 Key...' : '打开编舞 Agent'}
                            </button>
                            {agentAccessError && (
                                <div className="mt-2 rounded border border-red-900/60 bg-red-950/30 px-2.5 py-2 text-[11px] leading-5 text-red-300">
                                    {agentAccessError}
                                </div>
                            )}
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
                <ChoreoAgentModal
                    isOpen={choreoAgentOpen}
                    aiConfig={aiConfig}
                    onClose={() => setChoreoAgentOpen(false)}
                    onApplyPlan={onApplyAIPlan}
                />
            </div>

            {/* Custom Color Picker Modal */}
            {colorPickerState.show && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={(e) => e.stopPropagation()}>
                    <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg shadow-2xl w-80">
                        <h3 className="text-lg font-bold text-white mb-4">选择分组颜色</h3>

                        <div className="flex flex-col gap-4">
                            <div className="flex gap-4 items-center">
                                <input
                                    type="color"
                                    value={colorPickerState.color}
                                    onChange={(e) => setColorPickerState(prev => ({ ...prev, color: e.target.value }))}
                                    className="w-16 h-16 rounded cursor-pointer border-0 p-0 bg-transparent"
                                />
                                <div className="text-sm flex flex-col gap-1">
                                    <div className="text-slate-400">已选颜色</div>
                                    <div className="font-mono bg-slate-800 px-2 py-1 rounded text-slate-300 border border-slate-700 select-all">
                                        {colorPickerState.color}
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-2 justify-end mt-4 pt-4 border-t border-slate-800">
                                <button
                                    onClick={() => setColorPickerState(prev => ({ ...prev, show: false }))}
                                    className="px-4 py-2 rounded text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={() => {
                                        if (colorPickerState.groupId) {
                                            onUpdateGroup(colorPickerState.groupId, { color: colorPickerState.color });
                                            onUpdateGroupPerformers(colorPickerState.groupId, { color: colorPickerState.color });
                                        }
                                        setColorPickerState(prev => ({ ...prev, show: false }));
                                    }}
                                    className="px-4 py-2 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-900/20 transition-all hover:scale-105 active:scale-95"
                                >
                                    确定应用
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <PropEditorModal
              isOpen={propEditorOpen}
              performer={propEditorPerformerId ? performers.find(p => p.id === propEditorPerformerId) || null : null}
              mode={propEditorPerformerId ? 'edit' : 'create'}
              onSave={(updates) => {
                if (propEditorPerformerId) {
                  onUpdatePerformer(propEditorPerformerId, updates);
                } else {
                  onAddPerformer(updates.name || '道具', updates.color || '#475569', 'square', {
                    type: 'prop',
                    ...updates
                  });
                }
                setPropEditorOpen(false);
                setPropEditorPerformerId(null);
              }}
              onClose={() => {
                setPropEditorOpen(false);
                setPropEditorPerformerId(null);
              }}
            />
        </div>
    );
};
