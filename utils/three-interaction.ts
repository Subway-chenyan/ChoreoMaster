export interface ThreeInteractionPolicyInput {
  dragEnabled: boolean;
  readonly: boolean;
  isDragging: boolean;
}

export interface ThreeInteractionPolicy {
  canDragObjects: boolean;
  enableRotate: boolean;
  enablePan: boolean;
  enableZoom: boolean;
}

export function resolveThreeInteractionPolicy(
  input: ThreeInteractionPolicyInput,
): ThreeInteractionPolicy {
  const canDragObjects = input.dragEnabled && !input.readonly;
  return {
    canDragObjects,
    enableRotate: !canDragObjects,
    enablePan: !input.isDragging,
    enableZoom: true,
  };
}

export function canStartThreeObjectDrag(input: {
  dragEnabled: boolean;
  readonly: boolean;
  button: number;
}): boolean {
  return input.dragEnabled && !input.readonly && input.button === 0;
}

export function isMatchingCapturedPointer(
  capturedPointerId: number | null | undefined,
  eventPointerId: number,
): boolean {
  return capturedPointerId === eventPointerId;
}

export function resolveThreeHeightFromPointerDrag(input: {
  startHeight: number;
  startClientY: number;
  currentClientY: number;
  cameraDistance: number;
}): number {
  const cameraDistance = Math.max(5, Math.min(80, input.cameraDistance));
  const metersPerPixel = cameraDistance / 500;
  const height = input.startHeight
    + (input.startClientY - input.currentClientY) * metersPerPixel;
  return Math.max(0, Math.min(10, height));
}
