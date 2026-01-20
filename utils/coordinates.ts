import type { StageConfig } from '../types';
import type { Position } from '../types';

/** Convert 2D percentage coordinates to 3D world coordinates */
export function mapTo3D(
  pos: Position,
  config: StageConfig
): [number, number, number] {
  // x: 0-100 → -width/2 to width/2
  const x3d = ((pos.x - 50) / 50) * (config.width / 2);

  // y: 0-100 → depth/2 to -depth/2 (front of stage is positive)
  const y3d = ((50 - pos.y) / 50) * (config.depth / 2);

  // z: height in meters (vertical in Three.js)
  const z3d = pos.z || 0;

  return [x3d, z3d, y3d]; // Three.js: Y is up
}

/** Convert 3D world coordinates to 2D percentage coordinates */
export function mapTo2D(
  x3d: number,
  y3d: number,
  z3d: number,
  config: StageConfig
): Position {
  const x = ((x3d / (config.width / 2)) * 50) + 50;
  const y = 50 - ((z3d / (config.depth / 2)) * 50);

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
