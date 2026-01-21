import type { StageConfig } from '../types';
import type { Position } from '../types';

/** Convert 2D percentage coordinates to 3D world coordinates */
export function mapTo3D(
  pos: Position,
  config: StageConfig
): [number, number, number] {
  // x: 0-100 → -width/2 to width/2 (left to right)
  const x3d = ((pos.x - 50) / 50) * (config.width / 2);

  // y: 0-100 → -depth/2 to depth/2
  // In 2D: y=0 is top (back of stage), y=100 is bottom (front of stage)
  // In 3D with camera at z=20 looking at origin: -z is front (towards camera), +z is back
  // Front of stage (y=100 in 2D) should map to -z (towards camera)
  // Back of stage (y=0 in 2D) should map to +z (away from camera)
  const z3d = ((pos.y - 50) / 50) * (config.depth / 2);

  // z in Position: height in meters (vertical in Three.js, Y axis)
  const y3d = pos.z || 0;

  return [x3d, y3d, z3d]; // Three.js: [x, y(up), z]
}

/** Convert 3D world coordinates to 2D percentage coordinates */
export function mapTo2D(
  x3d: number,
  y3d: number,
  z3d: number,
  config: StageConfig
): Position {
  // x: -width/2 to width/2 → 0-100
  const x = ((x3d / (config.width / 2)) * 50) + 50;
  // z: -z is front, +z is back → 0-100 (0 is top/back, 100 is bottom/front)
  const y = ((z3d / (config.depth / 2)) * 50) + 50;

  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    z: y3d
  };
}

/** Convert degrees to radians */
export function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/** Convert radians to degrees */
export function radToDeg(radians: number): number {
  return radians * (180 / Math.PI);
}
