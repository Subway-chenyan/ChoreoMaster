export const MODEL_PREVIEW_PADDING = 1.18;

export function getModelTopPreviewScale(widthValue: number, depthValue: number): {
  width: number;
  height: number;
} {
  const width = Math.max(0.001, widthValue);
  const depth = Math.max(0.001, depthValue);
  const imageWorldSpan = Math.max(width, depth) * MODEL_PREVIEW_PADDING;
  return {
    width: imageWorldSpan / width,
    height: imageWorldSpan / depth,
  };
}
