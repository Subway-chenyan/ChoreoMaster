import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Maximize,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  PersonStanding,
  Play,
  SlidersHorizontal,
  Video,
  X,
} from 'lucide-react';
import { Stage } from '../Stage';
import type { PortableProject } from '../../mobile/project-package';
import { useRehearsalPlayback } from '../../mobile/use-rehearsal-playback';
import { onAndroidBack } from '../../mobile/native';
import { evaluateSceneStateAtTime, getSortedFrames } from '../../utils/transitions';
import {
  DEFAULT_REHEARSAL_DISPLAY,
  MAX_LABEL_SCALE,
  MAX_PERFORMER_SCALE,
  MIN_LABEL_SCALE,
  MIN_PERFORMER_SCALE,
  REHEARSAL_DISPLAY_STORAGE_KEY,
  clampLabelScale,
  clampPerformerScale,
  loadRehearsalDisplay,
  saveRehearsalDisplay,
  rehearsalTransitionPaths,
  type RehearsalDisplaySettings,
} from '../../mobile/rehearsal-display';

const noChange = () => undefined;
const stamp = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export default function MobileRehearsal({
  project,
  onExit,
}: {
  project: PortableProject;
  onExit: () => void;
}) {
  const doc = project.document;
  const frames = useMemo(() => getSortedFrames(doc.frames), [doc.frames]);
  const playback = useRehearsalPlayback(
    doc.musicAsset ? project.assets[doc.musicAsset] : undefined,
    Math.max(0, ...frames.map((frame) => frame.startTime + frame.duration))
  );
  const current = frames.filter((frame) => frame.startTime <= playback.time).at(-1) ?? frames[0];
  const index = frames.findIndex((frame) => frame.id === current?.id);
  const scene = useMemo(
    () => evaluateSceneStateAtTime(playback.time, doc.frames, doc.performers, doc.transitions ?? []),
    [playback.time, doc]
  );
  // 渲染副本关闭舞美素材；导入的 JSON 始终只读。
  const baseStage = useMemo(
    () => ({ ...doc.stageConfig, background: undefined, ledContent: undefined }),
    [doc.stageConfig]
  );
  const [display, setDisplay] = useState<RehearsalDisplaySettings>(() => {
    try {
      return loadRehearsalDisplay(localStorage.getItem(REHEARSAL_DISPLAY_STORAGE_KEY));
    } catch {
      return DEFAULT_REHEARSAL_DISPLAY;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [reset, setReset] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null);
  const transitionPaths = useMemo(
    () => rehearsalTransitionPaths(playback.time, frames, doc.performers, doc.transitions ?? [], highlightId),
    [playback.time, frames, doc.performers, doc.transitions, highlightId]
  );
  const updateDisplay = (patch: Partial<RehearsalDisplaySettings>) =>
    setDisplay((prev) => ({ ...prev, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem(REHEARSAL_DISPLAY_STORAGE_KEY, saveRehearsalDisplay(display));
    } catch { /* 隐私模式等存储不可用时仅跳过持久化 */ }
  }, [display]);
  const notes = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = useRef<HTMLButtonElement>(null);
  const exit = useRef(() => {});
  exit.current = () => {
    // 收起态里顶栏不可见，返回键先展开防误退
    if (collapsed) {
      setCollapsed(false);
      return;
    }
    playback.pause();
    onExit();
  };
  const collapse = () => {
    setSettingsOpen(false);
    setCollapsed(true);
  };
  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    void onAndroidBack(() => exit.current()).then((cleanup) => {
      if (disposed) cleanup();
      else remove = cleanup;
    });
    return () => {
      disposed = true;
      remove?.();
    };
  }, []);
  useEffect(() => {
    if (notes.current) notes.current.scrollTop = 0;
  }, [current?.id]);
  // 收起态没有队形列表：队形切换（含播放自动推进）时右上角短暂提示队形名
  const toastSeq = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!collapsed || !current) {
      setToast(null);
      return;
    }
    toastSeq.current += 1;
    setToast({ seq: toastSeq.current, text: `${index + 1}. ${current.name}` });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [current?.id, collapsed]);
  // 只读点选高亮：轻点演员切换高亮并在队形间保持。
  // pan 模式下 Stage 会对 pointerdown preventDefault 并捕获指针（click 被取消、
  // pointerup 被重定向），因此用 pointerup + elementFromPoint 做几何命中。
  const tapState = useRef<{ id: number; x: number; y: number; multi: boolean } | null>(null);
  // 切换队形后按播放：跳过当前队形持场，直接从队形末尾的过渡开始
  const jumpTarget = useRef<string | null>(null);
  const jumpTo = (timeMs: number, frameId: string) => {
    jumpTarget.current = frameId;
    playback.seek(timeMs);
  };
  const togglePlay = () => {
    const atLast = index < 0 || index >= frames.length - 1;
    if (!playback.playing && !atLast && current && jumpTarget.current === current.id) {
      jumpTarget.current = null;
      void playback.playFrom(current.startTime + current.duration);
      return;
    }
    jumpTarget.current = null;
    void playback.toggle();
  };
  const beginTapTracking = (event: React.PointerEvent) => {
    tapState.current = tapState.current
      ? { ...tapState.current, multi: true }
      : { id: event.pointerId, x: event.clientX, y: event.clientY, multi: false };
  };
  const resolveTap = (event: React.PointerEvent) => {
    const tap = tapState.current;
    tapState.current = null;
    if (!tap || tap.multi || event.pointerId !== tap.id) return;
    if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const dot = hit?.closest<HTMLElement>('[data-performer-id]');
    const id = dot?.dataset.performerId;
    if (id) setHighlightId((prev) => (prev === id ? null : id));
  };
  useEffect(() => {
    const reveal = () => {
      const container = list.current;
      const item = selected.current;
      if (!container || !item) return;
      const bounds = container.getBoundingClientRect();
      const target = item.getBoundingClientRect();
      if (target.top < bounds.top) container.scrollTop += target.top - bounds.top;
      else if (target.bottom > bounds.bottom) container.scrollTop += target.bottom - bounds.bottom;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, [current?.id, collapsed]);
  return (
    <main className={`mobile-app rehearsal ${collapsed ? 'rehearsal--collapsed' : ''}`}>
      <header className="rehearsal-header">
        <button className="mobile-icon" aria-label="返回项目库" onClick={() => exit.current()}>
          <ArrowLeft size={21} />
        </button>
        <div>
          <strong>{doc.name}</strong>
          <small>团员排练 · 只读</small>
        </div>
        <button
          className="mobile-icon"
          aria-label="重置舞台视角"
          onClick={() => setReset((value) => value + 1)}
        >
          <Maximize size={21} />
        </button>
        <button
          className="mobile-icon"
          aria-label={display.performerView ? '切换到导演视角' : '切换到演员视角'}
          title={display.performerView ? '当前演员视角' : '当前导演视角'}
          onClick={() => updateDisplay({ performerView: !display.performerView })}
        >
          {display.performerView ? <PersonStanding size={21} /> : <Video size={21} />}
        </button>
        <button
          className="mobile-icon"
          aria-label="显示设置"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <SlidersHorizontal size={21} />
        </button>
        <button
          className="mobile-icon"
          aria-label="收起队形列表"
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : 'rehearsal-list'}
          onClick={() => (collapsed ? setCollapsed(false) : collapse())}
        >
          <PanelRightClose size={21} />
        </button>
      </header>
      {settingsOpen && (
        <>
          <div className="rehearsal-settings-backdrop" onClick={() => setSettingsOpen(false)} />
          <div className="rehearsal-settings" role="dialog" aria-label="显示设置">
            <div className="rehearsal-settings-head">
              <strong>显示设置</strong>
              <button className="mobile-icon" aria-label="关闭显示设置" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={display.showNames}
              className="rehearsal-settings-row"
              onClick={() => updateDisplay({ showNames: !display.showNames })}
            >
              <span>显示名字</span>
              <span className="rehearsal-switch" data-on={display.showNames ? '' : undefined} />
            </button>
            <label className="rehearsal-settings-row">
              <span>人物大小 {Math.round(display.performerScale * 100)}%</span>
              <input
                type="range"
                min={MIN_PERFORMER_SCALE * 100}
                max={MAX_PERFORMER_SCALE * 100}
                step={5}
                value={Math.round(display.performerScale * 100)}
                onChange={(event) =>
                  updateDisplay({ performerScale: clampPerformerScale(Number(event.target.value) / 100) })
                }
              />
            </label>
            <label className="rehearsal-settings-row">
              <span>字体大小 {Math.round(display.labelScale * 100)}%</span>
              <input
                type="range"
                min={MIN_LABEL_SCALE * 100}
                max={MAX_LABEL_SCALE * 100}
                step={5}
                value={Math.round(display.labelScale * 100)}
                onChange={(event) =>
                  updateDisplay({ labelScale: clampLabelScale(Number(event.target.value) / 100) })
                }
              />
            </label>
            <button
              type="button"
              className="rehearsal-settings-reset"
              onClick={() => setDisplay({ ...DEFAULT_REHEARSAL_DISPLAY })}
            >
              恢复默认
            </button>
          </div>
        </>
      )}
      {(playback.error || project.warnings.length > 0) && (
        <p className="rehearsal-warning" role="status">
          {playback.error || project.warnings.join(' ')}
        </p>
      )}
      <section
        className={`rehearsal-stage${display.performerView ? ' rehearsal-stage--flipped' : ''}`}
        aria-label="只读排练舞台"
        onPointerDownCapture={beginTapTracking}
        onPointerUpCapture={resolveTap}
        onPointerCancelCapture={() => {
          tapState.current = null;
        }}
      >
        {frames.length ? (
          <Stage
            touchMode="pan"
            viewResetKey={reset}
            readonly
            performers={doc.performers}
            performerDisplayScale={display.performerScale}
            performerLabelScale={display.labelScale}
            transitionPaths={transitionPaths}
            performerGroups={doc.performerGroups}
            positions={scene.positions}
            rotations={scene.rotations}
            hiddenGroupIds={scene.hiddenGroupIds}
            stageConfig={baseStage}
            selectedPerformerIds={highlightId ? [highlightId] : []}
            onSelectionChange={noChange}
            onPositionChange={noChange}
            showLabels={display.showNames}
            showDirectionArrows={false}
            flippedView={display.performerView}
          />
        ) : (
          <div className="mobile-empty">这个编排还没有队形。</div>
        )}
        {toast && collapsed && (
          <div key={toast.seq} className="rehearsal-toast" role="status">
            {toast.text}
          </div>
        )}
      </section>
      <section ref={notes} className="rehearsal-notes" aria-label="当前队形备注">
        <strong>{current ? `${index + 1}. ${current.name}` : '暂无队形'}</strong>
        <p key={current?.id}>{current?.notes?.trim() || '本队形暂无备注'}</p>
      </section>
      <aside className="rehearsal-rail" aria-label="排练控制">
        <div className="rehearsal-controls">
          {collapsed && (
            <button className="mobile-icon" aria-label="展开队形列表" onClick={() => setCollapsed(false)}>
              <PanelRightOpen size={21} />
            </button>
          )}
          <button
            className="mobile-icon"
            aria-label="上一队形"
            disabled={index <= 0}
            onClick={() => jumpTo(frames[index - 1].startTime, frames[index - 1].id)}
          >
            <ChevronUp size={23} />
          </button>
          <button
            className="mobile-play"
            aria-label={playback.playing ? '暂停排练' : '播放排练'}
            disabled={!frames.length}
            onClick={togglePlay}
          >
            {playback.playing ? <Pause size={23} /> : <Play size={23} fill="currentColor" />}
          </button>
          <button
            className="mobile-icon"
            aria-label="下一队形"
            disabled={index < 0 || index >= frames.length - 1}
            onClick={() => jumpTo(frames[index + 1].startTime, frames[index + 1].id)}
          >
            <ChevronDown size={23} />
          </button>
        </div>
        {!collapsed && (
          <>
            <span className="rehearsal-clock" aria-label="播放时间">
              {stamp(playback.time)} / {stamp(playback.duration)}
            </span>
            <input
              aria-label="排练进度"
              className="rehearsal-scrubber"
              type="range"
              min="0"
              max={playback.duration}
              step="50"
              value={playback.time}
              disabled={!frames.length}
              onChange={(event) => {
                jumpTarget.current = null;
                playback.seek(Number(event.target.value));
              }}
            />
            <div className="rehearsal-list" id="rehearsal-list" ref={list} aria-label="队形列表">
              {frames.map((frame, i) => (
                <button
                  key={frame.id}
                  ref={frame.id === current?.id ? selected : undefined}
                  aria-label={`队形 ${i + 1} ${frame.name}`}
                  aria-pressed={frame.id === current?.id}
                  onClick={() => jumpTo(frame.startTime, frame.id)}
                >
                  <b>{String(i + 1).padStart(2, '0')}</b>
                  <span>
                    {frame.name}
                    <small>
                      {stamp(frame.startTime)} · {(frame.duration / 1000).toFixed(1)} 秒
                      {frame.notes ? ' · 备注' : ''}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>
      {playback.source && (
        <audio
          ref={playback.audio}
          src={playback.source}
          preload="auto"
          onLoadedMetadata={playback.loaded}
          onError={playback.failed}
        />
      )}
    </main>
  );
}
