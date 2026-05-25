// ---------------------------------------------------------------------------
// PngOutlineExtractor.ts – Extract polygon outlines from PNG images using
// alpha transparency detection and Marching Squares contour tracing.
// Used by ShapeEditor2D's "Import from PNG" feature.
// ---------------------------------------------------------------------------

import { Point } from './PolygonUtils';
import {
  closePolygon,
  simplifyPolygon,
  normalizePoints,
  polygonArea,
} from './PolygonUtils';

// ── Public types ───────────────────────────────────────────────────────────

interface ExtractResult {
  points: Point[];
  normalizedPoints: Point[];
  width: number;   // original image width
  height: number;  // original image height
}

// ── Private helpers ────────────────────────────────────────────────────────

/**
 * Load a File as an HTMLImageElement.
 * Uses an object URL to avoid reading the entire file into memory twice.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    img.src = url;
  });
}

/**
 * 8-connected Moore Neighborhood offsets in clockwise order.
 * Starts at the right (dx=1, dy=0) and goes clockwise.
 */
const MOORE_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const MOORE_DY = [0, -1, -1, -1, 0, 1, 1, 1];

/**
 * Trace a single contour starting from (startX, startY) using
 * Moore Neighborhood tracing on the binary grid.
 *
 * The grid is padded with a 1px border of `false` so we never need
 * to bounds-check inside this function.
 */
function traceContour(
  grid: boolean[][],
  w: number,
  h: number,
  startX: number,
  startY: number,
  visited: boolean[][],
): Point[] {
  const contour: Point[] = [];

  // The backtracking direction is the index in the Moore neighborhood that
  // would have brought us from the previous pixel to the current pixel.
  // For the starting pixel we arrive from the left (index 4).
  let dir = 4;

  let cx = startX;
  let cy = startY;

  do {
    contour.push({ x: cx, y: cy });
    visited[cy][cx] = true;

    // Search clockwise starting from (dir + 6) % 8, which is two steps
    // counter-clockwise from the direction we came from (Moore convention).
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + 6 + i) % 8;
      const nx = cx + MOORE_DX[checkDir];
      const ny = cy + MOORE_DY[checkDir];

      if (grid[ny][nx]) {
        dir = checkDir;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }

    if (!found) {
      // Isolated pixel — contour has only this one point
      break;
    }

    // Safety: prevent infinite loops on degenerate grids
    if (contour.length > (w + 2) * (h + 2)) {
      break;
    }
  } while (cx !== startX || cy !== startY);

  return contour;
}

/**
 * Run Marching Squares contour extraction on a binary grid.
 *
 * Returns an array of contours, where each contour is an array of Points
 * in pixel coordinates (including the 1px padding offset).
 *
 * @param grid  - 2D boolean array (true = opaque). Must be padded with 1px border.
 * @param w     - Original (unpadded) image width.
 * @param h     - Original (unpadded) image height.
 */
function marchingSquares(
  grid: boolean[][],
  w: number,
  h: number,
): Point[][] {
  // grid dimensions include the 1px padding, so are (w+2) x (h+2)
  const gridW = w + 2;
  const gridH = h + 2;

  const visited: boolean[][] = [];
  for (let y = 0; y < gridH; y++) {
    visited[y] = new Array(gridW).fill(false);
  }

  const contours: Point[][] = [];

  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      if (!grid[y][x] || visited[y][x]) continue;

      // A boundary pixel is opaque with at least one transparent neighbor
      let isBoundary = false;
      for (let d = 0; d < 8; d++) {
        const nx = x + MOORE_DX[d];
        const ny = y + MOORE_DY[d];
        if (!grid[ny][nx]) {
          isBoundary = true;
          break;
        }
      }

      if (!isBoundary) continue;

      const contour = traceContour(grid, w, h, x, y, visited);
      if (contour.length >= 3) {
        contours.push(contour);
      }
    }
  }

  return contours;
}

/**
 * Adaptive Douglas-Peucker simplification using binary search on tolerance
 * to hit a target vertex count.
 *
 * @param points       - Input polygon vertices.
 * @param targetCount  - Desired number of vertices (approximate).
 * @returns Simplified polygon with approximately targetCount vertices.
 */
