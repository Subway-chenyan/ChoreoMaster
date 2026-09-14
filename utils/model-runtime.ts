import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type {
  ModelBounds,
  ModelAssetFile,
  ModelSize,
  ModelVector2,
  ModelPart,
  ParametricModelRecipe,
  ProjectModelAsset,
} from '../types';

type CachedModel = {
  promise: Promise<THREE.Group>;
  source?: THREE.Group;
  consumers: number;
};

const sourceCache = new Map<string, CachedModel>();

function createGeometry(part: ModelPart): THREE.BufferGeometry {
  const geometry = part.geometry;
  if (geometry.kind === 'box') {
    return new THREE.BoxGeometry(geometry.width, geometry.height, geometry.depth);
  }
  if (geometry.kind === 'cylinder') {
    return new THREE.CylinderGeometry(geometry.radius, geometry.radius, geometry.height, geometry.segments ?? 32);
  }
  if (geometry.kind === 'sphere') {
    return new THREE.SphereGeometry(geometry.radius, geometry.segments ?? 32, Math.max(12, (geometry.segments ?? 32) / 2));
  }
  if (geometry.kind === 'cone') {
    return new THREE.ConeGeometry(geometry.radius, geometry.height, geometry.segments ?? 32);
  }
  const shape = new THREE.Shape();
  geometry.points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  shape.closePath();
  const extruded = new THREE.ExtrudeGeometry(shape, { depth: geometry.height, bevelEnabled: false });
  extruded.rotateX(-Math.PI / 2);
  extruded.translate(0, geometry.height / 2, 0);
  return extruded;
}

function loadTexture(file: ModelAssetFile | undefined): THREE.Texture | null {
  if (!file?.runtimeUrl) return null;
  const texture = new THREE.TextureLoader().load(file.runtimeUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createParametricModel(recipe: ParametricModelRecipe): THREE.Group {
  const root = new THREE.Group();
  root.name = 'CosStageParametricModel';
  const groups = new Map<string, THREE.Group>();
  recipe.parts.forEach((part) => {
    const partGroup = new THREE.Group();
    partGroup.name = part.name;
    partGroup.userData.modelPartId = part.id;
    partGroup.position.set(part.position.x, part.position.y, part.position.z);
    partGroup.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
    partGroup.scale.set(part.scale.x, part.scale.y, part.scale.z);
    const texture = loadTexture(part.material.baseColorTexture);
    const material = new THREE.MeshStandardMaterial({
      color: texture ? '#ffffff' : part.material.color,
      map: texture,
      roughness: 0.72,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(createGeometry(part), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    partGroup.add(mesh);
    groups.set(part.id, partGroup);
  });
  recipe.parts.forEach((part) => {
    const group = groups.get(part.id);
    if (!group) return;
    const parent = part.parentId ? groups.get(part.parentId) : undefined;
    (parent ?? root).add(group);
  });
  root.position.sub(new THREE.Vector3(recipe.origin.x, recipe.origin.y, recipe.origin.z));
  return root;
}

export function calculateParametricModelMetadata(recipe: ParametricModelRecipe): {
  intrinsicSize: ModelSize;
  bounds: ModelBounds;
  footprints: ModelVector2[][];
} {
  const group = createParametricModel(recipe);
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  const footprints: ModelVector2[][] = [];
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const meshBounds = new THREE.Box3().setFromObject(object);
    if (meshBounds.isEmpty()) return;
    footprints.push([
      { x: meshBounds.min.x, y: meshBounds.min.z },
      { x: meshBounds.max.x, y: meshBounds.min.z },
      { x: meshBounds.max.x, y: meshBounds.max.z },
      { x: meshBounds.min.x, y: meshBounds.max.z },
    ]);
  });
  const result = {
    intrinsicSize: {
      width: Math.max(0.001, size.x),
      height: Math.max(0.001, size.y),
      depth: Math.max(0.001, size.z),
    },
    bounds: {
      min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    },
    footprints,
  };
  disposeModelObject(group);
  return result;
}

function applyCorrection(group: THREE.Group, asset: ProjectModelAsset): void {
  group.position.set(asset.correction.offset.x, asset.correction.offset.y, asset.correction.offset.z);
  group.rotation.set(asset.correction.rotation.x, asset.correction.rotation.y, asset.correction.rotation.z);
  group.scale.set(asset.correction.scale.x, asset.correction.scale.y, asset.correction.scale.z);
}

function markRenderable(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

async function loadGlb(asset: ProjectModelAsset, renderer?: THREE.WebGLRenderer): Promise<THREE.Group> {
  if (asset.payload.kind !== 'glb' || !asset.payload.file.runtimeUrl) {
    throw new Error('3D 模型文件缺失');
  }
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  const decoderBase = typeof document === 'undefined' ? '/' : document.baseURI;
  draco.setDecoderPath(new URL('decoders/draco/', decoderBase).toString());
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(new URL('decoders/basis/', decoderBase).toString());
  if (renderer) ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);
  try {
    const gltf = await loader.loadAsync(asset.payload.file.runtimeUrl);
    const source = gltf.scene;
    markRenderable(source);
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(source);
    const center = bounds.getCenter(new THREE.Vector3());
    source.position.x -= center.x;
    source.position.y -= bounds.min.y;
    source.position.z -= center.z;
    const group = new THREE.Group();
    group.add(source);
    applyCorrection(group, asset);
    return group;
  } finally {
    draco.dispose();
    ktx2.dispose();
  }
}

function cacheKey(asset: ProjectModelAsset): string {
  if (asset.payload.kind === 'glb') {
    return `${asset.id}:${asset.revision}:${asset.contentHash}:${asset.payload.file.runtimeUrl ?? asset.payload.file.assetPath}`;
  }
  return `${asset.id}:${asset.revision}:${asset.contentHash}`;
}

async function loadSource(asset: ProjectModelAsset, renderer?: THREE.WebGLRenderer): Promise<THREE.Group> {
  const key = cacheKey(asset);
  const existing = sourceCache.get(key);
  if (existing) return existing.promise;
  const cached: CachedModel = {
    consumers: 0,
    promise: Promise.resolve().then(async () => {
      const source = asset.payload.kind === 'parametric'
        ? createParametricModel(asset.payload.recipe)
        : await loadGlb(asset, renderer);
      cached.source = source;
      return source;
    }),
  };
  sourceCache.set(key, cached);
  try {
    return await cached.promise;
  } catch (error) {
    sourceCache.delete(key);
    throw error;
  }
}

export async function createModelAssetInstance(
  asset: ProjectModelAsset,
  renderer?: THREE.WebGLRenderer,
): Promise<THREE.Group> {
  const source = await loadSource(asset, renderer);
  const entry = sourceCache.get(cacheKey(asset));
  if (entry) entry.consumers += 1;
  const instance = cloneSkeleton(source) as THREE.Group;
  instance.userData.modelAssetCacheKey = cacheKey(asset);
  return instance;
}

export function createPreloadedModelAssetInstance(asset: ProjectModelAsset): THREE.Group {
  const entry = sourceCache.get(cacheKey(asset));
  if (!entry?.source) throw new Error(`模型尚未预载：${asset.name}`);
  entry.consumers += 1;
  const instance = cloneSkeleton(entry.source) as THREE.Group;
  instance.userData.modelAssetCacheKey = cacheKey(asset);
  instance.traverse((object) => {
    object.userData.sharedModelAssetResource = true;
  });
  return instance;
}

export async function preloadModelAssets(
  assets: Record<string, ProjectModelAsset>,
  renderer?: THREE.WebGLRenderer,
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  await Promise.all(Object.values(assets).map(async (asset) => {
    try {
      await loadSource(asset, renderer);
    } catch (error) {
      warnings.push(`${asset.name}：${error instanceof Error ? error.message : '加载失败'}`);
    }
  }));
  return { warnings };
}

export function releaseModelAssetInstance(instance: THREE.Group): void {
  const key = typeof instance.userData.modelAssetCacheKey === 'string'
    ? instance.userData.modelAssetCacheKey
    : '';
  const entry = sourceCache.get(key);
  if (entry) entry.consumers = Math.max(0, entry.consumers - 1);
}

export function disposeModelObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
  });
}

