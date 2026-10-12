export interface Point {
  x: number;
  y: number;
}
export interface StageViewport {
  scale: number;
  offset: Point;
}
export function pinchViewport(
  start: StageViewport,
  startPoints: [Point, Point],
  points: [Point, Point]
): StageViewport {
  const midpoint = ([a, b]: [Point, Point]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = ([a, b]: [Point, Point]) => Math.hypot(a.x - b.x, a.y - b.y);
  const initial = midpoint(startPoints);
  const current = midpoint(points);
  const scale = Math.max(
    0.5,
    Math.min(4, (start.scale * distance(points)) / Math.max(1, distance(startPoints)))
  );
  const ratio = scale / start.scale;
  return {
    scale,
    offset: {
      x: current.x - (initial.x - start.offset.x) * ratio,
      y: current.y - (initial.y - start.offset.y) * ratio,
    },
  };
}
