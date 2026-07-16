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
