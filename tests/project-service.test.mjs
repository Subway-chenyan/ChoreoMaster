import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ZipArchive } from 'archiver';
import crc32 from 'buffer-crc32';
import {
  createManagedProject,
  exportProjectPackage,
  importLegacyProject,
  importProjectPackage,
  ingestProjectAsset,
  loadManagedProject,
  resolveProjectAssetPath,
  saveManagedProject,
} from '../dist-electron/project-service.js';

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function withTempDir(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cosstage-project-test-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function projectDocument(name = '测试项目') {
  return {
    version: '3.0',
    name,
    musicName: null,
    musicAsset: null,
    performers: [{
      id: 'prop-1',
      name: '道具',
      color: '#ffffff',
      label: '道',
      shape: 'square',
      type: 'prop',
      boxTextures: { front: { dataUrl: ONE_PIXEL_PNG, fileName: 'front.png' } },
    }],
    performerGroups: [],
    frames: [{
      id: 'frame-1',
      name: 'Opening',
      startTime: 0,
      duration: 2000,
      positions: { 'prop-1': { x: 50, y: 50 } },
    }],
    audioMarkers: [],
    stageConfig: {
      width: 20,
      depth: 11.25,
      ledContent: { type: 'none' },
    },
  };
}

async function createZip(targetPath, entries) {
  const output = createWriteStream(targetPath);
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const completed = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  for (const entry of entries) {
    archive.append(entry.content, { name: entry.name });
  }
  await archive.finalize();
  await completed;
}

async function createRawZip(targetPath, entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.content);
    const checksum = crc32.unsigned(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(targetPath, Buffer.concat([...localParts, centralDirectory, end]));
}

test('saves prop textures as assets and restores them through project URLs', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Texture Project');
    await saveManagedProject(storagePath, created.id, projectDocument('Texture Project'));

    const saved = JSON.parse(await readFile(path.join(created.path, 'project.json'), 'utf8'));
    const texture = saved.performers[0].boxTextures.front;
    assert.equal(texture.dataUrl, undefined);
    assert.match(texture.assetPath, /^assets\/props\//);

    const loaded = await loadManagedProject(storagePath, created.id);
    assert.match(loaded.data.performers[0].boxTextures.front.dataUrl, /^choreo-asset:\/\//);
    assert.deepEqual(loaded.warnings, []);
  });
});

test('normalizes audio markers and persists them in project.json', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Marker Project');
    await saveManagedProject(storagePath, created.id, {
      ...projectDocument('Marker Project'),
      audioMarkers: [
        { id: 'chorus', label: '  副歌  ', timeMs: 45000.4, color: '#f97316' },
        { id: '', label: '', timeMs: -200, color: 'invalid' },
        { id: 'broken', label: '忽略', timeMs: Number.NaN, color: '#ffffff' },
      ],
    });

    const saved = JSON.parse(await readFile(path.join(created.path, 'project.json'), 'utf8'));
    assert.deepEqual(saved.audioMarkers, [
      { id: 'marker-1-0', label: '标记 2', timeMs: 0, color: '#3b82f6' },
      { id: 'chorus', label: '副歌', timeMs: 45000, color: '#f97316' },
    ]);

    const loaded = await loadManagedProject(storagePath, created.id);
    assert.deepEqual(loaded.data.audioMarkers, saved.audioMarkers);
  });
});

test('persists transition segments and motion settings in project.json', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Transition Project');
    await saveManagedProject(storagePath, created.id, {
      ...projectDocument('Transition Project'),
      frames: [
        {
          id: 'frame-1',
          name: 'Opening',
          startTime: 0,
          duration: 2000,
          positions: { 'prop-1': { x: 20, y: 30 } },
        },
        {
          id: 'frame-2',
          name: 'Ending',
          startTime: 5000,
          duration: 2000,
          positions: { 'prop-1': { x: 80, y: 70 } },
        },
      ],
      transitions: [{
        id: 'transition-frame-1-frame-2',
        fromFrameId: 'frame-1',
        toFrameId: 'frame-2',
        duration: 3000,
        objectMotions: {
          'prop-1': {
            pathType: 'bezier',
            controlPoints: [
              { x: 30, y: 20 },
              { x: 70, y: 80, z: 1.5 },
            ],
            rotationMode: 'lerp',
            startRotation: 0,
            endRotation: 135,
          },
        },
      }],
    });

    const saved = JSON.parse(await readFile(path.join(created.path, 'project.json'), 'utf8'));
    assert.equal(saved.transitions.length, 1);
    assert.equal(saved.transitions[0].objectMotions['prop-1'].pathType, 'bezier');
    assert.equal(saved.transitions[0].objectMotions['prop-1'].endRotation, 135);

    const loaded = await loadManagedProject(storagePath, created.id);
    assert.equal(loaded.data.transitions.length, 1);
    assert.equal(loaded.data.transitions[0].objectMotions['prop-1'].rotationMode, 'lerp');
    assert.deepEqual(loaded.data.transitions[0].objectMotions['prop-1'].controlPoints[1], { x: 70, y: 80, z: 1.5 });
  });
});

