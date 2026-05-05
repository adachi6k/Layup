import type {
  GDSBBox,
  GDSCell,
  GDSData,
  GDSPath,
  GDSPoint,
  GDSPolygon,
  GDSReference,
  GDSTransform,
} from '../types/gds';

const RECORD = {
  HEADER: 0x00,
  BGNLIB: 0x01,
  LIBNAME: 0x02,
  UNITS: 0x03,
  BGNSTR: 0x05,
  STRNAME: 0x06,
  ENDSTR: 0x07,
  BOUNDARY: 0x08,
  PATH: 0x09,
  SREF: 0x0a,
  AREF: 0x0b,
  LAYER: 0x0d,
  DATATYPE: 0x0e,
  WIDTH: 0x0f,
  XY: 0x10,
  ENDEL: 0x11,
  SNAME: 0x12,
  COLROW: 0x13,
  STRANS: 0x1a,
  MAG: 0x1b,
  ANGLE: 0x1c,
  BOX: 0x2d,
  BOXTYPE: 0x2e,
} as const;

type ElementKind = 'boundary' | 'path' | 'sref' | 'aref' | 'box';

interface PartialElement {
  kind: ElementKind;
  layer?: number;
  datatype?: number;
  width?: number;
  xy?: GDSPoint[];
  sname?: string;
  columns?: number;
  rows?: number;
  transform: GDSTransform;
}

const emptyBBox = (): GDSBBox => ({
  x1: Number.POSITIVE_INFINITY,
  y1: Number.POSITIVE_INFINITY,
  x2: Number.NEGATIVE_INFINITY,
  y2: Number.NEGATIVE_INFINITY,
});

const isFiniteBBox = (bbox: GDSBBox): boolean =>
  Number.isFinite(bbox.x1) && Number.isFinite(bbox.y1) &&
  Number.isFinite(bbox.x2) && Number.isFinite(bbox.y2);

const expandBBoxPoint = (bbox: GDSBBox, p: GDSPoint) => {
  bbox.x1 = Math.min(bbox.x1, p.x);
  bbox.y1 = Math.min(bbox.y1, p.y);
  bbox.x2 = Math.max(bbox.x2, p.x);
  bbox.y2 = Math.max(bbox.y2, p.y);
};

const expandBBox = (bbox: GDSBBox, other: GDSBBox) => {
  if (!isFiniteBBox(other)) return;
  bbox.x1 = Math.min(bbox.x1, other.x1);
  bbox.y1 = Math.min(bbox.y1, other.y1);
  bbox.x2 = Math.max(bbox.x2, other.x2);
  bbox.y2 = Math.max(bbox.y2, other.y2);
};

const bboxFromPoints = (points: GDSPoint[]): GDSBBox => {
  const bbox = emptyBBox();
  points.forEach((p) => expandBBoxPoint(bbox, p));
  return isFiniteBBox(bbox) ? bbox : { x1: 0, y1: 0, x2: 1, y2: 1 };
};

const readString = (view: DataView, offset: number, length: number): string => {
  const bytes: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const b = view.getUint8(offset + i);
    if (b !== 0) bytes.push(b);
  }
  return String.fromCharCode(...bytes).trim();
};

const readInt16Array = (view: DataView, offset: number, length: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 1 < length; i += 2) out.push(view.getInt16(offset + i, false));
  return out;
};

const readInt32Array = (view: DataView, offset: number, length: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 3 < length; i += 4) out.push(view.getInt32(offset + i, false));
  return out;
};

