import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  beginGlbModelImport,
  cancelGlbModelImport,
  duplicateModelAsset,
  getModelAssetDeletionPath,
  listModelAssets,
  materializeModelAsset,
  resolveLibraryAssetPath,
  saveParametricModelAsset,
  updateModelAssetThumbnail,
} from '../dist-electron/model-asset-service.js';
import { normalizeParametricRecipe } from '../dist-electron/model-asset-contract.js';
import { createManagedProject } from '../dist-electron/project-service.js';

async function withTempDir(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cosstage-model-asset-test-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function recipe() {
  return {
    schemaVersion: 1,
    origin: { x: 0, y: 0, z: 0 },
    parts: [{
      id: 'box',
      name: '盒体',
      position: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      geometry: { kind: 'box', width: 1, height: 1, depth: 1 },
      material: { color: '#64748b' },
    }],
  };
}

function saveInput(overrides = {}) {
  return {
    name: '测试方箱',
    tags: ['道具'],
    defaultUsage: 'prop',
    recipe: recipe(),
    intrinsicSize: { width: 1, height: 1, depth: 1 },
    bounds: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } },
    pivot: { x: 0, y: 0, z: 0 },
    footprints: [[{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }]],
    ...overrides,
  };
}

function glb(json) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const padding = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(padding, 0x20)]);
  const result = Buffer.alloc(20 + jsonChunk.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonChunk.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(result, 20);
  return result;
}

test('ships twelve read-only offline presets', async () => {
  await withTempDir(async (storagePath) => {
    const assets = await listModelAssets(storagePath);
    assert.equal(assets.filter((asset) => asset.origin === 'builtin').length, 12);
    await assert.rejects(
      () => getModelAssetDeletionPath(storagePath, assets[0].id),
      (error) => error.code === 'ASSET_READ_ONLY',
    );
  });
});

test('saves revisions atomically and materializes a hash-deduplicated project snapshot', async () => {
  await withTempDir(async (storagePath) => {
    const first = await saveParametricModelAsset(storagePath, saveInput());
    const second = await saveParametricModelAsset(storagePath, saveInput({
      assetId: first.id,
      expectedRevision: first.revision,
      name: '测试方箱二版',
    }));
    assert.equal(second.revision, 2);
    await assert.rejects(
      () => saveParametricModelAsset(storagePath, saveInput({ assetId: first.id, expectedRevision: 1 })),
      (error) => error.code === 'REVISION_CONFLICT',
    );
    const project = await createManagedProject(storagePath, '模型项目');
    const snapshotA = await materializeModelAsset(storagePath, project.id, project.path, second.id, 2);
    const snapshotB = await materializeModelAsset(storagePath, project.id, project.path, second.id, 2);
    assert.equal(snapshotA.id, snapshotB.id);
    assert.equal(snapshotA.sourceRevision, 2);
    const storedManifest = JSON.parse(await readFile(path.join(storagePath, 'asset-library', second.id, 'manifest.json'), 'utf8'));
    assert.equal(storedManifest.revision, 2);
    assert.equal(storedManifest.payload.recipe.parts[0].material.baseColorTexture, undefined);
  });
});

test('upgrades a legacy asset thumbnail to a versioned front-view preview', async () => {
  await withTempDir(async (storagePath) => {
    const source = await saveParametricModelAsset(storagePath, saveInput());
    assert.equal(source.thumbnailVersion, undefined);
    const upgraded = await updateModelAssetThumbnail(storagePath, {
      assetId: source.id,
      expectedRevision: source.revision,
      thumbnailDataUrl: 'data:image/png;base64,aGVsbG8=',
      floorplanDataUrl: 'data:image/png;base64,d29ybGQ=',
    });
    assert.equal(upgraded.revision, source.revision + 1);
    assert.equal(upgraded.thumbnailVersion, 1);
    assert.equal(upgraded.floorplanVersion, 1);
    assert.match(upgraded.thumbnail.runtimeUrl, /thumbnail-/);
    assert.match(upgraded.floorplan.runtimeUrl, /floorplan-/);
  });
});