test('persists frame rotations and prop pivot settings', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Pivot Project');
    const document = projectDocument('Pivot Project');
    document.performers = [{
      id: 'door',
      name: 'Door',
      color: '#334155',
      label: 'D',
      shape: 'square',
      type: 'prop',
      propCategory: 'prop',
      width: 2,
      height: 3,
      depth: 0.2,
      rotationPivot: 'left',
    }];
    document.frames = [{
      id: 'frame-1',
      name: 'Open',
      startTime: 0,
      duration: 2000,
      positions: { door: { x: 25, y: 50 } },
      rotations: { door: 75 },
    }];

    await saveManagedProject(storagePath, created.id, document);
    const loaded = await loadManagedProject(storagePath, created.id);

    assert.equal(loaded.data.performers[0].rotationPivot, 'left');
    assert.equal(loaded.data.frames[0].rotations.door, 75);
  });
});

test('exports and imports a complete project as a new managed project', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Portable Project');
    const sourceAudio = path.join(storagePath, 'source.mp3');
    await writeFile(sourceAudio, Buffer.from('fake-audio'));
    const audio = await ingestProjectAsset(storagePath, created.id, sourceAudio, 'audio');
    await saveManagedProject(storagePath, created.id, {
      ...projectDocument('Portable Project'),
      musicName: audio.displayName,
      musicAsset: audio.relativePath,
    });

    const packagePath = path.join(storagePath, 'portable.choreo');
    await exportProjectPackage(created.path, packagePath);
    const firstImport = await importProjectPackage(storagePath, packagePath);
    const secondImport = await importProjectPackage(storagePath, packagePath);

    assert.notEqual(firstImport.projectId, created.id);
    assert.notEqual(secondImport.projectId, firstImport.projectId);
    assert.match(firstImport.audioUrl, /^choreo-asset:\/\//);
    assert.equal(firstImport.data.frames.length, 1);
  });
});

test('continues loading when a referenced asset is missing', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Degraded Project');
    await saveManagedProject(storagePath, created.id, {
      ...projectDocument('Degraded Project'),
      musicName: 'missing.mp3',
      musicAsset: 'assets/audio/missing.mp3',
    });

    const loaded = await loadManagedProject(storagePath, created.id);
    assert.equal(loaded.audioUrl, null);
    assert.equal(loaded.data.frames.length, 1);
    assert.equal(loaded.warnings[0].code, 'missing_asset');
  });
});

test('migrates legacy JSON into a managed project with warnings', async () => {
  await withTempDir(async (storagePath) => {
    const legacyPath = path.join(storagePath, 'legacy.json');
    await writeFile(legacyPath, JSON.stringify({
      ...projectDocument('Legacy Project'),
      version: '1.2',
      musicName: 'lost.mp3',
    }));

    const imported = await importLegacyProject(storagePath, legacyPath);
    assert.equal(imported.data.name, 'Legacy Project');
    assert.equal(imported.warnings[0].code, 'legacy_resource_missing');
    assert.equal(imported.data.frames.length, 1);
  });
});

test('rejects paths that escape the project directory', async () => {
  await withTempDir(async (storagePath) => {
    assert.throws(
      () => resolveProjectAssetPath(storagePath, 'project-1', '../outside.txt'),
      /Invalid project asset path|escapes its root/,
    );
  });
});

test('rejects archive entries that attempt path traversal', async () => {
  await withTempDir(async (storagePath) => {
    const packagePath = path.join(storagePath, 'traversal.choreo');
    await createRawZip(packagePath, [
      { name: '../outside.txt', content: 'escape' },
      { name: 'project.json', content: JSON.stringify(projectDocument('Unsafe Project')) },
    ]);

    await assert.rejects(importProjectPackage(storagePath, packagePath), /Unsafe archive entry|escapes its root/);
  });
});

test('failed package import does not install a partial project', async () => {
  await withTempDir(async (storagePath) => {
    await mkdir(path.join(storagePath, 'projects'), { recursive: true });
    const packagePath = path.join(storagePath, 'invalid.choreo');
    await createZip(packagePath, [{ name: 'readme.txt', content: 'missing project.json' }]);

    await assert.rejects(importProjectPackage(storagePath, packagePath));
    const projects = await import('node:fs/promises').then(({ readdir }) => readdir(path.join(storagePath, 'projects')));
    assert.deepEqual(projects, []);
  });
});
