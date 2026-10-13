import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Maximize,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
} from 'lucide-react';
import { Stage } from '../Stage';
import type { PortableProject } from '../../mobile/project-package';
import { useRehearsalPlayback } from '../../mobile/use-rehearsal-playback';
import { onAndroidBack } from '../../mobile/native';
import { evaluateSceneStateAtTime, getSortedFrames } from '../../utils/transitions';

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
  const stage = useMemo(
    () => ({ ...doc.stageConfig, background: undefined, ledContent: undefined }),
    [doc.stageConfig]
  );
  const [collapsed, setCollapsed] = useState(false);
  const [reset, setReset] = useState(0);
  const notes = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = useRef<HTMLButtonElement>(null);
  const exit = useRef(() => {});
  exit.current = () => {
    playback.pause();
    onExit();
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
          aria-label={collapsed ? '展开队形列表' : '收起队形列表'}
          aria-expanded={!collapsed}
          aria-controls="rehearsal-list"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <PanelRightOpen size={21} /> : <PanelRightClose size={21} />}
        </button>
      </header>
      {(playback.error || project.warnings.length > 0) && (
        <p className="rehearsal-warning" role="status">
          {playback.error || project.warnings.join(' ')}
        </p>
      )}
      <section className="rehearsal-stage" aria-label="只读排练舞台">
        {frames.length ? (
          <Stage
            touchMode="pan"
            viewResetKey={reset}
            readonly
            performers={doc.performers}
            performerGroups={doc.performerGroups}
            positions={scene.positions}
            rotations={scene.rotations}
            hiddenGroupIds={scene.hiddenGroupIds}
            stageConfig={stage}
            selectedPerformerIds={[]}
            onSelectionChange={noChange}
            onPositionChange={noChange}
            showLabels
            showDirectionArrows={false}
          />
        ) : (
          <div className="mobile-empty">这个编排还没有队形。</div>
        )}
      </section>
      <section ref={notes} className="rehearsal-notes" aria-label="当前队形备注">
        <strong>{current ? `${index + 1}. ${current.name}` : '暂无队形'}</strong>
        <p key={current?.id}>{current?.notes?.trim() || '本队形暂无备注'}</p>
      </section>
      <aside className="rehearsal-rail" aria-label="排练控制">
        <div className="rehearsal-controls">
          <button
            className="mobile-icon"
            aria-label="上一队形"
            disabled={index <= 0}
            onClick={() => playback.seek(frames[index - 1].startTime)}
          >
            <ChevronUp size={23} />
          </button>
          <button
            className="mobile-play"
            aria-label={playback.playing ? '暂停排练' : '播放排练'}
            disabled={!frames.length}
            onClick={() => void playback.toggle()}
          >
            {playback.playing ? <Pause size={23} /> : <Play size={23} fill="currentColor" />}
          </button>
          <button
            className="mobile-icon"
            aria-label="下一队形"
            disabled={index < 0 || index >= frames.length - 1}
            onClick={() => playback.seek(frames[index + 1].startTime)}
          >
            <ChevronDown size={23} />
          </button>
        </div>
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
          onChange={(event) => playback.seek(Number(event.target.value))}
        />
        <div className="rehearsal-list" id="rehearsal-list" ref={list} aria-label="队形列表">
          {frames.map((frame, i) => (
            <button
              key={frame.id}
              ref={frame.id === current?.id ? selected : undefined}
              aria-label={`队形 ${i + 1} ${frame.name}`}
              aria-pressed={frame.id === current?.id}
              onClick={() => playback.seek(frame.startTime)}
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
