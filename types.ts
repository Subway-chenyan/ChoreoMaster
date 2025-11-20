
export interface Position {
  x: number; // Percentage 0-100
  y: number; // Percentage 0-100
}

export type PerformerShape = 'circle' | 'square' | 'triangle';

export interface Performer {
  id: string;
  name: string;
  color: string;
  label: string;
  shape: PerformerShape;
}

export interface Frame {
  id: string;
  name: string;
  startTime: number; // Absolute start time in ms
  duration: number; // How long the formation is held (ms)
  positions: Record<string, Position>; // Map performer ID to position
  notes?: string;
}

export interface Project {
  name: string;
  performers: Performer[];
  frames: Frame[];
  musicUrl: string | null;
  audioBuffer: AudioBuffer | null;
}

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export enum ToolMode {
  SELECT = 'SELECT',
  ADD_PERFORMER = 'ADD_PERFORMER',
}
