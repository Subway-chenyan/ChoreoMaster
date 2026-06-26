import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  AudioMarker,
  Frame,
  MotionControlPoint,
  Performer,
  Position,
  PerformerShape,
  PerformerGroup,
  PerformerType,
  AIConfig,
  AIChoreoPlan,
  ObjectMotion,
  ProjectDocument,
  ProjectLoadResult,
  PropRotationPivot,
  TransitionSegment,
  normalizeFrames,
  normalizePerformers,
  normalizeTransitions,
} from './types';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';
import Stage3D from './components/Stage3D';
import { Timeline } from './components/Timeline';
import { EditableNumberInput } from './components/FormControls';
import { HelpModal } from './components/HelpModal';
import { ProductGuide } from './components/ProductGuide';
import { useTheme } from './contexts/ThemeContext';
import { DEFAULT_COLORS, STAGE_ASPECT_RATIO } from './constants';
import { createOfflineScene, preloadPropTextures, preloadLEDVideo, type CameraAngle } from './utils/OfflineRenderer3D';
import { getTotalStageWidth, getWingWidth, stageXToViewPercent, getStageXBounds } from './utils/coordinates';
import { buildPlatformOccupancy, isPlatformProp } from './utils/platforms';
import {
  createCenteredStageGridMarks,
  DEFAULT_STAGE_GRID_SPACING,
  formatStageGridLabel,
  normalizeStageGridSpacing,
  STAGE_THIRD_POSITIONS,
} from './utils/stage-grid';
import { ZoomIn, ZoomOut, Type, PlusCircle, MinusCircle, HelpCircle, ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen, X, GripHorizontal, SlidersHorizontal, BookOpen, MessageCircle } from 'lucide-react';
import { StageConfig } from './types';
import {
  evaluateSceneStateAtTime,
  getGapSegments,
  getGapSelectionId,
  getDefaultBezierControlPoints,
  getSortedFrames,
} from './utils/transitions';
import { getPropCenterFromAnchor, migratePropAnchor } from './utils/prop-pivot';

const DEFAULT_FRAME: Frame = {
  id: 'start-frame',
  name: 'Opening',
  startTime: 0,
  duration: 2000,
  positions: {},
  rotations: {},
};

const createDefaultStageConfig = (): StageConfig => ({
  width: 20,
  depth: 20 / (16 / 9),
  wingWidth: 4,
  ledWidth: 20,
  ledHeight: 6,
  ledContent: { type: 'none' },
});

const normalizeAudioMarkers = (value: unknown): AudioMarker[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item !== 'object' || item === null) return [];
    const candidate = item as Partial<AudioMarker>;
    if (typeof candidate.timeMs !== 'number' || !Number.isFinite(candidate.timeMs)) return [];
    return [{
      id: typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id
        : `marker-${index}-${Math.round(candidate.timeMs)}`,
      label: typeof candidate.label === 'string' && candidate.label.trim()
        ? candidate.label.trim().slice(0, 80)
        : `标记 ${index + 1}`,
      timeMs: Math.max(0, Math.round(candidate.timeMs)),
      color: typeof candidate.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(candidate.color)
        ? candidate.color
        : '#3b82f6',
    }];
  }).sort((a, b) => a.timeMs - b.timeMs);
};

// Clipboard Item Structure
interface ClipboardItem {
  performer: Performer;
  positions: Record<string, Position>; // Map FrameID -> Position
}

type MovePerformersUndoAction = {
  type: 'move-performers';
  frameId: string;
  performerIds: string[];
  before: Record<string, Position>;
  after: Record<string, Position>;
};

type PastePerformersUndoAction = {
  type: 'paste-performers';
  performers: Performer[];
  frameUpdates: Record<string, Record<string, Position>>;
  previousSelectedIds: string[];
};

type PasteFrameUndoAction = {
  type: 'paste-frame';
  frame: Frame;
  previousCurrentFrameId: string | null;
};

type RotatePerformerUndoAction = {
  type: 'rotate-performer';
  frameId: string;
  performerId: string;
  before: number;
  after: number;
};

type UndoAction = MovePerformersUndoAction | PastePerformersUndoAction | PasteFrameUndoAction | RotatePerformerUndoAction;

const getSupportedVideoEncoderConfig = async (
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<VideoEncoderConfig | null> => {
  const level = width >= 3840 ? '33' : width >= 2560 ? '32' : '28';
  const configs: VideoEncoderConfig[] = [
    {
      codec: `avc1.4200${level}`,
      width,
      height,
      bitrate,
      framerate: fps,
    },
    {
      codec: `avc1.6400${level}`,
      width,
      height,
      bitrate,
      bitrateMode: 'constant',
      framerate: fps,
    },
  ];

  for (const config of configs) {
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return support.config;
    } catch (error) {
      console.warn('Video encoder configuration probe failed:', error);
    }
  }

  return null;
};

type MediaRecorderExportFormat = {
  mimeType: string;
  extension: 'mp4' | 'webm';
  description: string;
};

const MEDIA_RECORDER_EXPORT_FORMATS: MediaRecorderExportFormat[] = [
  {
    mimeType: 'video/mp4;codecs=avc1.42001E,mp4a.40.2',
    extension: 'mp4',
    description: 'MP4 video',
  },
  {
    mimeType: 'video/mp4;codecs=avc1.42001E',
    extension: 'mp4',
    description: 'MP4 video',
  },
  {
    mimeType: 'video/mp4',
    extension: 'mp4',
    description: 'MP4 video',
  },
  {
    mimeType: 'video/webm;codecs=vp9,opus',
    extension: 'webm',
    description: 'WebM video',
  },
  {
    mimeType: 'video/webm;codecs=vp8,opus',
    extension: 'webm',
    description: 'WebM video',
  },
  {
    mimeType: 'video/webm',
    extension: 'webm',
    description: 'WebM video',
  },
];

const getMediaRecorderExportFormats = (): MediaRecorderExportFormat[] => {
  const supportedFormats = MEDIA_RECORDER_EXPORT_FORMATS.filter(({ mimeType }) => MediaRecorder.isTypeSupported(mimeType));
  return supportedFormats.length > 0
    ? supportedFormats
    : [MEDIA_RECORDER_EXPORT_FORMATS[MEDIA_RECORDER_EXPORT_FORMATS.length - 1]];
};

const getMediaRecorderExportFormat = (): MediaRecorderExportFormat => {
  return getMediaRecorderExportFormats()[0];
};

type StartedMediaRecorder = {
  recorder: MediaRecorder;
  format: MediaRecorderExportFormat;
};

