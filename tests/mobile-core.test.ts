import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import 'fake-indexeddb/auto';
import {
  createMobileDocument,
  addActor,
  moveActors,
  removeActors,
  duplicateFormation,
  changeFormationDuration,
  editHistory,
} from '../mobile/editor-model';
import {
  readProjectPackage,
  writeProjectPackage,
  parseMobileDocument,
  inspectPackage,
  validateAssetPath,
} from '../mobile/project-package';
import {
  saveMobileProject,
  loadMobileProject,
  listMobileProjects,
  deleteMobileProject,
} from '../mobile/project-store';
import { createLegacyUnitBoxAsset } from '../electron/model-asset-contract';
import { pinchViewport } from '../mobile/gestures';
import {
  createManagedProject,
  saveManagedProject,
  exportProjectPackage,
  importProjectPackage,
} from '../dist-electron/project-service.js';

function fixture() {
  let doc = createMobileDocument('两端互通', () => 'f1');
  doc = addActor(doc, {
    id: 'p1',
    name: '主舞',
    label: 'A',
    color: '#38bdf8',
    shape: 'circle',
    type: 'performer',
  });
  doc = addActor(doc, {
    id: 'p2',
    name: '锁定演员',
    label: 'B',
    color: '#34d399',
    shape: 'circle',
    locked: true,
    type: 'performer',
  });
  doc.frames[0].positions.p1 = { x: 20, y: 30, z: 2 };
  doc.frames[0].rotations = { p1: 135 };
  doc.frames[0].notes = '开场注意灯光';
  doc = duplicateFormation(doc, 'f1', 'f2');
  doc.performerGroups = [{ id: 'g1', name: '主舞组', color: '#38bdf8', collapsed: false }];
  doc.performers[0].groupId = 'g1';
  doc.audioMarkers = [{ id: 'beat1', timeMs: 1000, label: '第一拍', color: '#ffffff' }];
  doc.musicAsset = 'assets/audio/rehearsal.wav';
  doc.musicName = 'rehearsal.wav';
  doc.transitions = [
    {
      id: 't1',
      fromFrameId: 'f1',
      toFrameId: 'f2',
      objectMotions: {
        p1: {
          pathType: 'bezier',
          controlPoints: [
            { x: 40, y: 20 },
            { x: 60, y: 80 },
          ],
          rotationMode: 'lerp',
          startRotation: 135,
          endRotation: 270,
        },
      },
    },
  ];
  doc.performerNotes = [
    {
      id: 'n1',
      performerId: 'p1',
      frameId: 'f1',
      content: '带道具入场',
      items: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  const model = createLegacyUnitBoxAsset();
  doc.modelAssets = { [model.id]: model };
  return doc;
}

test('desktop → mobile edit → desktop preserves shared document and binary assets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cosstage-mobile-'));
  try {
    const original = await createManagedProject(root, '两端互通');
    const doc = fixture();
    await saveManagedProject(root, original.id, doc);
    const payload = Buffer.from([82, 73, 70, 70, 0, 255, 128, 42]);
    await writeFile(path.join(original.path, 'assets/audio/rehearsal.wav'), payload);
    await mkdir(path.join(original.path, 'assets/models'), { recursive: true });
    await writeFile(path.join(original.path, 'assets/models/retained.glb'), payload);
    const desktopZip = path.join(root, 'desktop.zip');
    await exportProjectPackage(original.path, desktopZip);
    const mobile = await readProjectPackage(new Blob([await readFile(desktopZip)]));
    assert.deepEqual(mobile.warnings, []);
    assert.equal(mobile.document.frames[0].positions.p1.z, 2);
    const changed = moveActors(mobile.document, 'f1', [{ id: 'p1', pos: { x: 65, y: 45 } }]);
    const output = await writeProjectPackage(changed, mobile.assets);
    const mobileZip = path.join(root, 'mobile.zip');
    await writeFile(mobileZip, new Uint8Array(await output.arrayBuffer()));
    const imported = await importProjectPackage(root, mobileZip);
    assert.notEqual(imported.projectId, original.id);
    const saved = JSON.parse(await readFile(path.join(imported.projectPath, 'project.json'), 'utf8'));
    assert.deepEqual(saved.frames, changed.frames);
    assert.deepEqual(saved.performerGroups, changed.performerGroups);
    assert.deepEqual(saved.audioMarkers, changed.audioMarkers);
    assert.deepEqual(saved.transitions, changed.transitions);
    assert.deepEqual(saved.performerNotes, changed.performerNotes);
    assert.deepEqual(saved.modelAssets, changed.modelAssets);
    assert.deepEqual(await readFile(path.join(imported.projectPath, 'assets/audio/rehearsal.wav')), payload);
    assert.deepEqual(await readFile(path.join(imported.projectPath, 'assets/models/retained.glb')), payload);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('archives reject path traversal, truncation, corruption, oversized directory and future schemas', async () => {
  assert.throws(() => validateAssetPath('__proto__'), /路径/);
  const json = strToU8(JSON.stringify(fixture()));
  for (const unsafe of ['../escape', '/absolute', 'assets/../escape', 'assets\\escape']) {
    const zip = zipSync({ 'project.json': json, [unsafe]: strToU8('bad') });
    await assert.rejects(readProjectPackage(new Blob([zip])), /路径/);
  }
  const valid = zipSync({ 'project.json': json, 'assets/a': strToU8('payload') }, { level: 0 });
  await assert.rejects(readProjectPackage(new Blob([valid.slice(0, -9)])), /不完整/);
  const broken = valid.slice();
  broken[30 + 'project.json'.length + 10] ^= 1;
  await assert.rejects(readProjectPackage(new Blob([broken])), /校验失败/);
  const entries = Object.fromEntries(
    Array.from({ length: 501 }, (_, i) => [`assets/${i}`, new Uint8Array()])
  );
  assert.throws(() => inspectPackage(zipSync({ 'project.json': json, ...entries })), /数量/);
  const bomb = valid.slice();
  const view = new DataView(bomb.buffer);
  const central = view.getUint32(bomb.length - 6, true);
  view.setUint32(central + 24, 129 * 1024 * 1024, true);
  assert.throws(() => inspectPackage(bomb), /128 MB/);
  assert.throws(() => parseMobileDocument({ ...fixture(), version: '999.0' }), /更新版本/);
  assert.throws(
    () => parseMobileDocument({ ...fixture(), musicAsset: 'https://external.invalid/track.mp3' }),
    /路径/
  );
});

test('local project storage keeps assets across document-only saves and isolates imported IDs', async () => {
  const doc = fixture();
  const assets = { ['assets/audio/rehearsal.wav']: new Blob(['music']) };
  await saveMobileProject('original', doc, assets);
  await saveMobileProject('copy', doc, assets);
  await saveMobileProject('copy', { ...doc, name: '手机修改' });
  assert.equal((await loadMobileProject('original')).document.name, doc.name);
  const copy = await loadMobileProject('copy');
  assert.equal(copy.document.name, '手机修改');
  assert.equal(await copy.assets['assets/audio/rehearsal.wav'].text(), 'music');
  assert.equal((await listMobileProjects()).length, 2);
  await deleteMobileProject('copy');
  await assert.rejects(loadMobileProject('copy'), /找不到/);
  assert.equal((await listMobileProjects()).length, 1);
  await deleteMobileProject('original');
});

test('moves preserve elevation and lock state; history and formation timing remain reversible', () => {
  const doc = fixture();
  const moved = moveActors(doc, 'f1', [
    { id: 'p1', pos: { x: 80, y: 60 } },
    { id: 'p2', pos: { x: 99, y: 99 } },
  ]);
  assert.deepEqual(moved.frames[0].positions.p1, { x: 80, y: 60, z: 2 });
  assert.deepEqual(moved.frames[0].positions.p2, doc.frames[0].positions.p2);
  let history = editHistory({ past: [], present: doc, future: [] }, { type: 'commit', document: moved });
  history = editHistory(history, { type: 'undo' });
  assert.equal(history.present, doc);
  history = editHistory(history, { type: 'redo' });
  assert.equal(history.present, moved);
  const longer = changeFormationDuration(doc, 'f1', 7000);
  assert.equal(longer.frames[1].startTime, doc.frames[1].startTime + 3000);
  const removed = removeActors(doc, ['p1', 'p2']);
  assert.deepEqual(
    removed.performers.map((p) => p.id),
    ['p2']
  );
  assert.equal(removed.frames[0].positions.p1, undefined);
});

test('pinch zoom anchors the midpoint and respects bounds without touching document coordinates', () => {
  assert.deepEqual(
    pinchViewport(
      { scale: 1, offset: { x: 0, y: 0 } },
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { x: -50, y: 0 },
        { x: 150, y: 0 },
      ]
    ),
    { scale: 2, offset: { x: -50, y: 0 } }
  );
  assert.equal(
    pinchViewport(
      { scale: 1, offset: { x: 0, y: 0 } },
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ]
    ).scale,
    4
  );
});

test('asset write failure aborts the document write in the same transaction', async () => {
  const doc = fixture();
  await saveMobileProject('atomic', doc, {});
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'assets') throw new DOMException('Quota exceeded', 'QuotaExceededError');
    return original.apply(this, args);
  };
  try {
    await assert.rejects(
      saveMobileProject(
        'atomic',
        { ...doc, name: 'must not persist' },
        { 'assets/audio/rehearsal.wav': new Blob(['music']) }
      ),
      /Quota/
    );
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  assert.equal((await loadMobileProject('atomic')).document.name, doc.name);
  await deleteMobileProject('atomic');
});
