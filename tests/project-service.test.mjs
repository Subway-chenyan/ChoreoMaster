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
  deleteManagedProject,
  duplicateManagedProject,
  exportChoreographyDocument,
  exportProjectPackage,
  importChoreographyDocument,
  importProjectPackage,
  ingestProjectAsset,
  listManagedProjects,
  listProjectRecoverySnapshots,
  loadManagedProject,
  resolveProjectAssetPath,
  renameManagedProject,
  restoreProjectRecoverySnapshot,
  saveManagedProject,
} from '../dist-electron/project-service.js';
import {
  createProjectFromTemplate,
  listProjectTemplates,
} from '../dist-electron/project-template-service.js';

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

test('writes managed project documents through an atomic temporary file', async () => {
  const source = await readFile(new URL('../electron/project-service.ts', import.meta.url), 'utf8');

  assert.match(source, /async function writeJsonAtomically/);
  assert.match(source, /await fs\.writeFile\(temporaryPath,/);
  assert.match(source, /await fs\.rename\(temporaryPath, filePath\)/);
  assert.match(source, /await writeJsonAtomically\(projectPath, document\)/);
  assert.doesNotMatch(source, /await fs\.writeFile\(projectPath, JSON\.stringify\(document/);
});

test('persists stage background configuration and restores its project URL', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Stage Background Project');
    await saveManagedProject(storagePath, created.id, {
      ...projectDocument('Stage Background Project'),
      stageConfig: {
        width: 18,
        depth: 16,
        wingWidth: 3,
        showStageLines: false,
        ledDistanceFromBack: 2.5,
        ledBottomHeight: 1.2,
        background: {
          value: ONE_PIXEL_PNG,
          opacity: 0.35,
          pixelWidth: 1,
          pixelHeight: 1,
        },
      },
    });

    const saved = JSON.parse(await readFile(path.join(created.path, 'project.json'), 'utf8'));
    assert.match(saved.stageConfig.background.value, /^assets\/stage-backgrounds\//);
    assert.equal(saved.stageConfig.background.opacity, 0.35);
    assert.equal(saved.stageConfig.showStageLines, false);
    assert.equal(saved.stageConfig.ledDistanceFromBack, 2.5);
    assert.equal(saved.stageConfig.ledBottomHeight, 1.2);

    const loaded = await loadManagedProject(storagePath, created.id);
    const backgroundPath = loaded.data.stageConfig.background.value;
    assert.match(loaded.mediaUrls[backgroundPath], /^choreo-asset:\/\//);
    assert.equal(loaded.data.stageConfig.ledBottomHeight, 1.2);
    assert.deepEqual(loaded.warnings, []);
  });
});

test('normalizes legacy stage configuration defaults', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Legacy Stage Project');
    await writeFile(path.join(created.path, 'project.json'), JSON.stringify(projectDocument('Legacy Stage Project')));

    const loaded = await loadManagedProject(storagePath, created.id);
    assert.equal(loaded.data.stageConfig.showStageLines, true);
    assert.equal(loaded.data.stageConfig.ledDistanceFromBack, 0);
    assert.equal(loaded.data.stageConfig.ledBottomHeight, 0);
    assert.equal(loaded.data.stageConfig.background, undefined);
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
    const secondImport = await importProjectPackage(storagePath, packagePath, { name: 'Renamed Copy' });

    assert.notEqual(firstImport.projectId, created.id);
    assert.notEqual(secondImport.projectId, firstImport.projectId);
    assert.match(firstImport.audioUrl, /^choreo-asset:\/\//);
    assert.equal(firstImport.data.frames.length, 1);
    assert.equal(secondImport.data.name, 'Renamed Copy');
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

test('creates a named project from the verified ChinaJoy template and reuses its cache', async () => {
  await withTempDir(async (storagePath) => {
    const packageBytes = await readFile(new URL('../public/templates/chinajoy-v1.zip', import.meta.url));
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount += 1;
      return new Response(packageBytes, {
        headers: { 'content-length': String(packageBytes.byteLength) },
      });
    };
    const cacheRoot = path.join(storagePath, 'template-cache');

    const first = await createProjectFromTemplate(
      storagePath,
      cacheRoot,
      'chinajoy',
      'ChinaJoy 演示',
      fetcher,
    );
    const second = await createProjectFromTemplate(
      storagePath,
      cacheRoot,
      'chinajoy',
      'ChinaJoy 副本',
      fetcher,
    );
    await writeFile(path.join(cacheRoot, 'chinajoy-v1.zip'), 'corrupt-cache');
    const third = await createProjectFromTemplate(
      storagePath,
      cacheRoot,
      'chinajoy',
      'ChinaJoy 缓存恢复',
      fetcher,
    );

    assert.equal(fetchCount, 2);
    assert.equal(listProjectTemplates()[0].id, 'chinajoy');
    assert.equal(first.data.name, 'ChinaJoy 演示');
    assert.equal(second.data.name, 'ChinaJoy 副本');
    assert.notEqual(first.projectId, second.projectId);
    assert.equal(third.data.name, 'ChinaJoy 缓存恢复');
    assert.match(first.data.performers[2].boxTextures.front.dataUrl, /^choreo-asset:\/\//);
    assert.equal(first.warnings[0].code, 'missing_asset');
    assert.match(first.warnings[0].resource, /\.mp4$/);
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

test('exports and imports choreography-only JSON as a new project without binary assets', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Choreography Source');
    await saveManagedProject(storagePath, created.id, {
      ...projectDocument('Choreography Source'),
      musicName: 'song.mp3',
      musicAsset: 'assets/audio/song.mp3',
    });
    const jsonPath = path.join(storagePath, 'formation.json');

    await exportChoreographyDocument(storagePath, created.id, jsonPath);
    const exported = JSON.parse(await readFile(jsonPath, 'utf8'));
    assert.equal(exported.format, 'cosstage-choreography');
    assert.equal(exported.schemaVersion, 1);
    assert.equal(exported.musicAsset, undefined);
    assert.equal(exported.performers[0].boxTextures, undefined);

    const imported = await importChoreographyDocument(storagePath, jsonPath);
    assert.notEqual(imported.projectId, created.id);
    assert.equal(imported.data.frames.length, 1);
    assert.equal(imported.data.musicAsset, null);
    assert.equal(imported.data.performers[0].boxTextures, undefined);
  });
});

test('keeps five recovery snapshots and restores one as a new project', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Recovery Source');
    for (let index = 0; index < 7; index += 1) {
      await saveManagedProject(storagePath, created.id, {
        ...projectDocument('Recovery Source'),
        frames: [{
          id: `frame-${index}`,
          name: `Version ${index}`,
          startTime: 0,
          duration: 2000,
          positions: {},
        }],
      });
    }

    const snapshots = await listProjectRecoverySnapshots(storagePath, created.id);
    assert.equal(snapshots.length, 5);
    assert.equal(snapshots[0].sourceProjectId, created.id);

    const restored = await restoreProjectRecoverySnapshot(storagePath, snapshots[0].id);
    assert.notEqual(restored.projectId, created.id);
    assert.equal(restored.data.frames[0].name, 'Version 5');
    assert.match(restored.data.name, /Recovery Source/);
  });
});

test('skips blank initialization snapshots and keeps the first meaningful version', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, 'Fresh Project');
    await saveManagedProject(storagePath, created.id, projectDocument('Fresh Project'));
    assert.equal((await listProjectRecoverySnapshots(storagePath, created.id)).length, 0);

    await saveManagedProject(storagePath, created.id, {
      ...projectDocument('Fresh Project'),
      frames: [{
        id: 'frame-2',
        name: 'Changed',
        startTime: 0,
        duration: 2000,
        positions: {},
      }],
    });
    const snapshots = await listProjectRecoverySnapshots(storagePath, created.id);
    assert.equal(snapshots.length, 1);
    assert.equal(typeof snapshots[0].createdAt, 'number');
  });
});

