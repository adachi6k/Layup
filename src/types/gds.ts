export interface GDSPoint {
  x: number;
  y: number;
}

export interface GDSBBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GDSPolygon {
  layer: number;
  datatype: number;
  points: GDSPoint[];
  bbox: GDSBBox;
}

export interface GDSPath {
  layer: number;
  datatype: number;
  width: number;
  points: GDSPoint[];
  bbox: GDSBBox;
}

export interface GDSTransform {
  x: number;
  y: number;
  reflect: boolean;
  mag: number;
  angle: number;
}

export interface GDSReference {
  name: string;
  transform: GDSTransform;
  columns?: number;
  rows?: number;
  columnVector?: GDSPoint;
  rowVector?: GDSPoint;
}

export interface GDSCell {
  name: string;
  polygons: GDSPolygon[];
  paths: GDSPath[];
  references: GDSReference[];
  bbox?: GDSBBox;
}

export interface GDSData {
  version?: number;
  libraryName?: string;
  userUnitMeters: number;
  dbUnitMeters: number;
  unitScaleUm: number;
  cells: GDSCell[];
  cellMap: Map<string, GDSCell>;
  topCellName: string;
  bbox: GDSBBox;
  stats: {
    polygonCount: number;
    pathCount: number;
    referenceCount: number;
    maxHierarchyDepth: number;
  };
}
