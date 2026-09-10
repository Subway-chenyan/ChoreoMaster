import { createHash } from 'crypto';
import type {
  ModelAssetManifest,
  ModelAssetUsage,
  ModelPart,
  ModelPartGeometry,
  ModelSize,
  ModelVector3,
  ParametricModelRecipe,
} from './model-asset-contract.js';

const ZERO: ModelVector3 = { x: 0, y: 0, z: 0 };
const ONE: ModelVector3 = { x: 1, y: 1, z: 1 };

function part(
  id: string,
  name: string,
  geometry: ModelPartGeometry,
  position: ModelVector3,
  color: string,
): ModelPart {
  return {
    id,
    name,
    position,
    rotation: { ...ZERO },
    scale: { ...ONE },
    geometry,
    material: { color },
  };
}

function recipe(parts: ModelPart[]): ParametricModelRecipe {
  return { schemaVersion: 1, origin: { ...ZERO }, parts };
}

function preset(
  id: string,
  name: string,
  tags: string[],
  size: ModelSize,
  modelRecipe: ParametricModelRecipe,
  defaultUsage: ModelAssetUsage = 'prop',
): ModelAssetManifest {
  const contentHash = createHash('sha256').update(JSON.stringify({ id, size, modelRecipe })).digest('hex');
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    contentHash,
    name,
    tags,
    defaultUsage,
    origin: 'builtin',
    format: 'parametric',
    intrinsicSize: size,
    bounds: {
      min: { x: -size.width / 2, y: 0, z: -size.depth / 2 },
      max: { x: size.width / 2, y: size.height, z: size.depth / 2 },
    },
    pivot: { ...ZERO },
    footprints: [[
      { x: -size.width / 2, y: -size.depth / 2 },
      { x: size.width / 2, y: -size.depth / 2 },
      { x: size.width / 2, y: size.depth / 2 },
      { x: -size.width / 2, y: size.depth / 2 },
    ]],
    correction: { offset: { ...ZERO }, rotation: { ...ZERO }, scale: { ...ONE } },
    payload: { kind: 'parametric', recipe: modelRecipe },
    createdAt: 0,
    updatedAt: 0,
  };
}

export function getBuiltinModelAssets(): ModelAssetManifest[] {
  return [
    preset('builtin-standard-box', '标准方箱', ['方箱', '通用'], { width: 1, height: 1, depth: 1 }, recipe([
      part('box', '方箱', { kind: 'box', width: 1, height: 1, depth: 1 }, { x: 0, y: 0.5, z: 0 }, '#64748b'),
    ])),
    preset('builtin-long-box', '长方箱', ['方箱', '通用'], { width: 2, height: 0.8, depth: 0.8 }, recipe([
      part('box', '长方箱', { kind: 'box', width: 2, height: 0.8, depth: 0.8 }, { x: 0, y: 0.4, z: 0 }, '#78716c'),
    ])),
    preset('builtin-door-panel', '门板', ['门板', '板材'], { width: 1, height: 2.4, depth: 0.12 }, recipe([
      part('panel', '门板', { kind: 'box', width: 1, height: 2.4, depth: 0.12 }, { x: 0, y: 1.2, z: 0 }, '#92400e'),
    ])),
    preset('builtin-backdrop-panel', '背景板', ['背景板', '板材'], { width: 3, height: 2.5, depth: 0.12 }, recipe([
      part('panel', '背景板', { kind: 'box', width: 3, height: 2.5, depth: 0.12 }, { x: 0, y: 1.25, z: 0 }, '#334155'),
    ])),
    preset('builtin-cylinder', '圆柱', ['圆柱', '通用'], { width: 1, height: 1, depth: 1 }, recipe([
      part('cylinder', '圆柱', { kind: 'cylinder', radius: 0.5, height: 1, segments: 32 }, { x: 0, y: 0.5, z: 0 }, '#0f766e'),
    ])),
    preset('builtin-column', '立柱', ['立柱', '通用'], { width: 0.6, height: 2.5, depth: 0.6 }, recipe([
      part('column', '立柱', { kind: 'cylinder', radius: 0.3, height: 2.5, segments: 32 }, { x: 0, y: 1.25, z: 0 }, '#64748b'),
    ])),
    preset('builtin-cone', '圆锥', ['圆锥', '通用'], { width: 1, height: 1.5, depth: 1 }, recipe([
      part('cone', '圆锥', { kind: 'cone', radius: 0.5, height: 1.5, segments: 32 }, { x: 0, y: 0.75, z: 0 }, '#be123c'),
    ])),
    preset('builtin-sphere', '球体', ['球体', '通用'], { width: 1, height: 1, depth: 1 }, recipe([
      part('sphere', '球体', { kind: 'sphere', radius: 0.5, segments: 32 }, { x: 0, y: 0.5, z: 0 }, '#7c3aed'),
    ])),
    preset('builtin-square-platform', '方形高台', ['高台', '方形'], { width: 2, height: 0.5, depth: 2 }, recipe([
      part('platform', '方形高台', { kind: 'box', width: 2, height: 0.5, depth: 2 }, { x: 0, y: 0.25, z: 0 }, '#475569'),
    ]), 'platform'),
    preset('builtin-round-platform', '圆形高台', ['高台', '圆形'], { width: 2, height: 0.5, depth: 2 }, recipe([
      part('platform', '圆形高台', { kind: 'cylinder', radius: 1, height: 0.5, segments: 48 }, { x: 0, y: 0.25, z: 0 }, '#475569'),
    ]), 'platform'),
    preset('builtin-two-step', '双级台阶', ['高台', '台阶'], { width: 2.4, height: 0.6, depth: 1.6 }, recipe([
      part('lower', '下级', { kind: 'box', width: 2.4, height: 0.3, depth: 1.6 }, { x: 0, y: 0.15, z: 0 }, '#52525b'),
      part('upper', '上级', { kind: 'box', width: 2.4, height: 0.3, depth: 0.8 }, { x: 0, y: 0.45, z: -0.4 }, '#71717a'),
    ]), 'platform'),
    preset('builtin-table', '桌台', ['桌台', '通用'], { width: 1.8, height: 0.9, depth: 0.8 }, recipe([
      part('top', '台面', { kind: 'box', width: 1.8, height: 0.12, depth: 0.8 }, { x: 0, y: 0.84, z: 0 }, '#78350f'),
      part('leg-a', '桌腿 1', { kind: 'box', width: 0.12, height: 0.78, depth: 0.12 }, { x: -0.72, y: 0.39, z: -0.28 }, '#451a03'),
      part('leg-b', '桌腿 2', { kind: 'box', width: 0.12, height: 0.78, depth: 0.12 }, { x: 0.72, y: 0.39, z: -0.28 }, '#451a03'),
      part('leg-c', '桌腿 3', { kind: 'box', width: 0.12, height: 0.78, depth: 0.12 }, { x: -0.72, y: 0.39, z: 0.28 }, '#451a03'),
      part('leg-d', '桌腿 4', { kind: 'box', width: 0.12, height: 0.78, depth: 0.12 }, { x: 0.72, y: 0.39, z: 0.28 }, '#451a03'),
    ])),
  ];
}
