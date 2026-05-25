// ---------------------------------------------------------------------------
// PolygonUtils.ts – Mathematical foundation for polygon operations
// Used by ShapeEditor2D, PngOutlineExtractor, PropPreview3D, and Prop3D.
// ---------------------------------------------------------------------------

// ── Public types ───────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

// ── Private helpers ────────────────────────────────────────────────────────

/** 2D cross product of vectors OA x OB. */
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Check if point r lies on segment pq (inclusive).
 * Assumes r is already known to be collinear with p and q.
 */
function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    r.x <= Math.max(p.x, q.x) &&
    r.x >= Math.min(p.x, q.x) &&
    r.y <= Math.max(p.y, q.y) &&
    r.y >= Math.min(p.y, q.y)
  );
}

/**
 * Check if two line segments (p1,p2) and (p3,p4) intersect.
 * Returns true for proper or improper (endpoint-touching) intersections.
 */
function segmentsIntersect(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true; // proper intersection
  }

  // Improper intersections – one endpoint lies on the other segment
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;

  return false;
}

/**
 * Perpendicular distance from `point` to the infinite line defined by
 * `lineStart` and `lineEnd`.
 */
function perpendicularDistance(
  point: Point,
  lineStart: Point,
  lineEnd: Point,
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // lineStart === lineEnd – fall back to point distance
    const ex = point.x - lineStart.x;
    const ey = point.y - lineStart.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  const numerator = Math.abs(
    dy * point.x - dx * point.y +
    lineEnd.x * lineStart.y - lineEnd.y * lineStart.x,
  );
  return numerator / Math.sqrt(lenSq);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Check if a polygon is simple (non-self-intersecting).
 * Tests all pairs of non-adjacent edges for intersection.
 */
export function isSimplePolygon(points: Point[]): boolean {
  if (points.length < 3) return false;

  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      // Skip the edge that wraps around to the first vertex
      if (i === 0 && j === n - 1) continue;

      if (segmentsIntersect(points[i], points[i + 1], points[j], points[(j + 1) % n])) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Douglas-Peucker polygon simplification.
 * Returns a new array of `Point`s with a reduced vertex count.
 */
export function simplifyPolygon(
  points: Point[],
  tolerance: number,
): Point[] {
  if (points.length <= 2) return points.slice();

  // Find the point with the maximum distance from the start-end line
  let maxDist = 0;
  let maxIdx = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], start, end);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  // If max distance is within tolerance, keep only the endpoints
  if (maxDist <= tolerance) {
    return [start, end];
  }

  // Otherwise recurse on both halves
  const left = simplifyPolygon(points.slice(0, maxIdx + 1), tolerance);
  const right = simplifyPolygon(points.slice(maxIdx), tolerance);

  // Merge, dropping the duplicate split point
  return left.slice(0, left.length - 1).concat(right);
}

/**
 * Calculate polygon area using the Shoelace formula.
 * Positive area = counter-clockwise winding; negative = clockwise.
 */
export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  return area / 2;
}

/**
 * Compute the axis-aligned bounding box of an array of points.
 */
export function polygonBounds(
  points: Point[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const { x, y } = points[i];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Normalize an array of points so that both x and y fit in [0, 1].
 * The aspect ratio is preserved; the larger dimension spans [0, 1].
 */
export function normalizePoints(points: Point[]): Point[] {
  if (points.length === 0) return [];

  const { minX, minY, maxX, maxY } = polygonBounds(points);
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const range = Math.max(rangeX, rangeY);

  if (range === 0) {
    // Degenerate – all points are the same
    return points.map(() => ({ x: 0.5, y: 0.5 }));
  }

  // Center in [0,1] with equal scaling on both axes
  const offsetX = (range - rangeX) / 2;
  const offsetY = (range - rangeY) / 2;

  return points.map((p) => ({
    x: (p.x - minX + offsetX) / range,
    y: (p.y - minY + offsetY) / range,
  }));
}

/**
 * Close the polygon by appending the first point to the end, but only if
 * the polygon is not already closed (i.e. last point !== first point).
 * Returns a new array – does not mutate the input.
 */
export function closePolygon(points: Point[]): Point[] {
  if (points.length === 0) return [];

  const first = points[0];
  const last = points[points.length - 1];

  if (
    Math.abs(last.x - first.x) < Number.EPSILON &&
    Math.abs(last.y - first.y) < Number.EPSILON
  ) {
    return points.slice(); // already closed
  }

  return points.concat([{ x: first.x, y: first.y }]);
}

/**
 * Ray-casting algorithm to determine whether `point` lies inside `polygon`.
 * Works for both convex and concave simple polygons.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Find the closest point on segment ab to point p.
 * Returns both the closest point and the parameter t in [0, 1] where
 * t = 0 corresponds to a and t = 1 to b.
 */
export function closestPointOnSegment(
  p: Point,
  a: Point,
  b: Point,
): { point: Point; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return { point: { x: a.x, y: a.y }, t: 0 };
  }

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return {
    point: { x: a.x + t * dx, y: a.y + t * dy },
    t,
  };
}

/**
 * Convert normalized [0, 1] points to physical metre coordinates.
 * `width` maps to the x-axis, `depth` maps to the y-axis.
 */
export function denormalizePoints(
  points: Point[],
  width: number,
  depth: number,
): Point[] {
  return points.map((p) => ({
    x: p.x * width,
    y: p.y * depth,
  }));
}
