
import React, { useEffect, useRef, useMemo, useState } from 'react';
import { AudioMarker, Frame, MotionControlPoint, ObjectMotion, Performer, TransitionSegment } from '../types';
import { Flag, Pause, Play, PlusCircle, SkipBack, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { EditableNumberInput } from './FormControls';
import { createTransitionId, getDefaultBezierControlPoints, getGapSelectionId } from '../utils/transitions';

interface TimelineProps {
    performers: Performer[];
    frames: Frame[];
    transitions: TransitionSegment[];
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
    selectedTransitionId: string | null;
    onSelectTransition: (transitionId: string | null) => void;
    selectedMotionPerformerId: string | null;
    onSelectedMotionPerformerChange: (performerId: string | null) => void;
    onTransitionUpdate: (transition: TransitionSegment) => void;
    onTransitionDelete: (transitionId: string) => void;
    onFrameRotationChange: (frameId: string, performerId: string, rotation: number) => void;
    audioMarkers: AudioMarker[];
    onAudioMarkersChange: (markers: AudioMarker[]) => void;
    onRenameFrame?: (frameId: string) => void;
    heightPx?: number;
    inPointMs?: number | null;
    outPointMs?: number | null;
    onExportVideo?: () => void;
    isExporting?: boolean;
    exportProgress?: number;
}

export const Timeline: React.FC<TimelineProps> = ({
    performers,
    frames,
    transitions,
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
    selectedTransitionId,
    onSelectTransition,
    selectedMotionPerformerId,
    onSelectedMotionPerformerChange,
    onTransitionUpdate,
    onTransitionDelete,
    onFrameRotationChange,
    audioMarkers,
    onAudioMarkersChange,
    onRenameFrame,
    heightPx = 160,
    inPointMs,
    outPointMs,
    onExportVideo,
    isExporting,
    exportProgress
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [zoom, setZoom] = useState(() => window.matchMedia('(max-width: 1100px)').matches ? 24 : 100);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState<string>('');
    const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
    const toolbarHeight = 48;
    const trackHeight = Math.max(84, heightPx - toolbarHeight);
    const clipHeight = Math.min(80, Math.max(52, trackHeight - 28));

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

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !window.matchMedia('(max-width: 1100px)').matches) return;

        const fitTimeline = () => {
            const seconds = Math.max(1, duration / 1000);
            const fittedZoom = Math.max(8, Math.min(100, (container.clientWidth - 2) / seconds));
            setZoom(fittedZoom);
            container.scrollLeft = 0;
        };

        fitTimeline();
        const observer = new ResizeObserver(fitTimeline);
        observer.observe(container);
        return () => observer.disconnect();
    }, [duration]);

    // Draw waveform
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = Number.isFinite(totalWidth) && totalWidth > 0 ? totalWidth : (containerRef.current?.clientWidth || 0);
        const maxCanvasCssWidth = Math.floor(32767 / dpr);
        const renderWidth = Math.max(1, Math.min(cssWidth, maxCanvasCssWidth));
        const scaleX = cssWidth > 0 ? renderWidth / cssWidth : 1;
        canvas.width = renderWidth * dpr;
        canvas.height = trackHeight * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, renderWidth, trackHeight);

        // Draw grid lines (seconds)
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const gridStep = Math.max(1, zoom * scaleX);
        for (let i = 0; i < renderWidth; i += gridStep) {
            ctx.moveTo(i, 0);
            ctx.lineTo(i, trackHeight);
        }
        ctx.stroke();

        if (!audioBuffer) return;

        // Draw waveform
        ctx.fillStyle = '#475569'; // Slate 600
        ctx.globalAlpha = 0.5;

        const data = audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / renderWidth);
        const amp = Math.max(20, (trackHeight / 2) - 20);

        for (let i = 0; i < renderWidth; i++) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            ctx.fillRect(i, (trackHeight / 2) + min * amp, 1, Math.max(1, (max - min) * amp));
        }
        ctx.globalAlpha = 1.0;
    }, [audioBuffer, totalWidth, zoom, trackHeight]);

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
                    id: createTransitionId(current.id, next.id),
                    start: gapStart,
                    end: gapEnd,
                    duration: gapEnd - gapStart,
                    prevId: current.id,
                    nextId: next.id,
                    transition: transitions.find((transition) => transition.fromFrameId === current.id && transition.toFrameId === next.id) || null,
                });
            }
        }
        // Initial gap if first frame doesn't start at 0
        if (sorted.length > 0 && sorted[0].startTime > 0) {
            gaps.push({
                id: `transition-start-${sorted[0].id}`,
                start: 0,
                end: sorted[0].startTime,
                duration: sorted[0].startTime,
                prevId: null,
                nextId: sorted[0].id,
                transition: null,
            });
        }
        return gaps;
    }, [frames, transitions]);

    const selectedGap = useMemo(
        () => gapSegments.find((gap) => getGapSelectionId(gap) === selectedTransitionId) || null,
        [gapSegments, selectedTransitionId],
    );

    const selectedGapFrames = useMemo(() => {
        if (!selectedGap?.prevId) return null;
        const fromFrame = frames.find((frame) => frame.id === selectedGap.prevId);
        const toFrame = frames.find((frame) => frame.id === selectedGap.nextId);
        if (!fromFrame || !toFrame) return null;
        return { fromFrame, toFrame };
    }, [frames, selectedGap]);

    const selectableMotionPerformers = useMemo(() => {
        if (!selectedGapFrames) return [];
        return performers.filter((performer) => (
            selectedGapFrames.fromFrame.positions[performer.id] !== undefined
            && selectedGapFrames.toFrame.positions[performer.id] !== undefined
        ));
    }, [performers, selectedGapFrames]);

    useEffect(() => {
        if (selectableMotionPerformers.length === 0) {
            onSelectedMotionPerformerChange(null);
            return;
        }
        const nextPerformerId = selectedMotionPerformerId && selectableMotionPerformers.some((performer) => performer.id === selectedMotionPerformerId)
            ? selectedMotionPerformerId
            : selectableMotionPerformers[0].id;
        if (nextPerformerId !== selectedMotionPerformerId) {
            onSelectedMotionPerformerChange(nextPerformerId);
        }
    }, [onSelectedMotionPerformerChange, selectableMotionPerformers, selectedMotionPerformerId]);

    const selectedTransition = useMemo(() => {
        if (!selectedGap?.prevId) return null;
        return selectedGap.transition || {
            id: createTransitionId(selectedGap.prevId, selectedGap.nextId),
            fromFrameId: selectedGap.prevId,
            toFrameId: selectedGap.nextId,
            duration: selectedGap.duration,
            objectMotions: {},
        };
    }, [selectedGap]);

    const selectedMotion = useMemo<ObjectMotion>(() => {
        if (!selectedTransition || !selectedMotionPerformerId) return {};
        return selectedTransition.objectMotions[selectedMotionPerformerId] || {};
    }, [selectedMotionPerformerId, selectedTransition]);

    const formatTime = (ms: number) => {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        const dec = Math.floor((ms % 1000) / 100);
        return `${min}:${sec.toString().padStart(2, '0')}.${dec}`;
    };

    const selectedMarker = audioMarkers.find((marker) => marker.id === selectedMarkerId) || null;

    const updateMarker = (markerId: string, updates: Partial<AudioMarker>) => {
        onAudioMarkersChange(audioMarkers
            .map((marker) => marker.id === markerId ? { ...marker, ...updates } : marker)
            .sort((a, b) => a.timeMs - b.timeMs));
    };

    const addMarker = () => {
        const marker: AudioMarker = {
            id: typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `marker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            label: `标记 ${audioMarkers.length + 1}`,
            timeMs: Math.max(0, Math.min(duration, Math.round(currentTime))),
            color: '#3b82f6',
        };
        onAudioMarkersChange([...audioMarkers, marker].sort((a, b) => a.timeMs - b.timeMs));
        setSelectedMarkerId(marker.id);
    };

    const deleteMarker = (markerId: string) => {
        onAudioMarkersChange(audioMarkers.filter((marker) => marker.id !== markerId));
        setSelectedMarkerId(null);
    };

    const updateSelectedMotion = (updates: Partial<ObjectMotion>) => {
        if (!selectedTransition || !selectedMotionPerformerId) return;
        const nextMotion: ObjectMotion = {
            ...selectedMotion,
            ...updates,
        };
        onTransitionUpdate({
            ...selectedTransition,
            duration: selectedGap?.transition?.duration ?? selectedGap?.duration,
            objectMotions: {
                ...selectedTransition.objectMotions,
                [selectedMotionPerformerId]: nextMotion,
            },
        });
    };

    const updateControlPoint = (index: number, axis: keyof MotionControlPoint, value: number) => {
        if (!selectedTransition || !selectedMotionPerformerId || !selectedGapFrames) return;
        const start = selectedGapFrames.fromFrame.positions[selectedMotionPerformerId];
        const end = selectedGapFrames.toFrame.positions[selectedMotionPerformerId];
        if (!start || !end) return;
        const defaults: MotionControlPoint[] = getDefaultBezierControlPoints(start, end);
        const nextControlPoints = [...(selectedMotion.controlPoints || defaults)];
        nextControlPoints[index] = {
            ...nextControlPoints[index],
            [axis]: value,
        };
        updateSelectedMotion({ controlPoints: nextControlPoints });
    };

    const resetSelectedMotion = () => {
        if (!selectedGap?.transition || !selectedMotionPerformerId) return;
        const nextObjectMotions = { ...selectedGap.transition.objectMotions };
        delete nextObjectMotions[selectedMotionPerformerId];
        if (Object.keys(nextObjectMotions).length === 0) {
            onTransitionDelete(selectedGap.transition.id);
            return;
        }
        onTransitionUpdate({
            ...selectedGap.transition,
            objectMotions: nextObjectMotions,
        });
    };

    const rulerIntervalSeconds = useMemo(() => {
        const minimumLabelSpacing = 56;
        const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300];
        return candidates.find((seconds) => seconds * zoom >= minimumLabelSpacing)
            || candidates[candidates.length - 1];
    }, [zoom]);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (draggingState) return;
        e.currentTarget.setPointerCapture(e.pointerId);

        // Allow scrubbing anywhere on the timeline background
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
            const x = e.clientX - rect.left + (containerRef.current?.scrollLeft || 0);
            const time = Math.max(0, (x / zoom) * 1000);
            onSeek(time);
            setIsScrubbing(true);
        }
    };

    const handleFrameDragStart = (e: React.PointerEvent, frame: Frame, type: 'move' | 'resize') => {
        e.stopPropagation();
        e.preventDefault();
        if (editingId === frame.id) return; // prevent drag while editing
        e.currentTarget.setPointerCapture(e.pointerId);
        // Select frame on drag start
        onSelectTransition(null);
        onSelectFrame(frame.id);

        setDraggingState({
            id: frame.id,
            type,
            startX: e.clientX,
            originalStartTime: frame.startTime,
            originalDuration: frame.duration
        });
    };

    const onPointerMove = (e: React.PointerEvent) => {
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

    const onPointerUp = () => {
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
            className="relative flex-none bg-slate-950 border-t border-slate-800 flex flex-col select-none overflow-hidden"
            style={{ height: heightPx }}
            onPointerUp={onPointerUp}
            onPointerMove={onPointerMove}
            onPointerCancel={onPointerUp}
        >
            {/* Toolbar */}
            <div className="timeline-toolbar min-h-12 flex items-center gap-3 px-2 sm:px-4 bg-slate-900 border-b border-slate-800 justify-between z-20 relative overflow-hidden">
                <div className="flex items-center gap-2 min-w-max">
                    <button className="coarse-touch-target p-1.5 hover:bg-slate-800 rounded text-slate-400 flex items-center justify-center" onClick={() => onSeek(0)}><SkipBack size={16} /></button>
                    <button
                        className={`coarse-touch-target p-1.5 rounded text-white shadow-lg flex items-center gap-1 px-3 transition-colors ${isPlaying ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'}`}
                        onClick={onPlayPause}
                    >
                        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                        <span className="text-xs font-bold">{isPlaying ? '暂停' : '播放'}</span>
                    </button>
                    <span className="timeline-toolbar-time font-mono text-slate-300 ml-4 text-sm">{formatTime(currentTime)}</span>
                    <span className="desktop-only text-[10px] text-slate-500 ml-2">(空格键)</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-4 min-w-max">
                    <button
                        onClick={onAddFrame}
                        className="coarse-touch-target flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded border border-slate-700 text-slate-300"
                        title="在当前时间添加队形"
                    >
                        <PlusCircle size={12} /> 添加
                    </button>
                    <button
                        type="button"
                        onClick={addMarker}
                        className="coarse-touch-target flex items-center gap-1 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-xs text-blue-300 hover:bg-blue-500/20"
                        title="在当前播放头添加音频标记"
                    >
                        <Flag size={12} /> 标记
                    </button>
                    <div className="flex items-center gap-1">
                        <button className="coarse-touch-target p-1 hover:bg-slate-800 rounded text-slate-400 flex items-center justify-center" onClick={() => setZoom(Math.max(20, zoom - 20))}><ZoomOut size={14} /></button>
                        <div className="desktop-only w-20 h-1 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-slate-500" style={{ width: `${(zoom / 200) * 100}%` }}></div>
                        </div>
                        <button className="coarse-touch-target p-1 hover:bg-slate-800 rounded text-slate-400 flex items-center justify-center" onClick={() => setZoom(Math.min(200, zoom + 20))}><ZoomIn size={14} /></button>
                    <button
                        onClick={onExportVideo}
                        disabled={isExporting}
                        className={`text-xs ml-2 px-3 py-1 rounded border ${isExporting
                            ? 'bg-gray-500 text-white border-gray-500'
                            : 'bg-green-600 hover:bg-green-500 text-white border-green-500'
                            }`}
                        title={isExporting ? '导出中...' : '打开导出设置'}
                    >{isExporting ? '导出中…' : '导出视频'}</button>
                    {isExporting && (
                        <div className="flex items-center gap-2 ml-2">
                            <div className="w-32 h-2 bg-slate-700 rounded overflow-hidden">
                                <div className="h-2 bg-amber-500" style={{ width: `${Math.round((exportProgress || 0) * 100)}%` }} />
                            </div>
                            <span className="text-[11px] text-slate-300">
                                录制中 {typeof inPointMs === 'number' && typeof outPointMs === 'number'
                                    ? `${formatTime(Math.floor((exportProgress || 0) * (outPointMs - inPointMs)))} / ${formatTime(outPointMs - inPointMs)}`
                                    : ''}
                            </span>
                        </div>
                    )}
                </div>
                </div>
            </div>
            {/* Scrollable Timeline Area */}
            <div
                className={`timeline-scroll min-h-0 flex-1 overflow-x-auto max-[1100px]:overflow-x-hidden overflow-y-hidden relative custom-scrollbar bg-slate-950 ${isScrubbing ? 'cursor-col-resize' : 'cursor-default'}`}
                ref={containerRef}
                onPointerDown={handlePointerDown}
            >
                <div style={{ width: totalWidth, minWidth: '100%' }} className="h-full relative">

                    {/* Waveform Canvas Layer */}
                    <canvas
                        ref={canvasRef}
                        className="absolute top-0 left-0 h-full pointer-events-none opacity-100"
                        style={{ width: totalWidth, height: trackHeight }}
                    />

                    {/* Ruler */}
                    <div className="h-6 bg-slate-900/80 border-b border-slate-800 relative text-[10px] text-slate-500 z-10 pointer-events-none">
                        {Array.from({ length: Math.ceil(duration / 1000 / rulerIntervalSeconds) + 1 }).map((_, i) => (
                            <div key={i} className="absolute top-0 bottom-0 border-l border-slate-700 pl-1 select-none whitespace-nowrap" style={{ left: i * rulerIntervalSeconds * zoom }}>
                                {formatTime(i * rulerIntervalSeconds * 1000)}
                            </div>
                        ))}
                    </div>

                    {/* Audio markers */}
                    {audioMarkers.map((marker) => (
                        <button
                            key={marker.id}
                            type="button"
                            className="absolute top-0 bottom-0 z-40 w-3 -translate-x-1/2 cursor-pointer border-0 bg-transparent p-0"
                            style={{
                                left: (marker.timeMs / 1000) * zoom,
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                onSeek(marker.timeMs);
                                setSelectedMarkerId(marker.id);
                            }}
                            title={`${marker.label} · ${formatTime(marker.timeMs)}`}
                            aria-label={`跳转到标记 ${marker.label}`}
                        >
                            <span
                                className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2"
                                style={{ backgroundColor: marker.color }}
                            />
                            <span
                                className="absolute left-1/2 top-0 flex h-5 max-w-32 items-center gap-1 rounded-r px-1.5 text-[10px] font-semibold text-white shadow-md"
                                style={{ backgroundColor: marker.color }}
                            >
                                <Flag size={10} fill="currentColor" />
                                <span className="truncate">{marker.label}</span>
                            </span>
                        </button>
                    ))}

                    {/* Playhead */}
                    <div
                        className="absolute top-0 bottom-0 w-[1px] bg-amber-500 z-50 pointer-events-none"
                        style={{ left: (currentTime / 1000) * zoom }}
                    >
                        <div className="w-3 h-4 -ml-[5px] bg-amber-500 text-[8px] flex items-center justify-center text-black font-bold clip-path-arrow shadow-md"></div>
                        <div className="absolute top-0 left-0 h-full w-full bg-amber-500/20"></div>
                    </div>
                    {typeof inPointMs === 'number' && (
                        <div className="absolute top-0 bottom-0 w-[1px] bg-blue-400 z-40 pointer-events-none" style={{ left: (inPointMs / 1000) * zoom }} />
                    )}
                    {typeof outPointMs === 'number' && (
                        <div className="absolute top-0 bottom-0 w-[1px] bg-red-400 z-40 pointer-events-none" style={{ left: (outPointMs / 1000) * zoom }} />
                    )}
                    {typeof inPointMs === 'number' && typeof outPointMs === 'number' && outPointMs > inPointMs && (
                        <div className="absolute top-0 bottom-0 bg-green-500/10 z-30 pointer-events-none" style={{ left: (inPointMs / 1000) * zoom, width: ((outPointMs - inPointMs) / 1000) * zoom }} />
                    )}

                    {/* Frame Tracks - Vertically Centered */}
                    <div className="absolute top-6 bottom-0 left-0 right-0 flex items-center">

                        {/* Render Gaps (Transitions) */}
                        {gapSegments.map((gap, i) => (
                            <button
                                key={`gap-${i}`}
                                type="button"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    if (!gap.prevId) return;
                                    onSeek(gap.start + (gap.duration / 2));
                                    onSelectTransition(getGapSelectionId(gap));
                                }}
                                className={`absolute top-0 flex items-center justify-center overflow-hidden border transition-colors ${gap.prevId ? 'cursor-pointer' : 'cursor-not-allowed'} ${selectedTransitionId === getGapSelectionId(gap) ? 'border-blue-400 bg-blue-500/10' : gap.transition ? 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10' : 'border-slate-700/50 bg-transparent hover:bg-slate-800/30'}`}
                                style={{
                                    left: (gap.start / 1000) * zoom,
                                    width: (gap.duration / 1000) * zoom,
                                    height: clipHeight,
                                }}
                            >
                                <div className="w-full h-full relative opacity-30 pointer-events-none">
                                    <svg className="absolute inset-0 w-full h-full text-slate-500" preserveAspectRatio="none">
                                        <line x1="0" y1="0" x2="100%" y2="100%" stroke="currentColor" strokeWidth="1" />
                                        <line x1="0" y1="100%" x2="100%" y2="0" stroke="currentColor" strokeWidth="1" />
                                    </svg>
                                </div>
                                <div className="absolute text-[9px] font-mono text-slate-500 bg-slate-950/50 px-1 rounded pointer-events-none">
                                    {gap.transition ? '过渡' : '默认'} {(gap.duration / 1000).toFixed(1)}秒
                                </div>
                            </button>
                        ))}

                        {/* Render Frames */}
                        {frames.map((frame) => (
                            <div
                                key={frame.id}
                                className="absolute top-0 group"
                                style={{
                                    left: (frame.startTime / 1000) * zoom,
                                    height: clipHeight,
                                }}
                            >
                                <div
                                        onPointerDown={(e) => handleFrameDragStart(e, frame, 'move')}
                                        onClick={() => {
                                            onSelectTransition(null);
                                            onSelectFrame(frame.id);
                                        }}
                                        className={`timeline-clip relative h-full rounded-lg flex flex-col items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden transition-all border select-none shadow-lg
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
                                            className="absolute right-0 top-0 bottom-0 w-6 md:w-3 cursor-ew-resize hover:bg-blue-500/30 z-30 flex items-center justify-center group/handle touch-none"
                                            onPointerDown={(e) => handleFrameDragStart(e, frame, 'resize')}
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
            {selectedGap && selectedTransition && selectedGapFrames && (
                <div
                    className="absolute bottom-3 right-3 z-[70] w-[min(420px,calc(100vw-1.5rem))] rounded-xl border border-slate-700 bg-slate-900/98 p-3 shadow-2xl"
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <div className="mb-3 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-semibold text-slate-100">
                                过渡编辑
                            </div>
                            <div className="text-[11px] text-slate-400">
                                {selectedGapFrames.fromFrame.name} {'->'} {selectedGapFrames.toFrame.name} · {(selectedGap.duration / 1000).toFixed(1)} 秒
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => onSelectTransition(null)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                            aria-label="关闭过渡编辑"
                        >
                            <X size={15} />
                        </button>
                    </div>
                    {selectableMotionPerformers.length === 0 ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-400">
                            当前过渡没有同时存在于前后队形的对象，无法配置路径和旋转。
                        </div>
                    ) : (
                        <>
                            <div className="mb-3 max-h-24 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-1.5">
                                <div className="grid grid-cols-2 gap-1">
                                    {selectableMotionPerformers.map((performer) => {
                                        const motion = selectedTransition.objectMotions[performer.id];
                                        const selected = performer.id === selectedMotionPerformerId;
                                        return (
                                            <button
                                                key={performer.id}
                                                type="button"
                                                data-motion-id={performer.id}
                                                onPointerDown={(event) => {
                                                    event.stopPropagation();
                                                    onSelectedMotionPerformerChange(event.currentTarget.dataset.motionId || performer.id);
                                                }}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onSelectedMotionPerformerChange(event.currentTarget.dataset.motionId || performer.id);
                                                }}
                                                className={`flex items-center justify-between rounded px-2 py-1.5 text-left text-[11px] ${selected ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                                            >
                                                <span className="truncate">{performer.name}</span>
                                                <span className="ml-2 shrink-0 text-[9px] opacity-75">
                                                    {motion?.pathType === 'bezier' ? '曲线' : '直线'}
                                                    {performer.type === 'prop' ? ` · ${motion?.rotationMode === 'fixed' ? '固定' : '旋转'}` : ''}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="text-[10px] text-slate-400">
                                    路径
                                    <select
                                        value={selectedMotion.pathType || 'linear'}
                                        onChange={(event) => updateSelectedMotion({
                                            pathType: event.target.value as 'linear' | 'bezier',
                                            controlPoints: event.target.value === 'bezier' ? (selectedMotion.controlPoints || undefined) : undefined,
                                        })}
                                        className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                                    >
                                        <option value="linear">直线</option>
                                        <option value="bezier">Bezier</option>
                                    </select>
                                </label>
                                <label className="text-[10px] text-slate-400">
                                    旋转模式
                                    <select
                                        value={selectedMotion.rotationMode || 'lerp'}
                                        onChange={(event) => updateSelectedMotion({ rotationMode: event.target.value as 'fixed' | 'lerp' })}
                                        className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                                    >
                                        <option value="lerp">旋转插值</option>
                                        <option value="fixed">固定朝向</option>
                                    </select>
                                </label>
                                <div className="flex items-end">
                                    <button
                                        type="button"
                                        onClick={resetSelectedMotion}
                                        disabled={!selectedGap.transition || !selectedMotionPerformerId || !selectedGap.transition.objectMotions[selectedMotionPerformerId]}
                                        className="h-9 w-full rounded-md border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        重置当前对象
                                    </button>
                                </div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                <label className="text-[10px] text-slate-400">
                                    起始队形角度
                                    <EditableNumberInput
                                        step={1}
                                        value={selectedMotionPerformerId
                                            ? selectedGapFrames.fromFrame.rotations?.[selectedMotionPerformerId]
                                                ?? selectableMotionPerformers.find((item) => item.id === selectedMotionPerformerId)?.rotation
                                                ?? 0
                                            : 0}
                                        onChange={(value) => {
                                            if (selectedMotionPerformerId) {
                                                onFrameRotationChange(selectedGapFrames.fromFrame.id, selectedMotionPerformerId, value);
                                            }
                                        }}
                                        className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-slate-100 outline-none focus:border-blue-500"
                                    />
                                </label>
                                <label className="text-[10px] text-slate-400">
                                    目标队形角度
                                    <EditableNumberInput
                                        step={1}
                                        value={selectedMotionPerformerId
                                            ? selectedGapFrames.toFrame.rotations?.[selectedMotionPerformerId]
                                                ?? selectableMotionPerformers.find((item) => item.id === selectedMotionPerformerId)?.rotation
                                                ?? 0
                                            : 0}
                                        onChange={(value) => {
                                            if (selectedMotionPerformerId) {
                                                onFrameRotationChange(selectedGapFrames.toFrame.id, selectedMotionPerformerId, value);
                                            }
                                        }}
                                        className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-slate-100 outline-none focus:border-blue-500"
                                    />
                                </label>
                            </div>
                            {(selectedMotion.pathType || 'linear') === 'bezier' && (
                                <div className="mt-3 grid grid-cols-2 gap-3">
                                    {[0, 1].map((index) => (
                                        <div key={index} className="rounded-lg border border-slate-800 bg-slate-950/80 p-2">
                                            <div className="mb-2 text-[10px] font-medium text-slate-300">控制点 {index + 1}</div>
                                            <div className="grid grid-cols-3 gap-2">
                                                {(['x', 'y', 'z'] as const).map((axis) => (
                                                    <label key={axis} className="text-[10px] text-slate-500">
                                                        {axis.toUpperCase()}
                                                        <EditableNumberInput
                                                            step={0.1}
                                                            value={selectedMotion.controlPoints?.[index]?.[axis] ?? 0}
                                                            onChange={(value) => updateControlPoint(index, axis, value)}
                                                            className="mt-1 h-8 w-full rounded border border-slate-700 bg-slate-900 px-2 font-mono text-[11px] text-slate-100 outline-none focus:border-blue-500"
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
            {selectedMarker && (
                <div
                    className="absolute bottom-3 left-1/2 z-[70] w-[min(360px,calc(100vw-1.5rem))] -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-900/98 p-3 shadow-2xl"
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                            <Flag size={15} style={{ color: selectedMarker.color }} />
                            编辑音频标记
                        </div>
                        <button
                            type="button"
                            onClick={() => setSelectedMarkerId(null)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                            aria-label="关闭标记编辑"
                        >
                            <X size={15} />
                        </button>
                    </div>
                    <div className="grid grid-cols-[1fr_110px_44px] gap-2">
                        <label className="text-[10px] text-slate-400">
                            名称
                            <input
                                value={selectedMarker.label}
                                maxLength={80}
                                onChange={(event) => updateMarker(selectedMarker.id, { label: event.target.value })}
                                onBlur={(event) => {
                                    if (!event.target.value.trim()) {
                                        updateMarker(selectedMarker.id, { label: '未命名标记' });
                                    }
                                }}
                                className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                            />
                        </label>
                        <label className="text-[10px] text-slate-400">
                            时间（秒）
                            <input
                                type="number"
                                min={0}
                                max={Math.max(0, duration / 1000)}
                                step={0.1}
                                value={selectedMarker.timeMs / 1000}
                                onChange={(event) => {
                                    const seconds = Number(event.target.value);
                                    if (Number.isFinite(seconds)) {
                                        updateMarker(selectedMarker.id, {
                                            timeMs: Math.max(0, Math.min(duration, Math.round(seconds * 1000))),
                                        });
                                    }
                                }}
                                className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-slate-100 outline-none focus:border-blue-500"
                            />
                        </label>
                        <label className="text-[10px] text-slate-400">
                            颜色
                            <input
                                type="color"
                                value={selectedMarker.color}
                                onChange={(event) => updateMarker(selectedMarker.id, { color: event.target.value })}
                                className="mt-1 h-9 w-11 cursor-pointer rounded-md border border-slate-700 bg-slate-950 p-1"
                            />
                        </label>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                        <button
                            type="button"
                            onClick={() => onSeek(selectedMarker.timeMs)}
                            className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                        >
                            跳转到 {formatTime(selectedMarker.timeMs)}
                        </button>
                        <button
                            type="button"
                            onClick={() => deleteMarker(selectedMarker.id)}
                            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                        >
                            <Trash2 size={13} /> 删除标记
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
