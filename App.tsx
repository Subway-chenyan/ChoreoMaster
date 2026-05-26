import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Frame, Performer, Position, PerformerShape, PerformerGroup, PerformerType, AIConfig } from './types';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';
import Stage3D from './components/Stage3D';
import { Timeline } from './components/Timeline';
import { HelpModal } from './components/HelpModal';
import { useTheme } from './contexts/ThemeContext';
import { DEFAULT_COLORS, STAGE_ASPECT_RATIO } from './constants';
import { ZoomIn, ZoomOut, Type, PlusCircle, MinusCircle, HelpCircle, Maximize2, ChevronDown, ChevronUp } from 'lucide-react';
import { StageConfig } from './types';

const DEFAULT_FRAME: Frame = {
  id: 'start-frame',
  name: 'Opening',
  startTime: 0,
  duration: 2000,
  positions: {}
};

// Clipboard Item Structure
interface ClipboardItem {
  performer: Performer;
  positions: Record<string, Position>; // Map FrameID -> Position
}

const App: React.FC = () => {
  // State
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [performerGroups, setPerformerGroups] = useState<PerformerGroup[]>([]);
  const [frames, setFrames] = useState<Frame[]>([DEFAULT_FRAME]);
  const [currentFrameId, setCurrentFrameId] = useState<string>(DEFAULT_FRAME.id);
  const [selectedPerformerIds, setSelectedPerformerIds] = useState<string[]>([]);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [musicName, setMusicName] = useState<string | null>(null);
  const [inPointMs, setInPointMs] = useState<number | null>(null);
  const [outPointMs, setOutPointMs] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportIncludeLabels, setExportIncludeLabels] = useState<boolean>(true);
  const [exportIncludeGrid, setExportIncludeGrid] = useState<boolean>(true);

  // Stage View State
  const [showLabels, setShowLabels] = useState(true);
  const [gridScale, setGridScale] = useState(1);
  const [stageAspectRatio, setStageAspectRatio] = useState(16 / 9);
  const [stageMaxWidth, setStageMaxWidth] = useState<number>(1200);
  const [ratioW, setRatioW] = useState<number>(16);
  const [ratioH, setRatioH] = useState<number>(9);
  const [showHelp, setShowHelp] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [stageToolbarCollapsed, setStageToolbarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(320);
  const [timelineHeight, setTimelineHeight] = useState<number>(160);
  const [undoStack, setUndoStack] = useState<any[]>([]);
  const [redoStack, setRedoStack] = useState<any[]>([]);

  // 新增：3D 模式相关状态
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [stageConfig, setStageConfig] = useState<StageConfig>({
    width: 20,
    depth: 20 / (16 / 9),
    ledHeight: 6,
    ledContent: { type: 'none' }
  });
  const [mediaCache, setMediaCache] = useState<Record<string, string>>({});
  
  // Project storage state
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const [projectHasChanges, setProjectHasChanges] = useState(false);
  const [lastSavedState, setLastSavedState] = useState<string>('');
  
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
    const saved = localStorage.getItem('choreo-ai-config');
    return saved ? JSON.parse(saved) : {
      apiKey: '',
      baseUrl: 'https://generativelanguage.googleapis.com/',
      model: 'gemini-3-flash-preview'
    };
  });

  useEffect(() => {
    localStorage.setItem('choreo-ai-config', JSON.stringify(aiConfig));
  }, [aiConfig]);

  // Sync 3D stage config depth with 2D aspect ratio
  useEffect(() => {
    setStageConfig(prev => ({
      ...prev,
      depth: prev.width / stageAspectRatio
    }));
  }, [stageAspectRatio]);

  // Theme
  const { theme } = useTheme();

  // Clipboard State
  const [clipboard, setClipboard] = useState<ClipboardItem[]>([]);
  const [frameClipboard, setFrameClipboard] = useState<Frame | null>(null);

  // Playback State
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false); // Ref to track playing state inside animation loop

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  // Helper for ID generation to avoid crypto.randomUUID crash in non-secure contexts
  const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  };

  // Initialize Audio Context
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  // Sync ref with state
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Sort frames by start time helper
  const getSortedFrames = useCallback((currentFrames: Frame[]) => {
    return [...currentFrames].sort((a, b) => a.startTime - b.startTime);
  }, []);

  // Calculated: Interpolated Positions for Current Time
  const currentPositions = useCallback(() => {
    const sortedFrames = getSortedFrames(frames);

    // 1. Check if we are inside a specific frame (HOLD phase)
    const activeFrame = sortedFrames.find(f => currentTime >= f.startTime && currentTime < f.startTime + f.duration);

    if (activeFrame) {
      return activeFrame.positions;
    }

    // 2. If not in a frame, we are in a GAP (TRANSITION phase)
    // Find the frame just before current time and the frame just after
    const prevFrame = [...sortedFrames].reverse().find(f => f.startTime + f.duration <= currentTime);
    const nextFrame = sortedFrames.find(f => f.startTime > currentTime);

    if (prevFrame && nextFrame) {
      // Interpolate between prev and next
      const gapStart = prevFrame.startTime + prevFrame.duration;
      const gapEnd = nextFrame.startTime;
      const totalGap = gapEnd - gapStart;

      if (totalGap <= 0) return prevFrame.positions;

      const progress = (currentTime - gapStart) / totalGap;
      // Ease in-out
      const ease = progress < .5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;

      const interpolated: Record<string, Position> = {};
      performers.forEach(p => {
        // Only interpolate if performer exists in BOTH frames (Entrance/Exit logic)
        const start = prevFrame.positions[p.id];
        const end = nextFrame.positions[p.id];

        if (start && end) {
          interpolated[p.id] = {
            x: start.x + (end.x - start.x) * ease,
            y: start.y + (end.y - start.y) * ease,
          };
        }
        // If in one but not other, they do not exist during transition (clean cut)
      });
      return interpolated;
    }

    // 3. Before first frame or after last frame
    if (sortedFrames.length > 0) {
      if (currentTime < sortedFrames[0].startTime) {
        // Before first frame: Show first frame positions (static)
        return sortedFrames[0].positions;
      }
      // After last frame
      return sortedFrames[sortedFrames.length - 1].positions;
    }

    return {};

  }, [currentTime, frames, performers, getSortedFrames]);

  // Calculate Active Hidden Groups based on Current Time (for playback syncing)
  const activeHiddenGroupIds = useMemo(() => {
    const sortedFrames = getSortedFrames(frames);

    // 1. Inside a frame
    const activeFrame = sortedFrames.find(f => currentTime >= f.startTime && currentTime < f.startTime + f.duration);
    if (activeFrame) {
      return activeFrame.hiddenGroupIds || [];
    }

    // 2. In a GAP (Transition) -> Use Previous Frame's settings
    const prevFrame = [...sortedFrames].reverse().find(f => f.startTime + f.duration <= currentTime);
    if (prevFrame) {
      return prevFrame.hiddenGroupIds || [];
    }

    // 3. Before first frame -> Use first frame's settings (if exists) 
    // This is optional, but keeps consistency if waiting to start
    if (sortedFrames.length > 0 && currentTime < sortedFrames[0].startTime) {
      return sortedFrames[0].hiddenGroupIds || [];
    }

    return [];
  }, [currentTime, frames, getSortedFrames]);

  const computePositionsAtTime = useCallback((timeMs: number) => {
    const sortedFrames = getSortedFrames(frames);
    const activeFrame = sortedFrames.find(f => timeMs >= f.startTime && timeMs < f.startTime + f.duration);
    if (activeFrame) {
      return activeFrame.positions;
    }
    const prevFrame = [...sortedFrames].reverse().find(f => f.startTime + f.duration <= timeMs);
    const nextFrame = sortedFrames.find(f => f.startTime > timeMs);
    if (prevFrame && nextFrame) {
      const gapStart = prevFrame.startTime + prevFrame.duration;
      const gapEnd = nextFrame.startTime;
      const totalGap = gapEnd - gapStart;
      if (totalGap <= 0) return prevFrame.positions;
      const progress = (timeMs - gapStart) / totalGap;
      const ease = progress < .5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
      const interpolated: Record<string, Position> = {};
      performers.forEach(p => {
        const start = prevFrame.positions[p.id];
        const end = nextFrame.positions[p.id];
        if (start && end) {
          interpolated[p.id] = { x: start.x + (end.x - start.x) * ease, y: start.y + (end.y - start.y) * ease };
        }
      });
      return interpolated;
    }
    if (sortedFrames.length > 0) {
      if (timeMs < sortedFrames[0].startTime) return sortedFrames[0].positions;
      return sortedFrames[sortedFrames.length - 1].positions;
    }
    return {};
  }, [frames, performers, getSortedFrames]);

  // --- Actions ---

  const handleAddPerformer = (name: string, color: string, shape: PerformerShape, extra?: Partial<Performer>) => {
    const newPerformer: Performer = {
      id: generateId(),
      name,
      color,
      label: name.charAt(0).toUpperCase(),
      shape,
      type: extra?.type || 'performer',
      ...extra
    };
    setPerformers([...performers, newPerformer]);

    // Default hiding logic: If adding in a specific frame, hide in previous frames
    // by only adding position to frames starting at or after the current frame
    const currentFrame = frames.find(f => f.id === currentFrameId);
    const startThreshold = currentFrame ? currentFrame.startTime : -1;

    setFrames(frames.map(f => {
      // If frame is before current frame, do not add performer (effectively hidden)
      if (f.startTime < startThreshold) {
        return f;
      }
      return {
        ...f,
        positions: { ...f.positions, [newPerformer.id]: { x: 50, y: 50 } }
      };
    }));
  };

  const handleRemovePerformer = (id: string) => {
    setPerformers(performers.filter(p => p.id !== id));
    setSelectedPerformerIds(selectedPerformerIds.filter(pid => pid !== id));
  };

  const handleUpdatePerformer = (id: string, updates: Partial<Performer>) => {
    setPerformers(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  // --- Group Management ---
  const handleAddGroup = (name: string, color: string, type: 'performer' | 'prop' = 'performer') => {
    const newGroup: PerformerGroup = {
      id: generateId(),
      name,
      color,
      collapsed: false,
      type,
    };
    setPerformerGroups(prev => [...prev, newGroup]);
    return newGroup.id;
  };

  const handleRemoveGroup = (groupId: string) => {
    // Remove group and unassign all performers from this group
    setPerformers(prev => prev.map(p => p.groupId === groupId ? { ...p, groupId: undefined } : p));
    setPerformerGroups(prev => prev.filter(g => g.id !== groupId));
    // Also remove from all frames' hiddenGroupIds
    setFrames(prev => prev.map(f => ({
      ...f,
      hiddenGroupIds: f.hiddenGroupIds?.filter(id => id !== groupId)
    })));
  };

  const handleUpdateGroup = (groupId: string, updates: Partial<PerformerGroup>) => {
    setPerformerGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...updates } : g));
  };

  const handleAddPerformerToGroup = (performerId: string, groupId: string) => {
    setPerformers(prev => prev.map(p => p.id === performerId ? { ...p, groupId } : p));
  };

  const handleRemovePerformerFromGroup = (performerId: string) => {
    setPerformers(prev => prev.map(p => p.id === performerId ? { ...p, groupId: undefined } : p));
  };

  const handleAddPerformersToGroup = (performerIds: string[], groupId: string) => {
    setPerformers(prev => prev.map(p => performerIds.includes(p.id) ? { ...p, groupId } : p));
  };

  const handleUpdateGroupPerformers = (groupId: string, updates: Partial<Performer>) => {
    // Update all performers in a group (for batch color/name change)
    setPerformers(prev => prev.map(p => p.groupId === groupId ? { ...p, ...updates } : p));
  };

  const handleToggleGroupVisibilityInFrame = (groupId: string) => {
    setFrames(prev => prev.map(f => {
      if (f.id !== currentFrameId) return f;

      const hiddenGroupIds = f.hiddenGroupIds || [];
      const isCurrentlyHidden = hiddenGroupIds.includes(groupId);

      return {
        ...f,
        hiddenGroupIds: isCurrentlyHidden
          ? hiddenGroupIds.filter(id => id !== groupId)
          : [...hiddenGroupIds, groupId]
      };
    }));
  };

  const handleToggleGroupCollapsed = (groupId: string) => {
    setPerformerGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
    ));
  };

  const handleSelectGroupPerformers = (groupId: string) => {
    const groupPerformerIds = performers.filter(p => p.groupId === groupId).map(p => p.id);
    setSelectedPerformerIds(groupPerformerIds);
  };

  // LED 内容上传处理
  const handleLEDContentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const fileName = `led_${Date.now()}_${file.name}`;

    setMediaCache(prev => ({ ...prev, [fileName]: url }));

    const type = file.type.startsWith('video') ? 'video' : 'image';
    setStageConfig(prev => ({
      ...prev,
      ledContent: { type, value: fileName, loop: true }
    }));
  };

  // 清除 LED 内容
  const handleClearLEDContent = () => {
    setStageConfig(prev => ({
      ...prev,
      ledContent: { type: 'none' }
    }));
  };

  // 舞台配置更新
  const handleStageConfigChange = (updates: Partial<StageConfig>) => {
    setStageConfig(prev => ({ ...prev, ...updates }));
  };

  // ==================== Project Storage Handlers ====================

  // Get current project state as JSON string for comparison
  const getProjectStateString = useCallback(() => {
    return JSON.stringify({
      performers,
      performerGroups,
      frames,
      stageConfig,
      musicName,
    });
  }, [performers, performerGroups, frames, stageConfig, musicName]);

  // Track changes to project
  useEffect(() => {
    if (currentProjectId && lastSavedState) {
      const currentState = getProjectStateString();
      setProjectHasChanges(currentState !== lastSavedState);
    }
  }, [performers, performerGroups, frames, stageConfig, musicName, currentProjectId, lastSavedState, getProjectStateString]);

  // Create a new project
  const handleCreateProject = async (name: string): Promise<string> => {
    if (!window.electronAPI?.isElectron) return '';
    
    // Auto-save current project before creating new one
    if (currentProjectId && projectHasChanges) {
      try {
        const projectData = {
          version: '2.0',
          name: '',
          performers,
          performerGroups,
          frames,
          stageConfig,
          musicName,
        };
        await window.electronAPI.project.save(currentProjectId, projectData);
        console.log('Auto-saved current project before creating new');
      } catch (error) {
        console.error('Failed to auto-save before creating:', error);
      }
    }
    
    try {
      const { id, path } = await window.electronAPI.project.create(name);
      setCurrentProjectId(id);
      setCurrentProjectPath(path);
      
      // Reset to fresh state
      const newFrameId = generateId();
      setPerformers([]);
      setPerformerGroups([]);
      setFrames([{
        id: newFrameId,
        name: 'Opening',
        startTime: 0,
        duration: 2000,
        positions: {}
      }]);
      setCurrentFrameId(newFrameId);
      setMusicName(null);
      setAudioBuffer(null);
      setMusicUrl(null);
      setCurrentTime(0);
      setSelectedPerformerIds([]);
      
      // Mark as saved
      setLastSavedState(getProjectStateString());
      setProjectHasChanges(false);
      
      return id;
    } catch (error) {
      console.error('Failed to create project:', error);
      return '';
    }
  };

  const handleCreateFromTemplate = async (templateData: any): Promise<string> => {
    if (!window.electronAPI?.isElectron) return '';

    // Auto-save current project before switching
    if (currentProjectId && projectHasChanges) {
      try {
        const projectData = { version: '2.0', name: '', performers, performerGroups, frames, stageConfig, musicName };
        await window.electronAPI.project.save(currentProjectId, projectData);
      } catch (error) { /* ignore */ }
    }

    try {
      const name = templateData.name || '教学示例';
      const { id, path } = await window.electronAPI.project.create(name);

      // Save template data into the new project
      const saveData = { version: '2.0', name: '', performers: templateData.performers || [], performerGroups: templateData.performerGroups || [], frames: templateData.frames || [], stageConfig: templateData.stageConfig || stageConfig, musicName: null };
      await window.electronAPI.project.save(id, saveData);

      setCurrentProjectId(id);
      setCurrentProjectPath(path);

      // Load template data into state
      setPerformers(saveData.performers);
      setPerformerGroups(saveData.performerGroups);
      setFrames(saveData.frames);
      setStageConfig(saveData.stageConfig);
      setCurrentFrameId(saveData.frames[0]?.id || '');
      setMusicName(null);
      setAudioBuffer(null);
      setMusicUrl(null);
      setCurrentTime(0);
      setSelectedPerformerIds([]);

      setLastSavedState(JSON.stringify({ performers: saveData.performers, performerGroups: saveData.performerGroups, frames: saveData.frames, stageConfig: saveData.stageConfig, musicName: null }));
      setProjectHasChanges(false);

      return id;
    } catch (error) {
      console.error('Failed to create from template:', error);
      return '';
    }
  };

  const handleLoadTemplate = (templateData: any) => {
    const performers = templateData.performers || [];
    const groups = templateData.performerGroups || [];
    const frames = templateData.frames || [];
    const config = templateData.stageConfig || stageConfig;

    setPerformers(performers);
    setPerformerGroups(groups);
    setFrames(frames);
    setStageConfig(config);
    setCurrentFrameId(frames[0]?.id || '');
    setMusicName(null);
    setAudioBuffer(null);
    setMusicUrl(null);
    setCurrentTime(0);
    setSelectedPerformerIds([]);
    setProjectHasChanges(true);
  };

  // Load a project
  const handleLoadProject = async (projectId: string) => {
    if (!window.electronAPI?.isElectron) return;
    
    // Auto-save current project before switching
    if (currentProjectId && projectHasChanges) {
      try {
        const projectData = {
          version: '2.0',
          name: '',
          performers,
          performerGroups,
          frames,
          stageConfig,
          musicName,
        };
        await window.electronAPI.project.save(currentProjectId, projectData);
        console.log('Auto-saved current project before switching');
      } catch (error) {
        console.error('Failed to auto-save before switching:', error);
      }
    }
    
    try {
      const { data, projectPath } = await window.electronAPI.project.load(projectId);
      
      setCurrentProjectId(projectId);
      setCurrentProjectPath(projectPath);
      
      // Load project data
      setPerformers(data.performers || []);
      setPerformerGroups(data.performerGroups || []);
      setFrames(data.frames || []);
      setMusicName(data.musicName || null);
      
      if (data.stageConfig) {
        setStageConfig(data.stageConfig);
      }
      
      // Reset playback
      setCurrentTime(0);
      setAudioBuffer(null);
      setMusicUrl(null);
      setSelectedPerformerIds([]);
      
      if (data.frames?.length > 0) {
        setCurrentFrameId(data.frames[0].id);
      }
      
      // Mark as saved (use setTimeout to ensure state is updated)
      setTimeout(() => {
        setLastSavedState(JSON.stringify({
          performers: data.performers || [],
          performerGroups: data.performerGroups || [],
          frames: data.frames || [],
          stageConfig: data.stageConfig || stageConfig,
          musicName: data.musicName || null,
        }));
        setProjectHasChanges(false);
      }, 100);
      
    } catch (error) {
      console.error('Failed to load project:', error);
      alert('加载项目失败');
    }
  };

  // Save current project
  const handleSaveProject = async () => {
    if (!window.electronAPI?.isElectron || !currentProjectId) return;
    
    try {
      const projectData = {
        version: '2.0',
        name: '', // Will be preserved from existing project.json
        performers,
        performerGroups,
        frames,
        stageConfig,
        musicName,
      };
      
      await window.electronAPI.project.save(currentProjectId, projectData);
      
      // Mark as saved
      setLastSavedState(getProjectStateString());
      setProjectHasChanges(false);
      
    } catch (error) {
      console.error('Failed to save project:', error);
      alert('保存项目失败');
    }
  };

  // Auto-save on Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (currentProjectId && projectHasChanges) {
          handleSaveProject();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentProjectId, projectHasChanges]);

  const handleDeleteSelectedPerformers = () => {
    if (selectedPerformerIds.length === 0) return;
    if (isPlaying) handlePlayPause();
    const ids = new Set(selectedPerformerIds);
    const currentFrame = frames.find(fr => fr.id === currentFrameId);
    if (!currentFrame) return;
    const backup: Record<string, Position> = {};
    Object.entries(currentFrame.positions).forEach(([pid, pos]) => { if (ids.has(pid)) backup[pid] = pos as Position; });
    setUndoStack(prev => [...prev, { type: 'delete-performers-in-frame', frameId: currentFrameId, positionsBackup: backup, deletedIds: selectedPerformerIds }]);
    setRedoStack([]);
    setFrames(prev => prev.map(f => {
      if (f.id !== currentFrameId) return f;
      const newPositions = { ...f.positions } as Record<string, Position>;
      Object.keys(newPositions).forEach(pid => { if (ids.has(pid)) delete (newPositions as any)[pid]; });
      return { ...f, positions: newPositions };
    }));
    setSelectedPerformerIds([]);
  };

  // Toggle presence in the CURRENT frame
  const handleTogglePerformerInFrame = (performerId: string) => {
    setFrames(prevFrames => {
      return prevFrames.map(f => {
        if (f.id === currentFrameId) {
          const newPositions = { ...f.positions };
          if (newPositions[performerId]) {
            // Remove from this frame
            delete newPositions[performerId];
          } else {
            // Add to this frame. Try to find previous frame's position for continuity, or default.
            const sorted = getSortedFrames(prevFrames);
            const prevFrame = [...sorted].reverse().find(fr => fr.startTime < f.startTime && fr.positions[performerId]);

            const initialPos = prevFrame?.positions[performerId] || { x: 50, y: 50 };
            newPositions[performerId] = initialPos;
          }
          return { ...f, positions: newPositions };
        }
        return f;
      });
    });
  };

  const handlePositionChange = (updates: { id: string; pos: Position }[]) => {
    if (isPlaying) handlePlayPause();

    setFrames(prev => prev.map(f => {
      if (f.id === currentFrameId) {
        const updatedPositions = { ...f.positions };
        updates.forEach(update => {
          updatedPositions[update.id] = update.pos;
        });
        return {
          ...f,
          positions: updatedPositions
        };
      }
      return f;
    }));
  };

  const handleApplyPreset = (coords: Position[]) => {
    const targets = selectedPerformerIds.length > 0
      ? selectedPerformerIds
      : performers.map(p => p.id);

    const frame = frames.find(f => f.id === currentFrameId);
    if (!frame) return;

    // Use visible targets
    let effectiveTargets = targets;
    if (selectedPerformerIds.length === 0) {
      effectiveTargets = performers.filter(p => frame.positions[p.id] !== undefined).map(p => p.id);
    }

    if (effectiveTargets.length === 0) return;

    const limit = Math.min(effectiveTargets.length, coords.length);

    setFrames(prev => prev.map(f => {
      if (f.id === currentFrameId) {
        const newPositions = { ...f.positions };
        for (let i = 0; i < limit; i++) {
          // Clamp coordinates to stage bounds (2% to 98%)
          let { x, y } = coords[i];
          x = Math.max(2, Math.min(98, x));
          y = Math.max(2, Math.min(98, y));
          newPositions[effectiveTargets[i]] = { x, y };
        }
        return { ...f, positions: newPositions };
      }
      return f;
    }));
  };

  // --- Frame Management ---

  const handleAddFrame = () => {
    const sorted = getSortedFrames(frames);
    let newStart = currentTime;

    if (frames.length === 0) {
      newStart = Math.max(0, currentTime);
    }

    const currentPos = currentPositions();

    const newFrame: Frame = {
      id: generateId(),
      name: `Formation ${frames.length + 1}`,
      startTime: newStart,
      duration: 2000,
      positions: JSON.parse(JSON.stringify(currentPos)) // Deep copy current positions
    };

    const newFrames = [...frames, newFrame];
    newFrames.sort((a, b) => a.startTime - b.startTime);

    setFrames(newFrames);
    setCurrentFrameId(newFrame.id);
  };

  const handleDeleteFrame = (id: string) => {
    if (frames.length <= 0) return;
    if (isPlaying) handlePlayPause();
    const target = frames.find(f => f.id === id);
    const filtered = frames.filter(f => f.id !== id);
    if (target) {
      setUndoStack(prev => [...prev, { type: 'delete-frame', frame: JSON.parse(JSON.stringify(target)), prevCurrentFrameId: currentFrameId }]);
      setRedoStack([]);
    }
    if (filtered.length === 0) {
      const nf: Frame = { id: generateId(), name: 'Opening', startTime: 0, duration: 2000, positions: {} };
      setFrames([nf]);
      setCurrentFrameId(nf.id);
      return;
    }
    setFrames(filtered);
    if (currentFrameId === id) {
      setCurrentFrameId(filtered[filtered.length - 1].id);
    }
  };

  const handleUndo = () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack(prev => prev.slice(0, -1));
    if (last.type === 'delete-performers-in-frame') {
      setFrames(prev => prev.map(f => f.id === last.frameId ? { ...f, positions: { ...f.positions, ...last.positionsBackup } } : f));
      setSelectedPerformerIds(last.deletedIds);
      setRedoStack(prev => [...prev, last]);
    } else if (last.type === 'delete-frame') {
      setFrames(prev => {
        const nf = [...prev, last.frame];
        nf.sort((a, b) => a.startTime - b.startTime);
        return nf;
      });
      setCurrentFrameId(last.frame.id);
      setRedoStack(prev => [...prev, last]);
    }
  };

  const handleRedo = () => {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    setRedoStack(prev => prev.slice(0, -1));
    if (last.type === 'delete-performers-in-frame') {
      const ids = new Set(Object.keys(last.positionsBackup));
      setFrames(prev => prev.map(f => {
        if (f.id !== last.frameId) return f;
        const newPositions = { ...f.positions } as Record<string, Position>;
        Object.keys(newPositions).forEach(pid => { if (ids.has(pid)) delete (newPositions as any)[pid]; });
        return { ...f, positions: newPositions };
      }));
      setSelectedPerformerIds([]);
      setUndoStack(prev => [...prev, last]);
    } else if (last.type === 'delete-frame') {
      setFrames(prev => prev.filter(f => f.id !== last.frame.id));
      setCurrentFrameId(last.prevCurrentFrameId || null as any);
      setUndoStack(prev => [...prev, last]);
    }
  };

  const handleDuplicateFrame = (id: string) => {
    const f = frames.find(fr => fr.id === id);
    if (!f) return;

    const newFrame = {
      ...f,
      id: generateId(),
      name: `${f.name} (Copy)`,
      startTime: f.startTime + f.duration + 1000 // Place it after
    };
    const newFrames = [...frames, newFrame];
    newFrames.sort((a, b) => a.startTime - b.startTime);
    setFrames(newFrames);
  };

  // --- Project Export / Import ---

  const handleExportProject = async () => {
    const projectData = {
      version: "1.2",
      createdAt: new Date().toISOString(),
      name: "ChoreoMaster Project",
      musicName,
      performers,
      performerGroups,
      frames,
      stageConfig,
    };

    // Check if running in Electron
    if (window.electronAPI?.isElectron) {
      try {
        const defaultName = `choreomaster-project-${new Date().toISOString().slice(0, 10)}.json`;
        const filePath = await window.electronAPI.saveFile(defaultName);
        if (filePath) {
          await window.electronAPI.writeFile(filePath, JSON.stringify(projectData, null, 2));
          return;
        }
      } catch (error) {
        console.error('Electron export failed, falling back to web:', error);
      }
    }

    // Fallback to web version (blob download)
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `choreomaster-project-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleResetProject = () => {
    const hasData = performers.length > 0 || frames.length > 1 || (frames[0] && Object.keys(frames[0].positions).length > 0);

    if (hasData) {
      // Logic: Prompt to export. 
      // If Confirm -> Export -> Reset.
      // If Cancel -> No Export -> Reset.
      if (window.confirm("Do you want to export the current project before resetting?\n\nClick OK to Export.\nClick Cancel to reset without exporting.")) {
        try {
          handleExportProject();
        } catch (e) {
          console.error("Export failed", e);
        }
      }
    }

    // Perform Reset
    const newFrameId = generateId();
    setPerformers([]);
    setPerformerGroups([]);
    setFrames([{
      id: newFrameId,
      name: 'Opening',
      startTime: 0,
      duration: 2000,
      positions: {}
    }]);
    setCurrentFrameId(newFrameId);
    setMusicName(null);
    setAudioBuffer(null);
    setMusicUrl(null);
    setCurrentTime(0);
    setSelectedPerformerIds([]);
  };

  const handleImportProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Check if running in Electron
    if (window.electronAPI?.isElectron) {
      try {
        const filePath = await window.electronAPI.openFile([
          { name: 'ChoreoMaster Project', extensions: ['json'] },
          { name: 'JSON Files', extensions: ['json'] },
        ]);

        if (filePath) {
          const content = await window.electronAPI.readFile(filePath);
          const json = JSON.parse(content);

          // Basic validation
          if (!json.performers || !Array.isArray(json.performers)) throw new Error("Invalid project file: missing performers");
          if (!json.frames || !Array.isArray(json.frames)) throw new Error("Invalid project file: missing frames");

          setPerformers(json.performers);
          setPerformerGroups(json.performerGroups || []);
          setFrames(json.frames);
          setMusicName(json.musicName || null);

          // 恢复舞台配置
          if (json.stageConfig) {
            setStageConfig(json.stageConfig);
            if (json.stageConfig.ledContent?.value) {
              setMediaCache({});
            }
          }

          // Reset Playback
          setCurrentTime(0);
          setAudioBuffer(null);
          setMusicUrl(null);
          setSelectedPerformerIds([]);

          if (json.frames.length > 0) {
            setCurrentFrameId(json.frames[0].id);
          }

          alert(`Project loaded successfully. Please re-import audio file "${json.musicName || 'if needed'}"`);
          return;
        }
      } catch (error) {
        console.error('Electron import failed, falling back to web:', error);
      }
    }

    // Fallback to web version (file input)
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);

        // Basic validation
        if (!json.performers || !Array.isArray(json.performers)) throw new Error("Invalid project file: missing performers");
        if (!json.frames || !Array.isArray(json.frames)) throw new Error("Invalid project file: missing frames");

        setPerformers(json.performers);
        setPerformerGroups(json.performerGroups || []);
        setFrames(json.frames);
        setMusicName(json.musicName || null);

        // 恢复舞台配置
        if (json.stageConfig) {
          setStageConfig(json.stageConfig);
          if (json.stageConfig.ledContent?.value) {
            setMediaCache({});
          }
        }

        // Reset Playback
        setCurrentTime(0);
        setAudioBuffer(null);
        setMusicUrl(null);
        setSelectedPerformerIds([]);

        if (json.frames.length > 0) {
          setCurrentFrameId(json.frames[0].id);
        }

        alert(`Project loaded successfully. Please re-import audio file "${json.musicName || 'if needed'}"`);
      } catch (err) {
        console.error("Failed to import project:", err);
        alert("Failed to import project. File might be corrupted or invalid.");
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };


  // --- Copy / Paste / Duplicate Logic ---

  const copyPerformersToClipboard = useCallback(() => {
    if (selectedPerformerIds.length === 0) return;

    const items: ClipboardItem[] = [];
    selectedPerformerIds.forEach(id => {
      const performer = performers.find(p => p.id === id);
      if (performer) {
        const positions: Record<string, Position> = {};
        frames.forEach(f => {
          if (f.positions[id]) {
            positions[f.id] = { ...f.positions[id] };
          }
        });
        items.push({ performer: { ...performer }, positions });
      }
    });
    setClipboard(items);
    console.log(`Copied ${items.length} performers.`);
  }, [selectedPerformerIds, performers, frames]);

  const pastePerformers = useCallback((items: ClipboardItem[] = clipboard) => {
    if (items.length === 0) return;

    const newPerformers: Performer[] = [];
    const frameUpdates: Record<string, Record<string, Position>> = {}; // frameId -> { perfId: pos }

    items.forEach(item => {
      const newId = generateId();
      const newPerformer: Performer = {
        ...item.performer,
        id: newId,
        name: `${item.performer.name} (Copy)`
      };
      newPerformers.push(newPerformer);

      frames.forEach(f => {
        const originalPos = item.positions[f.id] || { x: 50, y: 50 };
        if (!frameUpdates[f.id]) frameUpdates[f.id] = {};
        frameUpdates[f.id][newId] = {
          x: Math.min(100, Math.max(0, originalPos.x + 2)),
          y: Math.min(100, Math.max(0, originalPos.y + 2))
        };
      });
    });

    setPerformers(prev => [...prev, ...newPerformers]);
    setFrames(prev => prev.map(f => {
      if (frameUpdates[f.id]) {
        return {
          ...f,
          positions: { ...f.positions, ...frameUpdates[f.id] }
        };
      }
      return f;
    }));

    setSelectedPerformerIds(newPerformers.map(p => p.id));

  }, [clipboard, frames]);

  const handleDuplicateSelected = () => {
    const items: ClipboardItem[] = [];
    selectedPerformerIds.forEach(id => {
      const performer = performers.find(p => p.id === id);
      if (performer) {
        const positions: Record<string, Position> = {};
        frames.forEach(f => {
          if (f.positions[id]) {
            positions[f.id] = { ...f.positions[id] };
          }
        });
        items.push({ performer: { ...performer }, positions });
      }
    });
    pastePerformers(items);
  };

  // Keyboard Shortcuts
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      // Pause
      setIsPlaying(false);
      stopAudio();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } else {
      // Play
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }

      setIsPlaying(true);
      isPlayingRef.current = true; // Force Ref True immediately for loop

      // Important: Start from CURRENT Time
      startTimeRef.current = performance.now() - currentTime;
      playAudio(currentTime);

      const loop = () => {
        // Critical: Check ref, not state variable which is stale in closure
        if (!isPlayingRef.current) return;

        const now = performance.now();
        let newTime = now - startTimeRef.current;

        // Auto-stop at end
        if (frames.length > 0) {
          const lastFrame = frames[frames.length - 1];
          const end = lastFrame.startTime + lastFrame.duration + 2000; // stop 2s after last frame
          if (newTime > end && end > 10000) {
            newTime = end;
            setIsPlaying(false);
            stopAudio();
            return; // Stop animation
          }
        }

        rafRef.current = requestAnimationFrame(loop);
        setCurrentTime(newTime);
      };
      rafRef.current = requestAnimationFrame(loop);
    }
  }, [isPlaying, currentTime, frames]);

  // Separate effect for spacebar to ensure latest handlePlayPause closure is used
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace' || e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        if (selectedPerformerIds.length > 0) {
          handleDeleteSelectedPerformers();
        } else if (currentFrameId) {
          handleDeleteFrame(currentFrameId);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (((e.ctrlKey || e.metaKey) && e.key === 'y') || ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedPerformerIds.length > 0) {
          e.preventDefault();
          copyPerformersToClipboard();
        }
        // Copy selected frame
        if (currentFrameId) {
          const f = frames.find(fr => fr.id === currentFrameId);
          if (f) {
            e.preventDefault();
            setFrameClipboard(JSON.parse(JSON.stringify(f)));
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboard.length > 0) {
          e.preventDefault();
          pastePerformers();
        }
        // Paste frame at playhead
        if (frameClipboard) {
          e.preventDefault();
          const newFrame: Frame = {
            ...frameClipboard,
            id: generateId(),
            name: `${frameClipboard.name} (复制)`,
            startTime: currentTime,
            positions: JSON.parse(JSON.stringify(frameClipboard.positions))
          };
          const newFrames = [...frames, newFrame];
          newFrames.sort((a, b) => a.startTime - b.startTime);
          setFrames(newFrames);
          setCurrentFrameId(newFrame.id);
        }
      }

      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
      }

      // Help Modal
      if (e.key === 'F1' || (e.ctrlKey && e.key === '/')) {
        e.preventDefault();
        setShowHelp(true);
      }


    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPerformerIds, clipboard, frameClipboard, copyPerformersToClipboard, pastePerformers, handlePlayPause, frames, currentTime, currentFrameId]);


  // --- Audio Logic ---
  const handleImportMusic = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMusicName(file.name);
    const url = URL.createObjectURL(file);
    setMusicUrl(url);

    const arrayBuffer = await file.arrayBuffer();
    if (audioContextRef.current) {
      const buffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
      setAudioBuffer(buffer);
    }
  };

  const playAudio = (offset: number) => {
    if (!audioContextRef.current || !audioBuffer) return;

    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch (e) { }
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    source.start(0, offset / 1000);
    audioSourceRef.current = source;
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch (e) { }
      audioSourceRef.current = null;
    }
  };

  const handleSeek = (time: number) => {
    setCurrentTime(time);

    // Auto-update selection to match playhead
    const sorted = getSortedFrames(frames);
    const frameUnderPlayhead = sorted.find(f => time >= f.startTime && time < f.startTime + f.duration);
    if (frameUnderPlayhead && frameUnderPlayhead.id !== currentFrameId) {
      setCurrentFrameId(frameUnderPlayhead.id);
    }

    if (isPlaying) {
      stopAudio();
      startTimeRef.current = performance.now() - time;
      playAudio(time);
    }
  };

  const renderFrameToCanvas = (canvas: HTMLCanvasElement, timeMs: number, opts?: { includeLabels?: boolean; includeGrid?: boolean; bgColor?: string; }) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const includeLabels = opts?.includeLabels ?? true;
    const includeGrid = opts?.includeGrid ?? true;
    const bgColor = opts?.bgColor ?? '#1f2937';
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    if (includeGrid) {
      const divisions = Math.round(4 * gridScale);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.2;
      for (let i = 0; i <= divisions; i++) {
        const gx = (i / divisions) * w;
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
        const gy = (i / divisions) * h;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Compute hidden groups at this time
    const sortedFrames = [...frames].sort((a, b) => a.startTime - b.startTime);
    const frame = sortedFrames.find(f => timeMs >= f.startTime && timeMs < f.startTime + f.duration)
      || [...sortedFrames].reverse().find(f => f.startTime + f.duration <= timeMs);
    const hiddenGroupIds = frame?.hiddenGroupIds || [];

    const positions = computePositionsAtTime(timeMs);
    const stageW = stageConfig.width || 20;
    const stageD = stageConfig.depth || stageW / STAGE_ASPECT_RATIO;

    // Draw performers
    performers.forEach(p => {
      if (p.groupId && hiddenGroupIds.includes(p.groupId)) return;
      const pos = positions[p.id];
      if (!pos) return;
      const cx = (pos.x / 100) * w;
      const cy = (pos.y / 100) * h;

      if (p.type === 'prop') {
        // Prop rendering: size from width/depth in meters, rotation, texture, clipPath
        const propW = (p.width || 1) / stageW * w;
        const propD = (p.depth || 1) / stageD * h;
        const rot = (p.rotation || 0) * Math.PI / 180;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-rot);

        // Clip path for custom polygon props
        if (p.polygonPoints && p.polygonPoints.length >= 3) {
          ctx.beginPath();
          p.polygonPoints.forEach((pt, i) => {
            const px = (pt.x - 0.5) * propW;
            const py = (pt.y - 0.5) * propD;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.clip();
        }

        // Texture or solid color
        const texUrl = p.boxTextures?.front?.dataUrl || p.textureDataUrl;
        if (texUrl && (texUrl as any).loaded) {
          ctx.drawImage((texUrl as any), -propW / 2, -propD / 2, propW, propD);
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(-propW / 2, -propD / 2, propW, propD);
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-propW / 2, -propD / 2, propW, propD);

        ctx.restore();

        if (includeLabels) {
          ctx.fillStyle = '#ffffff';
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(p.name, cx, cy + Math.max(propW, propD) / 2 + 2);
        }
      } else {
        // Performer rendering
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        const shapeSize = 32;
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(cx, cy, Math.floor(shapeSize / 2 - 7), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (p.shape === 'square') {
          const s = shapeSize;
          ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
          ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
        } else {
          const s = shapeSize + 6;
          ctx.beginPath();
          ctx.moveTo(cx, cy - s / 2);
          ctx.lineTo(cx + s / 2, cy + s / 2);
          ctx.lineTo(cx - s / 2, cy + s / 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        if (includeLabels) {
          ctx.fillStyle = '#ffffff';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(p.name, cx, cy + Math.floor(shapeSize / 2));
        }
      }
    });

    ctx.fillStyle = 'rgba(100,116,139,0.5)';
    ctx.fillRect(0, h - 8, w, 8);
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('舞台前沿', Math.floor(w / 2), h - 2);
  };

  const handleSetInPoint = () => { setInPointMs(currentTime); };
  const handleSetOutPoint = () => { setOutPointMs(currentTime); };

  const handleExportVideo = async () => {
    if (inPointMs == null || outPointMs == null || outPointMs <= inPointMs) {
      alert('请先设置有效的入点与出点（出点必须大于入点）。');
      return;
    }
    const width = 1280;
    const height = 720;
    const fps = 30;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const streamV = (canvas as any).captureStream ? (canvas as any).captureStream(0) : null;
    if (!streamV) return;
    const videoTrack = streamV.getVideoTracks()[0];

    const audioCtx = audioContextRef.current;
    let stream: MediaStream = streamV;
    let source: AudioBufferSourceNode | null = null;
    if (audioCtx && audioBuffer) {
      if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch { }
      }
      const dest = audioCtx.createMediaStreamDestination();
      source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(dest);
      source.connect(audioCtx.destination);
      stream = new MediaStream([...streamV.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    }
    const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mime = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5000000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e: any) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

    const totalMs = outPointMs - inPointMs;
    const totalFrames = Math.ceil(totalMs / 1000 * fps);
    const stepMs = 1000 / fps;

    setIsExporting(true);
    setExportProgress(0);

    // Pre-load prop textures for export
    const texturePromises = performers
      .filter(p => p.type === 'prop')
      .map(async (p) => {
        const texUrl = p.boxTextures?.front?.dataUrl || p.textureDataUrl;
        if (!texUrl) return;
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => { (texUrl as any).loaded = img; resolve(); };
          img.onerror = reject;
          img.src = texUrl;
        });
      });
    await Promise.all(texturePromises);

    // Offline render loop: render all frames as fast as possible
    recorder.start(100);
    if (source) source.start(0, inPointMs / 1000);

    for (let i = 0; i <= totalFrames; i++) {
      const t = inPointMs + i * stepMs;
      renderFrameToCanvas(canvas, Math.min(t, outPointMs), { includeLabels: exportIncludeLabels, includeGrid: exportIncludeGrid });
      // Request the video track to capture the current canvas frame
      if (videoTrack && (videoTrack as any).requestFrame) {
        (videoTrack as any).requestFrame();
      }
      setExportProgress(Math.min(1, i / totalFrames));
      // Yield to browser every 10 frames so UI updates and MediaRecorder can process
      if (i % 10 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    recorder.stop();
    if (source) { try { source.stop(); } catch { } }

    const blob = await new Promise<Blob>(resolve => {
      recorder.onstop = () => {
        const b = new Blob(chunks, { type: mime });
        setIsExporting(false);
        resolve(b);
      };
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `choreomaster-export-${Math.round(inPointMs)}-${Math.round(outPointMs)}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleSelectFrame = (id: string) => {
    setCurrentFrameId(id);
    const f = frames.find(fr => fr.id === id);
    if (f) {
      setCurrentTime(f.startTime);
      if (isPlaying) {
        handlePlayPause(); // Pause on select
      }
    }
  };

  const handleRenameFrame = (id: string, name?: string) => {
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (trimmed) setFrames(prev => prev.map(fr => fr.id === id ? { ...fr, name: trimmed } : fr));
      return;
    }
  };

  // Grid Zoom Logic
  const handleGridZoom = (delta: number) => {
    setGridScale(prev => {
      const newScale = prev + delta;
      return Math.max(1, Math.min(5, newScale)); // Clamp between 1x and 5x
    });
  };

  // Always use currentPositions() to ensure scrubbing shows real-time interpolation
  const displayedPositions = currentPositions();

  // Determine total duration for Timeline rendering
  const totalDuration = frames.length > 0
    ? frames[frames.length - 1].startTime + frames[frames.length - 1].duration
    : 0;

  return (
    <div className={`h-screen w-screen flex flex-col ${theme === 'dark' ? 'bg-slate-950 text-slate-200' : 'bg-gray-50 text-gray-900'} overflow-hidden`}>
      {/* Help Modal */}
      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />

      {/* Top Bar */}
      <div className={`h-12 flex items-center justify-between px-4 border-b ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2">
          <h1 className={`text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>CosFormation</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHelp(true)}
            className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-blue-400' : 'hover:bg-gray-100 text-gray-600 hover:text-blue-600'}`}
            title="帮助 (F1)"
          >
            <HelpCircle size={20} />
          </button>
          <button
            onClick={() => setViewMode(viewMode === '2d' ? '3d' : '2d')}
            className={`p-2 rounded-lg transition-colors ${viewMode === '3d'
              ? 'bg-purple-600 text-white hover:bg-purple-500'
              : theme === 'dark'
                ? 'hover:bg-slate-800 text-slate-400 hover:text-purple-400'
                : 'hover:bg-gray-100 text-gray-600 hover:text-purple-600'
              }`}
            title={viewMode === '2d' ? '切换到 3D 视图' : '切换到 2D 视图'}
          >
            {viewMode === '2d' ? '🎲' : '🔲'}
          </button>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-green-400' : 'hover:bg-gray-100 text-gray-600 hover:text-green-600'}`}
            title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          >
            <Maximize2 size={20} />
          </button>

        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {!sidebarCollapsed && (
          <Sidebar
            performers={performers}
            performerGroups={performerGroups}
            frames={frames}
            currentFrameId={currentFrameId}
            onAddPerformer={handleAddPerformer}
            onRemovePerformer={handleRemovePerformer}
            onUpdatePerformer={handleUpdatePerformer}
            onTogglePerformerInFrame={handleTogglePerformerInFrame}
            onDuplicateSelected={handleDuplicateSelected}
            onApplyPreset={handleApplyPreset}
            onImportMusic={handleImportMusic}
            onExport={handleExportProject}
            onImportProject={handleImportProject}
            selectedPerformerIds={selectedPerformerIds}
            onSelectionChange={setSelectedPerformerIds}
            musicName={musicName}
            onSelectFrame={handleSelectFrame}
            onAddFrame={handleAddFrame}
            onDeleteFrame={handleDeleteFrame}
            onDuplicateFrame={handleDuplicateFrame}
            onReorderFrame={() => { }} // Disabled
            onResetProject={handleResetProject}
            onRenameFrame={handleRenameFrame}
            widthPx={sidebarWidth}
            // Group Management Props
            onAddGroup={handleAddGroup}
            onRemoveGroup={handleRemoveGroup}
            onUpdateGroup={handleUpdateGroup}
            onAddPerformerToGroup={handleAddPerformerToGroup}
            onRemovePerformerFromGroup={handleRemovePerformerFromGroup}
            onAddPerformersToGroup={handleAddPerformersToGroup}
            onUpdateGroupPerformers={handleUpdateGroupPerformers}
            onToggleGroupVisibility={handleToggleGroupVisibilityInFrame}
            onToggleGroupCollapsed={handleToggleGroupCollapsed}
            onSelectGroupPerformers={handleSelectGroupPerformers}
            stageConfig={stageConfig}
            onStageConfigChange={handleStageConfigChange}
            onLEDContentUpload={handleLEDContentUpload}
            onClearLEDContent={handleClearLEDContent}
            aiConfig={aiConfig}
            onAiConfigChange={setAiConfig}
            // Project storage props
            currentProjectId={currentProjectId}
            onLoadProject={handleLoadProject}
            onCreateProject={handleCreateProject}
            onCreateFromTemplate={handleCreateFromTemplate}
            onLoadTemplate={handleLoadTemplate}
            onSaveProject={handleSaveProject}
            projectHasChanges={projectHasChanges}
          />)}
        {!sidebarCollapsed && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = sidebarWidth;
              document.body.style.cursor = 'ew-resize';
              document.body.style.userSelect = 'none';
              const onMove = (ev: MouseEvent) => {
                const dx = ev.clientX - startX;
                const next = Math.max(240, Math.min(480, startW + dx));
                setSidebarWidth(next);
              };
              const onUp = () => {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
            className={`${theme === 'dark' ? 'bg-slate-800 hover:bg-blue-600' : 'bg-gray-300 hover:bg-blue-500'} w-1.5 cursor-ew-resize transition-colors flex-shrink-0 group relative`}
            title="拖动调整侧边栏宽度"
          >
            {/* Visual indicator dots */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="w-1 h-1 bg-white rounded-full"></div>
              <div className="w-1 h-1 bg-white rounded-full"></div>
              <div className="w-1 h-1 bg-white rounded-full"></div>
            </div>
          </div>
        )}

        <div className={`flex-1 flex flex-col relative ${theme === 'dark' ? 'bg-black' : 'bg-gray-100'}`}>
          <div className="absolute top-4 left-4 z-10 pointer-events-none">
            <div className={`backdrop-blur px-4 py-2 rounded-lg border text-sm shadow-xl ${theme === 'dark' ? 'bg-slate-900/90 border-slate-700 text-slate-400' : 'bg-white/90 border-gray-300 text-gray-700'}`}>
              正在编辑队形：<span className="text-blue-400 font-bold ml-1">{frames.find(f => f.id === currentFrameId)?.name || '过渡/GAP'}</span>
              <div className={`text-[10px] mt-1 ${theme === 'dark' ? 'text-slate-500' : 'text-gray-500'}`}>{selectedPerformerIds.length} 人已选中</div>
            </div>
          </div>

          {viewMode === '2d' ? (
            <Stage
              performers={performers}
              performerGroups={performerGroups}
              hiddenGroupIds={activeHiddenGroupIds}
              positions={displayedPositions}
              selectedPerformerIds={selectedPerformerIds}
              onSelectionChange={setSelectedPerformerIds}
              onPositionChange={handlePositionChange}
              onUpdatePerformer={handleUpdatePerformer}
              readonly={isPlaying}
              showLabels={showLabels}
              gridScale={gridScale}
              onZoom={handleGridZoom}
              aspectRatio={stageAspectRatio}
              maxWidthPx={stageMaxWidth}
            />
          ) : (
            <Stage3D
              performers={performers}
              positions={displayedPositions}
              selectedIds={selectedPerformerIds}
              onSelect={setSelectedPerformerIds}
              hiddenGroupIds={activeHiddenGroupIds}
              onPositionChange={handlePositionChange}
              onUpdatePerformer={handleUpdatePerformer}
              onRemovePerformer={handleRemovePerformer}
              stageConfig={stageConfig}
              mediaCache={mediaCache}
              gridScale={gridScale}
              readonly={isPlaying}
            />
          )}

          <div
            onMouseDown={(e) => {
              const startY = e.clientY;
              const startH = timelineHeight;
              const onMove = (ev: MouseEvent) => {
                const dy = ev.clientY - startY;
                const next = Math.max(100, Math.min(300, startH - dy));
                setTimelineHeight(next);
              };
              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
            className={`h-2 cursor-ns-resize ${theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700' : 'bg-gray-300 hover:bg-gray-400'}`}
          />

          {/* Floating Stage Toolbar */}
          <div className={`absolute bottom-4 right-4 z-20 backdrop-blur p-2 rounded-lg border shadow-xl animate-in fade-in slide-in-from-bottom-4 ${theme === 'dark' ? 'bg-slate-900/90 border-slate-700' : 'bg-white/90 border-gray-300'}`}>
            {stageToolbarCollapsed ? (
              <button
                onClick={() => setStageToolbarCollapsed(false)}
                className={`${theme === 'dark' ? 'text-slate-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'} p-1 rounded`}
                title="展开工具栏"
              >
                <ChevronUp size={16} />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStageToolbarCollapsed(true)}
                  className={`${theme === 'dark' ? 'text-slate-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'} p-1 rounded`}
                  title="收起工具栏"
                >
                  <ChevronDown size={16} />
                </button>
                <div className={`w-px h-6 mx-1 ${theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'}`}></div>
                <button
                  onClick={() => setShowLabels(!showLabels)}
                  className={`p-2 rounded transition-colors ${showLabels ? 'text-blue-400' : theme === 'dark' ? 'text-slate-500 hover:bg-slate-800' : 'text-gray-500 hover:bg-gray-100'}`}
                  title="切换姓名显示"
                >
                  <Type size={18} />
                </button>
                <div className={`w-px h-6 mx-1 ${theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'}`}></div>
                <div className="flex items-center gap-2 px-2">
                  <button onClick={() => handleGridZoom(-0.5)} className={theme === 'dark' ? 'text-slate-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'}><MinusCircle size={16} /></button>
                  <span className={`text-xs font-mono w-8 text-center ${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>{gridScale.toFixed(1)}x</span>
                  <button onClick={() => handleGridZoom(0.5)} className={theme === 'dark' ? 'text-slate-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'}><PlusCircle size={16} /></button>
                </div>
                <div className={`w-px h-6 mx-1 ${theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'}`}></div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setStageAspectRatio(16 / 9)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${stageAspectRatio === 16 / 9 ? 'bg-blue-600 text-white' : theme === 'dark' ? 'bg-slate-800 text-slate-400 hover:bg-slate-700' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                    title="16:9"
                  >
                    16:9
                  </button>
                  <button
                    onClick={() => setStageAspectRatio(4 / 3)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${stageAspectRatio === 4 / 3 ? 'bg-blue-600 text-white' : theme === 'dark' ? 'bg-slate-800 text-slate-400 hover:bg-slate-700' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                    title="4:3"
                  >
                    4:3
                  </button>
                </div>
                <div className={`w-px h-6 mx-1 ${theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'}`}></div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>比例</span>
                  <input
                    type="number"
                    min={1}
                    value={ratioW}
                    onChange={(e) => { const v = Math.max(1, parseInt(e.target.value || '1')); setRatioW(v); setStageAspectRatio(v / Math.max(1, ratioH)); }}
                    className={`w-12 px-2 py-1 text-xs rounded border ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-gray-300 text-gray-800'}`}
                    title="宽"
                  />
                  <span className={`text-xs ${theme === 'dark' ? 'text-slate-500' : 'text-gray-500'}`}>:</span>
                  <input
                    type="number"
                    min={1}
                    value={ratioH}
                    onChange={(e) => { const v = Math.max(1, parseInt(e.target.value || '1')); setRatioH(v); setStageAspectRatio(Math.max(1, ratioW) / v); }}
                    className={`w-12 px-2 py-1 text-xs rounded border ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-gray-300 text-gray-800'}`}
                    title="高"
                  />
                </div>
                <div className={`w-px h-6 mx-1 ${theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'}`}></div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>宽度</span>
                  <input
                    type="range"
                    min={600}
                    max={2000}
                    step={50}
                    value={stageMaxWidth}
                    onChange={(e) => setStageMaxWidth(parseInt(e.target.value))}
                    className="w-32"
                  />
                  <span className={`text-xs font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>{stageMaxWidth}px</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Timeline
        frames={frames}
        duration={Math.max(totalDuration + 10000, 30000)}
        currentTime={currentTime}
        audioBuffer={audioBuffer}
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onSeek={handleSeek}
        onFrameUpdate={setFrames}
        onAddFrame={handleAddFrame}
        onSelectFrame={handleSelectFrame}
        selectedFrameId={currentFrameId}
        heightPx={timelineHeight}
        onRenameFrame={handleRenameFrame}
        inPointMs={inPointMs}
        outPointMs={outPointMs}
        onSetInPoint={handleSetInPoint}
        onSetOutPoint={handleSetOutPoint}
        onExportVideo={handleExportVideo}
        isExporting={isExporting}
        exportProgress={exportProgress}
        exportIncludeLabels={exportIncludeLabels}
        exportIncludeGrid={exportIncludeGrid}
        onToggleExportIncludeLabels={() => setExportIncludeLabels(v => !v)}
        onToggleExportIncludeGrid={() => setExportIncludeGrid(v => !v)}
        exportWidthPx={1280}
        exportHeightPx={720}
      />
    </div>
  );
};

export default App;