function adaptiveSimplify(
  points: Point[],
  targetCount: number,
): Point[] {
  if (points.length <= targetCount) return points.slice();

  let lo = 0;
  let hi = Math.max(points[targetCount - 1].x - points[0].x, 1);
  // Use the diagonal of the bounding box as an upper bound
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  hi = Math.max(maxX - minX, maxY - minY, 1);

  let bestResult = points.slice();

  // Binary search for the right tolerance
  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    const simplified = simplifyPolygon(points, mid);

    if (simplified.length > targetCount) {
      lo = mid; // need more tolerance
    } else {
      hi = mid; // need less tolerance
      bestResult = simplified;
    }
  }

  // Final check — pick whichever is closer to the target
  const loResult = simplifyPolygon(points, lo);
  const hiResult = simplifyPolygon(points, hi);

  const loDiff = Math.abs(loResult.length - targetCount);
  const hiDiff = Math.abs(hiResult.length - targetCount);

  return loDiff <= hiDiff ? loResult : hiResult;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract a polygon outline from a PNG image by detecting alpha transparency.
 *
 * @param file             - The PNG file to process.
 * @param alphaThreshold   - Alpha value above which a pixel is considered opaque (default 128).
 * @param maxResolution    - Maximum edge length for the downscaled image (default 256).
 * @param targetVertexCount - Target number of vertices in the output polygon (default 40).
 * @returns An ExtractResult with both raw and normalized polygon points.
 *
 * @throws Error if no valid contour is detected (image may be fully transparent).
 */
export async function extractOutlineFromPng(
  file: File,
  alphaThreshold: number = 128,
  maxResolution: number = 256,
  targetVertexCount: number = 40,
): Promise<ExtractResult> {
  // 1. Load the image
  const img = await loadImage(file);
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  // 2. Scale down to maxResolution
  const scale = Math.min(maxResolution / originalWidth, maxResolution / originalHeight, 1);
  const scaledW = Math.round(originalWidth * scale);
  const scaledH = Math.round(originalHeight * scale);

  // 3. Draw to offscreen canvas and get pixel data
  const canvas = document.createElement('canvas');
  canvas.width = scaledW;
  canvas.height = scaledH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 Canvas 2D 上下文');
  }
  ctx.drawImage(img, 0, 0, scaledW, scaledH);
  const imageData = ctx.getImageData(0, 0, scaledW, scaledH);
  const pixels = imageData.data;

  // 4. Create binary grid with 1px padding (padded grid is (scaledW+2) x (scaledH+2))
  const gridW = scaledW + 2;
  const gridH = scaledH + 2;
  const grid: boolean[][] = [];

  // Fill border with false
  for (let y = 0; y < gridH; y++) {
    grid[y] = new Array(gridW).fill(false);
  }

  // Fill interior based on alpha threshold
  for (let y = 0; y < scaledH; y++) {
    for (let x = 0; x < scaledW; x++) {
      const idx = (y * scaledW + x) * 4;
      const alpha = pixels[idx + 3];
      grid[y + 1][x + 1] = alpha > alphaThreshold;
    }
  }

  // 5. Run Marching Squares to extract contours
  const contours = marchingSquares(grid, scaledW, scaledH);

  if (contours.length === 0) {
    throw new Error('未检测到有效轮廓：图片可能完全透明');
  }

  if (contours.length > 1) {
    console.log(
      `[PngOutlineExtractor] 检测到 ${contours.length} 个轮廓，选择面积最大的`,
    );
  }

  // 6. Find largest contour by area
  let largestContour = contours[0];
  let largestArea = Math.abs(polygonArea(contours[0]));

  for (let i = 1; i < contours.length; i++) {
    const area = Math.abs(polygonArea(contours[i]));
    if (area > largestArea) {
      largestArea = area;
      largestContour = contours[i];
    }
  }

  // 7. Close the polygon
  let points = closePolygon(largestContour);

  // 8. Adaptive Douglas-Peucker simplification to hit targetVertexCount
  //    Remove the closing point before simplifying (Douglas-Peucker works on
  //    open polylines), then re-close after.
  const isOpen = points.length > 1 &&
    Math.abs(points[points.length - 1].x - points[0].x) < 1e-6 &&
    Math.abs(points[points.length - 1].y - points[0].y) < 1e-6;
  const openPoints = isOpen ? points.slice(0, -1) : points;
  const simplified = adaptiveSimplify(openPoints, targetVertexCount);
  points = closePolygon(simplified);

  // 9. Normalize points to [0,1]
  const normalizedPoints = normalizePoints(
    points.map(p => ({ x: p.x, y: p.y })),
  );

  return {
    points,
    normalizedPoints,
    width: originalWidth,
    height: originalHeight,
  };
}
