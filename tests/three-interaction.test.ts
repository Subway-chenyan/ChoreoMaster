import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canStartThreeObjectDrag,
  resolveThreeInteractionPolicy,
} from '../utils/three-interaction.ts';
import {
  getPropAnchorFromCenter,
  getPropCenterFromAnchor,
} from '../utils/prop-pivot.ts';

test('3D preview is safe by default and keeps camera navigation enabled', () => {
  assert.deepEqual(resolveThreeInteractionPolicy({
    dragEnabled: false,
    readonly: false,
    isDragging: false,
  }), {
    canDragObjects: false,
    enableRotate: true,
    enablePan: true,
    enableZoom: true,
  });
});

test('3D drag editing replaces primary camera rotation with object movement', () => {
  assert.deepEqual(resolveThreeInteractionPolicy({
    dragEnabled: true,
    readonly: false,
    isDragging: false,
  }), {
    canDragObjects: true,
    enableRotate: false,
    enablePan: true,
    enableZoom: true,
  });
});

test('playback read-only mode overrides the requested drag mode', () => {
  assert.deepEqual(resolveThreeInteractionPolicy({
    dragEnabled: true,
    readonly: true,
    isDragging: false,
  }), {
    canDragObjects: false,
    enableRotate: true,
    enablePan: true,
    enableZoom: true,
  });
});

test('active object movement temporarily disables camera pan', () => {
  assert.equal(resolveThreeInteractionPolicy({
    dragEnabled: true,
    readonly: false,
    isDragging: true,
  }).enablePan, false);
});

test('only a primary button can start an enabled writable object drag', () => {
  assert.equal(canStartThreeObjectDrag({ dragEnabled: true, readonly: false, button: 0 }), true);
  assert.equal(canStartThreeObjectDrag({ dragEnabled: false, readonly: false, button: 0 }), false);
  assert.equal(canStartThreeObjectDrag({ dragEnabled: true, readonly: true, button: 0 }), false);
  assert.equal(canStartThreeObjectDrag({ dragEnabled: true, readonly: false, button: 1 }), false);
  assert.equal(canStartThreeObjectDrag({ dragEnabled: true, readonly: false, button: 2 }), false);
  assert.equal(canStartThreeObjectDrag({ dragEnabled: true, readonly: false, button: -1 }), false);
});

test('moving a hinged prop center preserves its stored anchor semantics', () => {
  const stageConfig = { width: 20, depth: 10 };
  const performer = { id: 'door', width: 4, rotationPivot: 'left' as const };
  const anchor = { x: 20, y: 40 };
  const center = getPropCenterFromAnchor(anchor, 90, performer, stageConfig);
  const movedCenter = { ...center, x: center.x + 10, y: center.y - 5 };
  const movedAnchor = getPropAnchorFromCenter(movedCenter, 90, performer, stageConfig);

  assert.deepEqual(movedAnchor, { x: anchor.x + 10, y: anchor.y - 5 });
});