export function clearModelAssetCache(): void {
  sourceCache.forEach((entry) => {
    if (entry.source) disposeModelObject(entry.source);
  });
  sourceCache.clear();
}

export function getModelAssetCacheStats(): { sources: number; consumers: number } {
  return {
    sources: sourceCache.size,
    consumers: Array.from(sourceCache.values()).reduce((sum, entry) => sum + entry.consumers, 0),
  };
}

export function getModelAssetDefaultColor(asset: ProjectModelAsset): string | undefined {
  return asset.payload.kind === 'parametric'
    ? asset.payload.recipe.parts[0]?.material.color
    : undefined;
}

/**
 * 把道具颜色应用到一个模型实例上：克隆无纹理的标准材质并改成目标色。
 * SkeletonUtils.clone 出的实例共享缓存源材质，必须克隆后修改，否则会同资产的所有实例一起变色。
 * 返回新克隆的材质，由调用方负责在不使用时 dispose。
 */
export function tintModelObject(root: THREE.Object3D, color: string): THREE.Material[] {
  const tinted: THREE.Material[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    let cloned = false;
    const next = materials.map((material) => {
      if (!(material instanceof THREE.MeshStandardMaterial) || material.map) return material;
      const clone = material.clone();
      clone.color.set(color);
      tinted.push(clone);
      cloned = true;
      return clone;
    });
    if (!cloned) return;
    object.material = Array.isArray(object.material) ? next : next[0];
  });
  return tinted;
}

export function createMissingModelPlaceholder(width: number, height: number, depth: number): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const edges = new THREE.EdgesGeometry(geometry);
  geometry.dispose();
  group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#ef4444' })));
  return group;
}
