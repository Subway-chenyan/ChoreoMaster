import type { Frame, Performer, TransitionSegment, TransitionPathDisplay } from '../types';
import { findTransitionSegment, getSortedFrames } from '../utils/transitions';

export interface RehearsalDisplaySettings {
  /** 是否显示名字标签 */
  showNames: boolean;
  /** 表演者圆点缩放，1 为原始大小 */
  performerScale: number;
  /** 名字字体缩放，基于项目舞台配置的基准字号 */
  labelScale: number;
  /** 演员视角（台上朝向观众）；false 为导演视角 */
  performerView: boolean;
}

export const MIN_PERFORMER_SCALE = 0.5;
export const MAX_PERFORMER_SCALE = 2;
export const MIN_LABEL_SCALE = 0.2;
export const MAX_LABEL_SCALE = 2;

export const DEFAULT_REHEARSAL_DISPLAY: RehearsalDisplaySettings = {
  showNames: true,
  performerScale: 1,
  labelScale: 1,
  performerView: true,
};

export const REHEARSAL_DISPLAY_STORAGE_KEY = 'cosstage.rehearsal-display';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function clampPerformerScale(value: number): number {
  return clamp(value, MIN_PERFORMER_SCALE, MAX_PERFORMER_SCALE);
}

export function clampLabelScale(value: number): number {
  return clamp(value, MIN_LABEL_SCALE, MAX_LABEL_SCALE);
}

function parseSettings(raw: string | null): Partial<RehearsalDisplaySettings> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<RehearsalDisplaySettings>) : null;
  } catch {
    return null;
  }
}

/** 读取持久化的显示设置；缺字段或字段非法时逐项回退默认值。 */
export function loadRehearsalDisplay(raw: string | null): RehearsalDisplaySettings {
  const parsed = parseSettings(raw);
  if (!parsed) return DEFAULT_REHEARSAL_DISPLAY;
  return {
    showNames: typeof parsed.showNames === 'boolean' ? parsed.showNames : DEFAULT_REHEARSAL_DISPLAY.showNames,
    performerScale:
      typeof parsed.performerScale === 'number' && Number.isFinite(parsed.performerScale)
        ? clampPerformerScale(parsed.performerScale)
        : DEFAULT_REHEARSAL_DISPLAY.performerScale,
    labelScale:
      typeof parsed.labelScale === 'number' && Number.isFinite(parsed.labelScale)
        ? clampLabelScale(parsed.labelScale)
        : DEFAULT_REHEARSAL_DISPLAY.labelScale,
    performerView:
      typeof parsed.performerView === 'boolean' ? parsed.performerView : DEFAULT_REHEARSAL_DISPLAY.performerView,
  };
}

export function saveRehearsalDisplay(settings: RehearsalDisplaySettings): string {
  return JSON.stringify({
    showNames: settings.showNames,
    performerScale: clampPerformerScale(settings.performerScale),
    labelScale: clampLabelScale(settings.labelScale),
    performerView: settings.performerView,
  });
}

/** 只在实际队形间隙显示高亮演员的路径，与播放插值使用相同端点和控制点。 */
export function rehearsalTransitionPaths(
  time: number, frames: Frame[], performers: Performer[], transitions: TransitionSegment[], highlightId: string | null,
): TransitionPathDisplay[] {
  if (!highlightId) return [];
  const sorted = getSortedFrames(frames);
  if (sorted.some((frame) => time >= frame.startTime && time < frame.startTime + frame.duration)) return [];
  const from = [...sorted].reverse().find((frame) => frame.startTime + frame.duration <= time);
  const to = sorted.find((frame) => frame.startTime > time);
  const performer = performers.find((item) => item.id === highlightId);
  if (!from || !to || !performer || (performer.groupId && from.hiddenGroupIds?.includes(performer.groupId))) return [];
  const start = from.positions[highlightId];
  const end = to.positions[highlightId];
  if (!start || !end) return [];
  const motion = findTransitionSegment(transitions, from.id, to.id)?.objectMotions?.[highlightId];
  return [{ performerId: highlightId, color: performer.color, start, end,
    pathType: motion?.pathType ?? 'linear', controlPoints: motion?.controlPoints ?? [], isSelected: true }];
}
