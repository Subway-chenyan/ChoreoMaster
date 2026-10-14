import { DEFAULT_PERFORMER_LABEL_FONT_SIZE } from '../electron/stage-defaults';
import type { Performer, StageConfig } from '../types';

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
export const MIN_LABEL_SCALE = 0.6;
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

/**
 * 只缩放表演者的宽深，道具与平台保持原始尺寸，避免平台占位判定失真。
 * 未设置宽深的表演者保留缺省，让 Stage 继续套用默认尺寸。
 */
export function scaleRehearsalPerformers(performers: Performer[], scale: number): Performer[] {
  if (scale === 1) return performers;
  const scaleSize = (value: number | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value * scale : value;
  return performers.map((performer) => {
    if (performer.type === 'prop') return performer;
    return {
      ...performer,
      width: scaleSize(performer.width),
      depth: scaleSize(performer.depth),
    };
  });
}

/** 在项目舞台配置之上叠加名字字体缩放；项目未配置时回退默认字号。 */
export function applyRehearsalLabelScale(stageConfig: StageConfig, labelScale: number): StageConfig {
  if (labelScale === 1) return stageConfig;
  const base = stageConfig.performerLabelFontSize ?? DEFAULT_PERFORMER_LABEL_FONT_SIZE;
  return { ...stageConfig, performerLabelFontSize: Math.round(base * labelScale * 10) / 10 };
}
