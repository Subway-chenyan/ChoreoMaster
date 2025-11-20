import { Position } from './types';

export const STAGE_ASPECT_RATIO = 16 / 9;

export const DEFAULT_COLORS = [
  '#EF4444', // Red
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Yellow
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
];

// Helper to create a grid
const createGrid = (count: number, spread: number = 60) => {
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    return Array.from({ length: count }).map((_, i) => ({
      x: 50 - (spread/2) + (spread / (cols > 1 ? cols - 1 : 1)) * (i % cols),
      y: 50 - (spread/2) + (spread / (rows > 1 ? rows - 1 : 1)) * Math.floor(i / cols),
    }));
};

export const PRESET_SHAPES: Record<string, (count: number, scale?: number) => Position[]> = {
  // --- LINES ---
  'Horizontal Line': (count, scale = 1) => {
    const width = 60 * scale;
    const startX = 50 - width / 2;
    return Array.from({ length: count }).map((_, i) => ({
      x: startX + (width / (count > 1 ? count - 1 : 1)) * i,
      y: 50,
    }));
  },
  'Vertical Line': (count, scale = 1) => {
    const height = 60 * scale;
    const startY = 50 - height / 2;
    return Array.from({ length: count }).map((_, i) => ({
      x: 50,
      y: startY + (height / (count > 1 ? count - 1 : 1)) * i,
    }));
  },
  'Diagonal /': (count, scale = 1) => {
    const spread = 40 * scale;
    const height = 60 * scale;
    return Array.from({ length: count }).map((_, i) => ({
      x: 50 - spread/2 + (spread / (count > 1 ? count - 1 : 1)) * i,
      y: 50 + height/2 - (height / (count > 1 ? count - 1 : 1)) * i,
    }));
  },

  // --- OUTLINE ---
  'Circle (Outline)': (count, scale = 1) => {
    const r = 30 * scale;
    return Array.from({ length: count }).map((_, i) => {
      const angle = (i / count) * 2 * Math.PI - Math.PI / 2; // Start top
      return {
        x: 50 + r * Math.cos(angle),
        y: 50 + r * Math.sin(angle) * (16/9),
      };
    });
  },
  'Square (Outline)': (count, scale = 1) => {
      // Perimeter walk: Top -> Right -> Bottom -> Left
      return Array.from({ length: count }).map((_, i) => {
          const section = Math.floor((i / count) * 4);
          const progress = ((i / count) * 4) % 1;
          
          const r = 30 * scale;
          const ry = r * (16/9); 
          let x=50, y=50;
          
          if (section === 0) { // Top
              x = 50 - r + (2*r * progress);
              y = 50 - ry;
          } else if (section === 1) { // Right
              x = 50 + r;
              y = 50 - ry + (2*ry * progress);
          } else if (section === 2) { // Bottom
              x = 50 + r - (2*r * progress);
              y = 50 + ry;
          } else { // Left
              x = 50 - r;
              y = 50 + ry - (2*ry * progress);
          }
          return { x, y };
      });
  },
  'Triangle (Outline)': (count, scale = 1) => {
      const r = 30 * scale;
      const ry = r * (16/9);
      
      // Triangle vertices relative to center (50,50)
      const p1 = { x: 50, y: 50 - ry }; // Top
      const p2 = { x: 50 + r, y: 50 + ry }; // Bottom Right
      const p3 = { x: 50 - r, y: 50 + ry }; // Bottom Left

      return Array.from({ length: count }).map((_, i) => {
          const progress = i / count;
          let x, y;
          if (progress < 0.333) { // Right side (Top -> Bottom Right)
               const p = progress / 0.333;
               x = p1.x + (p2.x - p1.x) * p;
               y = p1.y + (p2.y - p1.y) * p;
          } else if (progress < 0.666) { // Bottom (Bottom Right -> Bottom Left)
               const p = (progress - 0.333) / 0.333;
               x = p2.x + (p3.x - p2.x) * p;
               y = p2.y + (p3.y - p2.y) * p;
          } else { // Left side (Bottom Left -> Top)
               const p = (progress - 0.666) / 0.333;
               x = p3.x + (p1.x - p3.x) * p;
               y = p3.y + (p1.y - p3.y) * p;
          }
          return { x, y };
      });
  },

  // --- FILL ---
  'Circle (Fill)': (count, scale = 1) => {
      // Golden Ratio Spiral (Sunflower)
      const maxR = 30 * scale;
      return Array.from({ length: count }).map((_, i) => {
          // Normalize radius based on scale
          const r = Math.sqrt(i / count) * maxR;
          const theta = Math.PI * (3 - Math.sqrt(5)) * i * 20; // Golden angle
          const x = 50 + r * Math.cos(theta);
          const y = 50 + r * Math.sin(theta) * (16/9);
          return { x, y };
      });
  },
  'Square (Fill)': (count, scale = 1) => {
      return createGrid(count, 60 * scale);
  },
  'Triangle (Fill)': (count, scale = 1) => {
      // Bowling pin arrangement approx
      let rows = 1;
      while ((rows * (rows + 1)) / 2 < count) rows++;
      
      const positions: Position[] = [];
      let currentRow = 0;
      let inRow = 0;
      
      for(let i=0; i<count; i++) {
          const spreadX = 10 * scale;
          const spreadY = 15 * scale;
          const totalHeight = (rows - 1) * spreadY;
          
          // Center vertical
          const yBase = 50 - totalHeight / 2;
          const xBase = 50;
          
          const x = xBase - (currentRow * spreadX / 2) + inRow * spreadX;
          const y = yBase + currentRow * spreadY;
          
          positions.push({x, y});
          
          inRow++;
          if (inRow > currentRow) {
              currentRow++;
              inRow = 0;
          }
      }
      return positions;
  }
};