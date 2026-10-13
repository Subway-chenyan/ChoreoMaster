import { useCallback, useEffect, useRef, useState } from 'react';

export function useRehearsalPlayback(music: Blob | undefined, choreographyDuration: number) {
  const audio = useRef<HTMLAudioElement>(null);
  const [source, setSource] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [musicDuration, setMusicDuration] = useState(0);
  const [error, setError] = useState('');
  const [audioFailed, setAudioFailed] = useState(false);
  const request = useRef(0);
  const clock = useRef({ time: 0, at: 0 });
  const duration = Math.max(choreographyDuration, musicDuration, 1);
  const pause = useCallback(() => {
    request.current++;
    audio.current?.pause();
    setPlaying(false);
  }, []);
  useEffect(() => {
    const url = music ? URL.createObjectURL(music) : '';
    setSource(url);
    return () => {
      request.current++;
      if (url) URL.revokeObjectURL(url);
    };
  }, [music]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') pause();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [pause]);
  const seek = (next: number) => {
    pause();
    const value = Math.max(0, Math.min(duration, next));
    setTime(value);
    if (audio.current && !audioFailed) audio.current.currentTime = value / 1000;
  };
  const toggle = async () => {
    if (playing) {
      pause();
      return;
    }
    const token = ++request.current;
    const next = time >= duration - 10 ? 0 : time;
    const player = audio.current;
    if (player && source && !audioFailed && (!musicDuration || next < musicDuration)) {
      player.currentTime = next / 1000;
      try {
        await player.play();
      } catch {
        if (token === request.current) {
          setError('音乐无法播放，可再次点击播放，静音查看队形。');
          setAudioFailed(true);
        }
        return;
      }
    }
    // 过期请求不能暂停后续已经开始的新一次播放；seek/exit 已负责暂停旧播放。
    if (token !== request.current) return;
    clock.current = { time: next, at: performance.now() };
    setTime(next);
    setPlaying(true);
  };
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const player = audio.current;
      const next =
        player && !player.paused && !player.ended
          ? player.currentTime * 1000
          : clock.current.time + now - clock.current.at;
      clock.current = { time: next, at: now };
      setTime(Math.min(next, duration));
      if (next >= duration) {
        pause();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, pause]);
  return {
    audio,
    source,
    time,
    playing,
    duration,
    error,
    pause,
    seek,
    toggle,
    loaded: () => {
      const seconds = audio.current?.duration;
      if (seconds && Number.isFinite(seconds)) setMusicDuration(seconds * 1000);
    },
    failed: () => {
      pause();
      setAudioFailed(true);
      setError('音乐无法读取，可静音查看队形。');
    },
  };
}