test('renames atomically and duplicates Chinese project names with valid IDs', async () => {
  await withTempDir(async (storagePath) => {
    const created = await createManagedProject(storagePath, '中文项目');
    await saveManagedProject(storagePath, created.id, projectDocument('中文项目'));
    await renameManagedProject(storagePath, created.id, '舞台方案');

    const renamed = await loadManagedProject(storagePath, created.id);
    assert.equal(renamed.data.name, '舞台方案');
    assert.equal((await listProjectRecoverySnapshots(storagePath, created.id)).length, 1);

    const duplicate = await duplicateManagedProject(storagePath, created.id);
    assert.notEqual(duplicate.id, created.id);
    assert.match(duplicate.id, /^[\p{L}\p{N}-]+$/u);
    const duplicated = await loadManagedProject(storagePath, duplicate.id);
    assert.equal(duplicated.data.name, '舞台方案 (副本)');
    assert.equal((await listManagedProjects(storagePath)).length, 2);

    await deleteManagedProject(storagePath, created.id);
    assert.equal((await listManagedProjects(storagePath)).length, 1);
    assert.equal((await listProjectRecoverySnapshots(storagePath, created.id)).length, 0);
  });
});

test('invalid choreography JSON never installs a partial project', async () => {
  await withTempDir(async (storagePath) => {
    const jsonPath = path.join(storagePath, 'invalid-choreography.json');
    await writeFile(jsonPath, JSON.stringify({
      format: 'cosstage-choreography',
      schemaVersion: 1,
      name: 'Broken',
      performers: [],
    }));

    await assert.rejects(importChoreographyDocument(storagePath, jsonPath), /performers or frames/);
    assert.equal((await listManagedProjects(storagePath)).length, 0);
  });
});

test('rejects project packages with too many archive entries before extracting them', async () => {
  await withTempDir(async (storagePath) => {
    const packagePath = path.join(storagePath, 'too-many-files.choreo');
    await createRawZip(packagePath, Array.from({ length: 501 }, (_, index) => ({
      name: `assets/audio/${index}.txt`,
      content: 'x',
    })));

    await assert.rejects(importProjectPackage(storagePath, packagePath), /too many files/i);
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
