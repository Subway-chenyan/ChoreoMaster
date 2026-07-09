import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function importTypeScriptModule(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: relativePath,
  });
  const encoded = Buffer.from(transpiled.outputText, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

test('uses the persisted transition id when selecting a configured frame gap', async () => {
  const { getGapSelectionId } = await importTypeScriptModule('../utils/transitions.ts');
  const selectionId = getGapSelectionId({
    id: 'transition-frame-a-frame-b',
    start: 2000,
    end: 5000,
    duration: 3000,
    prevId: 'frame-a',
    nextId: 'frame-b',
    transition: {
      id: 'custom-imported-transition-id',
      fromFrameId: 'frame-a',
      toFrameId: 'frame-b',
      objectMotions: {},
    },
  });

  assert.equal(selectionId, 'custom-imported-transition-id');
});

test('normalizes imported transitions and discards malformed motion data', async () => {
  const { normalizeTransitions } = await importTypeScriptModule('../electron/project-contract.ts');
  const transitions = normalizeTransitions([
    {
      id: ' custom-id ',
      fromFrameId: ' frame-a ',
      toFrameId: 'frame-b',
      duration: 1250.4,
      objectMotions: {
        valid: {
          pathType: 'bezier',
          controlPoints: [{ x: 10, y: 20 }, { x: 30, y: 40, z: 2 }],
          rotationMode: 'lerp',
          startRotation: -45,
          endRotation: 90,
        },
        invalid: null,
      },
    },
    {
      id: 'missing-motion-map',
      fromFrameId: 'frame-b',
      toFrameId: 'frame-c',
    },
    {
      fromFrameId: 12,
      toFrameId: 'frame-d',
      objectMotions: {},
    },
  ]);

  assert.deepEqual(transitions, [
    {
      id: 'custom-id',
      fromFrameId: 'frame-a',
      toFrameId: 'frame-b',
      duration: 1250,
      objectMotions: {
        valid: {
          pathType: 'bezier',
          controlPoints: [{ x: 10, y: 20 }, { x: 30, y: 40, z: 2 }],
          rotationMode: 'lerp',
          startRotation: -45,
          endRotation: 90,
        },
      },
    },
    {
      id: 'missing-motion-map',
      fromFrameId: 'frame-b',
      toFrameId: 'frame-c',
      objectMotions: {},
    },
  ]);
});

test('honors a shorter transition duration and holds the destination until the next frame', async () => {
  const { evaluateSceneStateAtTime } = await importTypeScriptModule('../utils/transitions.ts');
  const frames = [
    {
      id: 'frame-a',
      name: 'A',
      startTime: 0,
      duration: 1000,
      positions: { performer: { x: 0, y: 0 } },
    },
    {
      id: 'frame-b',
      name: 'B',
      startTime: 5000,
      duration: 1000,
      positions: { performer: { x: 100, y: 100 } },
    },
  ];
  const performers = [{ id: 'performer', name: 'P', type: 'performer' }];
  const transitions = [{
    id: 'custom',
    fromFrameId: 'frame-a',
    toFrameId: 'frame-b',
    duration: 1000,
    objectMotions: {},
  }];

  const scene = evaluateSceneStateAtTime(3000, frames, performers, transitions);

  assert.deepEqual(scene.positions.performer, { x: 100, y: 100 });
});

test('uses frame rotations for holds and interpolates them through gaps', async () => {
  const { evaluateSceneStateAtTime } = await importTypeScriptModule('../utils/transitions.ts');
  const frames = [
    {
      id: 'frame-a',
      name: 'A',
      startTime: 0,
      duration: 1000,
      positions: { door: { x: 10, y: 20 } },
      rotations: { door: 10 },
    },
    {
      id: 'frame-b',
      name: 'B',
      startTime: 3000,
      duration: 1000,
      positions: { door: { x: 30, y: 20 } },
      rotations: { door: 90 },
    },
  ];
  const performers = [{ id: 'door', name: 'Door', type: 'prop', rotation: 5 }];

  assert.equal(evaluateSceneStateAtTime(500, frames, performers, []).rotations.door, 10);
  assert.equal(evaluateSceneStateAtTime(2000, frames, performers, []).rotations.door, 50);
  assert.equal(evaluateSceneStateAtTime(3500, frames, performers, []).rotations.door, 90);
});

test('converts between center and hinge anchors without moving prop geometry', async () => {
  const {
    getPropCenterFromAnchor,
    getPropAnchorFromCenter,
    migratePropAnchor,
  } = await importTypeScriptModule('../utils/prop-pivot.ts');
  const stageConfig = { width: 20, depth: 10 };
  const performer = { id: 'door', width: 4, rotationPivot: 'left' };
  const leftAnchor = { x: 20, y: 40 };

  const center = getPropCenterFromAnchor(leftAnchor, 90, performer, stageConfig);
  assert.deepEqual(center, { x: 20, y: 60 });
  assert.deepEqual(
    getPropAnchorFromCenter(center, 90, { ...performer, rotationPivot: 'right' }, stageConfig),
    { x: 20, y: 80 },
  );
  assert.deepEqual(
    migratePropAnchor(leftAnchor, 90, performer, 'left', 'right', stageConfig),
    { x: 20, y: 80 },
  );
});

test('normalizes frame rotations and prop pivot values at the project boundary', async () => {
  const {
    normalizeFrames,
    normalizePerformers,
  } = await importTypeScriptModule('../electron/project-contract.ts');
  const frames = normalizeFrames([
    {
      id: 'frame-a',
      name: 'A',
      startTime: 0,
      duration: 1000,
      positions: {},
      rotations: { door: 45, broken: Number.POSITIVE_INFINITY },
    },
  ]);
  const performers = normalizePerformers([
    { id: 'door', name: 'Door', type: 'prop', rotationPivot: 'left' },
    { id: 'platform', name: 'Platform', type: 'prop', propCategory: 'platform', rotationPivot: 'right' },
    { id: 'legacy', name: 'Legacy', type: 'prop', rotationPivot: 'invalid' },
  ]);

  assert.deepEqual(frames[0].rotations, { door: 45 });
  assert.equal(performers[0].rotationPivot, 'left');
  assert.equal(performers[1].rotationPivot, 'center');
  assert.equal(performers[2].rotationPivot, 'center');
});

test('derives stage dimensions from a full-stage background width', async () => {
  const { calculateStageDimensionsFromImage } = await importTypeScriptModule('../utils/stage-config.ts');

  assert.deepEqual(calculateStageDimensionsFromImage(24, 3, 1200, 800), {
    width: 18,
    depth: 16,
  });
  assert.equal(calculateStageDimensionsFromImage(6, 3, 1200, 800), null);
  assert.equal(calculateStageDimensionsFromImage(24, 3, 0, 800), null);
});

test('normalizes stage background opacity and LED distance', async () => {
  const {
    clampStageBackgroundOpacity,
    getLedBottomHeight,
    getLedDistanceFromBack,
    getLedStageYPercent,
    getLedZPosition,
  } = await importTypeScriptModule('../utils/stage-config.ts');

  assert.equal(clampStageBackgroundOpacity(2), 1);
  assert.equal(clampStageBackgroundOpacity(Number.NaN), 0.5);
  assert.equal(getLedBottomHeight({ width: 20, depth: 10, ledBottomHeight: -1 }), 0);
  assert.equal(getLedBottomHeight({ width: 20, depth: 10, ledBottomHeight: 4.5 }), 4.5);
  assert.equal(getLedBottomHeight({ width: 20, depth: 10, ledBottomHeight: 40 }), 30);
  assert.equal(getLedDistanceFromBack({ width: 20, depth: 10, ledDistanceFromBack: 12 }), 10);
  assert.equal(getLedStageYPercent({ width: 20, depth: 10, ledDistanceFromBack: 3 }), 30);
  assert.equal(getLedZPosition({ width: 20, depth: 10, ledDistanceFromBack: 3 }), -2);
});
