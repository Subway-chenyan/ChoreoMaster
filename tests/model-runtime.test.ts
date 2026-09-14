import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { ProjectModelAsset } from '../types.ts';
import {
  clearModelAssetCache,
  createModelAssetInstance,
  getModelAssetCacheStats,
  getModelAssetDefaultColor,
  releaseModelAssetInstance,
  tintModelObject,
} from '../utils/model-runtime.ts';
import { getModelTopPreviewScale } from '../utils/model-preview-layout.ts';

const asset: ProjectModelAsset = {
  schemaVersion: 1,
  id: 'cache-test',
  revision: 1,
  contentHash: 'cache-test-hash',
  name: '缓存测试',
  tags: [],
  defaultUsage: 'prop',
  origin: 'user',
  format: 'parametric',
  intrinsicSize: { width: 1, height: 1, depth: 1 },
  bounds: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } },
  pivot: { x: 0, y: 0, z: 0 },
  footprints: [[{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }]],
  correction: { offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  payload: { kind: 'parametric', recipe: { schemaVersion: 1, origin: { x: 0, y: 0, z: 0 }, parts: [{ id: 'box', name: 'box', position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, geometry: { kind: 'box', width: 1, height: 1, depth: 1 }, material: { color: '#64748b' } }] } },
  createdAt: 1,
  updatedAt: 1,
};

test('fifty model instances share one cached source and release consumers', async () => {
  clearModelAssetCache();
  const instances = await Promise.all(Array.from({ length: 50 }, () => createModelAssetInstance(asset)));
  assert.deepEqual(getModelAssetCacheStats(), { sources: 1, consumers: 50 });
  instances.forEach(releaseModelAssetInstance);
  assert.deepEqual(getModelAssetCacheStats(), { sources: 1, consumers: 0 });
  clearModelAssetCache();
});

test('top preview keeps real-world width and depth when mapped from its square render', () => {
  assert.deepEqual(getModelTopPreviewScale(2, 2), { width: 1.18, height: 1.18 });
  assert.deepEqual(getModelTopPreviewScale(4, 1), { width: 1.18, height: 4.72 });
});

test('tinting a model instance does not mutate materials shared with the cache source', async () => {
  clearModelAssetCache();
  const first = await createModelAssetInstance(asset);
  const second = await createModelAssetInstance(asset);
  const tintedMaterials = tintModelObject(first, '#ff3b0a');
  assert.ok(tintedMaterials.length > 0);
  const collectColors = (root: THREE.Object3D): string[] => {
    const colors: string[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshStandardMaterial;
      colors.push(material.color.getHexString());
    });
    return colors;
  };
  assert.deepEqual(collectColors(first), ['ff3b0a']);
  assert.deepEqual(collectColors(second), ['64748b']);
  tintedMaterials.forEach((material) => material.dispose());
  releaseModelAssetInstance(first);
  releaseModelAssetInstance(second);
  clearModelAssetCache();
});

test('tint skips materials that carry a base color texture', async () => {
  clearModelAssetCache();
  const instance = await createModelAssetInstance(asset);
  const textured = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: '#ffffff', map: new THREE.Texture() }));
  instance.add(textured);
  const tintedMaterials = tintModelObject(instance, '#00ff00');
  assert.equal((textured.material as THREE.MeshStandardMaterial).color.getHexString(), 'ffffff');
  assert.ok(!tintedMaterials.includes(textured.material as THREE.MeshStandardMaterial));
  textured.geometry.dispose();
  (textured.material as THREE.MeshStandardMaterial).dispose();
  tintedMaterials.forEach((material) => material.dispose());
  releaseModelAssetInstance(instance);
  clearModelAssetCache();
});

test('default model color comes from the first parametric part', () => {
  assert.equal(getModelAssetDefaultColor(asset), '#64748b');
  const glbAsset: ProjectModelAsset = {
    ...asset,
    payload: { kind: 'glb', file: { assetPath: 'model.glb', fileName: 'model.glb' } },
  };
  assert.equal(getModelAssetDefaultColor(glbAsset), undefined);
});
