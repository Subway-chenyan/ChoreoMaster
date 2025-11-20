
import React, { useEffect, useRef, useMemo, useState } from 'react';
import { Frame } from '../types';
import { Play, Pause, SkipBack, ZoomIn, ZoomOut, PlusCircle } from 'lucide-react';

interface TimelineProps {
    frames: Frame[];
    duration: number; // Total duration in ms
    currentTime: number;
    audioBuffer: AudioBuffer | null;
    isPlaying: boolean;
    onPlayPause: () => void;
    onSeek: (time: number) => void;
    onFrameUpdate: (frames: Frame[]) => void;
    onAddFrame: () => void;
    onSelectFrame: (frameId: string) => void;
    selectedFrameId: string | null;
    onRenameFrame?: (frameId: string) => void;
    heightPx?: number;
}

export const Timeline: React.FC<TimelineProps> = ({
    frames,
    duration,
    currentTime,
    audioBuffer,
    isPlaying,
    onPlayPause,
    onSeek,
    onFrameUpdate,
    onAddFrame,
    onSelectFrame,
    selectedFrameId,
    onRenameFrame,
    heightPx = 160
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [zoom, setZoom] = useState(100); // Pixels per second
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState<string>('');

    // Dragging State
    const [draggingState, setDraggingState] = useState<{
        id: string,
        type: 'move' | 'resize',
        startX: number,
        originalStartTime: number,
        originalDuration: number
    } | null>(null);

    // Calculate total timeline width
    const totalWidth = Math.max((duration / 1000) * zoom, containerRef.current?.clientWidth || 0);

    // Draw waveform
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = totalWidth * dpr;
        canvas.height = heightPx * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, totalWidth, heightPx);

        // Draw grid lines (seconds)
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < totalWidth; i += zoom) {
            ctx.moveTo(i, 0);
            ctx.lineTo(i, heightPx);
        }
        ctx.stroke();

        if (!audioBuffer) return;

        // Draw waveform
        ctx.fillStyle = '#475569'; // Slate 600
        ctx.globalAlpha = 0.5;

        const data = audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / totalWidth);
        const amp = Math.max(20, (heightPx / 2) - 20);

        for (let i = 0; i < totalWidth; i++) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            ctx.fillRect(i, (heightPx / 2) + min * amp, 1, Math.max(1, (max - min) * amp));
        }
        ctx.globalAlpha = 1.0;
    }, [audioBuffer, totalWidth, zoom, heightPx]);

    // Calculate gaps (Transitions) between frames
    const gapSegments = useMemo(() => {
        const sorted = [...frames].sort((a, b) => a.startTime - b.startTime);
        const gaps = [];
        for (let i = 0; i < sorted.length - 1; i++) {
            const current = sorted[i];
            const next = sorted[i + 1];
            const gapStart = current.startTime + current.duration;
            const gapEnd = next.startTime;

            if (gapEnd > gapStart) {
                gaps.push({
                    start: gapStart,
                    end: gapEnd,
                    duration: gapEnd - gapStart,
                    prevId: current.id,
                    nextId: next.id
                });
            }
        }
        // Initial gap if first frame doesn't start at 0
        if (sorted.length > 0 && sorted[0].startTime > 0) {
            gaps.push({
                start: 0,
                end: sorted[0].startTime,
                duration: sorted[0].startTime,
                prevId: null,
                nextId: sorted[0].id
            });
        }
        return gaps;
    }, [frames]);

    const formatTime = (ms: number) => {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        const dec = Math.floor((ms % 1000) / 100);
        return `${min}:${sec.toString().padStart(2, '0')}.${dec}`;
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (draggingState) return;

        // Allow scrubbing anywhere on the timeline background
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
            const x = e.clientX - rect.left + (containerRef.current?.scrollLeft || 0);
            const time = Math.max(0, (x / zoom) * 1000);
            onSeek(time);
            setIsScrubbing(true);
        }
    };

    const handleFrameDragStart = (e: React.MouseEvent, frame: Frame, type: 'move' | 'resize') => {
        e.stopPropagation();
        if (editingId === frame.id) return; // prevent drag while editing
        // Select frame on drag start
        onSelectFrame(frame.id);

        setDraggingState({
            id: frame.id,
            type,
            startX: e.clientX,
            originalStartTime: frame.startTime,
            originalDuration: frame.duration
        });
    };

    const onMouseMove = (e: React.MouseEvent) => {
        // Handle Scrubbing
        if (isScrubbing) {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
                const x = e.clientX - rect.left + (containerRef.current?.scrollLeft || 0);
                const time = Math.max(0, (x / zoom) * 1000);
                onSeek(time);
            }
            return;
        }

        // Handle Frame Dragging
        if (!draggingState) return;

        const deltaPx = e.clientX - draggingState.startX;
        const deltaTime = (deltaPx / zoom) * 1000;

        const updatedFrames = frames.map(f => {
            if (f.id === draggingState.id) {
                if (draggingState.type === 'move') {
                    const newStart = Math.max(0, draggingState.originalStartTime + deltaTime);
                    return { ...f, startTime: newStart };
                } else {
                    // Resize
                    const newDur = Math.max(500, draggingState.originalDuration + deltaTime);
                    return { ...f, duration: newDur };
                }
            }
            return f;
        });

        // Update frames immediately for smooth feedback
        onFrameUpdate(updatedFrames);
    };

    const onMouseUp = () => {
        setIsScrubbing(false);
        if (draggingState) {
            // Final sort on drop to ensure consistency
            const sorted = [...frames].sort((a, b) => a.startTime - b.startTime);
            onFrameUpdate(sorted);
            setDraggingState(null);
        }
    };

    return (
        <div
            className="h-auto bg-slate-950 border-t border-slate-800 flex flex-col select-none"
            onMouseUp={onMouseUp}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseUp}
        >
            {/* Toolbar */}
            <div className="h-10 flex items-center px-4 bg-slate-900 border-b border-slate-800 justify-between z-20 relative">
                <div className="flex items-center gap-2">
                    <button className="p-1.5 hover:bg-slate-800 rounded text-slate-400" onClick={() => onSeek(0)}><SkipBack size={16} /></button>
                    <button
                        className={`p-1.5 rounded text-white shadow-lg flex items-center gap-1 px-3 transition-colors ${isPlaying ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'}`}
                        onClick={onPlayPause}
                    >
                        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                        <span className="text-xs font-bold">{isPlaying ? '暂停' : '播放'}</span>
                    </button>
                    <span className="font-mono text-slate-300 ml-4 text-sm">{formatTime(currentTime)}</span>
                    <span className="text-[10px] text-slate-500 ml-2">(空格键)</span>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={onAddFrame}
                        className="flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded border border-slate-700 text-slate-300"
                        title="在当前时间添加队形"
                    >
                        <PlusCircle size={12} /> 添加
                    </button>
                    <div className="flex items-center gap-1">
                        <button className="p-1 hover:bg-slate-800 rounded text-slate-400" onClick={() => setZoom(Math.max(20, zoom - 20))}><ZoomOut size={14} /></button>
                        <div className="w-20 h-1 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-slate-500" style={{ width: `${(zoom / 200) * 100}%` }}></div>
                        </div>
                        <button className="p-1 hover:bg-slate-800 rounded text-slate-400" onClick={() => setZoom(Math.min(200, zoom + 20))}><ZoomIn size={14} /></button>
                    </div>
                </div>
            </div>

            {/* Scrollable Timeline Area */}
            <div
                className={`overflow-x-auto overflow-y-hidden relative custom-scrollbar bg-slate-950 ${isScrubbing ? 'cursor-col-resize' : 'cursor-default'}`}
                ref={containerRef}
                onMouseDown={handleMouseDown}
                style={{ height: heightPx }}
            >
                <div style={{ width: totalWidth, minWidth: '100%' }} className="h-full relative">

                    {/* Waveform Canvas Layer */}
                    <canvas
                        ref={canvasRef}
                        className="absolute top-0 left-0 h-full pointer-events-none opacity-100"
                        style={{ width: totalWidth, height: heightPx }}
                    />

                    {/* Ruler */}
                    <div className="h-6 bg-slate-900/80 border-b border-slate-800 relative text-[10px] text-slate-500 z-10 pointer-events-none">
                        {Array.from({ length: Math.ceil(duration / 1000) + 1 }).map((_, i) => (
                            <div key={i} className="absolute top-0 bottom-0 border-l border-slate-700 pl-1 select-none" style={{ left: i * zoom }}>
                                {formatTime(i * 1000)}
                            </div>
                        ))}
                    </div>

                    {/* Playhead */}
                    <div
                        className="absolute top-0 bottom-0 w-[1px] bg-amber-500 z-50 pointer-events-none"
                        style={{ left: (currentTime / 1000) * zoom }}
                    >
                        <div className="w-3 h-4 -ml-[5px] bg-amber-500 text-[8px] flex items-center justify-center text-black font-bold clip-path-arrow shadow-md"></div>
                        <div className="absolute top-0 left-0 h-full w-full bg-amber-500/20"></div>
                    </div>

                    {/* Frame Tracks - Vertically Centered */}
                    <div className="absolute top-6 bottom-0 left-0 right-0 flex items-center">

                        {/* Render Gaps (Transitions) */}
                        {gapSegments.map((gap, i) => (
                            <div
                                key={`gap-${i}`}
                                className="absolute h-20 top-0 flex items-center justify-center overflow-hidden pointer-events-none"
                                style={{
                                    left: (gap.start / 1000) * zoom,
                                    width: (gap.duration / 1000) * zoom
                                }}
                            >
                                <div className="w-full h-full relative opacity-30">
                                    <svg className="absolute inset-0 w-full h-full text-slate-500" preserveAspectRatio="none">
                                        <line x1="0" y1="0" x2="100%" y2="100%" stroke="currentColor" strokeWidth="1" />
                                        <line x1="0" y1="100%" x2="100%" y2="0" stroke="currentColor" strokeWidth="1" />
                                    </svg>
                                </div>
                                <div className="absolute text-[9px] font-mono text-slate-500 bg-slate-950/50 px-1 rounded">
                                    {(gap.duration / 1000).toFixed(1)}秒
                                </div>
                            </div>
                        ))}

                        {/* Render Frames */}
                        {frames.map((frame) => (
                            <div
                                key={frame.id}
                                className="absolute h-20 top-0 group"
                                style={{ left: (frame.startTime / 1000) * zoom }}
                            >
                                <div
                                        onMouseDown={(e) => handleFrameDragStart(e, frame, 'move')}
                                        className={`relative h-full rounded-lg flex flex-col items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden transition-all border select-none shadow-lg
                                ${selectedFrameId === frame.id
                                            ? 'bg-slate-700 border-blue-400 shadow-blue-900/20 z-20'
                                            : 'bg-slate-800/90 border-slate-600 hover:bg-slate-700 z-10'
                                        }
                            `}
                                        style={{
                                            width: (frame.duration / 1000) * zoom
                                        }}
                                        onDoubleClick={() => { setEditingId(frame.id); setEditingName(frame.name); }}
                                    >
                                    <div className="font-bold text-xs text-slate-200 truncate px-2 mb-1">
                                        {editingId === frame.id ? (
                                            <input
                                                autoFocus
                                                value={editingName}
                                                onChange={(e) => setEditingName(e.target.value)}
                                                onBlur={() => {
                                                    const name = editingName.trim();
                                                    if (!name) { setEditingId(null); return; }
                                                    const updated = frames.map(f => f.id === frame.id ? { ...f, name } : f);
                                                    onFrameUpdate(updated);
                                                    setEditingId(null);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        const name = editingName.trim();
                                                        if (!name) { setEditingId(null); return; }
                                                        const updated = frames.map(f => f.id === frame.id ? { ...f, name } : f);
                                                        onFrameUpdate(updated);
                                                        setEditingId(null);
                                                    } else if (e.key === 'Escape') {
                                                        setEditingId(null);
                                                    }
                                                }}
                                                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200"
                                            />
                                        ) : (
                                            frame.name
                                        )}
                                    </div>
                                    <div className="text-[9px] text-slate-400 pointer-events-none">{(frame.duration / 1000).toFixed(1)}秒</div>

                                        {/* Resize Handle (Right) */}
                                        <div
                                            className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-blue-500/30 z-30 flex items-center justify-center group/handle"
                                            onMouseDown={(e) => handleFrameDragStart(e, frame, 'resize')}
                                            title="拖动调整时长"
                                        >
                                            <div className="w-1 h-4 bg-slate-500 rounded-full group-hover/handle:bg-blue-400" />
                                        </div>
                                    </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