const startMediaRecorderWithFallback = (
  stream: MediaStream,
  formats: MediaRecorderExportFormat[],
  timesliceMs: number,
): StartedMediaRecorder => {
  let lastError: unknown = null;
  const bitrateOptions: Array<number | undefined> = [5_000_000, 2_500_000, undefined];

  for (const format of formats) {
    for (const videoBitsPerSecond of bitrateOptions) {
      try {
        const options: MediaRecorderOptions = videoBitsPerSecond == null
          ? { mimeType: format.mimeType }
          : { mimeType: format.mimeType, videoBitsPerSecond };
        const recorder = new MediaRecorder(stream, options);
        recorder.start(timesliceMs);
        return { recorder, format };
      } catch (error) {
        lastError = error;
        console.warn('MediaRecorder configuration failed:', { mimeType: format.mimeType, videoBitsPerSecond, error });
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('MediaRecorder 没有可用的录制编码配置');
};

const App: React.FC = () => {
  // State
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [performerGroups, setPerformerGroups] = useState<PerformerGroup[]>([]);
  const [frames, setFrames] = useState<Frame[]>([DEFAULT_FRAME]);
  const [transitions, setTransitions] = useState<TransitionSegment[]>([]);
  const [currentFrameId, setCurrentFrameId] = useState<string>(DEFAULT_FRAME.id);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [selectedTransitionPerformerId, setSelectedTransitionPerformerId] = useState<string | null>(null);
  const [selectedPerformerIds, setSelectedPerformerIds] = useState<string[]>([]);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [musicName, setMusicName] = useState<string | null>(null);
  const [musicAsset, setMusicAsset] = useState<string | null>(null);
  const [audioMarkers, setAudioMarkers] = useState<AudioMarker[]>([]);
  const [inPointMs, setInPointMs] = useState<number | null>(null);
  const [outPointMs, setOutPointMs] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportIncludeLabels, setExportIncludeLabels] = useState<boolean>(true);
  const [exportIncludeGrid, setExportIncludeGrid] = useState<boolean>(true);
  const [exportResolution, setExportResolution] = useState<'1080p' | '2k' | '4k'>('1080p');
  const [exportCameraAngle, setExportCameraAngle] = useState<CameraAngle>('judge');
  const [showExportModal, setShowExportModal] = useState(false);
  const [export2D, setExport2D] = useState(true);
  const [export3D, setExport3D] = useState(false);

  // Stage View State
  const [showLabels, setShowLabels] = useState(true);
  const [gridScale, setGridScale] = useState(DEFAULT_STAGE_GRID_SPACING);
  const [showHelp, setShowHelp] = useState(false);
  const [showProductGuide, setShowProductGuide] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [stageToolbarCollapsed, setStageToolbarCollapsed] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  const [sidebarWidth, setSidebarWidth] = useState<number>(320);
  const [timelineHeight, setTimelineHeight] = useState<number>(() => (
    window.matchMedia('(max-width: 1100px)').matches ? 132 : 180
  ));
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const previousTimelineHeightRef = useRef(180);
  const [isCompactLayout, setIsCompactLayout] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const pendingMoveUndoRef = useRef<{
    frameId: string;
    performerIds: string[];
    before: Record<string, Position>;
  } | null>(null);
  const pendingRotationUndoRef = useRef<{
    frameId: string;
    performerId: string;
    before: number;
  } | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const syncLayout = () => {
      setIsCompactLayout(media.matches);
      if (media.matches) {
        setTimelineHeight((height) => height === 180 ? 132 : Math.min(height, 320));
        setStageToolbarCollapsed(true);
      }
    };
    syncLayout();
    media.addEventListener('change', syncLayout);
    return () => media.removeEventListener('change', syncLayout);
  }, []);

  // 新增：3D 模式相关状态
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [stageConfig, setStageConfig] = useState<StageConfig>(createDefaultStageConfig);
  const [mediaCache, setMediaCache] = useState<Record<string, string>>({});
  
  // Project storage state
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const [projectHasChanges, setProjectHasChanges] = useState(false);
  const [lastSavedState, setLastSavedState] = useState<string>('');
  const [projectMessages, setProjectMessages] = useState<string[]>([]);
  
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
    const saved = localStorage.getItem('choreo-ai-config');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        backendUrl: parsed.backendUrl || import.meta.env.VITE_AI_BACKEND_URL || 'http://localhost:8000',
        memberToken: parsed.memberToken || import.meta.env.VITE_MEMBER_TOKEN || '',
      };
    }
    return {
      backendUrl: import.meta.env.VITE_AI_BACKEND_URL || 'http://localhost:8000',
      memberToken: import.meta.env.VITE_MEMBER_TOKEN || ''
    };
  });

  useEffect(() => {
    localStorage.setItem('choreo-ai-config', JSON.stringify(aiConfig));
  }, [aiConfig]);

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

  const createGridPosition = (index: number, count: number): Position => {
    const cols = Math.ceil(Math.sqrt(Math.max(count, 1)));
    const rows = Math.ceil(count / cols);
    const spreadX = Math.min(70, Math.max(20, cols * 12));
    const spreadY = Math.min(70, Math.max(20, rows * 12));
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      x: 50 - spreadX / 2 + (cols > 1 ? (spreadX / (cols - 1)) * col : spreadX / 2),
      y: 50 - spreadY / 2 + (rows > 1 ? (spreadY / (rows - 1)) * row : spreadY / 2),
    };
  };

  const buildProjectDocument = useCallback((name: string = ''): ProjectDocument => ({
    version: '3.0',
    name,
    performers,
    performerGroups,
    frames,
    transitions,
    audioMarkers,
    stageConfig,
    musicName,
    musicAsset,
  }), [
    performers,
    performerGroups,
    frames,
    transitions,
    audioMarkers,
    stageConfig,
    musicName,
    musicAsset,
  ]);

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

  const computeSceneStateAtTime = useCallback((timeMs: number) => (
    evaluateSceneStateAtTime(timeMs, frames, performers, transitions)
  ), [frames, performers, transitions]);

  const currentSceneState = useMemo(() => (
    computeSceneStateAtTime(currentTime)
  ), [computeSceneStateAtTime, currentTime]);

  const activeHiddenGroupIds = currentSceneState.hiddenGroupIds;

  const computePositionsAtTime = useCallback((timeMs: number) => (
    computeSceneStateAtTime(timeMs).positions
  ), [computeSceneStateAtTime]);

  const clonePositionMap = (positionsMap: Record<string, Position>): Record<string, Position> => (
    Object.fromEntries(
      Object.entries(positionsMap).map(([id, pos]) => [id, { ...pos }])
    )
  );

  const positionsEqual = (a: Position | undefined, b: Position | undefined) => (
    a?.x === b?.x && a?.y === b?.y && a?.z === b?.z
  );

  const pushUndoAction = useCallback((action: UndoAction) => {
    setUndoStack((prev) => [...prev, action]);
    setRedoStack([]);
  }, []);

  const removePerformerIdsFromFrames = useCallback((targetIds: string[]) => {
    const idSet = new Set(targetIds);
    setFrames((prev) => prev.map((frame) => {
      let changed = false;
      const nextPositions = { ...frame.positions } as Record<string, Position>;
      const nextRotations = { ...(frame.rotations ?? {}) };
      Object.keys(nextPositions).forEach((performerId) => {
        if (idSet.has(performerId)) {
          delete nextPositions[performerId];
          delete nextRotations[performerId];
          changed = true;
        }
      });
      return changed ? { ...frame, positions: nextPositions, rotations: nextRotations } : frame;
    }));
  }, []);

  const restoreFrameUpdates = useCallback((frameUpdates: Record<string, Record<string, Position>>) => {
    setFrames((prev) => prev.map((frame) => {
      const updates = frameUpdates[frame.id];
      if (!updates) return frame;
      return {
        ...frame,
        positions: { ...frame.positions, ...clonePositionMap(updates) }
      };
    }));
  }, []);

  const createFrameCopy = useCallback((source: Frame, overrides?: Partial<Frame>): Frame => ({
    ...source,
    id: overrides?.id ?? generateId(),
    name: overrides?.name ?? source.name,
    startTime: overrides?.startTime ?? source.startTime,
    duration: overrides?.duration ?? source.duration,
    positions: JSON.parse(JSON.stringify(overrides?.positions ?? source.positions)),
    rotations: { ...(overrides?.rotations ?? source.rotations ?? {}) },
  }), []);

  const writeBlobToElectronPath = useCallback(async (filePath: string, blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await window.electronAPI.writeBinaryFile(filePath, bytes);
  }, []);

  const requestElectronExportPath = useCallback(async (
    baseName: string,
    extension: 'mp4' | 'webm'
  ): Promise<string | null> => {
    if (!window.electronAPI?.isElectron) return null;
    return window.electronAPI.saveFile(`${baseName}.${extension}`, [
      { name: extension === 'mp4' ? 'MP4 Video' : 'WebM Video', extensions: [extension] },
      { name: 'All Files', extensions: ['*'] },
    ]);
  }, []);

  const downloadBlob = useCallback((blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const withTimeout = useCallback(async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs);
      promise.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          window.clearTimeout(timer);
          reject(error);
        }
      );
    });
  }, []);

  const getExportVideoTime = useCallback((video: HTMLVideoElement, timelineTimeSec: number, shouldLoop: boolean) => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, timelineTimeSec);
    if (shouldLoop) return timelineTimeSec % duration;
    return Math.min(Math.max(0, timelineTimeSec), Math.max(0, duration - 0.001));
  }, []);

  const create2DExportLedRenderer = useCallback(async () => {
    const ledContent = stageConfig.ledContent;
    if (!ledContent || ledContent.type === 'none' || !ledContent.value) {
      return null;
    }

    if (ledContent.type === 'color') {
      return {
        draw: async (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => {
          ctx.fillStyle = ledContent.value!;
          ctx.fillRect(x, y, width, height);
        },
        dispose: () => {},
      };
    }

    const assetUrl = mediaCache[ledContent.value];
    if (!assetUrl) return null;

    if (ledContent.type === 'image') {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = reject;
        image.src = assetUrl;
      });
      return {
        draw: async (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => {
          ctx.drawImage(image, x, y, width, height);
        },
        dispose: () => {},
      };
    }

    if (ledContent.type === 'video') {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.src = assetUrl;
      video.loop = ledContent.loop ?? true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      await new Promise<void>((resolve) => {
        const onReady = () => {
          video.removeEventListener('loadedmetadata', onReady);
          video.removeEventListener('loadeddata', onReady);
          resolve();
        };
        video.addEventListener('loadedmetadata', onReady, { once: true });
        video.addEventListener('loadeddata', onReady, { once: true });
        window.setTimeout(resolve, 3000);
        video.load();
      });

      return {
        draw: async (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, timeMs: number) => {
          if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
          const desired = getExportVideoTime(video, timeMs / 1000, video.loop);
          if (Math.abs(video.currentTime - desired) > 0.03) {
            await new Promise<void>((resolve) => {
              const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                resolve();
              };
              video.addEventListener('seeked', onSeeked, { once: true });
              window.setTimeout(() => {
                video.removeEventListener('seeked', onSeeked);
                resolve();
              }, 250);
              try {
                video.currentTime = desired;
              } catch {
                resolve();
              }
            });
          }
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            ctx.drawImage(video, x, y, width, height);
          }
        },
        dispose: () => {
          video.pause();
          video.removeAttribute('src');
          video.load();
        },
      };
    }

    return null;
  }, [getExportVideoTime, mediaCache, stageConfig.ledContent]);

  // --- Actions ---

  const handleAddPerformer = (name: string, color: string, shape: PerformerShape, extra?: Partial<Performer>) => {
    const newPerformer: Performer = {
      id: generateId(),
      name,
      color,
      label: name.charAt(0).toUpperCase(),
      shape,
      type: extra?.type || 'performer',
      propCategory: extra?.type === 'prop' ? (extra.propCategory ?? 'prop') : undefined,
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
        positions: { ...f.positions, [newPerformer.id]: { x: 50, y: 50 } },
        rotations: { ...(f.rotations ?? {}), [newPerformer.id]: newPerformer.rotation ?? 0 },
      };
    }));
  };

  const handleRemovePerformer = (id: string) => {
    setPerformers(performers.filter(p => p.id !== id));
    setSelectedPerformerIds(selectedPerformerIds.filter(pid => pid !== id));
    setTransitions((prev) => prev.map((transition) => {
      if (!transition.objectMotions[id]) return transition;
      const nextObjectMotions = { ...transition.objectMotions };
      delete nextObjectMotions[id];
      return { ...transition, objectMotions: nextObjectMotions };
    }));
  };

  const handleUpdatePerformer = (id: string, updates: Partial<Performer>) => {
    const performer = performers.find((item) => item.id === id);
    if (!performer) return;
    const oldPivot = performer.rotationPivot ?? 'center';
    const requestedPivot = updates.rotationPivot ?? oldPivot;
    const newPivot: PropRotationPivot = performer.propCategory === 'platform' || updates.propCategory === 'platform'
      ? 'center'
      : requestedPivot;

    if (oldPivot !== newPivot && performer.type === 'prop') {
      const nextPerformer = { ...performer, ...updates, rotationPivot: newPivot };
      const frameById = new Map(frames.map((frame) => [frame.id, frame]));
      setFrames((previousFrames) => previousFrames.map((frame) => {
        const position = frame.positions[id];
        if (!position) return frame;
        const rotation = frame.rotations?.[id] ?? performer.rotation ?? 0;
        return {
          ...frame,
          positions: {
            ...frame.positions,
            [id]: migratePropAnchor(position, rotation, nextPerformer, oldPivot, newPivot, stageConfig),
          },
        };
      }));
      setTransitions((previousTransitions) => previousTransitions.map((transition) => {
        const motion = transition.objectMotions[id];
        if (!motion?.controlPoints?.length) return transition;
        const fromFrame = frameById.get(transition.fromFrameId);
        const toFrame = frameById.get(transition.toFrameId);
        const startRotation = fromFrame?.rotations?.[id] ?? performer.rotation ?? 0;
        const endRotation = toFrame?.rotations?.[id] ?? performer.rotation ?? 0;
        const controlPoints = motion.controlPoints.map((point, index, points) => {
          const progress = (index + 1) / (points.length + 1);
          const rotation = startRotation + ((endRotation - startRotation) * progress);
          return migratePropAnchor(point, rotation, nextPerformer, oldPivot, newPivot, stageConfig);
        });
        return {
          ...transition,
          objectMotions: {
            ...transition.objectMotions,
            [id]: { ...motion, controlPoints },
          },
        };
      }));
    }
    setPerformers(prev => prev.map(p => p.id === id ? { ...p, ...updates, rotationPivot: newPivot } : p));
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
  const handleLEDContentUpload = async (e?: React.ChangeEvent<HTMLInputElement>) => {
    if (window.electronAPI?.isElectron) {
      if (!currentProjectId) {
        setProjectMessages(['请先新建或打开一个项目，再导入背景资源']);
        return;
      }
      const sourcePath = await window.electronAPI.openFile([
        { name: 'Image and Video', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov'] },
      ]);
      if (!sourcePath) return;
      const asset = await window.electronAPI.project.ingestAsset(currentProjectId, sourcePath, 'background');
      const extension = asset.displayName.split('.').pop()?.toLowerCase() || '';
      const type = ['mp4', 'webm', 'mov'].includes(extension) ? 'video' : 'image';
      setMediaCache({ [asset.relativePath]: asset.url });
      setStageConfig(prev => ({
        ...prev,
        ledContent: { type, value: asset.relativePath, loop: true },
      }));
      setProjectMessages(['背景资源已复制到项目']);
      return;
    }

    const file = e?.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const fileName = `led_${Date.now()}_${file.name}`;
    const previousValue = stageConfig.ledContent?.value;

    setMediaCache(prev => {
      const next = { ...prev, [fileName]: url };
      if (previousValue && next[previousValue]) {
        if (next[previousValue].startsWith('blob:')) URL.revokeObjectURL(next[previousValue]);
        delete next[previousValue];
      }
      return next;
    });

    const type = file.type.startsWith('video') ? 'video' : 'image';
    setStageConfig(prev => ({
      ...prev,
      ledContent: { type, value: fileName, loop: true }
    }));
    if (e) e.target.value = '';
  };

  // 清除 LED 内容
  const handleClearLEDContent = () => {
    const previousValue = stageConfig.ledContent?.value;
    if (previousValue) {
      setMediaCache(prev => {
        if (!prev[previousValue]) return prev;
        if (prev[previousValue].startsWith('blob:')) URL.revokeObjectURL(prev[previousValue]);
        const next = { ...prev };
        delete next[previousValue];
        return next;
      });
    }
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

  const applyLoadedProject = useCallback(async (projectId: string, result: ProjectLoadResult) => {
    const { data, projectPath, audioUrl, mediaUrls, warnings } = result;
    setCurrentProjectId(projectId);
    setCurrentProjectPath(projectPath);
    setPerformers(data.performers);
    setPerformerGroups(data.performerGroups);
    setFrames(data.frames);
    setTransitions(data.transitions || []);
    setAudioMarkers(data.audioMarkers || []);
    setMusicName(data.musicName || null);
    setMusicAsset(data.musicAsset || null);
    setStageConfig(data.stageConfig);
    setMediaCache(mediaUrls);
    setCurrentTime(0);
    setAudioBuffer(null);
    setMusicUrl(audioUrl);
    setSelectedPerformerIds([]);
    setSelectedTransitionId(null);
    setSelectedTransitionPerformerId(null);
    if (data.frames.length > 0) {
      setCurrentFrameId(data.frames[0].id);
    }

    const messages = warnings.map((warning) => warning.message);
    if (audioUrl && audioContextRef.current) {
      try {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setAudioBuffer(await audioContextRef.current.decodeAudioData(await response.arrayBuffer()));
      } catch (error) {
        console.error('Failed to restore project audio:', error);
        messages.push(`音频无法解码：${data.musicName || data.musicAsset || '未知音频'}`);
      }
    }

    setLastSavedState(JSON.stringify({
      performers: data.performers,
      performerGroups: data.performerGroups,
      frames: data.frames,
      transitions: data.transitions || [],
      audioMarkers: data.audioMarkers || [],
      stageConfig: data.stageConfig,
      musicName: data.musicName || null,
      musicAsset: data.musicAsset || null,
    }));
    setProjectHasChanges(false);
    setProjectMessages(messages.length > 0 ? messages : ['项目已完整恢复']);
  }, []);

  // Get current project state as JSON string for comparison
  const getProjectStateString = useCallback(() => {
    return JSON.stringify({
      performers,
      performerGroups,
      frames,
      transitions,
      audioMarkers,
      stageConfig,
      musicName,
      musicAsset,
    });
  }, [performers, performerGroups, frames, transitions, audioMarkers, stageConfig, musicName, musicAsset]);

  // Track changes to project
  useEffect(() => {
    if (currentProjectId && lastSavedState) {
      const currentState = getProjectStateString();
      setProjectHasChanges(currentState !== lastSavedState);
    }
  }, [performers, performerGroups, frames, transitions, audioMarkers, stageConfig, musicName, musicAsset, currentProjectId, lastSavedState, getProjectStateString]);

  // Create a new project
  const handleCreateProject = async (name: string): Promise<string> => {
    if (!window.electronAPI?.isElectron) return '';
    
    // Auto-save current project before creating new one
    if (currentProjectId && projectHasChanges) {
      try {
        const projectData = buildProjectDocument();
        await window.electronAPI.project.save(currentProjectId, projectData);
        console.log('Auto-saved current project before creating new');
      } catch (error) {
        console.error('Failed to auto-save before creating:', error);
        setProjectMessages(['当前项目自动保存失败，已取消新建项目']);
        return '';
      }
    }
    
    try {
      const { id, path } = await window.electronAPI.project.create(name);
      setCurrentProjectId(id);
      setCurrentProjectPath(path);
      
      // Reset to fresh state
      const newFrameId = generateId();
      const newFrames: Frame[] = [{
        id: newFrameId,
        name: 'Opening',
        startTime: 0,
        duration: 2000,
        positions: {},
        rotations: {},
      }];
      const newStageConfig = createDefaultStageConfig();
      setPerformers([]);
      setPerformerGroups([]);
      setFrames(newFrames);
      setTransitions([]);
      setAudioMarkers([]);
      setCurrentFrameId(newFrameId);
      setSelectedTransitionId(null);
      setSelectedTransitionPerformerId(null);
      setStageConfig(newStageConfig);
      setMediaCache({});
      setMusicName(null);
      setMusicAsset(null);
      setAudioBuffer(null);
      setMusicUrl(null);
      setCurrentTime(0);
      setSelectedPerformerIds([]);
      
      // Mark as saved
      setLastSavedState(JSON.stringify({
        performers: [],
        performerGroups: [],
        frames: newFrames,
        transitions: [],
        audioMarkers: [],
        stageConfig: newStageConfig,
        musicName: null,
        musicAsset: null,
      }));
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
        const projectData = buildProjectDocument();
        await window.electronAPI.project.save(currentProjectId, projectData);
      } catch (error) {
        console.error('Failed to auto-save before creating template project:', error);
        setProjectMessages(['当前项目自动保存失败，已取消创建模板项目']);
        return '';
      }
    }

    try {
      const name = templateData.name || '教学示例';
      const { id, path } = await window.electronAPI.project.create(name);

      // Save template data into the new project
      const saveData: ProjectDocument = {
        version: '3.0',
        name: '',
        performers: normalizePerformers(templateData.performers),
        performerGroups: templateData.performerGroups || [],
        frames: normalizeFrames(templateData.frames),
        transitions: normalizeTransitions(templateData.transitions),
        audioMarkers: normalizeAudioMarkers(templateData.audioMarkers),
        stageConfig: templateData.stageConfig || stageConfig,
        musicName: null,
        musicAsset: null,
      };
      await window.electronAPI.project.save(id, saveData);

      setCurrentProjectId(id);
      setCurrentProjectPath(path);

      // Load template data into state
      setPerformers(saveData.performers);
      setPerformerGroups(saveData.performerGroups);
      setFrames(saveData.frames);
      setTransitions(saveData.transitions || []);
      setAudioMarkers(saveData.audioMarkers || []);
      setStageConfig(saveData.stageConfig);
      setCurrentFrameId(saveData.frames[0]?.id || '');
      setSelectedTransitionId(null);
      setSelectedTransitionPerformerId(null);
      setMusicName(null);
      setMusicAsset(null);
      setAudioBuffer(null);
      setMusicUrl(null);
      setCurrentTime(0);
      setSelectedPerformerIds([]);

      setLastSavedState(JSON.stringify({
        performers: saveData.performers,
        performerGroups: saveData.performerGroups,
        frames: saveData.frames,
        transitions: saveData.transitions || [],
        audioMarkers: saveData.audioMarkers || [],
        stageConfig: saveData.stageConfig,
        musicName: null,
        musicAsset: null,
      }));
      setProjectHasChanges(false);

      return id;
    } catch (error) {
      console.error('Failed to create from template:', error);
      return '';
    }
  };

  const handleLoadTemplate = (templateData: any) => {
    const performers = normalizePerformers(templateData.performers);
    const groups = templateData.performerGroups || [];
    const frames = normalizeFrames(templateData.frames);
    const transitions = normalizeTransitions(templateData.transitions);
    const config = templateData.stageConfig || stageConfig;

    setPerformers(performers);
    setPerformerGroups(groups);
    setFrames(frames);
    setTransitions(transitions);
    setAudioMarkers(normalizeAudioMarkers(templateData.audioMarkers));
    setStageConfig(config);
    setCurrentFrameId(frames[0]?.id || '');
    setSelectedTransitionId(null);
    setSelectedTransitionPerformerId(null);
    setMusicName(null);
    setMusicAsset(null);
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
        const projectData = buildProjectDocument();
        await window.electronAPI.project.save(currentProjectId, projectData);
        console.log('Auto-saved current project before switching');
      } catch (error) {
        console.error('Failed to auto-save before switching:', error);
        setProjectMessages(['当前项目自动保存失败，已取消切换项目']);
        return;
      }
    }
    
    try {
      await applyLoadedProject(projectId, await window.electronAPI.project.load(projectId));
      
    } catch (error) {
      console.error('Failed to load project:', error);
      setProjectMessages(['项目加载失败，请检查项目文件是否完整']);
    }
  };

  // Save current project
  const handleSaveProject = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI?.isElectron || !currentProjectId) return false;
    
    try {
      const projectData = buildProjectDocument();
      
      const saved = await window.electronAPI.project.save(currentProjectId, projectData);
      setPerformers(saved.data.performers);
      setTransitions(saved.data.transitions || []);
      setAudioMarkers(saved.data.audioMarkers || []);
      setMediaCache(saved.mediaUrls);
      setLastSavedState(JSON.stringify({
        performers: saved.data.performers,
        performerGroups: saved.data.performerGroups,
        frames: saved.data.frames,
        transitions: saved.data.transitions || [],
        audioMarkers: saved.data.audioMarkers || [],
        stageConfig: saved.data.stageConfig,
        musicName: saved.data.musicName || null,
        musicAsset: saved.data.musicAsset || null,
      }));
      setProjectHasChanges(false);
      return true;
    } catch (error) {
      console.error('Failed to save project:', error);
      setProjectMessages(['项目保存失败，请检查磁盘空间和目录权限']);
      return false;
    }
  }, [buildProjectDocument, currentProjectId]);

  const handleImportProjectPackage = async () => {
    if (!window.electronAPI?.isElectron) return;
    try {
      const result = await window.electronAPI.project.importPackage();
      if (result) await applyLoadedProject(result.projectId, result);
    } catch (error) {
      console.error('Project package import failed:', error);
      setProjectMessages(['项目包导入失败，文件可能已损坏或格式不受支持']);
    }
  };

  const handleImportLegacyProject = async () => {
    if (!window.electronAPI?.isElectron) return;
    try {
      const result = await window.electronAPI.project.importLegacy();
      if (result) await applyLoadedProject(result.projectId, result);
    } catch (error) {
      console.error('Legacy project import failed:', error);
      setProjectMessages(['旧 JSON 导入失败，文件可能已损坏或格式不受支持']);
    }
  };

  const handleExportProjectPackage = async () => {
    if (!window.electronAPI?.isElectron || !currentProjectId) {
      setProjectMessages(['请先打开需要导出的项目']);
      return;
    }
    try {
      if (projectHasChanges && !await handleSaveProject()) return;
      const exportedPath = await window.electronAPI.project.exportPackage(currentProjectId);
      if (exportedPath) setProjectMessages([`项目包已导出：${exportedPath}`]);
    } catch (error) {
      console.error('Project package export failed:', error);
      setProjectMessages(['项目包导出失败，请检查目标目录权限和磁盘空间']);
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
    setFrames(prev => prev.map(f => {
      if (f.id !== currentFrameId) return f;
      const newPositions = { ...f.positions } as Record<string, Position>;
      const newRotations = { ...(f.rotations ?? {}) };
      Object.keys(newPositions).forEach(pid => { if (ids.has(pid)) delete (newPositions as any)[pid]; });
      ids.forEach((id) => delete newRotations[id]);
      return { ...f, positions: newPositions, rotations: newRotations };
    }));
    setSelectedPerformerIds([]);
  };

  // Toggle presence in the CURRENT frame
  const handleTogglePerformerInFrame = (performerId: string) => {
    setFrames(prevFrames => {
      return prevFrames.map(f => {
        if (f.id === currentFrameId) {
          const newPositions = { ...f.positions };
          const newRotations = { ...(f.rotations ?? {}) };
          if (newPositions[performerId]) {
            // Remove from this frame
            delete newPositions[performerId];
            delete newRotations[performerId];
          } else {
            // Add to this frame. Try to find previous frame's position for continuity, or default.
            const sorted = getSortedFrames(prevFrames);
            const prevFrame = [...sorted].reverse().find(fr => fr.startTime < f.startTime && fr.positions[performerId]);

            const initialPos = prevFrame?.positions[performerId] || { x: 50, y: 50 };
            newPositions[performerId] = initialPos;
            const performer = performers.find((item) => item.id === performerId);
            newRotations[performerId] = prevFrame?.rotations?.[performerId] ?? performer?.rotation ?? 0;
          }
          return { ...f, positions: newPositions, rotations: newRotations };
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

  const selectedTransition = useMemo(() => {
    if (!selectedTransitionId) return null;
    const existing = transitions.find((transition) => transition.id === selectedTransitionId);
    if (existing) return existing;
    const gap = getGapSegments(frames, transitions)
      .find((item) => getGapSelectionId(item) === selectedTransitionId);
    if (!gap?.prevId) return null;
    return {
      id: gap.id,
      fromFrameId: gap.prevId,
      toFrameId: gap.nextId,
      duration: gap.duration,
      objectMotions: {},
    };
  }, [frames, selectedTransitionId, transitions]);

  const selectedTransitionFrames = useMemo(() => {
    if (!selectedTransition) return null;
    const fromFrame = frames.find((frame) => frame.id === selectedTransition.fromFrameId);
    const toFrame = frames.find((frame) => frame.id === selectedTransition.toFrameId);
    if (!fromFrame || !toFrame) return null;
    return { fromFrame, toFrame };
  }, [frames, selectedTransition]);

  const transitionSelectablePerformers = useMemo(() => {
    if (!selectedTransitionFrames) return [];
    return performers.filter((performer) => (
      selectedTransitionFrames.fromFrame.positions[performer.id] !== undefined
      && selectedTransitionFrames.toFrame.positions[performer.id] !== undefined
    ));
  }, [performers, selectedTransitionFrames]);

  useEffect(() => {
    if (transitionSelectablePerformers.length === 0) {
      setSelectedTransitionPerformerId(null);
      return;
    }
    setSelectedTransitionPerformerId((current) => (
      current && transitionSelectablePerformers.some((performer) => performer.id === current)
        ? current
        : transitionSelectablePerformers[0].id
    ));
  }, [transitionSelectablePerformers]);

  const selectedTransitionPaths = useMemo(() => {
    if (!selectedTransition || !selectedTransitionFrames) return [];
    return transitionSelectablePerformers.flatMap((performer) => {
      const start = selectedTransitionFrames.fromFrame.positions[performer.id];
      const end = selectedTransitionFrames.toFrame.positions[performer.id];
      if (!start || !end) return [];
      const motion = selectedTransition.objectMotions[performer.id] || {};
      const controlPoints: MotionControlPoint[] = motion.controlPoints || getDefaultBezierControlPoints(start, end);
      return [{
        performerId: performer.id,
        color: performer.color,
        start,
        end,
        pathType: motion.pathType || 'linear' as const,
        controlPoints,
        isSelected: performer.id === selectedTransitionPerformerId,
      }];
    });
  }, [
    selectedTransition,
    selectedTransitionFrames,
    selectedTransitionPerformerId,
    transitionSelectablePerformers,
  ]);

  const handleSelectTransition = useCallback((transitionId: string | null) => {
    setSelectedTransitionId(transitionId);
    setSelectedTransitionPerformerId(null);
    setSelectedPerformerIds([]);
  }, []);

  const handleTransitionUpdate = useCallback((nextTransition: TransitionSegment) => {
    setTransitions((prev) => {
      const existingIndex = prev.findIndex((transition) => transition.id === nextTransition.id);
      if (existingIndex === -1) {
        return [...prev, nextTransition];
      }
      return prev.map((transition) => (
        transition.id === nextTransition.id ? nextTransition : transition
      ));
    });
    setSelectedTransitionId(nextTransition.id);
  }, []);

  const handleTransitionDelete = useCallback((transitionId: string) => {
    setTransitions((prev) => prev.filter((transition) => transition.id !== transitionId));
    setSelectedTransitionId((current) => current === transitionId ? null : current);
    setSelectedTransitionPerformerId((current) => (
      selectedTransitionId === transitionId ? null : current
    ));
  }, [selectedTransitionId]);

  const handleTransitionControlPointChange = useCallback((controlPointIndex: number, nextPosition: Position) => {
    if (!selectedTransition || !selectedTransitionPerformerId || !selectedTransitionFrames) return;
    const start = selectedTransitionFrames.fromFrame.positions[selectedTransitionPerformerId];
    const end = selectedTransitionFrames.toFrame.positions[selectedTransitionPerformerId];
    if (!start || !end) return;

    const motion = selectedTransition.objectMotions[selectedTransitionPerformerId] || {};
    const controlPoints = [...(motion.controlPoints || getDefaultBezierControlPoints(start, end))];
    controlPoints[controlPointIndex] = {
      ...controlPoints[controlPointIndex],
      x: nextPosition.x,
      y: nextPosition.y,
      ...(nextPosition.z !== undefined ? { z: nextPosition.z } : {}),
    };

    handleTransitionUpdate({
      ...selectedTransition,
      objectMotions: {
        ...selectedTransition.objectMotions,
        [selectedTransitionPerformerId]: {
          ...motion,
          pathType: 'bezier',
          controlPoints,
        },
      },
    });
  }, [
    handleTransitionUpdate,
    selectedTransition,
    selectedTransitionFrames,
    selectedTransitionPerformerId,
  ]);

  const handleTransitionStartPointChange = useCallback((nextPosition: Position) => {
    if (!selectedTransitionPerformerId || !selectedTransitionFrames) return;
    setFrames((previousFrames) => previousFrames.map((frame) => {
      if (frame.id !== selectedTransitionFrames.fromFrame.id) return frame;
      const previousPosition = frame.positions[selectedTransitionPerformerId];
      return {
        ...frame,
        positions: {
          ...frame.positions,
          [selectedTransitionPerformerId]: {
            x: nextPosition.x,
            y: nextPosition.y,
            ...(nextPosition.z !== undefined
              ? { z: nextPosition.z }
              : previousPosition?.z !== undefined
                ? { z: previousPosition.z }
                : {}),
          },
        },
      };
    }));
  }, [selectedTransitionFrames, selectedTransitionPerformerId]);

  const selectedTransitionPerformer = useMemo(() => (
    selectedTransitionPerformerId
      ? transitionSelectablePerformers.find((performer) => performer.id === selectedTransitionPerformerId) ?? null
      : null
  ), [selectedTransitionPerformerId, transitionSelectablePerformers]);

  const selectedTransitionMotion = useMemo<ObjectMotion>(() => {
    if (!selectedTransition || !selectedTransitionPerformerId) return {};
    return selectedTransition.objectMotions[selectedTransitionPerformerId] || {};
  }, [selectedTransition, selectedTransitionPerformerId]);

  const canEditSelectedTransitionRotation = selectedTransitionPerformer?.type === 'prop';

  const updateSelectedTransitionMotion = useCallback((updates: Partial<ObjectMotion>) => {
    if (!selectedTransition || !selectedTransitionPerformerId) return;
    const nextMotion: ObjectMotion = {
      ...selectedTransitionMotion,
      ...updates,
    };
    handleTransitionUpdate({
      ...selectedTransition,
      objectMotions: {
        ...selectedTransition.objectMotions,
        [selectedTransitionPerformerId]: nextMotion,
      },
    });
  }, [
    handleTransitionUpdate,
    selectedTransition,
    selectedTransitionMotion,
    selectedTransitionPerformerId,
  ]);

  const resetSelectedTransitionMotion = useCallback(() => {
    if (!selectedTransition || !selectedTransitionPerformerId) return;
    const nextObjectMotions = { ...selectedTransition.objectMotions };
    delete nextObjectMotions[selectedTransitionPerformerId];
    if (Object.keys(nextObjectMotions).length === 0) {
      handleTransitionDelete(selectedTransition.id);
      return;
    }
    handleTransitionUpdate({
      ...selectedTransition,
      objectMotions: nextObjectMotions,
    });
  }, [
    handleTransitionDelete,
    handleTransitionUpdate,
    selectedTransition,
    selectedTransitionPerformerId,
  ]);

  const handleTransitionMotionControlPointChange = useCallback((index: number, axis: keyof MotionControlPoint, value: number) => {
    if (!selectedTransition || !selectedTransitionPerformerId || !selectedTransitionFrames) return;
    const start = selectedTransitionFrames.fromFrame.positions[selectedTransitionPerformerId];
    const end = selectedTransitionFrames.toFrame.positions[selectedTransitionPerformerId];
    if (!start || !end) return;
    const defaults = getDefaultBezierControlPoints(start, end);
    const nextControlPoints = [...(selectedTransitionMotion.controlPoints || defaults)];
    nextControlPoints[index] = {
      ...nextControlPoints[index],
      [axis]: value,
    };
    updateSelectedTransitionMotion({ controlPoints: nextControlPoints });
  }, [
    selectedTransition,
    selectedTransitionFrames,
    selectedTransitionMotion,
    selectedTransitionPerformerId,
    updateSelectedTransitionMotion,
  ]);

  const getRotationTargetFrameId = useCallback((): string | null => (
    selectedTransitionFrames?.toFrame.id ?? currentFrameId ?? null
  ), [currentFrameId, selectedTransitionFrames]);

  const handleRotationStart = useCallback((performerId: string) => {
    const frameId = getRotationTargetFrameId();
    if (!frameId) return;
    const frame = frames.find((item) => item.id === frameId);
    const performer = performers.find((item) => item.id === performerId);
    if (!frame || !performer) return;
    pendingRotationUndoRef.current = {
      frameId,
      performerId,
      before: frame.rotations?.[performerId] ?? performer.rotation ?? 0,
    };
  }, [frames, getRotationTargetFrameId, performers]);

  const handleRotationChange = useCallback((performerId: string, rotation: number) => {
    const frameId = getRotationTargetFrameId();
    if (!frameId || !Number.isFinite(rotation)) return;
    setFrames((previousFrames) => previousFrames.map((frame) => (
      frame.id === frameId
        ? { ...frame, rotations: { ...(frame.rotations ?? {}), [performerId]: rotation } }
        : frame
    )));
  }, [getRotationTargetFrameId]);

  const handleFrameRotationChange = useCallback((frameId: string, performerId: string, rotation: number) => {
    if (!Number.isFinite(rotation)) return;
    const frame = frames.find((item) => item.id === frameId);
    const performer = performers.find((item) => item.id === performerId);
    if (!frame || !performer) return;
    const before = frame.rotations?.[performerId] ?? performer.rotation ?? 0;
    if (Math.abs(before - rotation) < 0.01) return;
    setFrames((previousFrames) => previousFrames.map((frame) => (
      frame.id === frameId
        ? { ...frame, rotations: { ...(frame.rotations ?? {}), [performerId]: rotation } }
        : frame
    )));
    pushUndoAction({
      type: 'rotate-performer',
      frameId,
      performerId,
      before,
      after: rotation,
    });
  }, [frames, performers, pushUndoAction]);

  const handleRotationEnd = useCallback((performerId: string, rotation: number) => {
    handleRotationChange(performerId, rotation);
    const pending = pendingRotationUndoRef.current;
    pendingRotationUndoRef.current = null;
    if (!pending || pending.performerId !== performerId || Math.abs(pending.before - rotation) < 0.01) return;
    pushUndoAction({
      type: 'rotate-performer',
      frameId: pending.frameId,
      performerId,
      before: pending.before,
      after: rotation,
    });
  }, [handleRotationChange, pushUndoAction]);

  const handleStageDragStart = useCallback((performerIds: string[]) => {
    if (!currentFrameId || performerIds.length === 0) {
      pendingMoveUndoRef.current = null;
      return;
    }
    const currentFrame = frames.find((frame) => frame.id === currentFrameId);
    if (!currentFrame) {
      pendingMoveUndoRef.current = null;
      return;
    }
    const before = clonePositionMap(
      Object.fromEntries(
        performerIds
          .map((id) => [id, currentFrame.positions[id]] as const)
          .filter((entry): entry is [string, Position] => entry[1] !== undefined)
      )
    );
    pendingMoveUndoRef.current = Object.keys(before).length > 0
      ? { frameId: currentFrameId, performerIds: Object.keys(before), before }
      : null;
  }, [currentFrameId, frames]);

  const handleStageDragEnd = useCallback((performerIds: string[], finalUpdates?: { id: string; pos: Position }[]) => {
    const snapshot = pendingMoveUndoRef.current;
    pendingMoveUndoRef.current = null;
    if (!snapshot || snapshot.frameId !== currentFrameId) return;
    const currentFrame = frames.find((frame) => frame.id === snapshot.frameId);
    if (!currentFrame) return;
    const relevantIds = snapshot.performerIds.filter((id) => performerIds.length === 0 || performerIds.includes(id));
    const finalPositionById = new Map((finalUpdates ?? []).map((update) => [update.id, update.pos]));
    const after = clonePositionMap(
      Object.fromEntries(
        relevantIds
          .map((id) => [id, finalPositionById.get(id) ?? currentFrame.positions[id]] as const)
          .filter((entry): entry is [string, Position] => entry[1] !== undefined)
      )
    );
    const changedIds = relevantIds.filter((id) => !positionsEqual(snapshot.before[id], after[id]));
    if (changedIds.length === 0) return;
    pushUndoAction({
      type: 'move-performers',
      frameId: snapshot.frameId,
      performerIds: changedIds,
      before: clonePositionMap(Object.fromEntries(changedIds.map((id) => [id, snapshot.before[id]]))),
      after: clonePositionMap(Object.fromEntries(changedIds.map((id) => [id, after[id]]))),
    });
  }, [currentFrameId, frames, pushUndoAction]);

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
    const presetUpdates = effectiveTargets.slice(0, limit).map((performerId, index) => {
      let { x, y } = coords[index];
      x = Math.max(2, Math.min(98, x));
      y = Math.max(2, Math.min(98, y));
      return { performerId, pos: { x, y } };
    });
    const before: Record<string, Position> = {};
    const after: Record<string, Position> = {};

    presetUpdates.forEach((update) => {
      const previous = frame.positions[update.performerId];
      if (previous && !positionsEqual(previous, update.pos)) {
        before[update.performerId] = { ...previous };
        after[update.performerId] = { ...update.pos };
      }
    });

    setFrames(prev => prev.map(f => {
      if (f.id === currentFrameId) {
        const newPositions = { ...f.positions };
        presetUpdates.forEach((update) => {
          newPositions[update.performerId] = { ...update.pos };
        });
        return { ...f, positions: newPositions };
      }
      return f;
    }));

    const changedIds = Object.keys(before);
    if (changedIds.length > 0) {
      pushUndoAction({
        type: 'move-performers',
        frameId: currentFrameId,
        performerIds: changedIds,
        before: clonePositionMap(before),
        after: clonePositionMap(after),
      });
    }
  };

  const handleApplyAIPlan = (plan: AIChoreoPlan) => {
    if (isPlaying) handlePlayPause();

    const hasExistingContent = performers.length > 0 || performerGroups.length > 0 || frames.some(f => Object.keys(f.positions).length > 0);
    const shouldOverwrite = plan.intent === 'initialize_project' && hasExistingContent
      ? window.confirm('AI initialization found existing project content. Click OK to overwrite, or Cancel to append.')
      : false;

    const baseFrames: Frame[] = shouldOverwrite
      ? [{ ...DEFAULT_FRAME, positions: {} }]
      : JSON.parse(JSON.stringify(frames));
    const basePerformers: Performer[] = shouldOverwrite ? [] : JSON.parse(JSON.stringify(performers));
    const baseGroups: PerformerGroup[] = shouldOverwrite ? [] : JSON.parse(JSON.stringify(performerGroups));

    const groupIdByTempId = new Map<string, string>();
    const performerIdByTempId = new Map<string, string>();

    const newGroups: PerformerGroup[] = plan.groupsToCreate.map(group => {
      const id = generateId();
      groupIdByTempId.set(group.tempId, id);
      return {
        id,
        name: group.name,
        color: group.color,
        collapsed: false,
        type: group.type || 'performer',
      };
    });

    const newPerformers: Performer[] = plan.entitiesToCreate.map(entity => {
      const id = generateId();
      performerIdByTempId.set(entity.tempId, id);
      return {
        id,
        name: entity.name,
        color: entity.color,
        label: entity.label || entity.name.charAt(0).toUpperCase(),
        shape: entity.shape || (entity.type === 'prop' ? 'square' : 'circle'),
        type: entity.type,
        groupId: entity.groupTempId ? groupIdByTempId.get(entity.groupTempId) : undefined,
        width: entity.type === 'prop' ? (entity.width ?? 1) : entity.width,
        height: entity.type === 'prop' ? (entity.height ?? 2) : entity.height,
        depth: entity.type === 'prop' ? (entity.depth ?? 0.3) : entity.depth,
        rotation: entity.rotation,
        propGeometryType: entity.propGeometryType || (entity.type === 'prop' ? 'box' : undefined),
        propCategory: entity.type === 'prop' ? (entity.propCategory ?? 'prop') : undefined,
      };
    });

    const allPerformers = [...basePerformers, ...newPerformers];
    const allGroups = [...baseGroups, ...newGroups];
    const framesWithEntities = baseFrames.map(frame => {
      const positions = { ...frame.positions };
      newPerformers.forEach((performer, index) => {
        positions[performer.id] = createGridPosition(basePerformers.length + index, allPerformers.length);
      });
      return { ...frame, positions };
    });

    const remapPositions = (positions: Record<string, Position>) => {
      const remapped: Record<string, Position> = {};
      Object.entries(positions).forEach(([id, pos]) => {
        remapped[performerIdByTempId.get(id) || id] = {
          x: Math.max(2, Math.min(98, pos.x)),
          y: Math.max(2, Math.min(98, pos.y)),
          ...(pos.z !== undefined ? { z: pos.z } : {}),
        };
      });
      return remapped;
    };

    const createdFrames: Frame[] = plan.framesToCreate.map(frame => ({
      id: generateId(),
      name: frame.name,
      startTime: frame.startTime,
      duration: frame.duration,
      positions: remapPositions(frame.positions),
      notes: frame.notes,
    }));

    let nextFrames = [...framesWithEntities, ...createdFrames];
    plan.positionUpdates.forEach(update => {
      nextFrames = nextFrames.map(frame => {
        if (frame.id !== update.frameId) return frame;
        return {
          ...frame,
          positions: {
            ...frame.positions,
            ...remapPositions(update.positions),
          },
        };
      });
    });
    nextFrames.sort((a, b) => a.startTime - b.startTime);

    setPerformerGroups(allGroups);
    setPerformers(allPerformers);
    setFrames(nextFrames);
    if (shouldOverwrite) {
      setCurrentFrameId(DEFAULT_FRAME.id);
    } else if (createdFrames.length > 0) {
      setCurrentFrameId(createdFrames[0].id);
    }
    setSelectedPerformerIds(newPerformers.map(p => p.id));
  };

  // --- Frame Management ---

  const handleAddFrame = () => {
    const sorted = getSortedFrames(frames);
    let newStart = currentTime;

    if (frames.length === 0) {
      newStart = Math.max(0, currentTime);
    }

    const currentPos = currentSceneState.positions;

    const newFrame: Frame = {
      id: generateId(),
      name: `Formation ${frames.length + 1}`,
      startTime: newStart,
      duration: 2000,
      positions: JSON.parse(JSON.stringify(currentPos)),
      rotations: { ...currentSceneState.rotations },
    };

    const newFrames = [...frames, newFrame];
    newFrames.sort((a, b) => a.startTime - b.startTime);

    setFrames(newFrames);
    setCurrentFrameId(newFrame.id);
    setSelectedTransitionId(null);
    setSelectedTransitionPerformerId(null);
  };

  const handleDeleteFrame = (id: string) => {
    if (frames.length <= 0) return;
    if (isPlaying) handlePlayPause();
    const filtered = frames.filter(f => f.id !== id);
    setTransitions((prev) => prev.filter((transition) => (
      transition.fromFrameId !== id && transition.toFrameId !== id
    )));
    if (selectedTransitionId && transitions.some((transition) => (
      transition.id === selectedTransitionId
      && (transition.fromFrameId === id || transition.toFrameId === id)
    ))) {
      setSelectedTransitionId(null);
      setSelectedTransitionPerformerId(null);
    }
    if (filtered.length === 0) {
      const nf: Frame = { id: generateId(), name: 'Opening', startTime: 0, duration: 2000, positions: {}, rotations: {} };
      setFrames([nf]);
      setTransitions([]);
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
    if (last.type === 'move-performers') {
      setFrames((prev) => prev.map((frame) => {
        if (frame.id !== last.frameId) return frame;
        return {
          ...frame,
          positions: { ...frame.positions, ...clonePositionMap(last.before) }
        };
      }));
      setSelectedPerformerIds(last.performerIds);
    } else if (last.type === 'rotate-performer') {
      setFrames((prev) => prev.map((frame) => (
        frame.id === last.frameId
          ? { ...frame, rotations: { ...(frame.rotations ?? {}), [last.performerId]: last.before } }
          : frame
      )));
    } else if (last.type === 'paste-performers') {
      const pastedIds = last.performers.map((performer) => performer.id);
      setPerformers((prev) => prev.filter((performer) => !pastedIds.includes(performer.id)));
      removePerformerIdsFromFrames(pastedIds);
      setSelectedPerformerIds(last.previousSelectedIds);
    } else if (last.type === 'paste-frame') {
      setFrames((prev) => prev.filter((frame) => frame.id !== last.frame.id));
      if (last.previousCurrentFrameId) {
        setCurrentFrameId(last.previousCurrentFrameId);
      }
    }
    setRedoStack(prev => [...prev, last]);
  };

  const handleRedo = () => {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    setRedoStack(prev => prev.slice(0, -1));
    if (last.type === 'move-performers') {
      setFrames((prev) => prev.map((frame) => {
        if (frame.id !== last.frameId) return frame;
        return {
          ...frame,
          positions: { ...frame.positions, ...clonePositionMap(last.after) }
        };
      }));
      setSelectedPerformerIds(last.performerIds);
    } else if (last.type === 'rotate-performer') {
      setFrames((prev) => prev.map((frame) => (
        frame.id === last.frameId
          ? { ...frame, rotations: { ...(frame.rotations ?? {}), [last.performerId]: last.after } }
          : frame
      )));
    } else if (last.type === 'paste-performers') {
      setPerformers((prev) => [...prev, ...last.performers.map((performer) => ({ ...performer }))]);
      restoreFrameUpdates(last.frameUpdates);
      setSelectedPerformerIds(last.performers.map((performer) => performer.id));
    } else if (last.type === 'paste-frame') {
      setFrames((prev) => {
        const nextFrames = [...prev, createFrameCopy(last.frame, { id: last.frame.id })];
        nextFrames.sort((a, b) => a.startTime - b.startTime);
        return nextFrames;
      });
      setCurrentFrameId(last.frame.id);
    }
    setUndoStack(prev => [...prev, last]);
  };

  const handleDuplicateFrame = (id: string) => {
    const f = frames.find(fr => fr.id === id);
    if (!f) return;
    const newFrame = createFrameCopy(f, {
      name: `${f.name} (Copy)`,
      startTime: f.startTime + f.duration + 1000,
    });
    const newFrames = [...frames, newFrame];
    newFrames.sort((a, b) => a.startTime - b.startTime);
    setFrames(newFrames);
    setCurrentFrameId(newFrame.id);
    setSelectedTransitionId(null);
    setSelectedTransitionPerformerId(null);
    pushUndoAction({
      type: 'paste-frame',
      frame: createFrameCopy(newFrame, { id: newFrame.id }),
      previousCurrentFrameId: currentFrameId,
    });
  };

  // --- Project Export / Import ---

  const handleExportProject = async () => {
    const projectData = {
      version: "1.2",
      createdAt: new Date().toISOString(),
      name: "CosStage Project",
      musicName,
      performers,
      performerGroups,
      frames,
      transitions,
      audioMarkers,
      stageConfig,
    };

    // Check if running in Electron
    if (window.electronAPI?.isElectron) {
      try {
        const defaultName = `CosStage-project-${new Date().toISOString().slice(0, 10)}.json`;
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
    a.download = `CosStage-project-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleResetProject = () => {
    const hasData = audioMarkers.length > 0
      || performers.length > 0
      || frames.length > 1
      || (frames[0] && Object.keys(frames[0].positions).length > 0);

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
    setTransitions([]);
    setFrames([{
      id: newFrameId,
      name: 'Opening',
      startTime: 0,
      duration: 2000,
      positions: {},
      rotations: {},
    }]);
    setAudioMarkers([]);
    setCurrentFrameId(newFrameId);
    setSelectedTransitionId(null);
    setSelectedTransitionPerformerId(null);
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
          { name: 'CosStage Project', extensions: ['json'] },
          { name: 'JSON Files', extensions: ['json'] },
        ]);

        if (filePath) {
          const content = await window.electronAPI.readFile(filePath);
          const json = JSON.parse(content);

          // Basic validation
          if (!json.performers || !Array.isArray(json.performers)) throw new Error("Invalid project file: missing performers");
          if (!json.frames || !Array.isArray(json.frames)) throw new Error("Invalid project file: missing frames");

          setPerformers(normalizePerformers(json.performers));
          setPerformerGroups(json.performerGroups || []);
          setFrames(normalizeFrames(json.frames));
          setTransitions(normalizeTransitions(json.transitions));
          setAudioMarkers(normalizeAudioMarkers(json.audioMarkers));
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
          setSelectedTransitionId(null);
          setSelectedTransitionPerformerId(null);

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

        setPerformers(normalizePerformers(json.performers));
        setPerformerGroups(json.performerGroups || []);
        setFrames(normalizeFrames(json.frames));
        setTransitions(normalizeTransitions(json.transitions));
        setAudioMarkers(normalizeAudioMarkers(json.audioMarkers));
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
        setSelectedTransitionId(null);
        setSelectedTransitionPerformerId(null);

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
    const previousSelectedIds = [...selectedPerformerIds];

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
          x: Math.min(getStageXBounds(stageConfig).max, Math.max(getStageXBounds(stageConfig).min, originalPos.x + 2)),
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
    pushUndoAction({
      type: 'paste-performers',
      performers: newPerformers.map((performer) => ({ ...performer })),
      frameUpdates: Object.fromEntries(
        Object.entries(frameUpdates).map(([frameId, updates]) => [frameId, clonePositionMap(updates)])
      ),
      previousSelectedIds,
    });
  }, [clipboard, frames, selectedPerformerIds, pushUndoAction, stageConfig]);

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

  const getPlaybackEndMs = useCallback(() => {
    const lastFrameEnd = frames.reduce(
      (maximum, frame) => Math.max(maximum, frame.startTime + frame.duration),
      0,
    );
    const visualTimelineEnd = Math.max(lastFrameEnd + 10000, 30000);
    const audioEnd = audioBuffer ? audioBuffer.duration * 1000 : 0;
    const markerEnd = audioMarkers.reduce((maximum, marker) => Math.max(maximum, marker.timeMs + 10000), 0);
    return Math.max(visualTimelineEnd, audioEnd, markerEnd);
  }, [frames, audioBuffer, audioMarkers]);

  // Keyboard Shortcuts
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      // Pause
      setIsPlaying(false);
      stopAudio();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } else {
      const playbackEnd = getPlaybackEndMs();
      const restartTime = currentTime >= playbackEnd - 50 ? 0 : currentTime;

      // Play
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }

      setIsPlaying(true);
      isPlayingRef.current = true; // Force Ref True immediately for loop

      // Important: Start from CURRENT Time
      if (restartTime !== currentTime) {
        setCurrentTime(restartTime);
      }
      startTimeRef.current = performance.now() - restartTime;
      playAudio(restartTime);

      const loop = () => {
        // Critical: Check ref, not state variable which is stale in closure
        if (!isPlayingRef.current) return;

        const now = performance.now();
        let newTime = now - startTimeRef.current;

        if (newTime >= playbackEnd) {
          setCurrentTime(playbackEnd);
          setIsPlaying(false);
          isPlayingRef.current = false;
          stopAudio();
          return;
        }

        rafRef.current = requestAnimationFrame(loop);
        setCurrentTime(newTime);
      };
      rafRef.current = requestAnimationFrame(loop);
    }
  }, [isPlaying, currentTime, getPlaybackEndMs]);

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
          setFrameClipboard(null);
        } else if (currentFrameId) {
          // Copy the current frame only when no performer is selected.
          const f = frames.find(fr => fr.id === currentFrameId);
          if (f) {
            e.preventDefault();
            setClipboard([]);
            setFrameClipboard(JSON.parse(JSON.stringify(f)));
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboard.length > 0) {
          e.preventDefault();
          pastePerformers();
        } else if (frameClipboard) {
          // Paste a frame only when the performer clipboard is empty.
          e.preventDefault();
          const newFrame = createFrameCopy(frameClipboard, {
            name: `${frameClipboard.name} (复制)`,
            startTime: currentTime,
          });
          const newFrames = [...frames, newFrame];
          newFrames.sort((a, b) => a.startTime - b.startTime);
          setFrames(newFrames);
          setCurrentFrameId(newFrame.id);
          pushUndoAction({
            type: 'paste-frame',
            frame: createFrameCopy(newFrame, { id: newFrame.id }),
            previousCurrentFrameId: currentFrameId,
          });
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
  }, [selectedPerformerIds, clipboard, frameClipboard, copyPerformersToClipboard, pastePerformers, handlePlayPause, frames, currentTime, currentFrameId, createFrameCopy, pushUndoAction]);


  // --- Audio Logic ---
  const handleImportMusic = async (e?: React.ChangeEvent<HTMLInputElement>) => {
    if (window.electronAPI?.isElectron) {
      if (!currentProjectId) {
        setProjectMessages(['请先新建或打开一个项目，再导入音频']);
        return;
      }
      const sourcePath = await window.electronAPI.openFile([
        { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] },
      ]);
      if (!sourcePath) return;
      const asset = await window.electronAPI.project.ingestAsset(currentProjectId, sourcePath, 'audio');
      setMusicName(asset.displayName);
      setMusicAsset(asset.relativePath);
      setMusicUrl(asset.url);
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`Failed to read imported audio: ${response.status}`);
      if (audioContextRef.current) {
        setAudioBuffer(await audioContextRef.current.decodeAudioData(await response.arrayBuffer()));
      }
      setProjectMessages(['音频已复制到项目']);
      return;
    }

    const file = e?.target.files?.[0];
    if (!file) return;

    setMusicName(file.name);
    setMusicAsset(null);
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

    if (offset >= audioBuffer.duration * 1000) {
      audioSourceRef.current = null;
      return;
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

  const renderFrameToCanvas = async (
    canvas: HTMLCanvasElement,
    timeMs: number,
    opts?: { includeLabels?: boolean; includeGrid?: boolean; bgColor?: string; ledRenderer?: { draw: (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, timeMs: number) => Promise<void> | void } | null; }
  ) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const includeLabels = opts?.includeLabels ?? true;
    const includeGrid = opts?.includeGrid ?? true;
    const bgColor = opts?.bgColor ?? '#1f2937';
    const w = canvas.width;
    const h = canvas.height;
    const scale = w / 1280; // baseline: 1280px wide
    const stageW = stageConfig.width || 20;
    const stageD = stageConfig.depth || stageW / STAGE_ASPECT_RATIO;
    const totalStageW = getTotalStageWidth(stageConfig);
    const stageAspect = totalStageW / stageD;
    let renderW = w;
    let renderH = renderW / stageAspect;
    if (renderH > h) {
      renderH = h;
      renderW = renderH * stageAspect;
    }
    const renderX = (w - renderW) / 2;
    const renderY = (h - renderH) / 2;
    const leftMainEdge = renderX + stageXToViewPercent(0, stageConfig) / 100 * renderW;
    const rightMainEdge = renderX + stageXToViewPercent(100, stageConfig) / 100 * renderW;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = bgColor;
    ctx.fillRect(renderX, renderY, renderW, renderH);
    if (opts?.ledRenderer) {
      await opts.ledRenderer.draw(ctx, leftMainEdge, renderY, rightMainEdge - leftMainEdge, renderH, timeMs);
    }
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = scale;
    ctx.strokeRect(renderX + 0.5, renderY + 0.5, renderW - 1, renderH - 1);

    if (includeGrid) {
      const gridMarks = createCenteredStageGridMarks(totalStageW, gridScale);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = scale;
      gridMarks.forEach((mark) => {
        const gx = renderX + mark.positionRatio * renderW;
        ctx.globalAlpha = mark.offsetMeters === 0 ? 0.55 : 0.2;
        ctx.lineWidth = (mark.offsetMeters === 0 ? 1.5 : 1) * scale;
        ctx.beginPath(); ctx.moveTo(gx, renderY); ctx.lineTo(gx, renderY + renderH); ctx.stroke();
      });
      ctx.strokeStyle = '#38bdf8';
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = 2.5 * scale;
      STAGE_THIRD_POSITIONS.forEach((position) => {
        const gy = renderY + position * renderH;
        ctx.beginPath(); ctx.moveTo(renderX, gy); ctx.lineTo(renderX + renderW, gy); ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    const sceneState = computeSceneStateAtTime(timeMs);
    const hiddenGroupIds = sceneState.hiddenGroupIds;
    const positions = sceneState.positions;
    const rotations = sceneState.rotations;
    const platformOccupancy = buildPlatformOccupancy(performers, positions, stageConfig);

    ctx.fillStyle = 'rgba(2,6,23,0.55)';
    ctx.fillRect(renderX, renderY, leftMainEdge - renderX, renderH);
    ctx.fillRect(rightMainEdge, renderY, renderX + renderW - rightMainEdge, renderH);
    ctx.strokeStyle = 'rgba(245,158,11,0.8)';
    ctx.lineWidth = Math.max(2, 2 * scale);
    ctx.setLineDash([8 * scale, 6 * scale]);
    ctx.beginPath();
    ctx.moveTo(leftMainEdge, renderY);
    ctx.lineTo(leftMainEdge, renderY + renderH);
    ctx.moveTo(rightMainEdge, renderY);
    ctx.lineTo(rightMainEdge, renderY + renderH);
    ctx.stroke();
    ctx.setLineDash([]);

    if (getWingWidth(stageConfig) > 0) {
      ctx.fillStyle = 'rgba(252,211,77,0.8)';
      ctx.font = `${Math.round(11 * scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('左备场区', renderX + (leftMainEdge - renderX) / 2, renderY + 10 * scale);
      ctx.fillText('右备场区', rightMainEdge + (renderX + renderW - rightMainEdge) / 2, renderY + 10 * scale);
    }

    // Draw props first, then actors, so occupied platforms stay visually below actors in 2D exports.
    [...performers]
      .sort((a, b) => {
        const aRank = isPlatformProp(a) ? 0 : a.type === 'prop' ? 1 : 2;
        const bRank = isPlatformProp(b) ? 0 : b.type === 'prop' ? 1 : 2;
        return aRank - bRank;
      })
      .forEach(p => {
      if (p.groupId && hiddenGroupIds.includes(p.groupId)) return;
      const pos = positions[p.id];
      if (!pos) return;
      const rotation = rotations[p.id] ?? p.rotation ?? 0;
      const renderPosition = p.type === 'prop'
        ? getPropCenterFromAnchor(pos, rotation, p, stageConfig)
        : pos;
      const cx = renderX + (stageXToViewPercent(renderPosition.x, stageConfig) / 100) * renderW;
      const cy = renderY + (renderPosition.y / 100) * renderH;

      if (p.type === 'prop') {
        const propLift = platformOccupancy.entityLiftById[p.id] ?? 0;
        const propW = (p.width || 1) / totalStageW * renderW;
        const propD = (p.depth || 1) / stageD * renderH;
        const rot = rotation * Math.PI / 180;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-rot);

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

        const texUrl = p.boxTextures?.front?.dataUrl || p.textureDataUrl;
        if (texUrl && (texUrl as any).loaded) {
          ctx.drawImage((texUrl as any), -propW / 2, -propD / 2, propW, propD);
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(-propW / 2, -propD / 2, propW, propD);
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = scale;
        ctx.strokeRect(-propW / 2, -propD / 2, propW, propD);

        ctx.restore();

        if (includeLabels) {
          ctx.fillStyle = '#ffffff';
          ctx.font = `${Math.round(9 * scale)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(p.name, cx, cy + propD / 2 + 4 * scale - propLift * scale * 2);
        }
      } else {
        const performerLift = platformOccupancy.entityLiftById[p.id] ?? 0;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * scale;
        const shapeSize = 32 * scale;
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(cx, cy, Math.floor(shapeSize / 2 - 7 * scale), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (p.shape === 'square') {
          const s = shapeSize;
          ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
          ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
        } else {
          const s = shapeSize + 6 * scale;
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
          ctx.font = `${Math.round(10 * scale)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(p.name, cx, cy + Math.floor(shapeSize / 2) - performerLift * scale * 2);
        }
      }
    });

    const rulerHeight = 28 * scale;
    ctx.fillStyle = 'rgba(2,6,23,0.78)';
    ctx.fillRect(renderX, renderY + renderH - rulerHeight, renderW, rulerHeight);
    const gridMarks = createCenteredStageGridMarks(totalStageW, gridScale);
    ctx.strokeStyle = '#e2e8f0';
    ctx.fillStyle = '#f8fafc';
    ctx.lineWidth = Math.max(1, scale);
    ctx.font = `${Math.max(7, Math.round(8 * scale))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    gridMarks.forEach((mark) => {
      const x = renderX + mark.positionRatio * renderW;
      ctx.beginPath();
      ctx.moveTo(x, renderY + renderH - rulerHeight);
      ctx.lineTo(x, renderY + renderH - rulerHeight + 7 * scale);
      ctx.stroke();
      ctx.fillText(formatStageGridLabel(mark.offsetMeters), x, renderY + renderH - rulerHeight + 8 * scale);
    });
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.max(7, Math.round(8 * scale))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('舞台前沿', Math.floor(renderX + renderW / 2), renderY + renderH - 2 * scale);
  };

  const handleExportVideo2D = async () => {
    if (inPointMs == null || outPointMs == null || outPointMs <= inPointMs) {
      if (inPointMs == null && outPointMs == null) {
        alert('请先设置导出范围。\n\n1. 将播放头移动到导出开始位置。\n2. 点击“导出视频”，在导出设置中把“入点”设为“当前”。\n3. 将播放头移动到导出结束位置，把“出点”设为“当前”。\n4. 再确认导出。');
      } else if (inPointMs == null) {
        alert('还没有设置入点。\n\n将播放头移动到导出开始位置，打开“导出视频”，在导出设置中把“入点”设为“当前”。');
      } else if (outPointMs == null) {
        alert('还没有设置出点。\n\n将播放头移动到导出结束位置，打开“导出视频”，在导出设置中把“出点”设为“当前”。');
      } else {
        alert('导出范围无效：出点必须晚于入点。\n\n请把播放头移动到更靠后的位置，在导出设置中把“出点”设为“当前”。');
      }
      return;
    }
    const width = exportResolution === '4k' ? 3840 : exportResolution === '2k' ? 2560 : 1920;
    const height = exportResolution === '4k' ? 2160 : exportResolution === '2k' ? 1440 : 1080;
    const fps = 30;
    const totalMs = outPointMs - inPointMs;
    const totalFrames = Math.ceil(totalMs / 1000 * fps);
    const stepMs = 1000 / fps;
    const downloadBaseName = `CosStage-export-${Math.round(inPointMs)}-${Math.round(outPointMs)}`;
    const isDesktopElectron = Boolean(window.electronAPI?.isElectron);
    const hasWebCodecs = typeof VideoEncoder !== 'undefined';
    const videoBitrate = exportResolution === '4k' ? 20_000_000 : exportResolution === '2k' ? 10_000_000 : 5_000_000;
    const videoEncoderConfig = hasWebCodecs
      ? await getSupportedVideoEncoderConfig(width, height, fps, videoBitrate)
      : null;
    const canFastExport = videoEncoderConfig != null;
    const realtimeFormat = getMediaRecorderExportFormat();
    const initialExtension = canFastExport ? 'mp4' : realtimeFormat.extension;
    const showSaveFilePicker = (window as any).showSaveFilePicker as
      | ((options?: any) => Promise<any>)
      | undefined;
    let mp4Writable: any = null;
    let realtimeWritable: any = null;
    let desktopExportPath: string | null = null;

    if (window.electronAPI?.isElectron) {
      desktopExportPath = await requestElectronExportPath(downloadBaseName, initialExtension);
      if (!desktopExportPath) return;
    } else if (showSaveFilePicker) {
      try {
        const handle = await showSaveFilePicker({
          suggestedName: `${downloadBaseName}.${initialExtension}`,
          types: [{
            description: canFastExport ? 'MP4 video' : realtimeFormat.description,
            accept: canFastExport
              ? { 'video/mp4': ['.mp4'] }
              : { [realtimeFormat.mimeType.split(';')[0]]: [`.${realtimeFormat.extension}`] },
          }],
        });
        if (canFastExport) {
          mp4Writable = await handle.createWritable();
        } else {
          realtimeWritable = await handle.createWritable();
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn('Streaming file picker unavailable, falling back to in-memory download:', err);
      }
    }

    setIsExporting(true);
    setExportProgress(0.02);

    // Desktop 2D export intentionally ignores prop textures / LED media to keep the path stable.
    const ledRenderer = isDesktopElectron ? null : await create2DExportLedRenderer();

    // Shared canvas for rendering (reused across both paths to avoid holding all frames in memory)
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = width;
    tmpCanvas.height = height;

    const waitForEncoderQueueBelow = async (encoder: VideoEncoder | AudioEncoder, maxQueueSize: number) => {
      while (encoder.encodeQueueSize > maxQueueSize) {
        await new Promise<void>(resolve => {
          let settled = false;
          const cleanup = () => {
            if (settled) return;
            settled = true;
            encoder.removeEventListener('dequeue', onDequeue);
            clearTimeout(timeoutId);
            resolve();
          };
          const onDequeue = () => cleanup();
          const timeoutId = window.setTimeout(cleanup, 50);
          encoder.addEventListener('dequeue', onDequeue, { once: true });
        });
      }
    };

    const createFrameFromCanvas = async (timestamp: number, duration: number) => {
      try {
        return new VideoFrame(tmpCanvas, { timestamp, duration });
      } catch {
        const bitmap = await createImageBitmap(tmpCanvas);
        try {
          return new VideoFrame(bitmap, { timestamp, duration });
        } finally {
          bitmap.close();
        }
      }
    };

    if (canFastExport) {
      // --- WebCodecs + mp4-muxer (fast, offline) ---
      let videoEncoder: VideoEncoder | null = null;
      try {
        const { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } = await import('mp4-muxer');

        const hasAudio = audioBuffer != null && typeof AudioEncoder !== 'undefined';
        const sampleRate = audioBuffer?.sampleRate ?? 44100;
        const numChannels = audioBuffer?.numberOfChannels ?? 1;
        const arrayBufferTarget = !mp4Writable ? new ArrayBufferTarget() : null;
        const target = mp4Writable
          ? new FileSystemWritableFileStreamTarget(mp4Writable, { chunkSize: 16 * 1024 * 1024 })
          : arrayBufferTarget;
        const muxer = new Muxer({
          target,
          video: { codec: 'avc', width, height },
          audio: hasAudio ? {
            codec: 'aac',
            numberOfChannels: numChannels,
            sampleRate,
          } : undefined,
          fastStart: false,
          firstTimestampBehavior: 'offset',
        });

        // --- Step 1: Render + Encode video (one frame at a time, no batch pre-render) ---
        let videoEncoderError: DOMException | null = null;
        videoEncoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (error) => {
            videoEncoderError = error;
            console.error('VideoEncoder error:', error);
          },
        });
        videoEncoder.configure(videoEncoderConfig);

        const ensureVideoEncoderOpen = () => {
          if (videoEncoderError) throw videoEncoderError;
          if (videoEncoder?.state === 'closed') {
            throw new Error('Video encoder closed unexpectedly.');
          }
        };

        for (let i = 0; i <= totalFrames; i++) {
          ensureVideoEncoderOpen();
          const t = inPointMs + i * stepMs;
          await renderFrameToCanvas(tmpCanvas, Math.min(t, outPointMs), {
            includeLabels: exportIncludeLabels,
            includeGrid: exportIncludeGrid,
            ledRenderer,
          });
          const frame = await createFrameFromCanvas((i * 1_000_000) / fps, 1_000_000 / fps);
          try {
            ensureVideoEncoderOpen();
            videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
          } finally {
            frame.close();
          }
          await waitForEncoderQueueBelow(videoEncoder, 8);
          ensureVideoEncoderOpen();
          setExportProgress((i / (totalFrames + 1)) * 0.7);
          if (i % 30 === 0) await new Promise(r => setTimeout(r, 0));
        }

        await withTimeout(videoEncoder.flush(), 15000, '2D 视频编码');
        videoEncoder.close();

        // --- Step 2: Encode audio (after video is fully flushed) ---
        if (hasAudio) {
          const audioEncoder = new AudioEncoder({
            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
            error: (e) => console.error('AudioEncoder error:', e),
          });
          audioEncoder.configure({
            codec: 'mp4a.40.2',
            numberOfChannels: numChannels,
            sampleRate,
            bitrate: 128_000,
          });

          const audioInSamples = Math.floor(inPointMs / 1000 * sampleRate);
          const audioOutSamples = Math.floor(outPointMs / 1000 * sampleRate);
          const aacFrameSize = 1024;
          const totalAudioChunks = Math.ceil((audioOutSamples - audioInSamples) / aacFrameSize);

          const channelData: Float32Array[] = [];
          for (let ch = 0; ch < numChannels; ch++) {
            channelData.push(audioBuffer!.getChannelData(ch));
          }

          for (let base = 0; base < totalAudioChunks; base++) {
            const sampleStart = audioInSamples + base * aacFrameSize;
            if (sampleStart >= audioOutSamples) break;

            const data = new Float32Array(numChannels * aacFrameSize);
            for (let ch = 0; ch < numChannels; ch++) {
              const src = channelData[ch];
              const off = ch * aacFrameSize;
              for (let s = 0; s < aacFrameSize; s++) {
                data[off + s] = (sampleStart + s < src.length) ? src[sampleStart + s] : 0;
              }
            }

            const audioData = new AudioData({
              format: 'f32-planar',
              sampleRate,
              numberOfFrames: aacFrameSize,
              numberOfChannels: numChannels,
              timestamp: (base * aacFrameSize * 1_000_000) / sampleRate,
              data,
            });
            audioEncoder.encode(audioData);
            audioData.close();
            await waitForEncoderQueueBelow(audioEncoder, 32);

            if (base % 100 === 0) {
              setExportProgress(0.85 + (base / totalAudioChunks) * 0.1);
              await new Promise(r => setTimeout(r, 0));
            }
          }

          setExportProgress(0.95);
          await withTimeout(audioEncoder.flush(), 15000, '2D 音频编码');
          audioEncoder.close();
        }

        muxer.finalize();
        if (mp4Writable) {
          await mp4Writable.close();
        } else if (arrayBufferTarget) {
          const bytes = new Uint8Array(arrayBufferTarget.buffer);
          if (desktopExportPath) {
            await window.electronAPI.writeBinaryFile(desktopExportPath, bytes);
          } else {
            downloadBlob(new Blob([bytes], { type: 'video/mp4' }), `${downloadBaseName}.mp4`);
          }
        } else {
          throw new Error('MP4 export target was not initialized.');
        }

        setIsExporting(false);
        setExportProgress(1);
        ledRenderer?.dispose();
        return;
      } catch (err) {
        if (videoEncoder?.state !== 'closed') {
          try { videoEncoder?.close(); } catch { }
        }
        if (mp4Writable) {
          try { await mp4Writable.abort?.(); } catch { }
          mp4Writable = null;
        }
        console.error('WebCodecs export failed, falling back to MediaRecorder:', err);
        setProjectMessages(['当前设备不支持稳定的高速导出，已自动切换到实时录制模式']);
      }
    }

    // --- Fallback: MediaRecorder (real-time playback, render on-the-fly) ---
    if (canFastExport) {
      if (window.electronAPI?.isElectron) {
        desktopExportPath = await requestElectronExportPath(downloadBaseName, realtimeFormat.extension);
        if (!desktopExportPath) {
          setIsExporting(false);
          return;
        }
      } else if (showSaveFilePicker && !realtimeWritable) {
        try {
          const handle = await showSaveFilePicker({
            suggestedName: `${downloadBaseName}.${realtimeFormat.extension}`,
            types: [{
              description: realtimeFormat.description,
              accept: { [realtimeFormat.mimeType.split(';')[0]]: [`.${realtimeFormat.extension}`] },
            }],
          });
          realtimeWritable = await handle.createWritable();
        } catch (err) {
          setIsExporting(false);
          if (err instanceof DOMException && err.name === 'AbortError') return;
          console.warn('WebM file picker unavailable, falling back to in-memory download:', err);
        }
      }
    }

    const streamV = (tmpCanvas as any).captureStream ? (tmpCanvas as any).captureStream(fps) : null;
    if (!streamV) {
      if (realtimeWritable) {
        try { await realtimeWritable.abort?.(); } catch { }
      }
      setIsExporting(false);
      return;
    }

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

    let activeRealtimeFormat = realtimeFormat;
    let recorder: MediaRecorder;
    try {
      const recorderFormats = realtimeWritable
        ? getMediaRecorderExportFormats().filter((format) => format.extension === realtimeFormat.extension)
        : getMediaRecorderExportFormats();
      const startedRecorder = startMediaRecorderWithFallback(stream, recorderFormats, 100);
      recorder = startedRecorder.recorder;
      activeRealtimeFormat = startedRecorder.format;
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      if (realtimeWritable) {
        try { await realtimeWritable.abort?.(); } catch { }
      }
      ledRenderer?.dispose();
      setIsExporting(false);
      alert('实时录制导出失败：' + (err instanceof Error ? err.message : String(err)));
      return;
    }

    if (desktopExportPath && activeRealtimeFormat.extension !== realtimeFormat.extension) {
      recorder.stop();
      const updatedPath = await requestElectronExportPath(downloadBaseName, activeRealtimeFormat.extension);
      if (!updatedPath) {
        stream.getTracks().forEach((track) => track.stop());
        ledRenderer?.dispose();
        setIsExporting(false);
        return;
      }
      desktopExportPath = updatedPath;
      recorder = startMediaRecorderWithFallback(stream, [activeRealtimeFormat], 100).recorder;
    }

    const mime = activeRealtimeFormat.mimeType;
    const chunks: Blob[] = [];
    let realtimeWriteChain = Promise.resolve();
    recorder.ondataavailable = (e: any) => {
      if (!e.data || e.data.size <= 0) return;
      if (realtimeWritable) {
        realtimeWriteChain = realtimeWriteChain.then(() => realtimeWritable.write(e.data));
      } else {
        chunks.push(e.data);
      }
    };

    if (source) source.start(0, inPointMs / 1000);

    const recordStart = performance.now();
    const drawFrame = async () => {
      const elapsed = performance.now() - recordStart;
      const currentFrameIdx = Math.min(Math.floor(elapsed / stepMs), totalFrames);
      const t = Math.min(inPointMs + currentFrameIdx * stepMs, outPointMs);
      await renderFrameToCanvas(tmpCanvas, t, {
        includeLabels: exportIncludeLabels,
        includeGrid: exportIncludeGrid,
        ledRenderer,
      });
      setExportProgress(0.7 + Math.min(0.3, (currentFrameIdx / totalFrames) * 0.3));

      if (elapsed < totalMs + stepMs) {
        requestAnimationFrame(() => { void drawFrame(); });
      } else {
        recorder.stop();
        if (source) { try { source.stop(); } catch { } }
      }
    };
    requestAnimationFrame(() => { void drawFrame(); });

    let blob: Blob;
    try {
      blob = await withTimeout(new Promise<Blob>((resolve, reject) => {
        recorder.onerror = (event) => reject((event as any).error || new Error('MediaRecorder 导出失败'));
        recorder.onstop = () => {
          realtimeWriteChain
            .then(async () => {
              if (realtimeWritable) {
                await realtimeWritable.close();
                resolve(new Blob([], { type: mime }));
              } else {
                resolve(new Blob(chunks, { type: mime }));
              }
            })
            .catch(async err => {
              if (realtimeWritable) {
                try { await realtimeWritable.abort?.(); } catch { }
              }
              reject(err);
            });
        };
      }), Math.max(totalMs + 15000, 30000), '2D 实时录制');
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      ledRenderer?.dispose();
      setIsExporting(false);
      alert('实时录制导出失败：' + (err instanceof Error ? err.message : String(err)));
      return;
    }

    stream.getTracks().forEach((track) => track.stop());
    setIsExporting(false);
    setExportProgress(1);
    ledRenderer?.dispose();

    if (!realtimeWritable) {
      if (desktopExportPath) {
        await writeBlobToElectronPath(desktopExportPath, blob);
      } else {
        downloadBlob(blob, `${downloadBaseName}.${activeRealtimeFormat.extension}`);
      }
    }
  };

  const handleExportVideo3D = async () => {
    if (inPointMs == null || outPointMs == null || outPointMs <= inPointMs) return;

    const width = exportResolution === '4k' ? 3840 : exportResolution === '2k' ? 2560 : 1920;
    const height = exportResolution === '4k' ? 2160 : exportResolution === '2k' ? 1440 : 1080;
    const fps = 30;
    const totalMs = outPointMs - inPointMs;
    const totalFrames = Math.ceil(totalMs / 1000 * fps);
    const stepMs = 1000 / fps;
    const downloadBaseName = `CosStage-3d-${exportCameraAngle}-${Math.round(inPointMs)}-${Math.round(outPointMs)}`;
    const hasWebCodecs = typeof VideoEncoder !== 'undefined';
    const videoBitrate = exportResolution === '4k' ? 20_000_000 : exportResolution === '2k' ? 10_000_000 : 5_000_000;
    const videoEncoderConfig = hasWebCodecs
      ? await getSupportedVideoEncoderConfig(width, height, fps, videoBitrate)
      : null;
    const canFastExport = videoEncoderConfig != null;
    const realtimeFormat = getMediaRecorderExportFormat();
    const initialExtension = canFastExport ? 'mp4' : realtimeFormat.extension;
    const showSaveFilePicker = (window as any).showSaveFilePicker as
      | ((options?: any) => Promise<any>)
      | undefined;
    let mp4Writable: any = null;
    let realtimeWritable: any = null;
    let desktopExportPath: string | null = null;

    if (window.electronAPI?.isElectron) {
      desktopExportPath = await requestElectronExportPath(downloadBaseName, initialExtension);
      if (!desktopExportPath) return;
    } else if (showSaveFilePicker) {
      try {
        const handle = await showSaveFilePicker({
          suggestedName: `${downloadBaseName}.${initialExtension}`,
          types: [{
            description: canFastExport ? 'MP4 video' : realtimeFormat.description,
            accept: canFastExport
              ? { 'video/mp4': ['.mp4'] }
              : { [realtimeFormat.mimeType.split(';')[0]]: [`.${realtimeFormat.extension}`] },
          }],
        });
        if (canFastExport) {
          mp4Writable = await handle.createWritable();
        } else {
          realtimeWritable = await handle.createWritable();
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn('Streaming file picker unavailable, falling back to in-memory download:', err);
      }
    }

    setIsExporting(true);
    setExportProgress(0);

    // Pre-load resources
    setExportProgress(0.03);
    await Promise.all([
      preloadPropTextures(performers),
      preloadLEDVideo(stageConfig, mediaCache),
    ]);
    setExportProgress(0.08);

    // Create offline 3D scene
    const offline = createOfflineScene(
      width, height, stageConfig, performers, exportCameraAngle, gridScale, mediaCache, exportIncludeGrid, exportIncludeLabels,
    );

    // Pre-capture LED video frames for fast export (seeks once, then uses cache)
    try {
      await withTimeout(offline.prerenderLEDVideo(inPointMs, outPointMs, fps), 10000, '3D LED 预处理');
    } catch (err) {
      console.warn('3D LED pre-render timed out, continuing without cache:', err);
    }
    setExportProgress(0.12);

    // Canvas for capturing WebGL output
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = width;
    tmpCanvas.height = height;

    const waitForEncoderQueueBelow = async (encoder: VideoEncoder | AudioEncoder, maxQueueSize: number) => {
      while (encoder.encodeQueueSize > maxQueueSize) {
        await new Promise<void>(resolve => {
          let settled = false;
          const cleanup = () => {
            if (settled) return;
            settled = true;
            encoder.removeEventListener('dequeue', onDequeue);
            clearTimeout(timeoutId);
            resolve();
          };
          const onDequeue = () => cleanup();
          const timeoutId = window.setTimeout(cleanup, 50);
          encoder.addEventListener('dequeue', onDequeue, { once: true });
        });
      }
    };

    const createFrameFromCanvas = async (timestamp: number, duration: number) => {
      try {
        return new VideoFrame(tmpCanvas, { timestamp, duration });
      } catch {
        const bitmap = await createImageBitmap(tmpCanvas);
        try {
          return new VideoFrame(bitmap, { timestamp, duration });
        } finally {
          bitmap.close();
        }
      }
    };

    if (canFastExport) {
      // --- WebCodecs + mp4-muxer (fast, offline) ---
      let videoEncoder: VideoEncoder | null = null;
      try {
        const { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } = await import('mp4-muxer');

        const hasAudio = audioBuffer != null && typeof AudioEncoder !== 'undefined';
        const sampleRate = audioBuffer?.sampleRate ?? 44100;
        const numChannels = audioBuffer?.numberOfChannels ?? 1;
        const arrayBufferTarget = !mp4Writable ? new ArrayBufferTarget() : null;
        const target = mp4Writable
          ? new FileSystemWritableFileStreamTarget(mp4Writable, { chunkSize: 16 * 1024 * 1024 })
          : arrayBufferTarget;
        const muxer = new Muxer({
          target,
          video: { codec: 'avc', width, height },
          audio: hasAudio ? {
            codec: 'aac',
            numberOfChannels: numChannels,
            sampleRate,
          } : undefined,
          fastStart: false,
          firstTimestampBehavior: 'offset',
        });

        // --- Step 1: Render + Encode video ---
        let videoEncoderError: DOMException | null = null;
        videoEncoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (error) => {
            videoEncoderError = error;
            console.error('VideoEncoder error:', error);
          },
        });
        videoEncoder.configure(videoEncoderConfig);

        const ensureVideoEncoderOpen = () => {
          if (videoEncoderError) throw videoEncoderError;
          if (videoEncoder?.state === 'closed') {
            throw new Error('Video encoder closed unexpectedly.');
          }
        };

        for (let i = 0; i <= totalFrames; i++) {
          ensureVideoEncoderOpen();
          const t = inPointMs + i * stepMs;
          const clampedT = Math.min(t, outPointMs);
          const sceneState = computeSceneStateAtTime(clampedT);

          // Update scene and render (await LED video seek if present)
          offline.updateAtTime(clampedT, sceneState.positions, sceneState.rotations, sceneState.hiddenGroupIds);
          offline.renderer.render(offline.scene, offline.camera);

          // Copy WebGL canvas to tmpCanvas for VideoFrame
          const ctx = tmpCanvas.getContext('2d')!;
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(offline.renderer.domElement, 0, 0);

          const frame = await createFrameFromCanvas((i * 1_000_000) / fps, 1_000_000 / fps);
          try {
            ensureVideoEncoderOpen();
            videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
          } finally {
            frame.close();
          }
          await waitForEncoderQueueBelow(videoEncoder, 8);
          ensureVideoEncoderOpen();
          setExportProgress((i / (totalFrames + 1)) * 0.7);
          if (i % 30 === 0) await new Promise(r => setTimeout(r, 0));
        }

        await withTimeout(videoEncoder.flush(), 15000, '3D 视频编码');
        videoEncoder.close();

        // --- Step 2: Encode audio (after video is fully flushed) ---
        if (hasAudio) {
          const audioEncoder = new AudioEncoder({
            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
            error: (e) => console.error('AudioEncoder error:', e),
          });
          audioEncoder.configure({
            codec: 'mp4a.40.2',
            numberOfChannels: numChannels,
            sampleRate,
            bitrate: 128_000,
          });

          const audioInSamples = Math.floor(inPointMs / 1000 * sampleRate);
          const audioOutSamples = Math.floor(outPointMs / 1000 * sampleRate);
          const aacFrameSize = 1024;
          const totalAudioChunks = Math.ceil((audioOutSamples - audioInSamples) / aacFrameSize);

          const channelData: Float32Array[] = [];
          for (let ch = 0; ch < numChannels; ch++) {
            channelData.push(audioBuffer!.getChannelData(ch));
          }

          for (let base = 0; base < totalAudioChunks; base++) {
            const sampleStart = audioInSamples + base * aacFrameSize;
            if (sampleStart >= audioOutSamples) break;

            const data = new Float32Array(numChannels * aacFrameSize);
            for (let ch = 0; ch < numChannels; ch++) {
              const src = channelData[ch];
              const off = ch * aacFrameSize;
              for (let s = 0; s < aacFrameSize; s++) {
                data[off + s] = (sampleStart + s < src.length) ? src[sampleStart + s] : 0;
              }
            }

            const audioData = new AudioData({
              format: 'f32-planar',
              sampleRate,
              numberOfFrames: aacFrameSize,
              numberOfChannels: numChannels,
              timestamp: (base * aacFrameSize * 1_000_000) / sampleRate,
              data,
            });
            audioEncoder.encode(audioData);
            audioData.close();
            await waitForEncoderQueueBelow(audioEncoder, 32);

            if (base % 100 === 0) {
              setExportProgress(0.85 + (base / totalAudioChunks) * 0.1);
              await new Promise(r => setTimeout(r, 0));
            }
          }

          setExportProgress(0.95);
          await withTimeout(audioEncoder.flush(), 15000, '3D 音频编码');
          audioEncoder.close();
        }

        muxer.finalize();
        if (mp4Writable) {
          await mp4Writable.close();
        } else if (arrayBufferTarget) {
          const bytes = new Uint8Array(arrayBufferTarget.buffer);
          if (desktopExportPath) {
            await window.electronAPI.writeBinaryFile(desktopExportPath, bytes);
          } else {
            downloadBlob(new Blob([bytes], { type: 'video/mp4' }), `${downloadBaseName}.mp4`);
          }
        } else {
          throw new Error('MP4 export target was not initialized.');
        }

        offline.dispose();
        setIsExporting(false);
        setExportProgress(1);
        return;
      } catch (err) {
        if (videoEncoder?.state !== 'closed') {
          try { videoEncoder?.close(); } catch { }
        }
        if (mp4Writable) {
          try { await mp4Writable.abort?.(); } catch { }
          mp4Writable = null;
        }
        console.error('WebCodecs 3D export failed, falling back to MediaRecorder:', err);
        setProjectMessages(['当前设备不支持稳定的高速导出，已自动切换到实时录制模式']);
      }
    }

    // --- Fallback: MediaRecorder (real-time rendering) ---
    if (canFastExport) {
      if (window.electronAPI?.isElectron) {
        desktopExportPath = await requestElectronExportPath(downloadBaseName, realtimeFormat.extension);
        if (!desktopExportPath) {
          offline.dispose();
          setIsExporting(false);
          return;
        }
      } else if (showSaveFilePicker && !realtimeWritable) {
        try {
          const handle = await showSaveFilePicker({
            suggestedName: `${downloadBaseName}.${realtimeFormat.extension}`,
            types: [{
              description: realtimeFormat.description,
              accept: { [realtimeFormat.mimeType.split(';')[0]]: [`.${realtimeFormat.extension}`] },
            }],
          });
          realtimeWritable = await handle.createWritable();
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            offline.dispose();
            setIsExporting(false);
            return;
          }
          console.warn('WebM file picker unavailable, falling back to in-memory download:', err);
        }
      }
    }

    const streamV = (offline.renderer.domElement as any).captureStream
      ? (offline.renderer.domElement as any).captureStream(fps)
      : null;
    if (!streamV) {
      if (realtimeWritable) {
        try { await realtimeWritable.abort?.(); } catch { }
      }
      offline.dispose();
      setIsExporting(false);
      return;
    }

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

    let activeRealtimeFormat = realtimeFormat;
    let recorder: MediaRecorder;
    try {
      const recorderFormats = realtimeWritable
        ? getMediaRecorderExportFormats().filter((format) => format.extension === realtimeFormat.extension)
        : getMediaRecorderExportFormats();
      const startedRecorder = startMediaRecorderWithFallback(stream, recorderFormats, 100);
      recorder = startedRecorder.recorder;
      activeRealtimeFormat = startedRecorder.format;
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      if (realtimeWritable) {
        try { await realtimeWritable.abort?.(); } catch { }
      }
      offline.dispose();
      setIsExporting(false);
      alert('实时录制导出失败：' + (err instanceof Error ? err.message : String(err)));
      return;
    }

    if (desktopExportPath && activeRealtimeFormat.extension !== realtimeFormat.extension) {
      recorder.stop();
      const updatedPath = await requestElectronExportPath(downloadBaseName, activeRealtimeFormat.extension);
      if (!updatedPath) {
        stream.getTracks().forEach((track) => track.stop());
        offline.dispose();
        setIsExporting(false);
        return;
      }
      desktopExportPath = updatedPath;
      recorder = startMediaRecorderWithFallback(stream, [activeRealtimeFormat], 100).recorder;
    }

    const mime = activeRealtimeFormat.mimeType;
    const chunks: Blob[] = [];
    let realtimeWriteChain = Promise.resolve();
    recorder.ondataavailable = (e: any) => {
      if (!e.data || e.data.size <= 0) return;
      if (realtimeWritable) {
        realtimeWriteChain = realtimeWriteChain.then(() => realtimeWritable.write(e.data));
      } else {
        chunks.push(e.data);
      }
    };

    if (source) source.start(0, inPointMs / 1000);

    const recordStart = performance.now();
    const drawFrame = async () => {
      const elapsed = performance.now() - recordStart;
      const currentFrameIdx = Math.min(Math.floor(elapsed / stepMs), totalFrames);
      const t = Math.min(inPointMs + currentFrameIdx * stepMs, outPointMs);
      const sceneState = computeSceneStateAtTime(t);

      offline.updateAtTime(t, sceneState.positions, sceneState.rotations, sceneState.hiddenGroupIds);
      offline.renderer.render(offline.scene, offline.camera);

      setExportProgress(0.7 + Math.min(0.3, (currentFrameIdx / totalFrames) * 0.3));

      if (elapsed < totalMs + stepMs) {
        requestAnimationFrame(drawFrame);
      } else {
        recorder.stop();
        if (source) { try { source.stop(); } catch { } }
        offline.dispose();
      }
    };
    requestAnimationFrame(drawFrame);

    let blob: Blob;
    try {
      blob = await withTimeout(new Promise<Blob>((resolve, reject) => {
        recorder.onerror = (event) => reject((event as any).error || new Error('MediaRecorder 导出失败'));
        recorder.onstop = () => {
          realtimeWriteChain
            .then(async () => {
              if (realtimeWritable) {
                await realtimeWritable.close();
                resolve(new Blob([], { type: mime }));
              } else {
                resolve(new Blob(chunks, { type: mime }));
              }
            })
            .catch(async err => {
              if (realtimeWritable) {
                try { await realtimeWritable.abort?.(); } catch { }
              }
              reject(err);
            });
        };
      }), Math.max(totalMs + 15000, 30000), '3D 实时录制');
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      offline.dispose();
      setIsExporting(false);
      alert('实时录制导出失败：' + (err instanceof Error ? err.message : String(err)));
      return;
    }

    stream.getTracks().forEach((track) => track.stop());
    setIsExporting(false);
    setExportProgress(1);

    if (!realtimeWritable) {
      if (desktopExportPath) {
        await writeBlobToElectronPath(desktopExportPath, blob);
      } else {
        downloadBlob(blob, `${downloadBaseName}.${activeRealtimeFormat.extension}`);
      }
    }
  };

  const handleOpenExportModal = () => {
    const projectDuration = Math.max(
      totalDuration,
      audioBuffer ? audioBuffer.duration * 1000 : 0,
      1000,
    );
    if (inPointMs == null) setInPointMs(0);
    if (outPointMs == null || outPointMs <= (inPointMs ?? 0)) setOutPointMs(projectDuration);
    setShowExportModal(true);
  };

  const handleConfirmExport = async () => {
    if (inPointMs == null || outPointMs == null || outPointMs <= inPointMs) {
      alert('请设置有效的导出入点和出点，出点必须晚于入点。');
      return;
    }
    if (!export2D && !export3D) {
      alert('请至少选择一种输出：2D 视频或 3D 视频。');
      return;
    }

    setShowExportModal(false);
    if (export2D) await handleExportVideo2D();
    if (export3D) await handleExportVideo3D();
  };

  const handleSelectFrame = (id: string) => {
    setSelectedPerformerIds([]);
    setSelectedTransitionId(null);
    setSelectedTransitionPerformerId(null);
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
    setGridScale(prev => normalizeStageGridSpacing(prev + delta));
  };

  const cycleTimelineHeight = () => {
    if (timelineCollapsed) {
      setTimelineCollapsed(false);
      setTimelineHeight(previousTimelineHeightRef.current);
      return;
    }
    const presets = isCompactLayout ? [132, 200, 320] : [152, 220, 300];
    const next = presets.find((height) => height > timelineHeight + 12) ?? presets[0];
    setTimelineHeight(next);
  };

  const toggleTimelineVisibility = () => {
    setTimelineCollapsed((collapsed) => {
      if (collapsed) {
        setTimelineHeight(previousTimelineHeightRef.current);
        return false;
      }
      previousTimelineHeightRef.current = timelineHeight;
      return true;
    });
  };

  const displayedPositions = currentSceneState.positions;
  const displayedRotations = currentSceneState.rotations;
  const selectedTransitionLabel = selectedTransition
    ? `${frames.find((frame) => frame.id === selectedTransition.fromFrameId)?.name || '起点'} -> ${frames.find((frame) => frame.id === selectedTransition.toFrameId)?.name || '终点'}`
    : null;

  // Determine total duration for Timeline rendering
  const totalDuration = frames.reduce(
    (maximum, frame) => Math.max(maximum, frame.startTime + frame.duration),
    0,
  );

  return (
    <div className={`min-h-[100dvh] h-[100dvh] w-screen flex flex-col safe-top safe-bottom ${theme === 'dark' ? 'bg-slate-950 text-slate-200' : 'bg-gray-50 text-gray-900'} overflow-hidden`}>
      {/* Help Modal */}
      <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
      {showProductGuide && <ProductGuide onClose={() => setShowProductGuide(false)} />}

      {/* Top Bar */}
      <div className={`min-h-12 flex items-center justify-between px-3 sm:px-4 border-b ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={`compact-only touch-target -ml-2 items-center justify-center rounded-lg ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-700 hover:bg-gray-100'}`}
            aria-label={sidebarCollapsed ? '打开侧栏' : '关闭侧栏'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={22} /> : <PanelLeftClose size={22} />}
          </button>
          <div className="flex items-center gap-2">
            <img src="./icons/icon-192.png" alt="CosStage" className="w-6 h-6" />
            <h1 className={`text-base sm:text-lg font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>CosStage</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowProductGuide(true)}
            className={`touch-target flex items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium transition-colors ${theme === 'dark' ? 'text-slate-300 hover:bg-slate-800 hover:text-blue-300' : 'text-gray-600 hover:bg-gray-100 hover:text-blue-600'}`}
            title="产品介绍与使用说明"
          >
            <BookOpen size={19} />
            <span className="desktop-only">产品指南</span>
          </button>
          <div
            className={`flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium ${
              theme === 'dark'
                ? 'border border-slate-700 bg-slate-800/70 text-slate-300'
                : 'border border-gray-200 bg-gray-100 text-gray-700'
            }`}
            title="使用反馈 QQ群：1016629275"
          >
            <MessageCircle size={17} />
            <span className="desktop-only">反馈QQ群</span>
            <span className="font-mono text-blue-400">1016629275</span>
          </div>
          <button
            onClick={() => setShowHelp(true)}
            className={`touch-target flex items-center justify-center rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-blue-400' : 'hover:bg-gray-100 text-gray-600 hover:text-blue-600'}`}
            title="帮助 (F1)"
          >
            <HelpCircle size={20} />
          </button>
          <button
            onClick={() => setViewMode(viewMode === '2d' ? '3d' : '2d')}
            className={`touch-target flex items-center justify-center rounded-lg transition-colors ${viewMode === '3d'
              ? 'bg-purple-600 text-white hover:bg-purple-500'
              : theme === 'dark'
                ? 'hover:bg-slate-800 text-slate-400 hover:text-purple-400'
                : 'hover:bg-gray-100 text-gray-600 hover:text-purple-600'
              }`}
            title={viewMode === '2d' ? '切换到 3D 视图' : '切换到 2D 视图'}
          >
            {viewMode === '2d' ? '🎲' : '🔲'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
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
            onApplyAIPlan={handleApplyAIPlan}
            onImportMusic={handleImportMusic}
            onExport={handleExportProject}
            onImportProject={handleImportProject}
            onImportProjectPackage={handleImportProjectPackage}
            onImportLegacyProject={handleImportLegacyProject}
            onExportProjectPackage={handleExportProjectPackage}
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
            isCompactLayout={isCompactLayout}
          />)}
        {!sidebarCollapsed && !isCompactLayout && (
          <div
            onPointerDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = sidebarWidth;
              e.currentTarget.setPointerCapture(e.pointerId);
              document.body.style.cursor = 'ew-resize';
              document.body.style.userSelect = 'none';
              const onMove = (ev: PointerEvent) => {
                const dx = ev.clientX - startX;
                const next = Math.max(240, Math.min(480, startW + dx));
                setSidebarWidth(next);
              };
              const onUp = () => {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
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

        <div className={`min-w-0 flex-1 flex flex-col relative ${theme === 'dark' ? 'bg-black' : 'bg-gray-100'}`}>
          <div className="min-h-0 flex-1 flex flex-col relative">
          {!isCompactLayout && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className={`desktop-only group absolute left-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-lg border text-xs font-semibold shadow-lg transition-all ${
                theme === 'dark'
                  ? 'border-blue-500/50 bg-blue-500/15 text-blue-100 hover:border-blue-400 hover:bg-blue-500/25'
                  : 'border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-400 hover:bg-blue-100'
              }`}
              title={sidebarCollapsed ? '打开左侧栏' : '收起左侧栏'}
              aria-label={sidebarCollapsed ? '打开左侧栏' : '收起左侧栏'}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              <span
                className={`pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium opacity-0 shadow-lg transition-opacity group-hover:opacity-100 ${
                  theme === 'dark'
                    ? 'border-slate-700 bg-slate-900 text-slate-100'
                    : 'border-gray-200 bg-white text-gray-700'
                }`}
              >
                {sidebarCollapsed ? '打开侧栏' : '收起侧栏'}
              </span>
            </button>
          )}

          <div className={`stage-status absolute top-4 z-10 pointer-events-none ${isCompactLayout ? 'left-4' : 'left-16'}`}>
            <div className={`backdrop-blur px-4 py-2 rounded-lg border text-sm shadow-xl ${theme === 'dark' ? 'bg-slate-900/90 border-slate-700 text-slate-400' : 'bg-white/90 border-gray-300 text-gray-700'}`}>
              正在编辑：<span className="text-blue-400 font-bold ml-1">{selectedTransitionLabel || frames.find(f => f.id === currentFrameId)?.name || '过渡/GAP'}</span>
              <div className={`text-[10px] mt-1 ${theme === 'dark' ? 'text-slate-500' : 'text-gray-500'}`}>{selectedPerformerIds.length} 人已选中</div>
            </div>
          </div>

          {viewMode === '2d' ? (
            <Stage
              performers={performers}
              performerGroups={performerGroups}
              hiddenGroupIds={activeHiddenGroupIds}
              positions={displayedPositions}
              rotations={displayedRotations}
              transitionPaths={selectedTransitionPaths}
              selectedPerformerIds={selectedPerformerIds}
              onSelectionChange={setSelectedPerformerIds}
              onPositionChange={handlePositionChange}
              onTransitionControlPointChange={handleTransitionControlPointChange}
              onTransitionStartPointChange={handleTransitionStartPointChange}
              onTransitionObjectSelect={setSelectedTransitionPerformerId}
              onRotationStart={handleRotationStart}
              onRotationChange={handleRotationChange}
              onRotationEnd={handleRotationEnd}
              onDragStart={handleStageDragStart}
              onDragEnd={handleStageDragEnd}
              onUpdatePerformer={handleUpdatePerformer}
              readonly={isPlaying}
              showLabels={showLabels}
              gridScale={gridScale}
              onZoom={handleGridZoom}
              stageConfig={stageConfig}
            />
          ) : (
            <Stage3D
              performers={performers}
              positions={displayedPositions}
              rotations={displayedRotations}
              selectedIds={selectedPerformerIds}
              onSelect={setSelectedPerformerIds}
              hiddenGroupIds={activeHiddenGroupIds}
              onPositionChange={handlePositionChange}
              onDragStart={handleStageDragStart}
              onDragEnd={handleStageDragEnd}
              onUpdatePerformer={handleUpdatePerformer}
              onRemovePerformer={handleRemovePerformer}
              stageConfig={stageConfig}
              mediaCache={mediaCache}
              currentTime={currentTime}
              isPlaying={isPlaying}
              gridScale={gridScale}
              readonly={isPlaying}
            />
          )}

          {selectedTransition && selectedTransitionFrames && (
            <div
              className="absolute right-4 z-40 w-[min(380px,calc(100vw-2rem))] rounded-xl border border-slate-700 bg-slate-900/95 p-3 text-slate-100 shadow-2xl backdrop-blur"
              style={{
                top: isCompactLayout ? 12 : 16,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">过渡参数</div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-400">
                    {selectedTransitionFrames.fromFrame.name} → {selectedTransitionFrames.toFrame.name}
                    <span className="ml-2">{(selectedTransition.duration / 1000).toFixed(1)} 秒</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleSelectTransition(null)}
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                  aria-label="关闭过渡参数"
                >
                  <X size={15} />
                </button>
              </div>

              {transitionSelectablePerformers.length === 0 ? (
                <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-400">
                  当前过渡没有同时存在于前后队形的对象，无法配置路径。
                </div>
              ) : (
                <>
                  <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950/70 p-1.5">
                    <div className="grid grid-cols-2 gap-1">
                      {transitionSelectablePerformers.map((performer) => {
                        const motion = selectedTransition.objectMotions[performer.id];
                        const selected = performer.id === selectedTransitionPerformerId;
                        return (
                          <button
                            key={performer.id}
                            type="button"
                            onClick={() => setSelectedTransitionPerformerId(performer.id)}
                            className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[11px] ${selected ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                          >
                            <span className="truncate">{performer.name}</span>
                            <span className="shrink-0 text-[9px] opacity-75">
                              {motion?.pathType === 'bezier' ? '曲线' : '直线'}
                              {performer.type === 'prop' ? ` · ${motion?.rotationMode === 'fixed' ? '固定' : '旋转'}` : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={`grid gap-2 ${canEditSelectedTransitionRotation ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <label className="text-[10px] text-slate-400">
                      路径
                      <select
                        value={selectedTransitionMotion.pathType || 'linear'}
                        onChange={(event) => updateSelectedTransitionMotion({
                          pathType: event.target.value as 'linear' | 'bezier',
                          controlPoints: event.target.value === 'bezier' ? (selectedTransitionMotion.controlPoints || undefined) : undefined,
                        })}
                        className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                      >
                        <option value="linear">直线</option>
                        <option value="bezier">Bezier 曲线</option>
                      </select>
                    </label>

                    {canEditSelectedTransitionRotation && (
                      <label className="text-[10px] text-slate-400">
                        旋转模式
                        <select
                          value={selectedTransitionMotion.rotationMode || 'lerp'}
                          onChange={(event) => updateSelectedTransitionMotion({ rotationMode: event.target.value as 'fixed' | 'lerp' })}
                          className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                        >
                          <option value="lerp">旋转插值</option>
                          <option value="fixed">固定朝向</option>
                        </select>
                      </label>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={resetSelectedTransitionMotion}
                    disabled={!selectedTransitionPerformerId || !selectedTransition.objectMotions[selectedTransitionPerformerId]}
                    className="mt-2 h-9 w-full rounded-md border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    重置当前对象
                  </button>

                  {canEditSelectedTransitionRotation && selectedTransitionPerformerId && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="text-[10px] text-slate-400">
                        起始队形角度
                        <EditableNumberInput
                          step={1}
                          value={selectedTransitionFrames.fromFrame.rotations?.[selectedTransitionPerformerId]
                            ?? selectedTransitionPerformer?.rotation
                            ?? 0}
                          onChange={(value) => {
                            handleFrameRotationChange(selectedTransitionFrames.fromFrame.id, selectedTransitionPerformerId, value);
                          }}
                          className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-slate-100 outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-[10px] text-slate-400">
                        目标队形角度
                        <EditableNumberInput
                          step={1}
                          value={selectedTransitionFrames.toFrame.rotations?.[selectedTransitionPerformerId]
                            ?? selectedTransitionPerformer?.rotation
                            ?? 0}
                          onChange={(value) => {
                            handleFrameRotationChange(selectedTransitionFrames.toFrame.id, selectedTransitionPerformerId, value);
                          }}
                          className="mt-1 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-slate-100 outline-none focus:border-blue-500"
                        />
                      </label>
                    </div>
                  )}

                  {(selectedTransitionMotion.pathType || 'linear') === 'bezier' && (
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
                                  value={selectedTransitionMotion.controlPoints?.[index]?.[axis] ?? 0}
                                  onChange={(value) => handleTransitionMotionControlPointChange(index, axis, value)}
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

          <div
            onPointerDown={(e) => {
              e.preventDefault();
              if (timelineCollapsed) {
                setTimelineCollapsed(false);
                setTimelineHeight(previousTimelineHeightRef.current);
                return;
              }
              const startY = e.clientY;
              const startH = timelineHeight;
              let moved = false;
              e.currentTarget.setPointerCapture(e.pointerId);
              const onMove = (ev: PointerEvent) => {
                const dy = ev.clientY - startY;
                if (Math.abs(dy) > 4) moved = true;
                const minimum = isCompactLayout ? 132 : 152;
                const maximum = Math.min(
                  isCompactLayout ? 360 : 300,
                  Math.round(window.innerHeight * 0.58),
                );
                const next = Math.max(minimum, Math.min(maximum, startH - dy));
                setTimelineHeight(next);
              };
              const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                if (!moved) cycleTimelineHeight();
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
              window.addEventListener('pointercancel', onUp);
            }}
            className={`timeline-resizer relative z-30 h-7 min-h-7 cursor-ns-resize touch-none flex items-center justify-center transition-colors ${theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700' : 'bg-gray-300 hover:bg-gray-400'}`}
            role="slider"
            aria-label="调整时间轴高度"
            aria-valuemin={isCompactLayout ? 132 : 152}
            aria-valuemax={isCompactLayout ? 360 : 300}
            aria-valuenow={timelineCollapsed ? 0 : Math.round(timelineHeight)}
            title="上下拖动调整时间轴高度，轻点切换高度"
          >
            <div className={`timeline-resizer-control flex h-6 min-w-32 items-center justify-center gap-1 rounded-full border pl-3 pr-1 text-[10px] shadow ${theme === 'dark' ? 'border-slate-600 bg-slate-900 text-slate-300' : 'border-gray-300 bg-white text-gray-600'}`}>
              <GripHorizontal className="pointer-events-none" size={16} />
              <span className="pointer-events-none">{timelineCollapsed ? '时间轴已隐藏' : `时间轴 ${Math.round(timelineHeight)}px`}</span>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={toggleTimelineVisibility}
                className={`ml-1 flex h-5 w-7 items-center justify-center rounded-full transition-colors ${theme === 'dark' ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}
                aria-label={timelineCollapsed ? '展开时间轴' : '隐藏时间轴'}
                title={timelineCollapsed ? '展开时间轴' : '隐藏时间轴'}
              >
                {timelineCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>

          {/* Floating Stage Toolbar */}
          <div className={`stage-toolbar absolute bottom-3 right-3 z-20 backdrop-blur p-1.5 lg:p-2 rounded-lg border shadow-xl animate-in fade-in slide-in-from-bottom-4 mobile-compact-scroll ${theme === 'dark' ? 'bg-slate-900/90 border-slate-700' : 'bg-white/90 border-gray-300'}`}>
            {stageToolbarCollapsed ? (
              <button
                onClick={() => setStageToolbarCollapsed(false)}
                className={`${theme === 'dark' ? 'text-slate-300 hover:bg-slate-700 hover:text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'} flex h-9 w-9 items-center justify-center rounded-full transition-colors`}
                title="打开舞台设置"
                aria-label="打开舞台设置"
              >
                <SlidersHorizontal size={17} />
              </button>
            ) : (
              <div className="flex items-center gap-2 min-w-max">
                <button
                  onClick={() => setStageToolbarCollapsed(true)}
                  className={`${theme === 'dark' ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'} flex h-8 w-8 items-center justify-center rounded-full transition-colors`}
                  title="收起舞台设置"
                  aria-label="收起舞台设置"
                >
                  <SlidersHorizontal size={16} />
                </button>
                <div className={`desktop-only w-px h-6 mx-1 ${theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'}`}></div>
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
                  <span className={`w-12 text-center font-mono text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>{gridScale.toFixed(1)}m</span>
                  <button onClick={() => handleGridZoom(0.5)} className={theme === 'dark' ? 'text-slate-500 hover:text-white' : 'text-gray-500 hover:text-gray-900'}><PlusCircle size={16} /></button>
                </div>
              </div>
            )}
          </div>
          </div>

          {!timelineCollapsed && <Timeline
            performers={performers}
            frames={frames}
            transitions={transitions}
            duration={Math.max(
              totalDuration + 10000,
              audioBuffer ? audioBuffer.duration * 1000 : 0,
              audioMarkers.reduce((maximum, marker) => Math.max(maximum, marker.timeMs + 10000), 0),
              30000,
            )}
            currentTime={currentTime}
            audioBuffer={audioBuffer}
            isPlaying={isPlaying}
            onPlayPause={handlePlayPause}
            onSeek={handleSeek}
            onFrameUpdate={setFrames}
            onAddFrame={handleAddFrame}
            onSelectFrame={handleSelectFrame}
            selectedFrameId={selectedPerformerIds.length > 0 ? null : currentFrameId}
            selectedTransitionId={selectedTransitionId}
            onSelectTransition={handleSelectTransition}
            selectedMotionPerformerId={selectedTransitionPerformerId}
            onSelectedMotionPerformerChange={setSelectedTransitionPerformerId}
            onTransitionUpdate={handleTransitionUpdate}
            onTransitionDelete={handleTransitionDelete}
            onFrameRotationChange={handleFrameRotationChange}
            audioMarkers={audioMarkers}
            onAudioMarkersChange={setAudioMarkers}
            heightPx={timelineHeight}
            onRenameFrame={handleRenameFrame}
            inPointMs={inPointMs}
            outPointMs={outPointMs}
            onExportVideo={handleOpenExportModal}
            isExporting={isExporting}
            exportProgress={exportProgress}
          />}
        </div>
      </div>

      {projectMessages.length > 0 && (
        <div className="fixed right-4 top-4 z-[60000] w-[min(420px,calc(100vw-2rem))] rounded-lg border border-blue-500/40 bg-slate-950/95 p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 text-sm text-slate-200">
              {projectMessages.map((message, index) => <div key={`${message}-${index}`}>{message}</div>)}
            </div>
            <button
              type="button"
              onClick={() => setProjectMessages([])}
              className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="关闭项目提示"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {showExportModal && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-white">导出视频</h2>
                <p className="mt-1 text-xs text-slate-400">设置时间范围和输出格式，可同时生成 2D 与 3D 视频。</p>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="关闭导出设置"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 p-5">
              <div>
                <label className="mb-2 block text-xs font-medium text-slate-300">导出时间范围</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                    <span className="mb-2 block text-[11px] text-slate-500">入点（秒）</span>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={((inPointMs ?? 0) / 1000).toFixed(1)}
                        onChange={(e) => setInPointMs(Math.max(0, Number(e.target.value) * 1000))}
                        className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                      <button onClick={() => setInPointMs(currentTime)} className="rounded border border-slate-700 px-2 text-[11px] text-slate-300 hover:bg-slate-800">当前</button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                    <span className="mb-2 block text-[11px] text-slate-500">出点（秒）</span>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={((outPointMs ?? 0) / 1000).toFixed(1)}
                        onChange={(e) => setOutPointMs(Math.max(0, Number(e.target.value) * 1000))}
                        className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                      <button onClick={() => setOutPointMs(currentTime)} className="rounded border border-slate-700 px-2 text-[11px] text-slate-300 hover:bg-slate-800">当前</button>
                    </div>
                  </div>
                </div>
                {inPointMs != null && outPointMs != null && outPointMs <= inPointMs && (
                  <p className="mt-2 text-xs text-red-400">出点必须晚于入点。</p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-slate-300">输出类型</label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${export2D ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-950/60'}`}>
                    <input type="checkbox" checked={export2D} onChange={(e) => setExport2D(e.target.checked)} />
                    <span className="text-sm text-slate-200">2D 视频</span>
                  </label>
                  <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${export3D ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-950/60'}`}>
                    <input type="checkbox" checked={export3D} onChange={(e) => setExport3D(e.target.checked)} />
                    <span className="text-sm text-slate-200">3D 视频</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                  显示姓名
                  <input type="checkbox" checked={exportIncludeLabels} onChange={(e) => setExportIncludeLabels(e.target.checked)} />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                  显示网格
                  <input type="checkbox" checked={exportIncludeGrid} onChange={(e) => setExportIncludeGrid(e.target.checked)} />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-400">
                  <span className="mb-2 block">分辨率</span>
                  <select value={exportResolution} onChange={(e) => setExportResolution(e.target.value as '1080p' | '2k' | '4k')} className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
                    <option value="1080p">1080p（1920×1080）</option>
                    <option value="2k">2K（2560×1440）</option>
                    <option value="4k">4K（3840×2160）</option>
                  </select>
                </label>
                <label className={`text-xs text-slate-400 ${export3D ? '' : 'opacity-50'}`}>
                  <span className="mb-2 block">3D 机位</span>
                  <select disabled={!export3D} value={exportCameraAngle} onChange={(e) => setExportCameraAngle(e.target.value as CameraAngle)} className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:cursor-not-allowed">
                    <option value="judge">评委视角</option>
                    <option value="overhead">45°俯视</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-700 px-5 py-4">
              <button onClick={() => setShowExportModal(false)} className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">取消</button>
              <button
                onClick={handleConfirmExport}
                disabled={!export2D && !export3D}
                className="rounded bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                开始导出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
