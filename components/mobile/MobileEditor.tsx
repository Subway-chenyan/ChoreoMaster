import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Hand,
  Layers,
  Magnet,
  Maximize,
  MoreHorizontal,
  MousePointer2,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Share2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { Stage } from '../Stage';
import { MobileSheet } from './MobileSheet';
import { MobileNumberInput } from './MobileNumberInput';
import { useProjectEditor } from '../../mobile/use-project-editor';
import {
  addActor,
  changeFormationDuration,
  duplicateFormation,
  moveActors,
  removeActors,
  removeFormation,
} from '../../mobile/editor-model';
import { newId } from '../../mobile/project-store';
import { onAndroidBack, shareProjectFile } from '../../mobile/native';
import { writeProjectPackage, type PortableProject } from '../../mobile/project-package';
import { evaluateSceneStateAtTime, getSortedFrames } from '../../utils/transitions';
import { getEffectivelyLockedPerformerIds } from '../../utils/performer-locking';
import type { Frame, Performer, Position, ProjectDocument } from '../../types';

const COLORS = ['#38bdf8', '#f472b6', '#a78bfa', '#34d399', '#fbbf24', '#fb923c'];
type Sheet = 'actors' | 'formation' | 'stage' | 'project' | 'delete-actors' | 'delete-frame' | null;
const timeLabel = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, '0')}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;

function FormationPreview({ frame, document }: { frame: Frame; document: ProjectDocument }) {
  return (
    <svg viewBox="0 0 100 60" aria-hidden="true">
      <rect x="1" y="1" width="98" height="58" rx="4" fill="#19273b" stroke="#334155" />
      <path d="M50 1v58M1 30h98" stroke="#334155" strokeDasharray="2 3" />
      {document.performers.slice(0, 120).map((p) => {
        const pos = frame.positions[p.id];
        return pos ? (
          <circle
            key={p.id}
            cx={Math.max(3, Math.min(97, pos.x))}
            cy={Math.max(3, Math.min(57, pos.y * 0.6))}
            r="2.5"
            fill={p.color}
          />
        ) : null;
      })}
    </svg>
  );
}