const readGDSReal8 = (view: DataView, offset: number): number => {
  let allZero = true;
  for (let i = 0; i < 8; i += 1) {
    if (view.getUint8(offset + i) !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return 0;

  const first = view.getUint8(offset);
  const sign = (first & 0x80) !== 0 ? -1 : 1;
  const exponent = (first & 0x7f) - 64;
  let mantissa = 0;
  for (let i = 1; i < 8; i += 1) {
    mantissa = mantissa * 256 + view.getUint8(offset + i);
  }
  return sign * (mantissa / 2 ** 56) * 16 ** exponent;
};

const readReal8Array = (view: DataView, offset: number, length: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 7 < length; i += 8) out.push(readGDSReal8(view, offset + i));
  return out;
};

const defaultTransform = (): GDSTransform => ({
  x: 0,
  y: 0,
  reflect: false,
  mag: 1,
  angle: 0,
});

export const transformPoint = (point: GDSPoint, transform: GDSTransform): GDSPoint => {
  const reflectedY = transform.reflect ? -point.y : point.y;
  const scaledX = point.x * transform.mag;
  const scaledY = reflectedY * transform.mag;
  const rad = (transform.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: transform.x + scaledX * cos - scaledY * sin,
    y: transform.y + scaledX * sin + scaledY * cos,
  };
};

export const transformBBox = (bbox: GDSBBox, transform: GDSTransform): GDSBBox => {
  const points = [
    { x: bbox.x1, y: bbox.y1 },
    { x: bbox.x1, y: bbox.y2 },
    { x: bbox.x2, y: bbox.y1 },
    { x: bbox.x2, y: bbox.y2 },
  ].map((p) => transformPoint(p, transform));
  return bboxFromPoints(points);
};

const composeTransform = (parent: GDSTransform, child: GDSTransform): GDSTransform => {
  const origin = transformPoint({ x: child.x, y: child.y }, parent);
  return {
    x: origin.x,
    y: origin.y,
    reflect: parent.reflect !== child.reflect,
    mag: parent.mag * child.mag,
    angle: parent.angle + (parent.reflect ? -child.angle : child.angle),
  };
};

const flushElement = (cell: GDSCell, element: PartialElement | null) => {
  if (!element) return;
  const layer = element.layer ?? 0;
  const datatype = element.datatype ?? 0;
  const points = element.xy ?? [];

  if ((element.kind === 'boundary' || element.kind === 'box') && points.length >= 3) {
    const polygon: GDSPolygon = {
      layer,
      datatype,
      points,
      bbox: bboxFromPoints(points),
    };
    cell.polygons.push(polygon);
  } else if (element.kind === 'path' && points.length >= 2) {
    const width = Math.abs(element.width ?? 0);
    const bbox = bboxFromPoints(points);
    const half = width / 2;
    bbox.x1 -= half;
    bbox.y1 -= half;
    bbox.x2 += half;
    bbox.y2 += half;
    const path: GDSPath = {
      layer,
      datatype,
      width,
      points,
      bbox,
    };
    cell.paths.push(path);
  } else if ((element.kind === 'sref' || element.kind === 'aref') && element.sname && points.length >= 1) {
    const base = points[0];
    const transform = {
      ...element.transform,
      x: base.x,
      y: base.y,
    };
    const reference: GDSReference = {
      name: element.sname,
      transform,
    };
    if (element.kind === 'aref' && points.length >= 3) {
      const columns = Math.max(1, element.columns ?? 1);
      const rows = Math.max(1, element.rows ?? 1);
      reference.columns = columns;
      reference.rows = rows;
      reference.columnVector = {
        x: (points[1].x - base.x) / columns,
        y: (points[1].y - base.y) / columns,
      };
      reference.rowVector = {
        x: (points[2].x - base.x) / rows,
        y: (points[2].y - base.y) / rows,
      };
    }
    cell.references.push(reference);
  }
};

const computeCellBBoxes = (cells: GDSCell[], cellMap: Map<string, GDSCell>): number => {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let maxDepth = 0;

  const compute = (cell: GDSCell, depth: number): GDSBBox => {
    maxDepth = Math.max(maxDepth, depth);
    if (visited.has(cell.name) && cell.bbox) return cell.bbox;
    if (visiting.has(cell.name)) return cell.bbox ?? { x1: 0, y1: 0, x2: 1, y2: 1 };
    visiting.add(cell.name);

    const bbox = emptyBBox();
    cell.polygons.forEach((p) => expandBBox(bbox, p.bbox));
    cell.paths.forEach((p) => expandBBox(bbox, p.bbox));
    cell.references.forEach((ref) => {
      const target = cellMap.get(ref.name);
      if (!target) return;
      const targetBBox = compute(target, depth + 1);
      const columns = ref.columns ?? 1;
      const rows = ref.rows ?? 1;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const dx = (ref.columnVector?.x ?? 0) * col + (ref.rowVector?.x ?? 0) * row;
          const dy = (ref.columnVector?.y ?? 0) * col + (ref.rowVector?.y ?? 0) * row;
          expandBBox(bbox, transformBBox(targetBBox, { ...ref.transform, x: ref.transform.x + dx, y: ref.transform.y + dy }));
        }
      }
    });

    const normalized = isFiniteBBox(bbox) ? bbox : { x1: 0, y1: 0, x2: 1, y2: 1 };
    cell.bbox = normalized;
    visiting.delete(cell.name);
    visited.add(cell.name);
    return normalized;
  };

  cells.forEach((cell) => compute(cell, 0));
  return maxDepth;
};

