import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makePerformersPortable,
  pasteFormationPayload,
  pastePerformerPayload,
  type FormationClipboardPayload,
  type PerformerClipboardPayload,
} from '../utils/cross-project-clipboard.ts';
import type { Performer } from '../types.ts';

function createIds(...ids: string[]): () => string {
  let index = 0;
  return () => {
    const id = ids[index];
    index += 1;
    if (!id) throw new Error('Test ID sequence exhausted');
    return id;
  };
}

test('pastes selected performers into the target frame at copied scene coordinates', () => {
  const payload: PerformerClipboardPayload = {
    kind: 'performers',
    performers: [{
      id: 'actor-a',
      name: 'A',
      color: '#ffffff',
      label: 'A',
      shape: 'circle',
      groupId: 'group-a',
    }],
    groups: [{
      id: 'group-a',
      name: '主演',
      color: '#ffffff',
      collapsed: false,
    }],
    scene: {
      'actor-a': {
        position: { x: 24, y: 61, z: 2 },
        rotation: 1.25,
      },
    },
  };

  const pasted = pastePerformerPayload(
    payload,
    'target-frame',
    createIds('group-new', 'actor-new'),
  );

  assert.equal(pasted.groups[0].id, 'group-new');
  assert.equal(pasted.performers[0].id, 'actor-new');
  assert.equal(pasted.performers[0].name, 'A');
  assert.equal(pasted.performers[0].groupId, 'group-new');
  assert.deepEqual(
    pasted.frameUpdates['target-frame'].positions['actor-new'],
    { x: 24, y: 61, z: 2 },
  );
  assert.equal(
    pasted.frameUpdates['target-frame'].rotations['actor-new'],
    1.25,
  );
});

test('pastes a formation with every source object and remapped hidden state', () => {
  const payload: FormationClipboardPayload = {
    kind: 'formation',
    groups: [
      { id: 'visible-group', name: '可见组', color: '#ffffff', collapsed: false },
      { id: 'hidden-group', name: '隐藏组', color: '#000000', collapsed: false },
    ],
    performers: [
      {
        id: 'a', name: 'A', color: '#ffffff', label: 'A', shape: 'circle',
        groupId: 'visible-group',
      },
      {
        id: 'b', name: 'B', color: '#ffffff', label: 'B', shape: 'circle',
        groupId: 'hidden-group',
      },
      {
        id: 'door', name: '门板', color: '#999999', label: '门', shape: 'square',
        type: 'prop', boundToId: 'a',
      },
    ],
    frame: {
      id: 'source-frame',
      name: 'Opening',
      startTime: 0,
      duration: 2000,
      positions: {
        a: { x: 10, y: 20 },
        door: { x: 30, y: 40, z: 1 },
      },
      rotations: { a: 0.5, door: 1 },
      hiddenGroupIds: ['hidden-group'],
    },
  };

  const pasted = pasteFormationPayload(
    payload,
    9000,
    createIds(
      'group-new-1', 'group-new-2',
      'actor-new-a', 'actor-new-b', 'prop-new',
      'frame-new',
    ),
  );

  assert.equal(pasted.performers.length, 3);
  assert.deepEqual(pasted.performers.map((item) => item.name), ['A', 'B', '门板']);
  assert.equal(pasted.performers[2].boundToId, pasted.performers[0].id);
  assert.equal(Object.keys(pasted.frame.positions).length, 2);
  assert.deepEqual(pasted.frame.positions['prop-new'], { x: 30, y: 40, z: 1 });
  assert.deepEqual(pasted.frame.rotations, { 'actor-new-a': 0.5, 'prop-new': 1 });
  assert.deepEqual(pasted.frame.hiddenGroupIds, ['group-new-2']);
  assert.equal(pasted.frame.id, 'frame-new');
  assert.equal(pasted.frame.name, 'Opening (复制)');
  assert.equal(pasted.frame.startTime, 9000);
});

test('makes performer textures self-contained for another project', async () => {
  const sourceProp: Performer = {
    id: 'door',
    name: '门板',
    color: '#ffffff',
    label: '门',
    shape: 'square',
    type: 'prop',
    textureDataUrl: 'choreo-asset://asset/source/assets/props/legacy.png',
    textureAssetPath: 'assets/props/legacy.png',
    boxTextures: {
      front: {
        dataUrl: 'choreo-asset://asset/source/assets/props/front.png',
        assetPath: 'assets/props/front.png',
        fileName: 'front.png',
      },
      back: {
        dataUrl: 'data:image/png;base64,YmFjaw==',
        assetPath: 'assets/props/back.png',
        fileName: 'back.png',
      },
    },
    extrudedTextures: {
      side: {
        dataUrl: 'choreo-asset://asset/source/assets/props/side.png',
        assetPath: 'assets/props/side.png',
        fileName: 'side.png',
      },
    },
  };
  const loadedUrls: string[] = [];

  const [portable] = await makePerformersPortable([sourceProp], async (url) => {
    loadedUrls.push(url);
    return `data:image/png;base64,${Buffer.from(url).toString('base64')}`;
  });

  assert.equal(loadedUrls.length, 3);
  assert.ok(loadedUrls.every((url) => url.startsWith('choreo-asset:')));
  assert.equal(portable.textureAssetPath, undefined);
  assert.match(portable.textureDataUrl ?? '', /^data:image\/png/);
  assert.equal(portable.boxTextures?.front?.assetPath, undefined);
  assert.equal(portable.boxTextures?.front?.fileName, 'front.png');
  assert.equal(portable.boxTextures?.back?.assetPath, undefined);
  assert.equal(portable.boxTextures?.back?.dataUrl, 'data:image/png;base64,YmFjaw==');
  assert.equal(portable.extrudedTextures?.side?.assetPath, undefined);
  assert.equal(portable.extrudedTextures?.side?.fileName, 'side.png');
});
