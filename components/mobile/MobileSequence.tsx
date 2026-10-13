import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Copy, Layers, Music2, Pause, Play, Settings2 } from 'lucide-react';
import type { Frame, ProjectDocument } from '../../types';

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
      {document.performers.slice(0, 120).map((actor) => {
        const pos = frame.positions[actor.id];
        return pos ? (
          <circle
            key={actor.id}
            cx={Math.max(3, Math.min(97, pos.x))}
            cy={Math.max(3, Math.min(57, pos.y * 0.6))}
            r="2.5"
            fill={actor.color}
          />
        ) : null;
      })}
    </svg>
  );
}

interface Props {
  document: ProjectDocument;
  frames: Frame[];
  frameIndex: number;
  playing: boolean;
  previewing: boolean;
  time: number;
  duration: number;
  collapsed: boolean;
  onSelect: (frame: Frame) => void;
  onPlay: () => void;
  onSeek: (time: number) => void;
  onMusic: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
}

export function MobileSequence(props: Props) {
  const {
    document,
    frames,
    frameIndex,
    playing,
    previewing,
    time,
    duration,
    collapsed,
    onSelect,
    onPlay,
    onSeek,
    onMusic,
    onEdit,
    onDuplicate,
  } = props;
  const list = useRef<HTMLDivElement>(null);
  const selected = useRef<HTMLButtonElement>(null);
  // 只滚动队形容器，避免 scrollIntoView 连带移动舞台或整个页面。
  useEffect(() => {
    const reveal = () => {
      const container = list.current;
      const item = selected.current;
      if (!container || !item || !container.clientWidth) return;
      const bounds = container.getBoundingClientRect();
      const target = item.getBoundingClientRect();
      if (target.top < bounds.top) container.scrollTop += target.top - bounds.top;
      else if (target.bottom > bounds.bottom) container.scrollTop += target.bottom - bounds.bottom;
      if (target.left < bounds.left) container.scrollLeft += target.left - bounds.left;
      else if (target.right > bounds.right) container.scrollLeft += target.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, [frames[frameIndex]?.id, frames.length, collapsed]);

  return (
    <section id="mobile-sequence" className="mobile-editor__sequence" aria-label="队形与播放">
      <div className="mobile-playback">
        <button
          className="mobile-icon"
          aria-label="上一队形"
          disabled={frameIndex <= 0}
          onClick={() => onSelect(frames[frameIndex - 1])}
        >
          <ChevronLeft size={22} />
        </button>
        <button
          className="mobile-play"
          aria-label={playing ? '暂停排练' : '播放排练'}
          disabled={!frames.length}
          onClick={onPlay}
        >
          {playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}
        </button>
        <button
          className="mobile-icon"
          aria-label="下一队形"
          disabled={frameIndex >= frames.length - 1}
          onClick={() => onSelect(frames[frameIndex + 1])}
        >
          <ChevronRight size={22} />
        </button>
        <span className="mobile-clock">
          {timeLabel(time)} <small>/ {timeLabel(duration)}</small>
        </span>
        <button className="mobile-icon mobile-music-button" aria-label="导入音乐" onClick={onMusic}>
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
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <div className="mobile-sequence-heading">
        <span>
          <Layers size={15} /> 队形 <small>{frames.length}</small>
        </span>
        <button
          className="mobile-icon"
          aria-label="编辑时长与备注"
          disabled={frameIndex < 0}
          onClick={onEdit}
        >
          <Settings2 size={18} />
          <span className="mobile-formation-edit-label">时长与备注</span>
        </button>
      </div>
      <div className="mobile-filmstrip" ref={list} aria-label="队形列表">
        {frames.map((frame, index) => (
          <button
            key={frame.id}
            ref={index === frameIndex ? selected : undefined}
            className={`mobile-frame ${index === frameIndex ? 'mobile-frame--active' : ''}`}
            aria-label={`队形 ${index + 1} ${frame.name}`}
            aria-pressed={index === frameIndex}
            onClick={() => onSelect(frame)}
          >
            <FormationPreview frame={frame} document={document} />
            <span>
              <b>{String(index + 1).padStart(2, '0')}</b> {frame.name}
            </span>
            <small>{(frame.duration / 1000).toFixed(1)} 秒</small>
          </button>
        ))}
      </div>
      <button
        className="mobile-frame-add"
        aria-label="复制当前队形"
        disabled={frameIndex < 0 || previewing}
        onClick={onDuplicate}
      >
        <Copy size={18} />
        <span>复制队形</span>
      </button>
    </section>
  );
}