const findTopCell = (cells: GDSCell[]): string => {
  const referenced = new Set<string>();
  cells.forEach((cell) => cell.references.forEach((ref) => referenced.add(ref.name)));
  return cells.find((cell) => !referenced.has(cell.name))?.name ?? cells[cells.length - 1]?.name ?? '';
};

export function parseGDS(buffer: ArrayBuffer): GDSData {
  const view = new DataView(buffer);
  const cells: GDSCell[] = [];
  let offset = 0;
  let version: number | undefined;
  let libraryName: string | undefined;
  let userUnitMeters = 1e-6;
  let dbUnitMeters = 1e-9;
  let currentCell: GDSCell | null = null;
  let currentElement: PartialElement | null = null;

  while (offset + 4 <= view.byteLength) {
    const length = view.getUint16(offset, false);
    const recordType = view.getUint8(offset + 2);
    const dataType = view.getUint8(offset + 3);
    if (length < 4 || offset + length > view.byteLength) {
      throw new Error(`Invalid GDS record length ${length} at byte ${offset}`);
    }

    const dataOffset = offset + 4;
    const dataLength = length - 4;
    const int16 = () => readInt16Array(view, dataOffset, dataLength);
    const int32 = () => readInt32Array(view, dataOffset, dataLength);
    const real8 = () => readReal8Array(view, dataOffset, dataLength);
    const str = () => readString(view, dataOffset, dataLength);

    if (recordType === RECORD.HEADER) {
      version = int16()[0];
    } else if (recordType === RECORD.LIBNAME) {
      libraryName = str();
    } else if (recordType === RECORD.UNITS) {
      const units = real8();
      if (units.length >= 2) {
        userUnitMeters = units[0] || userUnitMeters;
        dbUnitMeters = units[1] || dbUnitMeters;
      }
    } else if (recordType === RECORD.BGNSTR) {
      currentCell = { name: '', polygons: [], paths: [], references: [] };
    } else if (recordType === RECORD.STRNAME && currentCell) {
      currentCell.name = str();
    } else if (recordType === RECORD.ENDSTR && currentCell) {
      if (currentElement) {
        flushElement(currentCell, currentElement);
        currentElement = null;
      }
      cells.push(currentCell);
      currentCell = null;
    } else if (recordType === RECORD.BOUNDARY || recordType === RECORD.BOX || recordType === RECORD.PATH ||
      recordType === RECORD.SREF || recordType === RECORD.AREF) {
      if (!currentCell) throw new Error('GDS element found outside a structure');
      if (currentElement) flushElement(currentCell, currentElement);
      const kind: ElementKind =
        recordType === RECORD.BOUNDARY ? 'boundary' :
        recordType === RECORD.BOX ? 'box' :
        recordType === RECORD.PATH ? 'path' :
        recordType === RECORD.SREF ? 'sref' : 'aref';
      currentElement = { kind, transform: defaultTransform() };
    } else if (currentElement && (recordType === RECORD.LAYER || recordType === RECORD.DATATYPE || recordType === RECORD.BOXTYPE)) {
      const values = int16();
      if (recordType === RECORD.LAYER) currentElement.layer = values[0] ?? 0;
      else currentElement.datatype = values[0] ?? 0;
    } else if (currentElement && recordType === RECORD.WIDTH) {
      currentElement.width = (int32()[0] ?? 0) * dbUnitMeters * 1e6;
    } else if (currentElement && recordType === RECORD.SNAME) {
      currentElement.sname = str();
    } else if (currentElement && recordType === RECORD.COLROW) {
      const values = int16();
      currentElement.columns = values[0] ?? 1;
      currentElement.rows = values[1] ?? 1;
    } else if (currentElement && recordType === RECORD.STRANS) {
      const flags = dataLength >= 2 ? view.getUint16(dataOffset, false) : 0;
      currentElement.transform.reflect = (flags & 0x8000) !== 0;
    } else if (currentElement && recordType === RECORD.MAG) {
      currentElement.transform.mag = real8()[0] ?? 1;
    } else if (currentElement && recordType === RECORD.ANGLE) {
      currentElement.transform.angle = real8()[0] ?? 0;
    } else if (currentElement && recordType === RECORD.XY) {
      const values = int32();
      const scale = dbUnitMeters * 1e6;
      const points: GDSPoint[] = [];
      for (let i = 0; i + 1 < values.length; i += 2) {
        points.push({ x: values[i] * scale, y: values[i + 1] * scale });
      }
      currentElement.xy = points;
    } else if (recordType === RECORD.ENDEL && currentCell && currentElement) {
      flushElement(currentCell, currentElement);
      currentElement = null;
    } else if (dataType === 0 && dataLength !== 0) {
      throw new Error(`Unexpected non-empty no-data record at byte ${offset}`);
    }

    offset += length;
  }

  if (currentCell) throw new Error('Unexpected end of file inside a GDS structure');
  if (!cells.length) throw new Error('No GDS structures found');

  const cellMap = new Map(cells.map((cell) => [cell.name, cell]));
  const maxHierarchyDepth = computeCellBBoxes(cells, cellMap);
  const topCellName = findTopCell(cells);
  const bbox = cellMap.get(topCellName)?.bbox ?? { x1: 0, y1: 0, x2: 1, y2: 1 };
  const polygonCount = cells.reduce((sum, cell) => sum + cell.polygons.length, 0);
  const pathCount = cells.reduce((sum, cell) => sum + cell.paths.length, 0);
  const referenceCount = cells.reduce((sum, cell) => sum + cell.references.length, 0);

  return {
    version,
    libraryName,
    userUnitMeters,
    dbUnitMeters,
    unitScaleUm: dbUnitMeters * 1e6,
    cells,
    cellMap,
    topCellName,
    bbox,
    stats: {
      polygonCount,
      pathCount,
      referenceCount,
      maxHierarchyDepth,
    },
  };
}

