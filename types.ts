
export interface Position {
  x: number; // Percentage 0-100
  y: number; // Percentage 0-100
}

export type PerformerShape = 'circle' | 'square' | 'triangle';

export type PerformerType = 'performer' | 'prop';

export interface Performer {
  id: string;
  name: string;
  color: string;
  label: string;
  shape: PerformerShape;
  groupId?: string; // Optional group membership
  type?: PerformerType;
  width?: number; // Width in meters (conceptual)
  height?: number; // Height in meters (conceptual)
  rotation?: number; // Rotation in degrees
}

export interface PerformerGroup {
  id: string;
  name: string;
  color: string; // Group theme color
  collapsed: boolean; // Whether the group is collapsed in UI
  type?: 'performer' | 'prop'; // Group type
}

export interface Frame {
  id: string;
  name: string;
  startTime: number; // Absolute start time in ms
  duration: number; // How long the formation is held (ms)
  positions: Record<string, Position>; // Map performer ID to position
  notes?: string;
  hiddenGroupIds?: string[]; // IDs of groups that are hidden in this frame
}

export interface Project {
  name: string;
  performers: Performer[];
  groups: PerformerGroup[];
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