test('duplicates user parametric assets with texture and preview files', async () => {
  await withTempDir(async (storagePath) => {
    const imageDataUrl = 'data:image/png;base64,aGVsbG8=';
    const source = await saveParametricModelAsset(storagePath, saveInput({
      recipe: {
        ...recipe(),
        parts: [{
          ...recipe().parts[0],
          material: {
            color: '#ffffff',
            baseColorTexture: { runtimeUrl: imageDataUrl, fileName: 'texture.png', assetPath: 'texture.png' },
          },
        }],
      },
      thumbnailDataUrl: imageDataUrl,
      floorplanDataUrl: imageDataUrl,
    }));

    const copy = await duplicateModelAsset(storagePath, source.id);
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.payload.kind, 'parametric');
    const encodedCopyId = encodeURIComponent(copy.id);
    assert.ok(copy.payload.recipe.parts[0].material.baseColorTexture.runtimeUrl.includes(`/${encodedCopyId}/`));
    assert.ok(copy.thumbnail.runtimeUrl.includes(`/${encodedCopyId}/`));
    assert.ok(copy.floorplan.runtimeUrl.includes(`/${encodedCopyId}/`));

    const copyDirectory = path.join(storagePath, 'asset-library', copy.id);
    await readFile(path.join(copyDirectory, copy.payload.recipe.parts[0].material.baseColorTexture.assetPath));
    await readFile(path.join(copyDirectory, copy.thumbnail.assetPath));
    await readFile(path.join(copyDirectory, copy.floorplan.assetPath));
  });
});

test('rejects invalid or self-intersecting extrusion polygons', () => {
  assert.throws(() => normalizeParametricRecipe({
    ...recipe(),
    parts: [{
      ...recipe().parts[0],
      geometry: { kind: 'extrusion', height: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }] },
    }],
  }), /无效部件|多边形/);
});

test('rejects library path traversal', () => {
  assert.throws(
    () => resolveLibraryAssetPath('C:/safe', 'asset', 'asset-1', '../secret.glb'),
    /无效|越界|outside|路径/,
  );
});

test('validates GLB structure, external URIs, size, and triangle thresholds', async () => {
  await withTempDir(async (storagePath) => {
    const broken = path.join(storagePath, 'broken.glb');
    await writeFile(broken, Buffer.from('broken'));
    await assert.rejects(() => beginGlbModelImport(storagePath, broken), (error) => error.code === 'GLB_INVALID');

    const external = path.join(storagePath, 'external.glb');
    await writeFile(external, glb({ buffers: [{ uri: 'mesh.bin' }], meshes: [{ primitives: [] }] }));
    await assert.rejects(() => beginGlbModelImport(storagePath, external), (error) => error.code === 'GLB_EXTERNAL_RESOURCE');

    const empty = path.join(storagePath, 'empty.glb');
    await writeFile(empty, glb({ scenes: [{ nodes: [] }] }));
    await assert.rejects(() => beginGlbModelImport(storagePath, empty), (error) => error.code === 'GLB_INVALID');

    const complex = path.join(storagePath, 'complex.glb');
    await writeFile(complex, glb({ accessors: [{ count: 3_000_003 }], meshes: [{ primitives: [{ indices: 0 }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }] }));
    await assert.rejects(() => beginGlbModelImport(storagePath, complex), (error) => error.code === 'GLB_TOO_COMPLEX');

    const warning = path.join(storagePath, 'warning.glb');
    await writeFile(warning, glb({ accessors: [{ count: 900_000 }], meshes: [{ primitives: [{ indices: 0 }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }] }));
    const session = await beginGlbModelImport(storagePath, warning);
    assert.equal(session.triangleCount, 300_000);
    assert.equal(session.warnings.length, 1);
    await cancelGlbModelImport(session.sessionId);

    const huge = path.join(storagePath, 'huge.glb');
    await writeFile(huge, '');
    await truncate(huge, 100 * 1024 * 1024 + 1);
    await assert.rejects(() => beginGlbModelImport(storagePath, huge), (error) => error.code === 'GLB_TOO_LARGE');
  });
});