export const flattenGDSCell = (
  data: GDSData,
  cellName: string,
  maxShapes: number,
): { polygons: GDSPolygon[]; paths: GDSPath[]; truncated: boolean } => {
  const polygons: GDSPolygon[] = [];
  const paths: GDSPath[] = [];
  let truncated = false;

  const visit = (cell: GDSCell, transform: GDSTransform, depth: number) => {
    if (truncated || depth > 32) return;
    for (const polygon of cell.polygons) {
      if (polygons.length + paths.length >= maxShapes) {
        truncated = true;
        return;
      }
      const points = polygon.points.map((point) => transformPoint(point, transform));
      polygons.push({ ...polygon, points, bbox: bboxFromPoints(points) });
    }
    for (const path of cell.paths) {
      if (polygons.length + paths.length >= maxShapes) {
        truncated = true;
        return;
      }
      const points = path.points.map((point) => transformPoint(point, transform));
      paths.push({ ...path, points, bbox: bboxFromPoints(points) });
    }
    for (const ref of cell.references) {
      const target = data.cellMap.get(ref.name);
      if (!target) continue;
      const columns = ref.columns ?? 1;
      const rows = ref.rows ?? 1;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const dx = (ref.columnVector?.x ?? 0) * col + (ref.rowVector?.x ?? 0) * row;
          const dy = (ref.columnVector?.y ?? 0) * col + (ref.rowVector?.y ?? 0) * row;
          visit(target, composeTransform(transform, { ...ref.transform, x: ref.transform.x + dx, y: ref.transform.y + dy }), depth + 1);
          if (truncated) return;
        }
      }
    }
  };

  const top = data.cellMap.get(cellName);
  if (top) visit(top, defaultTransform(), 0);
  return { polygons, paths, truncated };
};
