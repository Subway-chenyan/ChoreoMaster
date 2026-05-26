# 异形道具与多面贴图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom polygon extruded props and 6-face independent texture mapping for box props, with a dedicated prop editor modal.

**Architecture:** New types extend `Performer` interface. A `PropEditorModal` with embedded Canvas 2D polygon editor and R3F preview. `Prop3D` supports both `BoxGeometry` (with 6-material array) and `ExtrudeGeometry`. PNG outline extraction via Marching Squares + Douglas-Peucker.

**Tech Stack:** React 19, TypeScript, Three.js 0.182, React Three Fiber 9.5, Drei 10.7, Canvas 2D API

---

### Task 1: Extend Type Definitions

**Files:**
- Modify: `types.ts`

- [ ] **Step 1: Add new types to types.ts**

Add after line 10 (after `export type PerformerType = 'performer' | 'prop';`):

```typescript
export type PropGeometryType = 'box' | 'extruded';

export interface FaceTexture {
  dataUrl: string;
  fileName?: string;
}

export interface BoxTextures {
  front?: FaceTexture;
  back?: FaceTexture;
  left?: FaceTexture;
  right?: FaceTexture;
  top?: FaceTexture;
  bottom?: FaceTexture;
}
```

- [ ] **Step 2: Extend Performer interface**

Add these optional fields to the `Performer` interface (after `rotation?: number;` on line 23):

```typescript
  propGeometryType?: PropGeometryType;
  boxTextures?: BoxTextures;
  extrudeHeight?: number;
  polygonPoints?: { x: number; y: number }[];
  textureDataUrl?: string;
  propShape?: 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'custom';
  boundToId?: string;
```

Note: `polygonPoints`, `textureDataUrl`, `propShape`, `boundToId` already exist in the design spec but are missing from this base commit's types.ts. Add them all.

- [ ] **Step 3: Commit**

```bash
git add types.ts
git commit -m "feat(types): add PropGeometryType, FaceTexture, BoxTextures and extend Performer interface"
```

---

### Task 2: Polygon Utility Functions

**Files:**
- Create: `components/prop-editor/PolygonUtils.ts`

- [ ] **Step 1: Create PolygonUtils.ts**

```typescript
export interface Point {
  x: number;
  y: number;
}

/** Check if a polygon is simple (non-self-intersecting) */
export function isSimplePolygon(points: Point[]): boolean {
  const n = points.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent edges share a vertex
      if (segmentsIntersect(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) {
        return false;
      }
    }
  }
  return true;
}

/** Check if two line segments intersect */
function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;

  return false;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    r.x <= Math.max(p.x, q.x) &&
    r.x >= Math.min(p.x, q.x) &&
    r.y <= Math.max(p.y, q.y) &&
    r.y >= Math.min(p.y, q.y)
  );
}

/** Douglas-Peucker polygon simplification */
export function simplifyPolygon(points: Point[], tolerance: number): Point[] {
  if (points.length <= 3) return points;

  let maxDist = 0;
  let maxIdx = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPolygon(points.slice(0, maxIdx + 1), tolerance);
    const right = simplifyPolygon(points.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  } else {
    return [start, end];
  }
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }

  const num = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
  return num / Math.sqrt(lenSq);
}

/** Calculate polygon area using Shoelace formula */
export function polygonArea(points: Point[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/** Compute bounding box of polygon points */
export function polygonBounds(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Normalize points to [0, 1] range */
export function normalizePoints(points: Point[]): Point[] {
  const bounds = polygonBounds(points);
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (w === 0 || h === 0) return points;
  return points.map(p => ({
    x: (p.x - bounds.minX) / w,
    y: (p.y - bounds.minY) / h
  }));
}

/** Close the polygon (add first point to end if needed for algorithms) */
export function closePolygon(points: Point[]): Point[] {
  if (points.length < 3) return points;
  if (points[0].x === points[points.length - 1].x && points[0].y === points[points.length - 1].y) {
    return points;
  }
  return [...points, { ...points[0] }];
}

/** Check if point is inside polygon (ray casting) */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Find closest point on line segment to a given point */
export function closestPointOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { point: a, t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { point: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

/** Convert normalized [0,1] points to physical meter coordinates */
export function denormalizePoints(points: Point[], width: number, depth: number): Point[] {
  return points.map(p => ({
    x: p.x * width,
    y: p.y * depth
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add components/prop-editor/PolygonUtils.ts
git commit -m "feat(prop-editor): add polygon utility functions for shape editing"
```

---

### Task 3: PNG Outline Extractor

**Files:**
- Create: `components/prop-editor/PngOutlineExtractor.ts`

- [ ] **Step 1: Create PngOutlineExtractor.ts**