export default function MobileEditor({
  id,
  initial,
  onExit,
}: {
  id: string;
  initial: PortableProject;
  onExit: () => void;
}) {
  const editor = useProjectEditor(id, initial);
  const doc = editor.document;
  const [selectedFrameId, setSelectedFrameId] = useState(doc.frames[0]?.id ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [mode, setMode] = useState<'select' | 'multi' | 'pan'>('select');
  const [snap, setSnap] = useState(true);
  const [labels, setLabels] = useState(true);
  const [resetView, setResetView] = useState(0);
  const [preview, setPreview] = useState<Record<string, Position> | null>(null);
  const [time, setTime] = useState(doc.frames[0]?.startTime ?? 0);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState(initial.warnings.join('\n'));
  const [busy, setBusy] = useState(false);
  const [newActorName, setNewActorName] = useState('');
  const [audioDuration, setAudioDuration] = useState(0);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const audio = useRef<HTMLAudioElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const sorted = useMemo(() => getSortedFrames(doc.frames), [doc.frames]);
  const frame = sorted.find((item) => item.id === selectedFrameId) ?? sorted[0];
  const frameIndex = sorted.findIndex((item) => item.id === frame?.id);
  const locked = useMemo(
    () => [...getEffectivelyLockedPerformerIds(doc.performers, doc.performerGroups)],
    [doc.performers, doc.performerGroups]
  );
  const selectedActor = doc.performers.find((actor) => actor.id === selected[0]);
  const duration = Math.max(...sorted.map((f) => f.startTime + f.duration), audioDuration, 1000);
  const previewing = playing || Math.abs(time - (frame?.startTime ?? 0)) > 1;
  const scene = useMemo(
    () => evaluateSceneStateAtTime(time, doc.frames, doc.performers, doc.transitions ?? []),
    [time, doc.frames, doc.performers, doc.transitions]
  );
  const commit = (next: ProjectDocument) => editor.dispatch({ type: 'commit', document: next });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const urls = Object.fromEntries(
      Object.entries(editor.assets).map(([path, blob]) => [path, URL.createObjectURL(blob)])
    );
    setMediaUrls(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [editor.assets]);
  // 只在渲染副本中添加素材 URL，导出和历史记录始终保留相对路径。
  const runtimeModels = useMemo(() => {
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(walk);
      if (!value || typeof value !== 'object') return value;
      const record = value as Record<string, unknown>;
      return {
        ...Object.fromEntries(
          Object.entries(record)
            .filter(([key]) => key !== 'runtimeUrl')
            .map(([key, child]) => [key, walk(child)])
        ),
        ...(typeof record.assetPath === 'string' ? { runtimeUrl: mediaUrls[record.assetPath] } : {}),
      };
    };
    return walk(doc.modelAssets) as typeof doc.modelAssets;
  }, [doc.modelAssets, mediaUrls]);
  const openSheet = (next: Sheet) => {
    if (frame) setTime(frame.startTime);
    setPlaying(false);
    setPreview(null);
    setSheet(next);
  };
  const selectFrame = (next: Frame) => {
    setPlaying(false);
    setPreview(null);
    setSelectedFrameId(next.id);
    setTime(next.startTime);
    if (audio.current) audio.current.currentTime = next.startTime / 1000;
  };
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const leave = async () => {
    setPlaying(false);
    await editor.flush();
    onExit();
  };
  const backAction = useRef(() => undefined as void);
  backAction.current = () => {
    if (busy) return;
    if (sheet) setSheet(null);
    else void run(leave);
  };
  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    void onAndroidBack(() => backAction.current()).then((cleanup) => {
      if (disposed) cleanup();
      else remove = cleanup;
    });
    return () => {
      disposed = true;
      remove?.();
    };
  }, []);
  const playbackStart = useRef({ time: 0, clock: 0 });
  const togglePlayback = async () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    const next = time >= duration - 10 ? 0 : time;
    if (audio.current && doc.musicAsset && mediaUrls[doc.musicAsset]) {
      audio.current.currentTime = next / 1000;
      try {
        await audio.current.play();
      } catch {
        setMessage('音乐无法播放，请检查格式或重新导入 MP3 / WAV。');
        return;
      }
    }
    setTime(next);
    playbackStart.current = { time: next, clock: performance.now() };
    setPreview(null);
    setPlaying(true);
  };
  useEffect(() => {
    if (!playing) {
      audio.current?.pause();
      return;
    }
    let raf = 0;
    const tick = () => {
      const next =
        audio.current && !audio.current.paused && !audio.current.ended
          ? audio.current.currentTime * 1000
          : playbackStart.current.time + performance.now() - playbackStart.current.clock;
      if (next >= duration) {
        setTime(duration);
        setPlaying(false);
        return;
      }
      setTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [playing, duration]);
  useEffect(() => {
    const pause = () => {
      if (document.visibilityState === 'hidden') setPlaying(false);
    };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  useEffect(() => {
    if (!frame) return;
    if (frame.id !== selectedFrameId) {
      setSelectedFrameId(frame.id);
      setTime(frame.startTime);
    }
  }, [frame, selectedFrameId]);
  const finishDrag = (_ids: string[], updates?: { id: string; pos: Position }[]) => {
    setPreview(null);
    if (
      !frame ||
      !updates ||
      !updates.some(
        ({ id: actorId, pos }) =>
          Math.abs(pos.x - (frame.positions[actorId]?.x ?? pos.x)) > 0.001 ||
          Math.abs(pos.y - (frame.positions[actorId]?.y ?? pos.y)) > 0.001
      )
    )
      return;
    commit(moveActors(doc, frame.id, updates));
  };
  const undo = (type: 'undo' | 'redo') => {
    setPlaying(false);
    setPreview(null);
    editor.dispatch({ type });
  };
  const changeActor = (updates: Partial<Performer>) => {
    if (!selectedActor) return;
    commit({
      ...doc,
      performers: doc.performers.map((actor) =>
        actor.id === selectedActor.id ? { ...actor, ...updates } : actor
      ),
    });
  };
  const chooseMusic = (file?: File) =>
    run(async () => {
      if (!file) return;
      if (file.size > 40 * 1024 * 1024) throw new Error('音乐文件不能超过 40 MB');
      const path = `assets/audio/${newId()}-${file.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`;
      editor.setAssets({ ...editor.assets, [path]: file });
      commit({ ...doc, musicAsset: path, musicName: file.name });
      setPlaying(false);
      setAudioDuration(0);
      setMessage('音乐已添加，完整项目包会一起保存音乐。');
    });
  const exportProject = () =>
    run(async () => {
      setPlaying(false);
      await editor.flush();
      const file = await writeProjectPackage(doc, editor.assets);
      await shareProjectFile(file, doc.name);
      setMessage('已交给系统分享或下载。请在接收端确认文件保存完成。');
    });
  return (
    <main className="mobile-app mobile-editor">
      <header className="mobile-editor__header">
        <button
          className="mobile-icon"
          aria-label="返回项目库"
          disabled={busy}
          onClick={() => void run(leave)}
        >
          <ArrowLeft size={22} />
        </button>
        <button className="mobile-editor__title" onClick={() => openSheet('project')}>
          <strong>{doc.name}</strong>
          <small className={editor.saveStatus === 'error' ? 'mobile-save-error' : ''}>
            {editor.saveStatus === 'saving'
              ? '正在保存…'
              : editor.saveStatus === 'error'
              ? '保存失败，点击重试'
              : '已保存在本机'}{' '}
            <span>⌄</span>
          </small>
        </button>
        <button
          className="mobile-icon"
          aria-label="撤销"
          disabled={!editor.history.past.length || playing}
          onClick={() => undo('undo')}
        >
          <Undo2 size={20} />
        </button>
        <button
          className="mobile-icon"
          aria-label="重做"
          disabled={!editor.history.future.length || playing}
          onClick={() => undo('redo')}
        >
          <Redo2 size={20} />
        </button>
        <button className="mobile-icon" aria-label="项目与分享" onClick={() => openSheet('project')}>
          <MoreHorizontal size={22} />
        </button>
      </header>
      {editor.saveStatus === 'error' && (
        <button className="mobile-error" onClick={() => void run(editor.flush)}>
          本机保存失败：{editor.saveError}。点击重试；暂时不要关闭应用。
        </button>
      )}
      <div className="mobile-editor__workspace">
        <section className="mobile-editor__stage" aria-label="舞台编辑区域">
          <div className="mobile-stage-heading">
            <div>
              <span className="mobile-eyebrow">
                {previewing ? '排练预览 · 点选队形继续编辑' : '正在编辑'}
              </span>
              <strong>
                {frame?.name ?? '空舞台'}{' '}
                <small>
                  {frameIndex + 1} / {sorted.length}
                </small>
              </strong>
            </div>
            <button
              className="mobile-icon"
              aria-label="重置舞台视角"
              onClick={() => setResetView((value) => value + 1)}
            >
              <Maximize size={20} />
            </button>
          </div>
          {frame ? (
            <Stage
              touchMode={mode}
              viewResetKey={resetView}
              performers={doc.performers}
              performerGroups={doc.performerGroups}
              lockedPerformerIds={locked}
              hiddenGroupIds={previewing ? scene.hiddenGroupIds : frame.hiddenGroupIds}
              positions={previewing ? scene.positions : preview ?? frame.positions}
              rotations={previewing ? scene.rotations : frame.rotations}
              selectedPerformerIds={selected}
              onSelectionChange={setSelected}
              onPositionChange={(updates) =>
                setPreview({
                  ...frame.positions,
                  ...Object.fromEntries(
                    updates.map(({ id: actorId, pos }) => [actorId, { ...frame.positions[actorId], ...pos }])
                  ),
                })
              }
              onDragEnd={finishDrag}
              onDragCancel={() => setPreview(null)}
              stageConfig={doc.stageConfig}
              readonly={previewing}
              showLabels={labels}
              showDirectionArrows={false}
              gridScale={1}
              snapToGrid={snap}
              mediaCache={mediaUrls}
              modelAssets={runtimeModels}
              onPerformerContextMenu={(actorId) => {
                setSelected([actorId]);
                openSheet('actors');
              }}
            />
          ) : (
            <div className="mobile-empty">
              <p>这个项目没有队形。</p>
              <button
                className="mobile-primary"
                onClick={() => {
                  const next: Frame = {
                    id: newId(),
                    name: '开场',
                    startTime: 0,
                    duration: 4000,
                    positions: Object.fromEntries(
                      doc.performers.map((actor, index) => [
                        actor.id,
                        { x: 20 + (index % 6) * 12, y: 25 + (Math.floor(index / 6) % 5) * 12 },
                      ])
                    ),
                  };
                  commit({ ...doc, frames: [next] });
                  setSelectedFrameId(next.id);
                }}
              >
                创建队形
              </button>
            </div>
          )}
          <div className="mobile-stage-caption">
            <span>
              {selected.length
                ? `已选 ${selected.length} 人`
                : `${doc.stageConfig.width} × ${doc.stageConfig.depth} m · ${doc.performers.length} 位演员`}
            </span>
            <button
              aria-label="吸附到网格"
              aria-pressed={snap}
              className={snap ? 'active' : ''}
              onClick={() => setSnap((value) => !value)}
            >
              <Magnet size={15} /> {snap ? '吸附已开' : '自由移动'}
            </button>
          </div>
          <p className="mobile-gesture-hint">
            {mode === 'pan'
              ? '单指平移视角 · 双指缩放'
              : mode === 'multi'
              ? '点选多位演员，再切回移动整体拖动'
              : '拖动演员调整站位 · 双指缩放 / 平移'}
          </p>
        </section>
        <section className="mobile-editor__sequence" aria-label="队形与播放">
          <div className="mobile-playback">
            <button
              className="mobile-icon"
              aria-label="上一队形"
              disabled={frameIndex <= 0}
              onClick={() => selectFrame(sorted[frameIndex - 1])}
            >
              <ChevronLeft size={22} />
            </button>
            <button
              className="mobile-play"
              aria-label={playing ? '暂停排练' : '播放排练'}
              onClick={() => void togglePlayback()}
            >
              {playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}
            </button>
            <button
              className="mobile-icon"
              aria-label="下一队形"
              disabled={frameIndex >= sorted.length - 1}
              onClick={() => selectFrame(sorted[frameIndex + 1])}
            >
              <ChevronRight size={22} />
            </button>
            <span className="mobile-clock">
              {timeLabel(time)} <small>/ {timeLabel(duration)}</small>
            </span>
            <button className="mobile-icon" aria-label="导入音乐" onClick={() => musicInput.current?.click()}>
              <Music2 size={20} />
            </button>
          </div>
          <input
            className="mobile-scrubber"
            aria-label="播放位置"
            type="range"
            min={0}
            max={duration}
            step={50}
            value={time}
            onChange={(event) => {
              setPlaying(false);
              const next = Number(event.target.value);
              setTime(next);
              if (audio.current) audio.current.currentTime = next / 1000;
            }}
          />
          <div className="mobile-sequence-heading">
            <span>
              <Layers size={15} /> 队形序列
            </span>
            <button onClick={() => openSheet('formation')} disabled={!frame}>
              编辑时长与备注 <ChevronRight size={14} />
            </button>
          </div>
          <div className="mobile-filmstrip">
            {sorted.map((item, index) => (
              <button
                key={item.id}
                className={`mobile-frame ${item.id === frame?.id ? 'mobile-frame--active' : ''}`}
                aria-label={`队形 ${index + 1} ${item.name}`}
                aria-pressed={item.id === frame?.id}
                onClick={() => selectFrame(item)}
              >
                <FormationPreview frame={item} document={doc} />
                <span>
                  <b>{String(index + 1).padStart(2, '0')}</b> {item.name}
                </span>
                <small>{(item.duration / 1000).toFixed(1)} 秒</small>
              </button>
            ))}
            <button
              className="mobile-frame-add"
              aria-label="复制当前队形"
              disabled={!frame || playing}
              onClick={() => {
                if (!frame) return;
                const nextId = newId();
                const next = duplicateFormation(doc, frame.id, nextId);
                commit(next);
                const added = next.frames.find((f) => f.id === nextId);
                if (added) selectFrame(added);
              }}
            >
              <Plus size={23} />
              <span>复制队形</span>
            </button>
          </div>
        </section>
      </div>
      <nav className="mobile-tools" aria-label="舞台工具">
        <button
          aria-pressed={mode === 'select'}
          className={mode === 'select' ? 'active' : ''}
          onClick={() => setMode('select')}
        >
          <MousePointer2 size={20} />
          <span>移动</span>
        </button>
        <button
          aria-pressed={mode === 'multi'}
          className={mode === 'multi' ? 'active' : ''}
          onClick={() => setMode('multi')}
        >
          <Copy size={20} />
          <span>多选</span>
        </button>
        <button
          aria-pressed={mode === 'pan'}
          className={mode === 'pan' ? 'active' : ''}
          onClick={() => setMode('pan')}
        >
          <Hand size={20} />
          <span>平移</span>
        </button>
        <i />
        <button onClick={() => openSheet('actors')}>
          <Users size={20} />
          <span>演员</span>
        </button>
        <button onClick={() => openSheet('stage')}>
          <SlidersHorizontal size={20} />
          <span>舞台</span>
        </button>
      </nav>
      <input
        ref={musicInput}
        className="sr-only"
        type="file"
        accept="audio/*"
        aria-label="选择音乐文件"
        onChange={(event) => {
          void chooseMusic(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <audio
        ref={audio}
        src={doc.musicAsset ? mediaUrls[doc.musicAsset] : undefined}
        onLoadedMetadata={() => {
          const value = audio.current?.duration;
          if (value && Number.isFinite(value)) setAudioDuration(value * 1000);
        }}
        onError={() => {
          if (doc.musicAsset) {
            setPlaying(false);
            setMessage('音乐无法解码，请更换 MP3 或 WAV 文件。');
          }
        }}
      />
      {message && (
        <div className="mobile-notice" role="status">
          <span>{message}</span>
          <button className="mobile-icon" aria-label="关闭提示" onClick={() => setMessage('')}>
            <X size={18} />
          </button>
        </div>
      )}
      {sheet === 'actors' && (
        <MobileSheet title="演员与选择" onClose={() => setSheet(null)}>
          <form
            className="mobile-add-actor"
            onSubmit={(event) => {
              event.preventDefault();
              const actor: Performer = {
                id: newId(),
                name: newActorName.trim() || `演员 ${doc.performers.length + 1}`,
                label: `${doc.performers.length + 1}`,
                color: COLORS[doc.performers.length % COLORS.length],
                shape: 'circle',
                type: 'performer',
              };
              commit(addActor(doc, actor));
              setSelected([actor.id]);
              setNewActorName('');
            }}
          >
            <input
              placeholder="演员姓名"
              aria-label="新演员姓名"
              value={newActorName}
              maxLength={50}
              onChange={(e) => setNewActorName(e.target.value)}
            />
            <button className="mobile-primary">
              <Plus size={18} /> 添加
            </button>
          </form>
          <div className="mobile-actor-list">
            {doc.performers.map((actor) => (
              <button
                key={actor.id}
                className={selected.includes(actor.id) ? 'active' : ''}
                aria-pressed={selected.includes(actor.id)}
                onClick={() => setSelected([actor.id])}
              >
                <i style={{ background: actor.color }} />
                <span>{actor.name}</span>
                {locked.includes(actor.id) && <small>已锁定</small>}
                {selected.includes(actor.id) && <Check size={16} />}
              </button>
            ))}
          </div>
          {doc.performerGroups.length > 0 && (
            <div className="mobile-button-row">
              {doc.performerGroups.map((group) => (
                <button
                  className="mobile-secondary"
                  key={group.id}
                  onClick={() => {
                    setSelected(doc.performers.filter((p) => p.groupId === group.id).map((p) => p.id));
                    setMode('select');
                    setSheet(null);
                  }}
                >
                  选择 {group.name}
                </button>
              ))}
            </div>
          )}
          {selectedActor && (
            <div className="mobile-form mobile-actor-detail">
              <label>
                姓名
                <input
                  value={selectedActor.name}
                  maxLength={50}
                  onChange={(e) => changeActor({ name: e.target.value })}
                />
              </label>
              <div className="mobile-color-picker">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    aria-label={`演员颜色 ${color}`}
                    aria-pressed={selectedActor.color === color}
                    style={{ background: color }}
                    onClick={() => changeActor({ color })}
                  >
                    {selectedActor.color === color && <Check size={18} />}
                  </button>
                ))}
              </div>
              <div className="mobile-fields">
                <label>
                  形状
                  <select
                    value={selectedActor.shape}
                    onChange={(e) => changeActor({ shape: e.target.value as Performer['shape'] })}
                  >
                    <option value="circle">圆形</option>
                    <option value="square">方形</option>
                    <option value="triangle">三角形</option>
                  </select>
                </label>
                <label>
                  舞台朝向
                  <input
                    type="number"
                    min={0}
                    max={360}
                    value={frame?.rotations?.[selectedActor.id] ?? selectedActor.rotation ?? 0}
                    disabled={locked.includes(selectedActor.id)}
                    onChange={(e) => {
                      if (frame)
                        commit({
                          ...doc,
                          frames: doc.frames.map((f) =>
                            f.id === frame.id
                              ? {
                                  ...f,
                                  rotations: {
                                    ...f.rotations,
                                    [selectedActor.id]: Number(e.target.value) % 360,
                                  },
                                }
                              : f
                          ),
                        });
                    }}
                  />
                </label>
              </div>
              <label className="mobile-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(selectedActor.locked)}
                  onChange={(e) => changeActor({ locked: e.target.checked })}
                />{' '}
                锁定演员位置
              </label>
              <button
                className="mobile-danger"
                disabled={selected.every((actorId) => locked.includes(actorId))}
                onClick={() => setSheet('delete-actors')}
              >
                <Trash2 size={17} /> 删除所选演员
              </button>
            </div>
          )}
          {!doc.performers.length && <p className="mobile-muted">添加演员后，可直接在舞台上拖动站位。</p>}
        </MobileSheet>
      )}
      {sheet === 'formation' && frame && (
        <MobileSheet title="队形设置" onClose={() => setSheet(null)}>
          <div className="mobile-form">
            <label>
              队形名称
              <input
                value={frame.name}
                maxLength={80}
                onChange={(e) =>
                  commit({
                    ...doc,
                    frames: doc.frames.map((f) => (f.id === frame.id ? { ...f, name: e.target.value } : f)),
                  })
                }
              />
            </label>
            <label>
              保持时长（秒）
              <MobileNumberInput
                min={0.1}
                max={600}
                step={0.1}
                value={frame.duration / 1000}
                onValueChange={(value) => commit(changeFormationDuration(doc, frame.id, value * 1000))}
              />
            </label>
            <p className="mobile-muted">调整时长会同步平移后续队形，保留原有转场间隔与路径。</p>
            <label>
              排练备注
              <textarea
                value={frame.notes ?? ''}
                rows={3}
                maxLength={4000}
                placeholder="这段队形需要注意什么？"
                onChange={(e) =>
                  commit({
                    ...doc,
                    frames: doc.frames.map((f) => (f.id === frame.id ? { ...f, notes: e.target.value } : f)),
                  })
                }
              />
            </label>
            <button
              className="mobile-danger"
              disabled={sorted.length <= 1}
              onClick={() => setSheet('delete-frame')}
            >
              <Trash2 size={17} /> 删除队形
            </button>
          </div>
        </MobileSheet>
      )}
      {sheet === 'stage' && (
        <MobileSheet title="舞台设置" onClose={() => setSheet(null)}>
          <div className="mobile-form">
            <div className="mobile-fields">
              {(['width', 'depth', 'wingWidth'] as const).map((key) => (
                <label key={key}>
                  {{ width: '宽度（米）', depth: '深度（米）', wingWidth: '侧台（米）' }[key]}
                  <MobileNumberInput
                    step={0.5}
                    min={key === 'wingWidth' ? 0 : 1}
                    max={100}
                    value={doc.stageConfig[key] ?? 0}
                    onValueChange={(value) =>
                      commit({
                        ...doc,
                        stageConfig: {
                          ...doc.stageConfig,
                          [key]: Math.min(100, Math.max(key === 'wingWidth' ? 0 : 1, value)),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="mobile-toggle">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> 松手吸附到
              1 米网格
            </label>
            <label className="mobile-toggle">
              <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />{' '}
              显示演员姓名
            </label>
            <label className="mobile-toggle">
              <input
                type="checkbox"
                checked={doc.stageConfig.showStageLines !== false}
                onChange={(e) =>
                  commit({ ...doc, stageConfig: { ...doc.stageConfig, showStageLines: e.target.checked } })
                }
              />{' '}
              显示舞台辅助线
            </label>
            <button
              className="mobile-secondary"
              onClick={() => {
                setResetView((value) => value + 1);
                setSheet(null);
              }}
            >
              <RotateCcw size={18} /> 适应屏幕
            </button>
            <p className="mobile-muted">手机和电脑使用相同舞台坐标。调整视角不会改变演员位置。</p>
          </div>
        </MobileSheet>
      )}
      {sheet === 'project' && (
        <MobileSheet
          title="项目与分享"
          onClose={() => {
            if (!busy) setSheet(null);
          }}
        >
          <div className="mobile-form">
            <label>
              项目名称
              <input
                value={doc.name}
                maxLength={80}
                onChange={(e) => commit({ ...doc, name: e.target.value })}
              />
            </label>
            <div className="mobile-project-status">
              <Save size={18} />
              <div>
                <strong>
                  {editor.saveStatus === 'saved'
                    ? '已保存在本机'
                    : editor.saveStatus === 'saving'
                    ? '正在保存'
                    : '保存遇到问题'}
                </strong>
                <p>编辑后自动保存，导出项目包可备份到电脑。</p>
              </div>
            </div>
            <button className="mobile-primary" disabled={busy} onClick={() => void exportProject()}>
              <Share2 size={18} /> {busy ? '正在处理…' : '分享完整项目包'}
            </button>
            <button className="mobile-secondary" disabled={busy} onClick={() => musicInput.current?.click()}>
              <Music2 size={18} /> {doc.musicName ? `更换音乐 · ${doc.musicName}` : '导入排练音乐'}
            </button>
            <button className="mobile-secondary" disabled={busy} onClick={() => void run(editor.flush)}>
              <Save size={18} /> 立即保存 / 重试
            </button>
            <p className="mobile-muted">
              电脑端选择“导入完整项目包”打开导出的
              .zip。每次导入创建新项目，不覆盖已有版本。当前采用文件互传，不是云端自动同步。
            </p>
          </div>
        </MobileSheet>
      )}
      {(sheet === 'delete-actors' || sheet === 'delete-frame') && (
        <MobileSheet
          title={sheet === 'delete-frame' ? '删除这个队形？' : '删除所选演员？'}
          onClose={() => setSheet(null)}
        >
          <p>
            {sheet === 'delete-frame'
              ? '此队形及相连转场将被移除，其他队形的开始时间保持不变。'
              : '所选未锁定演员将从全部队形中移除。'}
            操作后可以撤销。
          </p>
          <div className="mobile-button-row">
            <button className="mobile-secondary" onClick={() => setSheet(null)}>
              取消
            </button>
            <button
              className="mobile-danger"
              onClick={() => {
                if (sheet === 'delete-frame' && frame) commit(removeFormation(doc, frame.id));
                else {
                  commit(removeActors(doc, selected));
                  setSelected([]);
                }
                setSheet(null);
              }}
            >
              确认删除
            </button>
          </div>
        </MobileSheet>
      )}
    </main>
  );
}
