// LEF file data structures

export interface LEFCoordinate {
  x: number;
  y: number;
}

export interface LEFRect {
  layer: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LEFPin {
  name: string;
  direction: 'INPUT' | 'OUTPUT' | 'INOUT';
  use: 'SIGNAL' | 'POWER' | 'GROUND';
  rects: LEFRect[];
}

export interface LEFMacro {
  name: string;
  className: string;
  origin: LEFCoordinate;
  size: {
    width: number;
    height: number;
  };
  pins: LEFPin[];
  obs: LEFRect[]; // Obstruction rectangles
}

export interface LEFLayer {
  name: string;
  type: 'ROUTING' | 'CUT' | 'OVERLAP' | 'MASTERSLICE';
  spacing?: number;
}

export interface LEFData {
  version: string;
  layers: LEFLayer[];
  macros: LEFMacro[];
  via?: any[]; // VIA definitions if needed
}

// Color mapping for different layers
export const LAYER_COLORS: Record<string, string> = {
  M1: '#ff4444',      // Red
  M2: '#44ff44',      // Green  
  M3: '#4444ff',      // Blue
  M4: '#ffff44',      // Yellow
  M5: '#ff44ff',      // Magenta
  M6: '#44ffff',      // Cyan
  M7: '#ff8844',      // Orange
  M8: '#8844ff',      // Purple
  V1: '#888888',      // Gray (via)
  V2: '#aaaaaa',      // Light gray (via)
  V3: '#666666',      // Dark gray (via)
  V4: '#999999',      // Medium gray (via)
  V5: '#bbbbbb',      // Lighter gray (via)
  VDD: '#ff0000',     // Red (power)
  VSS: '#000000',     // Black (ground)
  default: '#808080'  // Default gray
};
