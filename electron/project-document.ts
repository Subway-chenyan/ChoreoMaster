// 纯项目解析逻辑，桌面与移动端共享；不要在此模块引入 Node API。
import { normalizeFrames, normalizePerformers, normalizeTransitions } from './project-contract.js';
import {
  PROJECT_SCHEMA_VERSION,
  createLegacyUnitBoxAsset,
  normalizeProjectModelAssets,
} from './model-asset-contract.js';
import type {
  AudioMarker,
  PerformerNote,
  ProjectDocument,
  StageBackground,
  StageConfig,
} from './project-contract.js';
import {
  DEFAULT_PERFORMER_LABEL_FONT_SIZE,
  DEFAULT_PROP_LABEL_FONT_SIZE,
  normalizeLabelFontSize,
} from './stage-defaults.js';
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeName(value: string): string {
  const safe = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ');
  return safe || 'CosStage Project';
}

export function parseAudioMarkers(value: unknown): AudioMarker[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((item, index) => {
      if (!isRecord(item) || typeof item.timeMs !== 'number' || !Number.isFinite(item.timeMs)) {
        return [];
      }
      const label = typeof item.label === 'string' ? item.label.trim().slice(0, 80) : '';
      const color =
        typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : '#3b82f6';
      const timeMs = Math.max(0, Math.round(item.timeMs));
      const id =
        typeof item.id === 'string' && item.id.trim()
          ? item.id.trim().slice(0, 120)
          : `marker-${index}-${timeMs}`;
      return [
        {
          id,
          label: label || `标记 ${index + 1}`,
          timeMs,
          color,
        },
      ];
    })
    .sort((a, b) => a.timeMs - b.timeMs);
}

function parseStageBackground(value: unknown): StageBackground | undefined {
  if (!isRecord(value) || typeof value.value !== 'string' || !value.value) return undefined;
  const pixelWidth =
    typeof value.pixelWidth === 'number' && Number.isFinite(value.pixelWidth) && value.pixelWidth > 0
      ? value.pixelWidth
      : 1;
  const pixelHeight =
    typeof value.pixelHeight === 'number' && Number.isFinite(value.pixelHeight) && value.pixelHeight > 0
      ? value.pixelHeight
      : 1;
  const opacity =
    typeof value.opacity === 'number' && Number.isFinite(value.opacity)
      ? Math.max(0, Math.min(1, value.opacity))
      : 0.5;
  return { value: value.value, opacity, pixelWidth, pixelHeight };
}

function parsePerformerNotes(raw: unknown): PerformerNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .filter((n) => typeof n.id === 'string' && typeof n.performerId === 'string')
    .map((n) => ({
      id: String(n.id),
      performerId: String(n.performerId),
      frameId: typeof n.frameId === 'string' ? n.frameId : undefined,
      content: typeof n.content === 'string' ? n.content : '',
      items: Array.isArray(n.items)
        ? n.items
            .filter(isRecord)
            .filter((i) => typeof i.id === 'string')
            .map((i) => ({
              id: String(i.id),
              name: typeof i.name === 'string' ? i.name : '',
              type:
                i.type === 'carry' || i.type === 'handoff' || i.type === 'event'
                  ? i.type
                  : ('event' as const),
              description: typeof i.description === 'string' ? i.description : undefined,
              frameId: typeof i.frameId === 'string' ? i.frameId : undefined,
            }))
        : [],
      createdAt: typeof n.createdAt === 'number' ? n.createdAt : 0,
      updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : 0,
    }));
}

export function parseProjectDocument(value: unknown, fallbackName: string): ProjectDocument {
  if (!isRecord(value)) throw new Error('Project file must contain an object');
  if (!Array.isArray(value.performers) || !Array.isArray(value.frames)) {
    throw new Error('Project file is missing performers or frames');
  }
  const rawStageConfig = isRecord(value.stageConfig) ? value.stageConfig : {};
  const depth =
    typeof rawStageConfig.depth === 'number' && Number.isFinite(rawStageConfig.depth)
      ? Math.max(1, rawStageConfig.depth)
      : 11.25;
  const ledDistanceFromBack =
    typeof rawStageConfig.ledDistanceFromBack === 'number' &&
    Number.isFinite(rawStageConfig.ledDistanceFromBack)
      ? Math.max(0, Math.min(depth, rawStageConfig.ledDistanceFromBack))
      : 0;
  const ledBottomHeight =
    typeof rawStageConfig.ledBottomHeight === 'number' && Number.isFinite(rawStageConfig.ledBottomHeight)
      ? Math.max(0, Math.min(30, rawStageConfig.ledBottomHeight))
      : 0;
  const stageConfig: StageConfig = {
    width: typeof rawStageConfig.width === 'number' ? rawStageConfig.width : 20,
    depth,
    wingWidth: typeof rawStageConfig.wingWidth === 'number' ? rawStageConfig.wingWidth : undefined,
    ledWidth: typeof rawStageConfig.ledWidth === 'number' ? rawStageConfig.ledWidth : undefined,
    ledHeight: typeof rawStageConfig.ledHeight === 'number' ? rawStageConfig.ledHeight : 6,
    ledBottomHeight,
    ledContent: isRecord(rawStageConfig.ledContent)
      ? (rawStageConfig.ledContent as unknown as StageConfig['ledContent'])
      : { type: 'none' },
    background: parseStageBackground(rawStageConfig.background),
    showStageLines: rawStageConfig.showStageLines !== false,
    ledDistanceFromBack,
    performerLabelFontSize: normalizeLabelFontSize(
      typeof rawStageConfig.performerLabelFontSize === 'number'
        ? rawStageConfig.performerLabelFontSize
        : undefined,
      DEFAULT_PERFORMER_LABEL_FONT_SIZE
    ),
    propLabelFontSize: normalizeLabelFontSize(
      typeof rawStageConfig.propLabelFontSize === 'number' ? rawStageConfig.propLabelFontSize : undefined,
      DEFAULT_PROP_LABEL_FONT_SIZE
    ),
  };
  const sourceVersion = typeof value.version === 'string' ? value.version : '1.0';
  const performers = normalizePerformers(value.performers).map((performer) => {
    if (sourceVersion !== PROJECT_SCHEMA_VERSION && performer.type === 'prop') {
      return {
        ...performer,
        modelAssetId: 'legacy-unit-box-v1',
        modelAspectLocked: true,
      };
    }
    return performer;
  });
  const modelAssets = normalizeProjectModelAssets(value.modelAssets);
  if (sourceVersion !== PROJECT_SCHEMA_VERSION && performers.some((performer) => performer.type === 'prop')) {
    const legacyAsset = createLegacyUnitBoxAsset();
    modelAssets[legacyAsset.id] = legacyAsset;
  }
  return {
    version: PROJECT_SCHEMA_VERSION,
    name: sanitizeName(typeof value.name === 'string' ? value.name : fallbackName),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
    musicName: typeof value.musicName === 'string' ? value.musicName : null,
    musicAsset: typeof value.musicAsset === 'string' ? value.musicAsset : null,
    modelAssets,
    performers,
    performerGroups: Array.isArray(value.performerGroups)
      ? (value.performerGroups as ProjectDocument['performerGroups'])
      : [],
    frames: normalizeFrames(value.frames),
    transitions: normalizeTransitions(value.transitions),
    audioMarkers: parseAudioMarkers(value.audioMarkers),
    stageConfig,
    performerNotes: parsePerformerNotes(value.performerNotes),
  };
}