```typescript
import { Point, closePolygon, simplifyPolygon, normalizePoints, polygonArea } from './PolygonUtils';

interface ExtractResult {
  points: Point[];
  normalizedPoints: Point[];
  width: number;   // original image width
  height: number;  // original image height
}

/**
 * Extract polygon outline from PNG image using alpha transparency.
 * Uses Marching Squares algorithm followed by Douglas-Peucker simplification.
 */
export async function extractOutlineFromPng(
  file: File,
  alphaThreshold: number = 128,
  maxResolution: number = 256,
  targetVertexCount: number = 40
): Promise<ExtractResult> {
  // 1. Load image and scale down
  const img = await loadImage(file);

  let scale = 1;
  if (img.width > maxResolution || img.height > maxResolution) {
    scale = maxResolution / Math.max(img.width, img.height);
  }

  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  // 2. Draw to offscreen canvas and get pixel data
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels = imageData.data;

  // 3. Create binary grid (alpha > threshold = opaque)
  const grid: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    grid[y] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      grid[y][x] = pixels[idx + 3] > alphaThreshold;
    }
  }

  // 4. Run Marching Squares to extract contour
  const contours = marchingSquares(grid, w, h);

  if (contours.length === 0) {
    throw new Error('未检测到有效轮廓：图片可能完全透明');
  }

  // 5. Find largest contour by area
  let largestContour = contours[0];
  let largestArea = polygonArea(contours[0]);

  for (let i = 1; i < contours.length; i++) {
    const area = polygonArea(contours[i]);
    if (area > largestArea) {
      largestArea = area;
      largestContour = contours[i];
    }
  }

  if (contours.length > 1) {
    console.log(`检测到 ${contours.length} 个区域，已选取最大区域`);
  }

  // 6. Close the polygon
  const closedPoints = closePolygon(largestContour);

  // 7. Simplify with adaptive tolerance to hit target vertex count
  const simplified = adaptiveSimplify(closedPoints, targetVertexCount);

  // 8. Normalize to [0, 1]
  const normalized = normalizePoints(simplified);

  return {
    points: simplified,
    normalizedPoints: normalized,
    width: img.width,
    height: img.height
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    const url = URL.createObjectURL(file);
    img.src = url;
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
  });
}

/**
 * Marching Squares algorithm to extract contour from binary grid.
 * Returns array of contours (each contour is an array of points).
 */
function marchingSquares(grid: boolean[][], w: number, h: number): Point[][] {
  // Create padded grid (1px border of false)
  const pw = w + 2;
  const ph = h + 2;
  const padded: boolean[][] = [];
  for (let y = 0; y < ph; y++) {
    padded[y] = [];
    for (let x = 0; x < pw; x++) {
      if (x === 0 || y === 0 || x === pw - 1 || y === ph - 1) {
        padded[y][x] = false;
      } else {
        padded[y][x] = grid[y - 1][x - 1];
      }
    }
  }

  // Trace boundary
  const visited: Set<string> = new Set();
  const contours: Point[][] = [];

  for (let y = 1; y < ph - 1; y++) {
    for (let x = 1; x < pw - 1; x++) {
      if (!padded[y][x]) continue;
      if (visited.has(`${x},${y}`)) continue;

      // Check if this is a boundary pixel
      if (!padded[y - 1][x] || !padded[y + 1][x] || !padded[y][x - 1] || !padded[y][x + 1]) {
        const contour = traceContour(padded, pw, ph, x, y, visited);
        if (contour.length >= 3) {
          contours.push(contour);
        }
      }
    }
  }

  return contours;
}

function traceContour(
  grid: boolean[][],
  w: number,
  h: number,
  startX: number,
  startY: number,
  visited: Set<string>
): Point[] {
  const contour: Point[] = [];
  const directions = [
    { dx: 0, dy: -1 }, // up
    { dx: 1, dy: 0 },  // right
    { dx: 0, dy: 1 },  // down
    { dx: -1, dy: 0 }, // left
  ];

  let x = startX;
  let y = startY;
  let dir = 0; // Start looking up

  const maxSteps = w * h * 2;
  let steps = 0;

  do {
    contour.push({ x: x - 1, y: y - 1 }); // Adjust back to original coordinates
    visited.add(`${x},${y}`);

    // Moore Neighborhood tracing
    let found = false;
    // Check clockwise starting from (dir + 3) % 4 (turn left from incoming direction)
    for (let i = 0; i < 4; i++) {
      const checkDir = (dir + 3 + i) % 4;
      const nx = x + directions[checkDir].dx;
      const ny = y + directions[checkDir].dy;

      if (nx >= 0 && nx < w && ny >= 0 && ny < h && grid[ny][nx]) {
        dir = checkDir;
        x = nx;
        y = ny;
        found = true;
        break;
      }
    }

    if (!found) break;
    steps++;
  } while ((x !== startX || y !== startY) && steps < maxSteps);

  return contour;
}

/**
 * Adaptive Douglas-Peucker: binary search for tolerance that produces
 * approximately targetVertexCount vertices.
 */
function adaptiveSimplify(points: Point[], targetCount: number): Point[] {
  if (points.length <= targetCount + 5) return points;

  let lowTol = 0.1;
  let highTol = 50;
  let bestResult = points;

  for (let iter = 0; iter < 20; iter++) {
    const midTol = (lowTol + highTol) / 2;
    const simplified = simplifyPolygon(points, midTol);

    if (simplified.length > targetCount + 5) {
      lowTol = midTol;
    } else if (simplified.length < targetCount - 5) {
      highTol = midTol;
    } else {
      bestResult = simplified;
      break;
    }

    if (Math.abs(simplified.length - targetCount) < Math.abs(bestResult.length - targetCount)) {
      bestResult = simplified;
    }
  }

  return bestResult;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/prop-editor/PngOutlineExtractor.ts
git commit -m "feat(prop-editor): add PNG outline extraction with Marching Squares"
```

---

### Task 4: Canvas 2D Polygon Editor Component

**Files:**
- Create: `components/prop-editor/ShapeEditor2D.tsx`

- [ ] **Step 1: Create ShapeEditor2D.tsx**

This is a Canvas-based polygon editor with three modes: draw, select, and PNG import. The component is large (~400 lines) — here are the key sections:

```typescript
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Pencil, MousePointer2, Trash2, Image, Eraser } from 'lucide-react';
import { Point, isSimplePolygon, closestPointOnSegment, normalizePoints, polygonBounds } from './PolygonUtils';
import { extractOutlineFromPng } from './PngOutlineExtractor';

export type EditorMode = 'draw' | 'select' | 'delete';

interface ShapeEditor2DProps {
  points: Point[];
  onChange: (points: Point[]) => void;
  propWidth: number;   // meters
  propDepth: number;   // meters
  onSizeChange?: (width: number, depth: number) => void;
}

const GRID_SIZE = 0.5; // meters per grid line
const SNAP_SIZE = 0.1;  // snap to 0.1m

export const ShapeEditor2D: React.FC<ShapeEditor2DProps> = ({
  points,
  onChange,
  propWidth,
  propDepth,
  onSizeChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<EditorMode>('select');
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [hoveredVertex, setHoveredVertex] = useState<number>(-1);
  const [draggingVertex, setDraggingVertex] = useState<number>(-1);
  const [insertionEdge, setInsertionEdge] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 300 });
  const lastClickTimeRef = useRef(0);
  const [statusMessage, setStatusMessage] = useState('');

  // Responsive canvas sizing
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setCanvasSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Coordinate transforms
  const metersToCanvas = useCallback((p: Point): Point => {
    const padding = 30;
    const availW = canvasSize.width - padding * 2;
    const availH = canvasSize.height - padding * 2;
    const scale = Math.min(availW / propWidth, availH / propDepth);
    return {
      x: (p.x / propWidth + 0.5) * scale * propWidth + padding,
      y: (p.y / propDepth + 0.5) * scale * propDepth + padding
    };
  }, [canvasSize, propWidth, propDepth]);

  const canvasToMeters = useCallback((cx: number, cy: number): Point => {
    const padding = 30;
    const availW = canvasSize.width - padding * 2;
    const availH = canvasSize.height - padding * 2;
    const scale = Math.min(availW / propWidth, availH / propDepth);
    const mx = ((cx - padding) / (scale * propWidth) - 0.5) * propWidth;
    const my = ((cy - padding) / (scale * propDepth) - 0.5) * propDepth;
    return {
      x: Math.round(mx / SNAP_SIZE) * SNAP_SIZE,
      y: Math.round(my / SNAP_SIZE) * SNAP_SIZE
    };
  }, [canvasSize, propWidth, propDepth]);

  // Draw everything
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    // Background
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // Draw grid
    const padding = 30;
    const availW = canvasSize.width - padding * 2;
    const availH = canvasSize.height - padding * 2;
    const scale = Math.min(availW / propWidth, availH / propDepth);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.5;

    const centerX = canvasSize.width / 2;
    const centerY = canvasSize.height / 2;

    // Vertical grid lines
    for (let mx = -propWidth / 2; mx <= propWidth / 2 + 0.01; mx += GRID_SIZE) {
      const cx = centerX + mx * scale;
      ctx.beginPath();
      ctx.moveTo(cx, padding);
      ctx.lineTo(cx, canvasSize.height - padding);
      ctx.stroke();
    }

    // Horizontal grid lines
    for (let my = -propDepth / 2; my <= propDepth / 2 + 0.01; my += GRID_SIZE) {
      const cy = centerY + my * scale;
      ctx.beginPath();
      ctx.moveTo(padding, cy);
      ctx.lineTo(canvasSize.width - padding, cy);
      ctx.stroke();
    }

    // Center crosshair
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, padding);
    ctx.lineTo(centerX, canvasSize.height - padding);
    ctx.moveTo(padding, centerY);
    ctx.lineTo(canvasSize.width - padding, centerY);
    ctx.stroke();

    // Draw polygon
    const displayPoints = drawingPoints.length > 0 ? drawingPoints : points;
    if (displayPoints.length >= 2) {
      ctx.beginPath();
      const first = metersToCanvas(displayPoints[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < displayPoints.length; i++) {
        const p = metersToCanvas(displayPoints[i]);
        ctx.lineTo(p.x, p.y);
      }
      if (mode !== 'draw' && displayPoints.length >= 3) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fill();
      }
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw vertices
    displayPoints.forEach((p, i) => {
      const cp = metersToCanvas(p);
      const isHovered = hoveredVertex === i;

      ctx.beginPath();
      ctx.arc(cp.x, cp.y, isHovered ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? '#f59e0b' : '#60a5fa';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw close indicator on first vertex in draw mode
      if (mode === 'draw' && i === 0 && drawingPoints.length >= 3) {
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 12, 0, Math.PI * 2);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // Draw edge insertion point
    if (mode === 'select' && insertionEdge >= 0 && points.length >= 3) {
      const i = insertionEdge;
      const next = (i + 1) % points.length;
      const edgeMid = {
        x: (points[i].x + points[next].x) / 2,
        y: (points[i].y + points[next].y) / 2
      };
      const cp = metersToCanvas(edgeMid);
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#22c55e';
      ctx.fill();
    }
  }, [canvasSize, propWidth, propDepth, points, drawingPoints, mode, hoveredVertex, insertionEdge, metersToCanvas]);

  useEffect(() => { draw(); }, [draw]);

  // Mouse handling
  const getCanvasPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const findVertex = (meterPos: Point): number => {
    const threshold = (SNAP_SIZE * 2);
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - meterPos.x;
      const dy = points[i].y - meterPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return i;
    }
    return -1;
  };

  const findEdge = (meterPos: Point): number => {
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      const { point: closest, t } = closestPointOnSegment(meterPos, points[i], points[next]);
      const dx = closest.x - meterPos.x;
      const dy = closest.y - meterPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < SNAP_SIZE * 2 && t > 0.1 && t < 0.9) return i;
    }
    return -1;
  };

  const handleClick = (e: React.MouseEvent) => {
    const { x, y } = getCanvasPos(e);
    const meterPos = canvasToMeters(x, y);

    if (mode === 'draw') {
      const now = Date.now();
      // Double-click to close
      if (now - lastClickTimeRef.current < 300 && drawingPoints.length >= 3) {
        // Close polygon
        const closed = [...drawingPoints];
        if (isSimplePolygon(closed)) {
          const normalized = normalizePoints(closed);
          setDrawingPoints([]);
          onChange(normalized);
          setStatusMessage(`多边形已创建 (${closed.length} 个顶点)`);
        } else {
          setStatusMessage('多边形自交，请调整顶点');
        }
        lastClickTimeRef.current = 0;
        return;
      }
      lastClickTimeRef.current = now;

      // Close if clicking near first vertex
      if (drawingPoints.length >= 3) {
        const first = drawingPoints[0];
        const dx = first.x - meterPos.x;
        const dy = first.y - meterPos.y;
        if (Math.sqrt(dx * dx + dy * dy) < GRID_SIZE) {
          if (isSimplePolygon(drawingPoints)) {
            const normalized = normalizePoints(drawingPoints);
            setDrawingPoints([]);
            onChange(normalized);
            setStatusMessage(`多边形已创建 (${drawingPoints.length} 个顶点)`);
          } else {
            setStatusMessage('多边形自交，请调整顶点');
          }
          return;
        }
      }

      setDrawingPoints(prev => [...prev, meterPos]);

    } else if (mode === 'select') {
      const vertexIdx = findVertex(meterPos);
      if (vertexIdx >= 0) {
        setDraggingVertex(vertexIdx);
        return;
      }

      const edgeIdx = findEdge(meterPos);
      if (edgeIdx >= 0 && points.length >= 3) {
        const next = (edgeIdx + 1) % points.length;
        const newPoint = { x: (points[edgeIdx].x + points[next].x) / 2, y: (points[edgeIdx].y + points[next].y) / 2 };
        const newPoints = [...points];
        newPoints.splice(edgeIdx + 1, 0, newPoint);
        if (isSimplePolygon(newPoints)) {
          onChange(normalizePoints(newPoints));
          setDraggingVertex(edgeIdx + 1);
        }
      }

    } else if (mode === 'delete') {
      const vertexIdx = findVertex(meterPos);
      if (vertexIdx >= 0 && points.length > 3) {
        const newPoints = points.filter((_, i) => i !== vertexIdx);
        if (isSimplePolygon(newPoints)) {
          onChange(normalizePoints(newPoints));
          setStatusMessage(`已删除顶点 (剩余 ${newPoints.length} 个)`);
        } else {
          setStatusMessage('删除后多边形会自交，操作已取消');
        }
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = getCanvasPos(e);
    const meterPos = canvasToMeters(x, y);

    if (mode === 'select' && draggingVertex >= 0) {
      const newPoints = [...points];
      newPoints[draggingVertex] = meterPos;
      if (isSimplePolygon(newPoints)) {
        onChange(normalizePoints(newPoints));
      }
      return;
    }

    // Hover detection
    const vertexIdx = findVertex(meterPos);
    setHoveredVertex(vertexIdx);

    if (mode === 'select' && vertexIdx < 0) {
      setInsertionEdge(findEdge(meterPos));
    } else {
      setInsertionEdge(-1);
    }
  };

  const handleMouseUp = () => {
    setDraggingVertex(-1);
  };

  const handlePngImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/webp,image/gif';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        setStatusMessage('正在提取轮廓...');
        const result = await extractOutlineFromPng(file);
        onChange(result.normalizedPoints);
        // Calculate width/depth from image aspect ratio
        const aspect = result.width / result.height;
        if (aspect >= 1) {
          const w = Math.max(0.5, Math.min(6, 2 * aspect));
          onSizeChange?.(w, 2);
        } else {
          const d = Math.max(0.5, Math.min(6, 2 / aspect));
          onSizeChange?.(2, d);
        }
        setStatusMessage(`轮廓已生成 (${result.normalizedPoints.length} 个顶点)`);
        setMode('select');
      } catch (err: any) {
        setStatusMessage(err.message || '轮廓提取失败');
      }
    };
    input.click();
  };

  const handleClear = () => {
    setDrawingPoints([]);
    onChange([]);
    setStatusMessage('');
  };

  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      {/* Toolbar */}
      <div className="flex gap-1 p-2 border-b border-slate-700 bg-slate-800/50">
        <button
          onClick={() => setMode('select')}
          className={`p-1.5 rounded ${mode === 'select' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
          title="选择/编辑顶点"
        >
          <MousePointer2 size={16} />
        </button>
        <button
          onClick={() => { setMode('draw'); setDrawingPoints([]); }}
          className={`p-1.5 rounded ${mode === 'draw' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
          title="绘制多边形"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={() => setMode('delete')}
          className={`p-1.5 rounded ${mode === 'delete' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
          title="删除顶点"
        >
          <Trash2 size={16} />
        </button>
        <div className="w-px bg-slate-600 mx-1" />
        <button
          onClick={handlePngImport}
          className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700"
          title="从PNG生成轮廓"
        >
          <Image size={16} />
        </button>
        <button
          onClick={handleClear}
          className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700"
          title="清空"
        >
          <Eraser size={16} />
        </button>
        <div className="ml-auto text-xs text-slate-500 flex items-center">
          {points.length > 0 ? `${points.length} 顶点` : '点击绘制多边形'}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative min-h-0">
        <canvas
          ref={canvasRef}
          style={{ width: canvasSize.width, height: canvasSize.height }}
          className="absolute inset-0"
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>

      {/* Status bar */}
      {statusMessage && (
        <div className="px-3 py-1.5 text-xs text-slate-400 border-t border-slate-700 bg-slate-800/50">
          {statusMessage}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add components/prop-editor/ShapeEditor2D.tsx
git commit -m "feat(prop-editor): add Canvas 2D polygon editor with draw/select/delete modes"
```

---

### Task 5: Box Texture Editor Component

**Files:**
- Create: `components/prop-editor/BoxTextureEditor.tsx`

- [ ] **Step 1: Create BoxTextureEditor.tsx**

```typescript
import React, { useRef } from 'react';
import { Upload, X } from 'lucide-react';
import { BoxTextures, FaceTexture } from '../../types';

interface BoxTextureEditorProps {
  textures: BoxTextures;
  onChange: (textures: BoxTextures) => void;
}

const FACES: { key: keyof BoxTextures; label: string; isDefault?: boolean }[] = [
  { key: 'front', label: '正面 (+Z)', isDefault: true },
  { key: 'back', label: '背面 (-Z)' },
  { key: 'left', label: '左面 (-X)' },
  { key: 'right', label: '右面 (+X)' },
  { key: 'top', label: '顶面 (+Y)' },
  { key: 'bottom', label: '底面 (-Y)' },
];

export const BoxTextureEditor: React.FC<BoxTextureEditorProps> = ({ textures, onChange }) => {
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleSelectFile = (faceKey: keyof BoxTextures) => {
    fileInputRefs.current[faceKey]?.click();
  };

  const handleFileChange = (faceKey: keyof BoxTextures, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const faceTexture: FaceTexture = {
        dataUrl: reader.result as string,
        fileName: file.name
      };
      onChange({ ...textures, [faceKey]: faceTexture });
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleClearFace = (faceKey: keyof BoxTextures) => {
    const newTextures = { ...textures };
    delete newTextures[faceKey];
    onChange(newTextures);
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-400 mb-2">
        为每个面选择贴图，正面为默认贴图面（面向舞台）
      </div>
      <div className="grid grid-cols-2 gap-2">
        {FACES.map(({ key, label, isDefault }) => {
          const texture = textures[key];
          return (
            <div
              key={key}
              className={`relative rounded-lg border p-2 transition-colors ${
                isDefault
                  ? 'border-green-500/50 bg-green-500/5'
                  : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
              }`}
            >
              <input
                ref={el => { fileInputRefs.current[key] = el; }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => handleFileChange(key, e)}
              />
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-xs font-medium ${isDefault ? 'text-green-400' : 'text-slate-300'}`}>
                  {label}
                  {isDefault && <span className="ml-1 text-[10px] bg-green-600/20 text-green-400 px-1 rounded">默认</span>}
                </span>
                {texture && (
                  <button
                    onClick={() => handleClearFace(key)}
                    className="p-0.5 text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {texture ? (
                <div
                  className="w-full h-16 rounded bg-slate-900 bg-cover bg-center cursor-pointer border border-slate-600"
                  style={{ backgroundImage: `url(${texture.dataUrl})` }}
                  onClick={() => handleSelectFile(key)}
                />
              ) : (
                <button
                  onClick={() => handleSelectFile(key)}
                  className="w-full h-16 rounded border border-dashed border-slate-600 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-colors"
                >
                  <Upload size={14} />
                  <span className="text-[10px]">选择贴图</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add components/prop-editor/BoxTextureEditor.tsx
git commit -m "feat(prop-editor): add 6-face texture editor for box props"
```

---

### Task 6: Extruded Texture Editor Component

**Files:**
- Create: `components/prop-editor/ExtrudedTextureEditor.tsx`

- [ ] **Step 1: Create ExtrudedTextureEditor.tsx**

```typescript
import React, { useRef } from 'react';
import { Upload, X } from 'lucide-react';
import { FaceTexture } from '../../types';

interface ExtrudedTextureEditorProps {
  topTexture?: FaceTexture;
  bottomTexture?: FaceTexture;
  sideTexture?: FaceTexture;
  onTopChange: (texture?: FaceTexture) => void;
  onBottomChange: (texture?: FaceTexture) => void;
  onSideChange: (texture?: FaceTexture) => void;
}

function TextureSlot({
  label,
  isDefault,
  texture,
  onSelect,
  onClear
}: {
  label: string;
  isDefault?: boolean;
  texture?: FaceTexture;
  onSelect: () => void;
  onClear: () => void;
}) {
  return (
    <div className={`rounded-lg border p-3 transition-colors ${
      isDefault ? 'border-green-500/50 bg-green-500/5' : 'border-slate-700 bg-slate-800/50'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-medium ${isDefault ? 'text-green-400' : 'text-slate-300'}`}>
          {label}
          {isDefault && <span className="ml-1 text-[10px] bg-green-600/20 text-green-400 px-1 rounded">默认</span>}
        </span>
        {texture && (
          <button onClick={onClear} className="p-0.5 text-slate-500 hover:text-red-400">
            <X size={12} />
          </button>
        )}
      </div>
      {texture ? (
        <div
          className="w-full h-20 rounded bg-slate-900 bg-cover bg-center cursor-pointer border border-slate-600"
          style={{ backgroundImage: `url(${texture.dataUrl})` }}
          onClick={onSelect}
        />
      ) : (
        <button
          onClick={onSelect}
          className="w-full h-20 rounded border border-dashed border-slate-600 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-colors"
        >
          <Upload size={16} />
          <span className="text-xs">选择贴图</span>
        </button>
      )}
    </div>
  );
}

export const ExtrudedTextureEditor: React.FC<ExtrudedTextureEditorProps> = ({
  topTexture, bottomTexture, sideTexture,
  onTopChange, onBottomChange, onSideChange
}) => {
  const topRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLInputElement>(null);
  const sideRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>, onChange: (t?: FaceTexture) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onChange({ dataUrl: reader.result as string, fileName: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-400 mb-2">
        为拉伸体选择贴图。侧面贴图将自动映射到拉伸面。
      </div>
      <input ref={topRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e, onTopChange)} />
      <input ref={bottomRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e, onBottomChange)} />
      <input ref={sideRef} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e, onSideChange)} />
      <TextureSlot label="侧面 (拉伸面)" isDefault texture={sideTexture} onSelect={() => sideRef.current?.click()} onClear={() => onSideChange()} />
      <TextureSlot label="顶面" texture={topTexture} onSelect={() => topRef.current?.click()} onClear={() => onTopChange()} />
      <TextureSlot label="底面" texture={bottomTexture} onSelect={() => bottomRef.current?.click()} onClear={() => onBottomChange()} />
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add components/prop-editor/ExtrudedTextureEditor.tsx
git commit -m "feat(prop-editor): add extruded prop texture editor (top/bottom/side)"
```

---

### Task 7: 3D Preview Component for Editor

**Files:**
- Create: `components/prop-editor/PropPreview3D.tsx`

- [ ] **Step 1: Create PropPreview3D.tsx**

```typescript
import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Performer, BoxTextures, PropGeometryType, FaceTexture } from '../../types';
import { Point, denormalizePoints } from './PolygonUtils';

interface PropPreview3DProps {
  performer: Partial<Performer>;
  boxTextures?: BoxTextures;
  sideTexture?: FaceTexture;
  topTexture?: FaceTexture;
  bottomTexture?: FaceTexture;
  polygonPoints?: Point[];
  propGeometryType: PropGeometryType;
}

function createMaterial(faceTexture?: FaceTexture, fallbackColor: string = '#475569'): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: fallbackColor,
    transparent: true,
    opacity: 1,
    side: THREE.FrontSide
  });

  if (faceTexture?.dataUrl) {
    const texture = new THREE.TextureLoader().load(faceTexture.dataUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    mat.map = texture;
    mat.color.set('#ffffff');
  }

  return mat;
}

function BoxPreview({ performer, boxTextures }: { performer: Partial<Performer>; boxTextures?: BoxTextures }) {
  const w = performer.width || 1;
  const h = performer.height || 1;
  const d = performer.depth || 1;
  const color = performer.color || '#475569';
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (meshRef.current) {
      const targetQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 6, Math.PI / 4, 0)
      );
      meshRef.current.quaternion.slerp(targetQ, 0.05);
    }
  });

  const materials = useMemo(() => [
    createMaterial(boxTextures?.right, color),
    createMaterial(boxTextures?.left, color),
    createMaterial(boxTextures?.top, color),
    createMaterial(boxTextures?.bottom, color),
    createMaterial(boxTextures?.front, color),
    createMaterial(boxTextures?.back, color),
  ], [boxTextures, color]);

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      {materials.map((mat, i) => (
        <primitive key={i} object={mat} attach={`material-${i}`} />
      ))}
    </mesh>
  );
}

function ExtrudedPreview({
  performer,
  polygonPoints,
  sideTexture,
  topTexture,
  bottomTexture,
}: {
  performer: Partial<Performer>;
  polygonPoints?: Point[];
  sideTexture?: FaceTexture;
  topTexture?: FaceTexture;
  bottomTexture?: FaceTexture;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const w = performer.width || 1;
  const d = performer.depth || 1;
  const h = performer.extrudeHeight || performer.height || 1;
  const color = performer.color || '#475569';

  useFrame(() => {
    if (meshRef.current) {
      const targetQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 6, Math.PI / 4, 0)
      );
      meshRef.current.quaternion.slerp(targetQ, 0.05);
    }
  });

  const geometry = useMemo(() => {
    if (!polygonPoints || polygonPoints.length < 3) return null;

    const denorm = denormalizePoints(polygonPoints, w, d);
    // Center the shape
    const cx = denorm.reduce((s, p) => s + p.x, 0) / denorm.length;
    const cy = denorm.reduce((s, p) => s + p.y, 0) / denorm.length;

    const shape = new THREE.Shape();
    shape.moveTo(denorm[0].x - cx, denorm[0].y - cy);
    for (let i = 1; i < denorm.length; i++) {
      shape.lineTo(denorm[i].x - cx, denorm[i].y - cy);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: h,
      bevelEnabled: false
    });

    // Rotate so extrusion goes up (Y axis)
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, h / 2, 0);

    return geo;
  }, [polygonPoints, w, d, h]);

  if (!geometry) return null;

  // ExtrudeGeometry creates: group 0 = side faces, group 1 = top cap, group 2 = bottom cap
  const sideMat = useMemo(() => createMaterial(sideTexture, color), [sideTexture, color]);
  const topMat = useMemo(() => createMaterial(topTexture, color), [topTexture, color]);
  const bottomMat = useMemo(() => createMaterial(bottomTexture, color), [bottomTexture, color]);

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow material={sideMat}>
      <primitive object={topMat} attach="material-1" />
      <primitive object={bottomMat} attach="material-2" />
    </mesh>
  );
}

export const PropPreview3D: React.FC<PropPreview3DProps> = (props) => {
  return (
    <Canvas
      camera={{ position: [5, 5, 5], fov: 50 }}
      shadows
      gl={{ antialias: true, alpha: true }}
      style={{ background: '#0f172a', borderRadius: '0.5rem' }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} castShadow />
      <OrbitControls enablePan={false} enableZoom enableRotate />

      {props.propGeometryType === 'box' ? (
        <BoxPreview performer={props.performer} boxTextures={props.boxTextures} />
      ) : (
        <ExtrudedPreview
          performer={props.performer}
          polygonPoints={props.polygonPoints}
          sideTexture={props.sideTexture}
          topTexture={props.topTexture}
          bottomTexture={props.bottomTexture}
        />
      )}

      {/* Ground grid */}
      <gridHelper args={[20, 40, '#334155', '#1e293b']} rotation={[0, 0, 0]} />
    </Canvas>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add components/prop-editor/PropPreview3D.tsx
git commit -m "feat(prop-editor): add 3D preview component for prop editor"
```

---

### Task 8: Prop Editor Modal (Main Component)

**Files:**
- Create: `components/PropEditorModal.tsx`

- [ ] **Step 1: Create PropEditorModal.tsx**

This is the main modal component that brings together ShapeEditor2D, BoxTextureEditor, ExtrudedTextureEditor, and PropPreview3D. It handles the two tabs (box/extruded) and all state management.

Key state:
- `geometryType`: `'box' | 'extruded'`
- Box mode: width, depth, height, color, rotation, boxTextures
- Extruded mode: polygonPoints, extrudeHeight, propWidth, propDepth, color, rotation, sideTexture, topTexture, bottomTexture

The component receives a `Performer` (optional, for editing), and an `onSave` callback that returns the updated performer fields.

Props interface:
```typescript
interface PropEditorModalProps {
  isOpen: boolean;
  performer?: Performer | null;
  onSave: (updates: Partial<Performer>) => void;
  onClose: () => void;
}
```

Structure:
- Left panel (w-80): Name input, shape type tabs, property inputs, texture editor
- Right panel (flex-1): PropPreview3D

The full implementation is ~350 lines. Key behaviors:
- On open with existing performer: populate all fields from performer data
- On open without performer (new prop): use defaults
- On save: call `onSave` with all the prop fields
- Box ↔ Extruded switch: preserves common fields (name, color, rotation), clears shape-specific fields

See implementation code below:

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import { X, Box as BoxIcon, Pentagon } from 'lucide-react';
import { Performer, PropGeometryType, BoxTextures, FaceTexture } from '../types';
import { Point } from './prop-editor/PolygonUtils';
import { ShapeEditor2D } from './prop-editor/ShapeEditor2D';
import { BoxTextureEditor } from './prop-editor/BoxTextureEditor';
import { ExtrudedTextureEditor } from './prop-editor/ExtrudedTextureEditor';
import { PropPreview3D } from './prop-editor/PropPreview3D';

interface PropEditorModalProps {
  isOpen: boolean;
  performer?: Performer | null;
  onSave: (updates: Partial<Performer>) => void;
  onClose: () => void;
  mode?: 'create' | 'edit';
}

export const PropEditorModal: React.FC<PropEditorModalProps> = ({
  isOpen, performer, onSave, onClose, mode = 'edit'
}) => {
  // Common state
  const [name, setName] = useState('');
  const [color, setColor] = useState('#475569');
  const [rotation, setRotation] = useState(0);
  const [geometryType, setGeometryType] = useState<PropGeometryType>('box');

  // Box state
  const [boxWidth, setBoxWidth] = useState(1);
  const [boxDepth, setBoxDepth] = useState(1);
  const [boxHeight, setBoxHeight] = useState(1);
  const [boxTextures, setBoxTextures] = useState<BoxTextures>({});

  // Extruded state
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [extWidth, setExtWidth] = useState(2);
  const [extDepth, setExtDepth] = useState(2);
  const [extHeight, setExtHeight] = useState(1);
  const [sideTexture, setSideTexture] = useState<FaceTexture>();
  const [topTexture, setTopTexture] = useState<FaceTexture>();
  const [bottomTexture, setBottomTexture] = useState<FaceTexture>();

  // Populate from existing performer
  useEffect(() => {
    if (!performer) {
      setName('');
      setColor('#475569');
      setRotation(0);
      setGeometryType('box');
      setBoxWidth(1); setBoxDepth(1); setBoxHeight(1);
      setBoxTextures({});
      setPolygonPoints([]);
      setExtWidth(2); setExtDepth(2); setExtHeight(1);
      setSideTexture(undefined); setTopTexture(undefined); setBottomTexture(undefined);
      return;
    }

    setName(performer.name);
    setColor(performer.color);
    setRotation(performer.rotation || 0);

    const geoType = performer.propGeometryType || 'box';
    setGeometryType(geoType);

    if (geoType === 'box') {
      setBoxWidth(performer.width || 1);
      setBoxDepth(performer.depth || 1);
      setBoxHeight(performer.height || 1);
      setBoxTextures(performer.boxTextures || {});
    } else {
      setPolygonPoints(performer.polygonPoints || []);
      setExtWidth(performer.width || 2);
      setExtDepth(performer.depth || 2);
      setExtHeight(performer.extrudeHeight || performer.height || 1);
    }
  }, [performer, isOpen]);

  const handleSave = useCallback(() => {
    const updates: Partial<Performer> = {
      name,
      color,
      rotation,
      propGeometryType: geometryType
    };

    if (geometryType === 'box') {
      updates.width = boxWidth;
      updates.depth = boxDepth;
      updates.height = boxHeight;
      updates.boxTextures = Object.keys(boxTextures).length > 0 ? boxTextures : undefined;
      updates.polygonPoints = undefined;
      updates.extrudeHeight = undefined;
    } else {
      updates.width = extWidth;
      updates.depth = extDepth;
      updates.height = extHeight;
      updates.extrudeHeight = extHeight;
      updates.polygonPoints = polygonPoints.length > 0 ? polygonPoints : undefined;
      updates.boxTextures = undefined;
    }

    onSave(updates);
  }, [name, color, rotation, geometryType, boxWidth, boxDepth, boxHeight, boxTextures, extWidth, extDepth, extHeight, polygonPoints, onSave]);

  if (!isOpen) return null;

  const currentWidth = geometryType === 'box' ? boxWidth : extWidth;
  const currentDepth = geometryType === 'box' ? boxDepth : extDepth;
  const currentHeight = geometryType === 'box' ? boxHeight : extHeight;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col" style={{ width: '900px', height: '620px' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h2 className="text-white font-bold text-lg">
            {mode === 'create' ? '创建道具' : `编辑道具: ${name}`}
          </h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left Panel */}
          <div className="w-80 border-r border-slate-700 flex flex-col overflow-y-auto">
            {/* Name */}
            <div className="p-4 border-b border-slate-800">
              <label className="text-xs text-slate-400 block mb-1">道具名称</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white"
                placeholder="输入名称"
              />
            </div>

            {/* Geometry Type Tabs */}
            <div className="flex border-b border-slate-700">
              <button
                onClick={() => setGeometryType('box')}
                className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
                  geometryType === 'box'
                    ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-500/5'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                <BoxIcon size={14} /> 立方体
              </button>
              <button
                onClick={() => setGeometryType('extruded')}
                className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
                  geometryType === 'extruded'
                    ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-500/5'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                <Pentagon size={14} /> 异形
              </button>
            </div>

            {/* Properties */}
            <div className="p-4 space-y-3 border-b border-slate-800">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">长 (米)</label>
                  <input type="number" step={0.1} min={0.1} max={20}
                    value={currentWidth}
                    onChange={e => {
                      const v = parseFloat(e.target.value) || 0.1;
                      geometryType === 'box' ? setBoxWidth(v) : setExtWidth(v);
                    }}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">{geometryType === 'extruded' ? '宽 (米)' : '深 (米)'}</label>
                  <input type="number" step={0.1} min={0.1} max={20}
                    value={currentDepth}
                    onChange={e => {
                      const v = parseFloat(e.target.value) || 0.1;
                      geometryType === 'box' ? setBoxDepth(v) : setExtDepth(v);
                    }}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">高 (米)</label>
                  <input type="number" step={0.1} min={0.1} max={20}
                    value={currentHeight}
                    onChange={e => {
                      const v = parseFloat(e.target.value) || 0.1;
                      geometryType === 'box' ? setBoxHeight(v) : setExtHeight(v);
                    }}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                  />
                </div>
              </div>
              <div className="flex gap-3 items-center">
                <div className="flex-1">
                  <label className="text-xs text-slate-400 block mb-1">旋转 (度)</label>
                  <input type="number" step={5} value={rotation}
                    onChange={e => setRotation(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">颜色</label>
                  <input type="color" value={color}
                    onChange={e => setColor(e.target.value)}
                    className="w-10 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Shape Editor (extruded only) */}
            {geometryType === 'extruded' && (
              <div className="flex-1 min-h-0 border-b border-slate-800" style={{ height: '220px' }}>
                <ShapeEditor2D
                  points={polygonPoints}
                  onChange={setPolygonPoints}
                  propWidth={extWidth}
                  propDepth={extDepth}
                  onSizeChange={(w, d) => { setExtWidth(w); setExtDepth(d); }}
                />
              </div>
            )}

            {/* Texture Editor */}
            <div className="p-4 flex-1 overflow-y-auto">
              <div className="text-xs font-medium text-slate-400 mb-2">贴图编辑</div>
              {geometryType === 'box' ? (
                <BoxTextureEditor textures={boxTextures} onChange={setBoxTextures} />
              ) : (
                <ExtrudedTextureEditor
                  sideTexture={sideTexture}
                  topTexture={topTexture}
                  bottomTexture={bottomTexture}
                  onSideChange={setSideTexture}
                  onTopChange={setTopTexture}
                  onBottomChange={setBottomTexture}
                />
              )}
            </div>
          </div>

          {/* Right Panel - 3D Preview */}
          <div className="flex-1 p-4">
            <PropPreview3D
              performer={{
                name, color, rotation,
                width: currentWidth, height: currentHeight, depth: currentDepth,
                extrudeHeight: extHeight
              }}
              propGeometryType={geometryType}
              boxTextures={boxTextures}
              sideTexture={sideTexture}
              topTexture={topTexture}
              bottomTexture={bottomTexture}
              polygonPoints={polygonPoints}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-3 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-900/20 transition-all hover:scale-105 active:scale-95"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add components/PropEditorModal.tsx
git commit -m "feat(prop-editor): add PropEditorModal with shape editing, textures, and 3D preview"
```

---

### Task 9: Update Prop3D for ExtrudeGeometry and 6-face Textures

**Files:**
- Modify: `3d_components/Prop3D.tsx`

- [ ] **Step 1: Update Prop3D.tsx**

Replace the entire `Prop3D` component. The key changes:
1. Import `BoxTextures`, `FaceTexture`, `Point` from types and PolygonUtils
2. Add a helper `createFaceMaterial` function
3. For `propGeometryType === 'extruded'`: use `ExtrudeGeometry` from `polygonPoints`
4. For `propGeometryType === 'box'` with `boxTextures`: use material array (6 materials)

The mesh section changes from a single material to conditional rendering:

```typescript
// Replace lines 141-158 in Prop3D.tsx with:

const isExtruded = performer.propGeometryType === 'extruded' && performer.polygonPoints && performer.polygonPoints.length >= 3;

// For box with textures
const boxMaterials = useMemo(() => {
  if (isExtruded) return null;
  const hasTextures = performer.boxTextures && Object.keys(performer.boxTextures).length > 0;
  if (!hasTextures) return null;
  const c = isSelected ? '#60a5fa' : performer.color;
  return [
    createFaceMaterial(performer.boxTextures?.right, c),
    createFaceMaterial(performer.boxTextures?.left, c),
    createFaceMaterial(performer.boxTextures?.top, c),
    createFaceMaterial(performer.boxTextures?.bottom, c),
    createFaceMaterial(performer.boxTextures?.front, c),
    createFaceMaterial(performer.boxTextures?.back, c),
  ];
}, [performer.boxTextures, performer.color, isSelected]);

// For extruded geometry
const extrudeGeometry = useMemo(() => {
  if (!isExtruded || !performer.polygonPoints) return null;
  const w = dims.width;
  const d = dims.depth;
  const h = performer.extrudeHeight || dims.height;
  const denorm = denormalizePoints(performer.polygonPoints, w, d);
  const cx = denorm.reduce((s, p) => s + p.x, 0) / denorm.length;
  const cy = denorm.reduce((s, p) => s + p.y, 0) / denorm.length;

  const shape = new THREE.Shape();
  shape.moveTo(denorm[0].x - cx, denorm[0].y - cy);
  for (let i = 1; i < denorm.length; i++) {
    shape.lineTo(denorm[i].x - cx, denorm[i].y - cy);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, h / 2, 0);
  return geo;
}, [isExtruded, performer.polygonPoints, dims.width, dims.depth, performer.extrudeHeight, dims.height]);
```

Then in the JSX return (inside `<group>`), replace the mesh section with:

```tsx
{isExtruded && extrudeGeometry ? (
  <mesh ref={meshRef as any} castShadow receiveShadow geometry={extrudeGeometry}
    onClick={handleClick} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}
    onPointerDown={handlePlanePointerDown} onPointerUp={handlePlanePointerUp}
  >
    <meshStandardMaterial color={isSelected ? '#60a5fa' : performer.color} transparent opacity={hovered ? 0.9 : 1} />
  </mesh>
) : (
  <mesh castShadow receiveShadow
    onClick={handleClick} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}
    onPointerDown={handlePlanePointerDown} onPointerUp={handlePlanePointerUp}
  >
    <boxGeometry args={[dims.width, dims.height, dims.depth]} />
    {boxMaterials ? (
      boxMaterials.map((mat, i) => <primitive key={i} object={mat} attach={`material-${i}`} />)
    ) : (
      <meshStandardMaterial color={isSelected ? '#60a5fa' : performer.color} transparent opacity={hovered ? 0.9 : 1} />
    )}
  </mesh>
)}
```

Also add the `useMemo` import and the `createFaceMaterial` helper:

```typescript
import { useMemo } from 'react';
import { BoxTextures, FaceTexture } from '../types';
import { denormalizePoints } from '../components/prop-editor/PolygonUtils';

function createFaceMaterial(faceTexture?: FaceTexture, fallbackColor: string = '#475569'): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: fallbackColor, transparent: true });
  if (faceTexture?.dataUrl) {
    const texture = new THREE.TextureLoader().load(faceTexture.dataUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    mat.map = texture;
    mat.color.set('#ffffff');
  }
  return mat;
}
```

Note: For the extruded shape, the edge geometry selection indicator should also be updated. When `isExtruded`, use the same `extrudeGeometry` for the `edgesGeometry`. Replace the selection indicator section:

```tsx
{isSelected && (
  <lineSegments>
    <edgesGeometry args={isExtruded && extrudeGeometry ? [extrudeGeometry] : [new THREE.BoxGeometry(dims.width, dims.height, dims.depth)]} />
    <lineBasicMaterial color="#fbbf24" linewidth={2} />
  </lineSegments>
)}
```

- [ ] **Step 2: Commit**

```bash
git add 3d_components/Prop3D.tsx
git commit -m "feat(3d): support ExtrudeGeometry and 6-face texture materials in Prop3D"
```

---

### Task 10: Update Stage.tsx for Extruded Props and Multi-face Textures

**Files:**
- Modify: `components/Stage.tsx`

- [ ] **Step 1: Add polygon clip-path helper**

Add this function before the `Stage` component (around line 52, after the `DragState` interface):

```typescript
function getPolygonClipPath(points: { x: number; y: number }[] | undefined): string | undefined {
  if (!points || points.length < 3) return undefined;
  return `polygon(${points.map(p => `${p.x * 100}% ${p.y * 100}%`).join(', ')})`;
}
```

- [ ] **Step 2: Update prop rendering in Stage.tsx**

In the props rendering section (around line 384-414), add clip-path for extruded props and front-face texture support. Replace the prop `<div>` rendering block:

Change the style section of the prop div (around line 389-398) to:

```tsx
style={{
  left: `${pos.x}%`,
  top: `${pos.y}%`,
  width: `${widthPct}%`,
  height: `${heightPct}%`,
  backgroundColor: performer.color,
  backgroundImage: performer.boxTextures?.front?.dataUrl || performer.textureDataUrl
    ? `url(${performer.boxTextures?.front?.dataUrl || performer.textureDataUrl})`
    : undefined,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  clipPath: getPolygonClipPath(performer.polygonPoints),
  transform: `translate(-50%, -50%) rotate(${performer.rotation || 0}deg)`,
  border: isSelected ? '2px solid white' : '1px solid rgba(255,255,255,0.3)',
  boxShadow: isSelected ? '0 0 10px rgba(59,130,246,0.5)' : 'none'
}}
```

- [ ] **Step 3: Commit**

```bash
git add components/Stage.tsx
git commit -m "feat(2d): support polygon clip-path and multi-face textures in Stage view"
```

---

### Task 11: Update Sidebar.tsx to Use PropEditorModal

**Files:**
- Modify: `components/Sidebar.tsx`

- [ ] **Step 1: Import PropEditorModal**

Add import at top of Sidebar.tsx:

```typescript
import { PropEditorModal } from './PropEditorModal';
```

- [ ] **Step 2: Add PropEditorModal state**

After the `propEditState` (around line 247), add:

```typescript
const [propEditorOpen, setPropEditorOpen] = useState(false);
const [propEditorPerformerId, setPropEditorPerformerId] = useState<string | null>(null);
```

- [ ] **Step 3: Open PropEditorModal from context menu**

In the context menu section where props are listed (around line 1035+), find the "编辑道具" menu item. Change `openPropEditDialog(performer.id)` to:

```typescript
setPropEditorPerformerId(performer.id);
setPropEditorOpen(true);
```

Also add a menu item for creating new props with the editor:
- In the props tab section, add a button "高级创建" next to the existing add button that opens PropEditorModal with `mode='create'`

- [ ] **Step 4: Add PropEditorModal component at the end of the sidebar render**

Before the closing `</div>` of the Sidebar component (but still inside it), add:

```tsx
<PropEditorModal
  isOpen={propEditorOpen}
  performer={propEditorPerformerId ? performers.find(p => p.id === propEditorPerformerId) || null : null}
  mode={propEditorPerformerId ? 'edit' : 'create'}
  onSave={(updates) => {
    if (propEditorPerformerId) {
      onUpdatePerformer(propEditorPerformerId, updates);
    } else {
      // Create new prop
      onAddPerformer(updates.name || '道具', updates.color || '#475569', 'square', {
        type: 'prop',
        width: updates.width,
        depth: updates.depth,
        height: updates.height,
        rotation: updates.rotation,
        ...updates
      });
    }
    setPropEditorOpen(false);
    setPropEditorPerformerId(null);
  }}
  onClose={() => {
    setPropEditorOpen(false);
    setPropEditorPerformerId(null);
  }}
/>
```

Note: The `onAddPerformer` call needs the `extra` parameter extended. See Task 12.

- [ ] **Step 5: Commit**

```bash
git add components/Sidebar.tsx
git commit -m "feat(sidebar): integrate PropEditorModal for advanced prop editing"
```

---

### Task 12: Update App.tsx to Support New Fields

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Extend handleAddPerformer signature**

In `App.tsx`, update the `handleAddPerformer` function (line 258) to accept new fields. Change the `extra` type from:

```typescript
extra?: { type?: PerformerType, width?: number, depth?: number, height?: number, rotation?: number }
```

to:

```typescript
extra?: { type?: PerformerType, width?: number, depth?: number, height?: number, rotation?: number, [key: string]: any }
```

And spread all extra fields into the newPerformer:

```typescript
const handleAddPerformer = (name: string, color: string, shape: PerformerShape, extra?: Record<string, any>) => {
  const newPerformer: Performer = {
    id: generateId(),
    name,
    color,
    label: name.charAt(0).toUpperCase(),
    shape,
    type: extra?.type || 'performer',
    ...extra
  };
  // ... rest unchanged
};
```

- [ ] **Step 2: Update SidebarProps onAddPerformer type in Sidebar.tsx**

In Sidebar.tsx line 15, update the onAddPerformer prop type:

```typescript
onAddPerformer: (name: string, color: string, shape: PerformerShape, extra?: Record<string, any>) => void;
```

- [ ] **Step 3: Commit**

```bash
git add App.tsx components/Sidebar.tsx
git commit -m "feat: extend handleAddPerformer to support new prop fields"
```

---

### Task 13: Update EditorPanel3D to Show Geometry Type

**Files:**
- Modify: `components/EditorPanel3D.tsx`

- [ ] **Step 1: Add geometry type display**

In the props section (after the size grid, around line 57), add a geometry type indicator:

```tsx
{isProp && performer.propGeometryType === 'extruded' && (
  <div className="text-xs text-amber-400 bg-amber-400/10 rounded px-2 py-1 mt-2">
    异形道具 ({(performer.polygonPoints?.length || 0)} 顶点)
  </div>
)}
{isProp && performer.boxTextures && Object.keys(performer.boxTextures).length > 0 && (
  <div className="text-xs text-blue-400 bg-blue-400/10 rounded px-2 py-1 mt-2">
    {Object.keys(performer.boxTextures).length} 面贴图
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add components/EditorPanel3D.tsx
git commit -m "feat(3d-panel): show geometry type and texture info in EditorPanel3D"
```

---

### Task 14: Build and Fix Errors

- [ ] **Step 1: Run TypeScript compilation**

```bash
cd C:/Users/Subway/code/ChoreoMaster && npx tsc --noEmit 2>&1 | head -100
```

- [ ] **Step 2: Fix any TypeScript errors**

Address all type errors reported by `tsc --noEmit`.

- [ ] **Step 3: Run dev server and test**

```bash
cd C:/Users/Subway/code/ChoreoMaster && npm run dev
```

Test the following in the browser:
1. Open Sidebar → Props tab → right-click a prop → "编辑道具" should open PropEditorModal
2. Switch between 立方体 and 异形 tabs
3. In 异形 mode, draw a polygon using click-to-add-vertex
4. In 立方体 mode, upload textures to individual faces
5. Import a PNG to generate outline in 异形 mode
6. 3D preview should update in real-time
7. Save the prop, check it renders correctly in both 2D and 3D views

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve TypeScript and runtime errors"
```

---

### Task 15: Final Integration Test

- [ ] **Step 1: Test full workflow end-to-end**

1. Create a new prop via Sidebar (simple box) → verify 2D and 3D rendering
2. Open PropEditorModal → edit it → add front texture → save → verify texture in 3D
3. Create prop with 异形 shape → draw polygon → set extrude height → verify in 3D
4. Import PNG → verify outline extraction → adjust vertices → save
5. Test box with multiple face textures → verify each face in 3D rotation
6. Save project → reload → verify props persist correctly

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "feat: custom props and multi-face textures - integration complete"
```
