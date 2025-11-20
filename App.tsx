
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Frame, Performer, Position, PerformerShape } from './types';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';
import { Timeline } from './components/Timeline';
import { DEFAULT_COLORS } from './constants';
import { ZoomIn, ZoomOut, Type, PlusCircle, MinusCircle } from 'lucide-react';

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
  const [frames, setFrames] = useState<Frame[]>([DEFAULT_FRAME]);
  const [currentFrameId, setCurrentFrameId] = useState<string>(DEFAULT_FRAME.id);
  const [selectedPerformerIds, setSelectedPerformerIds] = useState<string[]>([]);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [musicName, setMusicName] = useState<string | null>(null);
  
  // Stage View State
  const [showLabels, setShowLabels] = useState(true);
  const [gridScale, setGridScale] = useState(1);
  
  // Clipboard State
  const [clipboard, setClipboard] = useState<ClipboardItem[]>([]);

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

  // --- Actions ---

  const handleAddPerformer = (name: string, color: string, shape: PerformerShape) => {
    const newPerformer: Performer = {
      id: generateId(),
      name,
      color,
      label: name.charAt(0).toUpperCase(),
      shape
    };
    setPerformers([...performers, newPerformer]);
    // Update all frames to include initial pos for new performer
    setFrames(frames.map(f => ({
      ...f,
      positions: { ...f.positions, [newPerformer.id]: { x: 50, y: 50 } }
    })));
  };

  const handleRemovePerformer = (id: string) => {
    setPerformers(performers.filter(p => p.id !== id));
    setSelectedPerformerIds(selectedPerformerIds.filter(pid => pid !== id));
  };

  const handleUpdatePerformer = (id: string, updates: Partial<Performer>) => {
      setPerformers(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
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
      const newFrames = frames.filter(f => f.id !== id);
      setFrames(newFrames);
      if (currentFrameId === id && newFrames.length > 0) {
          setCurrentFrameId(newFrames[newFrames.length - 1].id);
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

  const handleExportProject = () => {
    const projectData = {
        version: "1.0",
        createdAt: new Date().toISOString(),
        name: "ChoreoMaster Project",
        musicName,
        performers,
        frames,
    };

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

  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
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
            setFrames(json.frames);
            setMusicName(json.musicName || null);
            
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
            const lastFrame = frames[frames.length-1];
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

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          if (selectedPerformerIds.length > 0) {
              e.preventDefault();
              copyPerformersToClipboard();
          }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
          if (clipboard.length > 0) {
              e.preventDefault();
              pastePerformers();
          }
      }

      if (e.code === 'Space') {
          e.preventDefault();
          handlePlayPause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPerformerIds, clipboard, copyPerformersToClipboard, pastePerformers, handlePlayPause]);


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
      try { audioSourceRef.current.stop(); } catch(e) {}
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    source.start(0, offset / 1000);
    audioSourceRef.current = source;
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
        try { audioSourceRef.current.stop(); } catch(e) {}
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
    ? frames[frames.length-1].startTime + frames[frames.length-1].duration 
    : 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-200 overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar 
          performers={performers}
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
          onReorderFrame={() => {}} // Disabled
          onResetProject={handleResetProject}
        />
        
        <div className="flex-1 flex flex-col relative bg-black">
           <div className="absolute top-4 left-4 z-10 pointer-events-none">
                <div className="bg-slate-900/90 backdrop-blur px-4 py-2 rounded-lg border border-slate-700 text-sm text-slate-400 shadow-xl">
                    Editing Frame: <span className="text-blue-400 font-bold ml-1">{frames.find(f => f.id === currentFrameId)?.name || 'Transition/Gap'}</span>
                    <div className="text-[10px] mt-1 text-slate-500">{selectedPerformerIds.length} performers selected</div>
                </div>
           </div>

           <Stage 
              performers={performers}
              positions={displayedPositions}
              selectedPerformerIds={selectedPerformerIds}
              onSelectionChange={setSelectedPerformerIds}
              onPositionChange={handlePositionChange}
              readonly={isPlaying}
              showLabels={showLabels}
              gridScale={gridScale}
              onZoom={handleGridZoom}
           />
           
           {/* Floating Stage Toolbar */}
           <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur p-2 rounded-lg border border-slate-700 shadow-xl animate-in fade-in slide-in-from-bottom-4">
                <button 
                    onClick={() => setShowLabels(!showLabels)}
                    className={`p-2 rounded hover:bg-slate-800 transition-colors ${showLabels ? 'text-blue-400' : 'text-slate-500'}`}
                    title="Toggle Names"
                >
                    <Type size={18} />
                </button>
                <div className="w-px h-6 bg-slate-700 mx-1"></div>
                <div className="flex items-center gap-2 px-2">
                    <button onClick={() => handleGridZoom(-0.5)} className="text-slate-500 hover:text-white"><MinusCircle size={16}/></button>
                    <span className="text-xs font-mono text-slate-400 w-8 text-center">{gridScale.toFixed(1)}x</span>
                    <button onClick={() => handleGridZoom(0.5)} className="text-slate-500 hover:text-white"><PlusCircle size={16}/></button>
                </div>
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
      />
    </div>
  );
};

export default App;
