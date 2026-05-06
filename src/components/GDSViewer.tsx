import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Badge, Button, Card, Col, Form, ListGroup, Row } from 'react-bootstrap';
import type { GDSBBox, GDSCell, GDSData, GDSPath, GDSPolygon, GDSRect, GDSTransform } from '../types/gds';
import { flattenGDSCell, transformBBox } from '../utils/gdsParser';
import { useCanvasViewport, syncCanvasDpr } from '../hooks/useCanvasViewport';

interface GDSViewerProps {
  gdsData: GDSData;
  filename: string;
}

const MAX_FLATTENED_SHAPES = 250_000;
const FLATTEN_WARN_SHAPES = 50_000;
const MAX_REFERENCE_BOXES = 75_000;
const DETAIL_SCALE_THRESHOLD_PX_PER_UM = 18;
const SIMPLIFIED_MAX_LAYERS = 8;
const SIMPLIFIED_ARRAY_AGGREGATE_INSTANCES = 1_500;
const SIMPLIFIED_SHAPE_SKIP_PX = 0.45;
/** Maximum GDS hierarchy depth the hierarchy renderer will descend before stopping. */
const MAX_HIERARCHY_DEPTH = 32;
/** Throttle interval (ms) for React state updates driven by frequent events (mousemove, draw). */
const THROTTLE_MS = 100;
/** Tolerance for treating array vectors as axis-aligned or zero length. */
const AXIS_EPSILON = 1e-12;
/**
 * LOD (Level of Detail) thresholds based on the instance's longest screen-space dimension.
 * Below LOD_SKIP_PX the instance is entirely sub-pixel and is culled.
 * Below LOD_BBOX_PX the instance is drawn as a bbox outline instead of recursing into geometry.
 */
const LOD_SKIP_PX = 1;
const LOD_BBOX_PX = 8;
const LOD_BBOX_ALPHA = 0.45;
const LOD_BBOX_COLOR_LIGHT = '#777';
const LOD_BBOX_COLOR_DARK = '#aaa';

type DetailMode = 'auto' | 'full' | 'simplified';

const layerColorCache = new Map<number, string>();
const layerColor = (layer: number): string => {
  const cached = layerColorCache.get(layer);
  if (cached !== undefined) return cached;
  const hues = [45, 95, 320, 205, 50, 25, 265, 185, 0, 150, 285, 15];
  const hue = hues[Math.abs(layer) % hues.length];
  const light = 48 + ((Math.abs(layer) * 7) % 18);
  const color = `hsl(${hue} 64% ${light}%)`;
  layerColorCache.set(layer, color);
  return color;
};

type Axis = 'x' | 'y';

const bboxWidth = (bbox: GDSBBox) => Math.max(1e-9, bbox.x2 - bbox.x1);
const bboxHeight = (bbox: GDSBBox) => Math.max(1e-9, bbox.y2 - bbox.y1);

const intersects = (a: GDSBBox, b: GDSBBox): boolean =>
  a.x2 >= b.x1 && a.x1 <= b.x2 && a.y2 >= b.y1 && a.y1 <= b.y2;

const translateBBox = (bbox: GDSBBox, dx: number, dy: number): GDSBBox => ({
  x1: bbox.x1 + dx,
  y1: bbox.y1 + dy,
  x2: bbox.x2 + dx,
  y2: bbox.y2 + dy,
});

const expandBBoxWith = (bbox: GDSBBox, other: GDSBBox): void => {
  bbox.x1 = Math.min(bbox.x1, other.x1);
  bbox.y1 = Math.min(bbox.y1, other.y1);
  bbox.x2 = Math.max(bbox.x2, other.x2);
  bbox.y2 = Math.max(bbox.y2, other.y2);
};

/** Compute an array's bbox from the four corner instance translations; a regular translated grid reaches x/y extrema at its parallelogram corners. */
const translatedArrayBBox = (instanceBBox: GDSBBox, columnVector: { x: number; y: number }, rowVector: { x: number; y: number }, columns: number, rows: number): GDSBBox => {
  const bbox = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  for (const [col, row] of [[0, 0], [columns - 1, 0], [0, rows - 1], [columns - 1, rows - 1]] as [number, number][]) {
    expandBBoxWith(bbox, translateBBox(instanceBBox, columnVector.x * col + rowVector.x * row, columnVector.y * col + rowVector.y * row));
  }
  return bbox;
};

/**
 * Compute the inclusive index range whose translated instance interval can intersect the viewport.
 * `step` is the array spacing on one axis, `instanceAxisMin/Max` are the single-instance bbox
 * extents on that axis, and `viewportMin/Max` are the visible region extents on the same axis.
 */
const computeVisibleIndexRange = (count: number, step: number, instanceAxisMin: number, instanceAxisMax: number, viewportMin: number, viewportMax: number): [number, number] | null => {
  if (count <= 0) return null;
  if (Math.abs(step) < AXIS_EPSILON) return instanceAxisMax >= viewportMin && instanceAxisMin <= viewportMax ? [0, count - 1] : null;
  const minRaw = step > 0 ? (viewportMin - instanceAxisMax) / step : (viewportMax - instanceAxisMin) / step;
  const maxRaw = step > 0 ? (viewportMax - instanceAxisMin) / step : (viewportMin - instanceAxisMax) / step;
  const start = Math.max(0, Math.ceil(minRaw));
  const end = Math.min(count - 1, Math.floor(maxRaw));
  return start <= end ? [start, end] : null;
};

/** Return whether a non-zero vector is aligned with the given axis within AXIS_EPSILON tolerance. */
const isAxisAlignedStep = (vector: { x: number; y: number }, axis: Axis): boolean =>
  axis === 'x'
    ? Math.abs(vector.x) >= AXIS_EPSILON && Math.abs(vector.y) < AXIS_EPSILON
    : Math.abs(vector.y) >= AXIS_EPSILON && Math.abs(vector.x) < AXIS_EPSILON;

const getAxisAlignedGridAxes = (columnVector: { x: number; y: number }, rowVector: { x: number; y: number }): { columnAxis: Axis; rowAxis: Axis } | null => {
  if (isAxisAlignedStep(columnVector, 'x') && isAxisAlignedStep(rowVector, 'y')) return { columnAxis: 'x', rowAxis: 'y' };
  if (isAxisAlignedStep(columnVector, 'y') && isAxisAlignedStep(rowVector, 'x')) return { columnAxis: 'y', rowAxis: 'x' };
  return null;
};

/**
 * Compute the bounding box of the pre-image of worldBBox under the given GDS transform.
 * This gives the region in local (cell) coordinates that maps into worldBBox, and is
 * used for conservative per-shape viewport culling when drawing recursively.
 */
const inverseTransformBBox = (worldBBox: GDSBBox, T: GDSTransform): GDSBBox => {
  const rad = (T.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const invMag = T.mag !== 0 ? 1 / T.mag : 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // Transform all 4 corners of worldBBox to local space
  for (const [wx, wy] of [
    [worldBBox.x1, worldBBox.y1],
    [worldBBox.x1, worldBBox.y2],
    [worldBBox.x2, worldBBox.y1],
    [worldBBox.x2, worldBBox.y2],
  ] as [number, number][]) {
    const sx = wx - T.x;
    const sy = wy - T.y;
    // Inverse rotation by -angle then unscale
    const ux = (sx * cos + sy * sin) * invMag;
    const uy = (-sx * sin + sy * cos) * invMag;
    // Inverse reflect
    const lx = ux;
    const ly = T.reflect ? -uy : uy;
    if (lx < minX) minX = lx;
    if (lx > maxX) maxX = lx;
    if (ly < minY) minY = ly;
    if (ly > maxY) maxY = ly;
  }
  return { x1: minX, y1: minY, x2: maxX, y2: maxY };
};

const renderRect = (ctx: CanvasRenderingContext2D, rect: GDSRect) => {
  ctx.fillRect(rect.x1, rect.y1, rect.x2 - rect.x1, rect.y2 - rect.y1);
};

const renderPolygon = (ctx: CanvasRenderingContext2D, polygon: GDSPolygon) => {
  if (polygon.points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
  for (let i = 1; i < polygon.points.length; i += 1) ctx.lineTo(polygon.points[i].x, polygon.points[i].y);
  ctx.closePath();
  ctx.fill();
};

const renderPath = (ctx: CanvasRenderingContext2D, path: GDSPath, absScale: number) => {
  if (path.points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(path.points[0].x, path.points[0].y);
  for (let i = 1; i < path.points.length; i += 1) ctx.lineTo(path.points[i].x, path.points[i].y);
  ctx.lineWidth = Math.max(path.width, 1 / absScale);
  ctx.stroke();
};

/**
 * Estimate the total number of shapes that would be produced by flattening the given cell.
 * Uses memoized recursive expansion (accounting for AREF multipliers) up to depth MAX_HIERARCHY_DEPTH and
 * short-circuits once `cap` is exceeded. This gives an accurate per-cell estimate instead
 * of the file-wide primitive totals, which can be misleading for heavily instanced designs.
 */
const estimateFlattenedShapeCount = (data: GDSData, cellName: string, cap: number): number => {
  const cache = new Map<string, number>();
  const visiting = new Set<string>();

  const estimate = (name: string, depth: number): number => {
    if (depth > MAX_HIERARCHY_DEPTH) return 0;
    if (cache.has(name)) return cache.get(name)!;
    if (visiting.has(name)) return 0; // circular ref guard
    const cell = data.cellMap.get(name);
    if (!cell) return 0;
    visiting.add(name);
    let count = cell.rects.length + cell.polygons.length + cell.paths.length;
    for (const ref of cell.references) {
      if (count >= cap) break;
      const instances = (ref.columns ?? 1) * (ref.rows ?? 1);
      count += instances * estimate(ref.name, depth + 1);
    }
    visiting.delete(name);
    cache.set(name, count);
    return count;
  };

  return estimate(cellName, 0);
};

export const GDSViewer: React.FC<GDSViewerProps> = ({ gdsData, filename }) => {
  const { containerRef, canvasRef, containerSize, zoom, setZoom, pan, setPan, isPanning, startPan, updatePan, endPan } = useCanvasViewport();
  const [selectedCellName, setSelectedCellName] = useState(gdsData.topCellName);
  const [visibleLayers, setVisibleLayers] = useState<Set<number>>(new Set());
  const [showRefs, setShowRefs] = useState(true);
  const [flattenRefs, setFlattenRefs] = useState(false);
  const [darkBg, setDarkBg] = useState(false);
  const [detailMode, setDetailMode] = useState<DetailMode>('auto');
  const [baseScale, setBaseScale] = useState(1);

  // Cursor: keep actual coords in a ref (updated every mousemove) and throttle the
  // React state update to ~100 ms so that frequent mouse moves don't trigger excessive re-renders.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RenderStats: throttled to avoid re-renders every animation frame.
  const renderStatsLatestRef = useRef({ visible: 0, culled: 0, refsVisible: 0, lodCulled: 0, lodSimplified: 0, drawMs: 0, truncated: false, refsTruncated: false, depthLimitHit: false });
  const renderStatsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renderStats, setRenderStats] = useState({ visible: 0, culled: 0, refsVisible: 0, lodCulled: 0, lodSimplified: 0, drawMs: 0, truncated: false, refsTruncated: false, depthLimitHit: false });

  // rAF handle: cancel any pending frame before scheduling a new one so rapid state
  // updates (e.g. every mousemove during panning) only produce one draw per display frame.
  const rafIdRef = useRef<number | null>(null);

  // Clean up throttle timers on unmount.
  useEffect(() => () => {
    if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    if (renderStatsTimerRef.current) clearTimeout(renderStatsTimerRef.current);
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
  }, []);

  const selectedCell = gdsData.cellMap.get(selectedCellName) ?? gdsData.cellMap.get(gdsData.topCellName) ?? gdsData.cells[0];
  const selectedBBox = selectedCell?.bbox ?? gdsData.bbox;
  const absScale = baseScale * zoom;
  const simplifiedActive = detailMode === 'simplified' || (detailMode === 'auto' && (isPanning || absScale < DETAIL_SCALE_THRESHOLD_PX_PER_UM));

  const allLayers = useMemo(() => {
    const layers = new Set<number>();
    gdsData.cells.forEach((cell) => {
      cell.rects.forEach((rect) => layers.add(rect.layer));
      cell.polygons.forEach((polygon) => layers.add(polygon.layer));
      cell.paths.forEach((path) => layers.add(path.layer));
    });
    return Array.from(layers).sort((a, b) => a - b);
  }, [gdsData]);

  useEffect(() => {
    setVisibleLayers(new Set(allLayers));
  }, [allLayers]);

  const renderLayers = useMemo(() => {
    const selected = allLayers.filter((layer) => visibleLayers.has(layer));
    if (!simplifiedActive || selected.length <= SIMPLIFIED_MAX_LAYERS) return new Set(selected);
    return new Set([...selected].sort((a, b) => b - a).slice(0, SIMPLIFIED_MAX_LAYERS));
  }, [allLayers, simplifiedActive, visibleLayers]);

  // ResizeObserver is handled by useCanvasViewport

  const fit = useCallback(() => {
    const pad = 0.06;
    const scale = Math.min(
      (containerSize.width * (1 - pad * 2)) / bboxWidth(selectedBBox),
      (containerSize.height * (1 - pad * 2)) / bboxHeight(selectedBBox),
    );
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    setBaseScale(safeScale);
    setZoom(1);
    setPan({
      x: (containerSize.width - bboxWidth(selectedBBox) * safeScale) / 2,
      y: (containerSize.height - bboxHeight(selectedBBox) * safeScale) / 2,
    });
  }, [containerSize.height, containerSize.width, selectedBBox, setPan, setZoom]);

  useEffect(() => {
    fit();
  }, [fit, selectedCellName]);

  const flattened = useMemo(() => {
    if (!flattenRefs || !selectedCell) return null;
    return flattenGDSCell(gdsData, selectedCell.name, MAX_FLATTENED_SHAPES);
  }, [flattenRefs, gdsData, selectedCell]);

  // Estimated expanded shape count for the selected cell, used to warn before flattening.
  // Recomputed only when the selected cell or data changes, not when flattenRefs toggles,
  // so the warning shows before the user commits to flattening.
  const estimatedFlattenCount = useMemo(
    () => estimateFlattenedShapeCount(gdsData, selectedCellName, MAX_FLATTENED_SHAPES + 1),
    [gdsData, selectedCellName],
  );

  const screenToWorld = useCallback((sx: number, sy: number) => ({
    x: selectedBBox.x1 + (sx - pan.x) / absScale,
    y: selectedBBox.y2 - (sy - pan.y) / absScale,
  }), [absScale, pan.x, pan.y, selectedBBox.x1, selectedBBox.y2]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = containerSize.width;
    const cssH = containerSize.height;
    syncCanvasDpr(canvas, cssW, cssH);

    const start = performance.now();
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = darkBg ? '#000000' : '#ffffff';
    ctx.fillRect(0, 0, cssW, cssH);

    const visibleBBox: GDSBBox = {
      x1: selectedBBox.x1 - pan.x / absScale,
      x2: selectedBBox.x1 + (cssW - pan.x) / absScale,
      y1: selectedBBox.y2 - (cssH - pan.y) / absScale,
      y2: selectedBBox.y2 + pan.y / absScale,
    };

    ctx.translate(pan.x, pan.y);
    ctx.scale(absScale, absScale);
    ctx.translate(-selectedBBox.x1, selectedBBox.y2);
    ctx.scale(1, -1);

    ctx.save();
    ctx.lineWidth = 1 / absScale;
    ctx.strokeStyle = darkBg ? '#d0d0d0' : '#222';
    ctx.setLineDash([8 / absScale, 6 / absScale]);
    ctx.strokeRect(selectedBBox.x1, selectedBBox.y1, bboxWidth(selectedBBox), bboxHeight(selectedBBox));
    ctx.setLineDash([]);
    ctx.restore();

    let visible = 0;
    let culled = 0;
    let refsVisible = 0;
    let lodCulled = 0;
    let lodSimplified = 0;
    let refsTruncated = false;
    let depthLimitHit = false;

    // Canvas state tracking: avoid redundant style/alpha assignments, which are
    // surprisingly expensive in browsers (they force style-parsing or attribute sync).
    // After any ctx.restore() these must be reset to '' / -1 so the next draw re-applies.
    let curFillStyle = '';
    let curStrokeStyle = '';
    let curGlobalAlpha = -1;
    const setFill = (style: string, alpha: number) => {
      if (alpha !== curGlobalAlpha) { ctx.globalAlpha = alpha; curGlobalAlpha = alpha; }
      if (style !== curFillStyle) { ctx.fillStyle = style; curFillStyle = style; }
    };
    const setStroke = (style: string, alpha: number) => {
      if (alpha !== curGlobalAlpha) { ctx.globalAlpha = alpha; curGlobalAlpha = alpha; }
      if (style !== curStrokeStyle) { ctx.strokeStyle = style; curStrokeStyle = style; }
    };
    const resetCtxState = () => { curFillStyle = ''; curStrokeStyle = ''; curGlobalAlpha = -1; };

    if (flattenRefs && flattened) {
      // Flatten mode: draw pre-flattened polygons and paths directly (all in world coords).
      for (const polygon of flattened.polygons) {
        if (!renderLayers.has(polygon.layer)) continue;
        if (!intersects(polygon.bbox, visibleBBox)) { culled += 1; continue; }
        const polygonScreenPx = absScale * Math.max(polygon.bbox.x2 - polygon.bbox.x1, polygon.bbox.y2 - polygon.bbox.y1);
        if (simplifiedActive && polygonScreenPx < SIMPLIFIED_SHAPE_SKIP_PX) { lodCulled += 1; continue; }
        visible += 1;
        setFill(layerColor(polygon.layer), simplifiedActive ? 0.42 : 0.68);
        renderPolygon(ctx, polygon);
      }
      for (const path of flattened.paths) {
        if (!renderLayers.has(path.layer)) continue;
        if (!intersects(path.bbox, visibleBBox)) { culled += 1; continue; }
        const pathScreenPx = absScale * Math.max(path.bbox.x2 - path.bbox.x1, path.bbox.y2 - path.bbox.y1);
        if (simplifiedActive && pathScreenPx < SIMPLIFIED_SHAPE_SKIP_PX) { lodCulled += 1; continue; }
        visible += 1;
        setStroke(layerColor(path.layer), simplifiedActive ? 0.55 : 0.8);
        renderPath(ctx, path, absScale);
      }
    } else if (selectedCell) {
      // Hierarchy-preserving mode: traverse the cell tree using transform stack.
      // No shape copies are created; canvas context transforms are used instead.
      // localVisibleBBox is the visible region in the current cell's local coordinate system,
      // used for per-shape culling without transforming individual shape bboxes.
      // effectiveScale is absScale × accumulated magnification, used for minimum stroke width.
      const drawCellRecursive = (cell: GDSCell, depth: number, localVisibleBBox: GDSBBox, effectiveScale: number) => {
        if (depth > MAX_HIERARCHY_DEPTH) { depthLimitHit = true; return; }

        // Draw rects
        for (const rect of cell.rects) {
          if (!renderLayers.has(rect.layer)) continue;
          if (!intersects(rect, localVisibleBBox)) { culled += 1; continue; }
          const rectScreenPx = effectiveScale * Math.max(rect.x2 - rect.x1, rect.y2 - rect.y1);
          if (simplifiedActive && rectScreenPx < SIMPLIFIED_SHAPE_SKIP_PX) { lodCulled += 1; continue; }
          visible += 1;
          setFill(layerColor(rect.layer), simplifiedActive ? 0.42 : 0.68);
          renderRect(ctx, rect);
        }

        // Draw polygons
        for (const polygon of cell.polygons) {
          if (!renderLayers.has(polygon.layer)) continue;
          if (!intersects(polygon.bbox, localVisibleBBox)) { culled += 1; continue; }
          const polygonScreenPx = effectiveScale * Math.max(polygon.bbox.x2 - polygon.bbox.x1, polygon.bbox.y2 - polygon.bbox.y1);
          if (simplifiedActive && polygonScreenPx < SIMPLIFIED_SHAPE_SKIP_PX) { lodCulled += 1; continue; }
          visible += 1;
          setFill(layerColor(polygon.layer), simplifiedActive ? 0.42 : 0.68);
          renderPolygon(ctx, polygon);
        }

        // Draw paths — use effectiveScale so the 1px minimum stroke is correct at this
        // depth even when the canvas has accumulated magnification from parent transforms.
        for (const path of cell.paths) {
          if (!renderLayers.has(path.layer)) continue;
          if (!intersects(path.bbox, localVisibleBBox)) { culled += 1; continue; }
          const pathScreenPx = effectiveScale * Math.max(path.bbox.x2 - path.bbox.x1, path.bbox.y2 - path.bbox.y1);
          if (simplifiedActive && pathScreenPx < SIMPLIFIED_SHAPE_SKIP_PX) { lodCulled += 1; continue; }
          visible += 1;
          setStroke(layerColor(path.layer), simplifiedActive ? 0.55 : 0.8);
          renderPath(ctx, path, effectiveScale);
        }

        // Recurse into references with cell-level bbox culling.
        for (const ref of cell.references) {
          const target = gdsData.cellMap.get(ref.name);
          if (!target?.bbox) continue;
          const columns = ref.columns ?? 1;
          const rows = ref.rows ?? 1;
          const columnVector = ref.columnVector ?? { x: 0, y: 0 };
          const rowVector = ref.rowVector ?? { x: 0, y: 0 };
          const baseInstBBox = transformBBox(target.bbox, ref.transform);
          const arrayBBox = translatedArrayBBox(baseInstBBox, columnVector, rowVector, columns, rows);
          if (!intersects(arrayBBox, localVisibleBBox)) continue;

          let colStart = 0;
          let colEnd = columns - 1;
          let rowStart = 0;
          let rowEnd = rows - 1;
          const axisAlignedGridAxes = getAxisAlignedGridAxes(columnVector, rowVector);

          if (axisAlignedGridAxes) {
            const colRange = axisAlignedGridAxes.columnAxis === 'x'
              ? computeVisibleIndexRange(columns, columnVector.x, baseInstBBox.x1, baseInstBBox.x2, localVisibleBBox.x1, localVisibleBBox.x2)
              : computeVisibleIndexRange(columns, columnVector.y, baseInstBBox.y1, baseInstBBox.y2, localVisibleBBox.y1, localVisibleBBox.y2);
            const rowRange = axisAlignedGridAxes.rowAxis === 'x'
              ? computeVisibleIndexRange(rows, rowVector.x, baseInstBBox.x1, baseInstBBox.x2, localVisibleBBox.x1, localVisibleBBox.x2)
              : computeVisibleIndexRange(rows, rowVector.y, baseInstBBox.y1, baseInstBBox.y2, localVisibleBBox.y1, localVisibleBBox.y2);
            if (!colRange || !rowRange) continue;
            [colStart, colEnd] = colRange;
            [rowStart, rowEnd] = rowRange;
          }

          if (simplifiedActive) {
            const visibleInstanceCount = (colEnd - colStart + 1) * (rowEnd - rowStart + 1);
            const arrayScreenPx = effectiveScale * Math.max(arrayBBox.x2 - arrayBBox.x1, arrayBBox.y2 - arrayBBox.y1);
            if (visibleInstanceCount > SIMPLIFIED_ARRAY_AGGREGATE_INSTANCES || arrayScreenPx < LOD_BBOX_PX || depth > 0) {
              lodSimplified += visibleInstanceCount;
              setStroke(darkBg ? LOD_BBOX_COLOR_DARK : LOD_BBOX_COLOR_LIGHT, darkBg ? 0.55 : 0.45);
              ctx.lineWidth = 1 / effectiveScale;
              ctx.strokeRect(arrayBBox.x1, arrayBBox.y1, arrayBBox.x2 - arrayBBox.x1, arrayBBox.y2 - arrayBBox.y1);
              continue;
            }
            setStroke(darkBg ? LOD_BBOX_COLOR_DARK : LOD_BBOX_COLOR_LIGHT, darkBg ? 0.55 : 0.45);
            ctx.lineWidth = 1 / effectiveScale;
            for (let row = rowStart; row <= rowEnd; row += 1) {
              for (let col = colStart; col <= colEnd; col += 1) {
                const dx = columnVector.x * col + rowVector.x * row;
                const dy = columnVector.y * col + rowVector.y * row;
                const instBBox = translateBBox(baseInstBBox, dx, dy);
                if (!axisAlignedGridAxes && !intersects(instBBox, localVisibleBBox)) continue;
                lodSimplified += 1;
                ctx.strokeRect(instBBox.x1, instBBox.y1, instBBox.x2 - instBBox.x1, instBBox.y2 - instBBox.y1);
              }
            }
            continue;
          }

          // Fast path: translation-only transform (angle=0, mag=1, no reflect).
          // Skip cos/sin computation and full matrix save; use a simple ctx.translate instead,
          // and compute the child-local bbox with a plain offset rather than inverseTransformBBox.
          const isSimpleTranslation =
            ref.transform.angle === 0 && ref.transform.mag === 1 && !ref.transform.reflect;

          for (let row = rowStart; row <= rowEnd; row += 1) {
            for (let col = colStart; col <= colEnd; col += 1) {
              const dx = columnVector.x * col + rowVector.x * row;
              const dy = columnVector.y * col + rowVector.y * row;
              const instBBox = translateBBox(baseInstBBox, dx, dy);
              if (!axisAlignedGridAxes && !intersects(instBBox, localVisibleBBox)) continue;

              // LOD: measure the instance's longest screen-space dimension to decide detail level.
              const instScreenPx = effectiveScale * Math.max(
                instBBox.x2 - instBBox.x1,
                instBBox.y2 - instBBox.y1,
              );
              if (instScreenPx < LOD_SKIP_PX) {
                // Instance is sub-pixel; skip entirely to avoid unnecessary work.
                lodCulled += 1;
                continue;
              }
              if (instScreenPx < LOD_BBOX_PX) {
                // Instance is very small; draw a simple bbox outline instead of recursing.
                lodSimplified += 1;
                setStroke(darkBg ? LOD_BBOX_COLOR_DARK : LOD_BBOX_COLOR_LIGHT, LOD_BBOX_ALPHA);
                ctx.lineWidth = 1 / effectiveScale;
                ctx.strokeRect(instBBox.x1, instBBox.y1, instBBox.x2 - instBBox.x1, instBBox.y2 - instBBox.y1);
                continue;
              }

              refsVisible += 1;
              const tx = ref.transform.x + dx;
              const ty = ref.transform.y + dy;

              if (isSimpleTranslation) {
                // Translation only: avoid trigonometry and full matrix push.
                ctx.save();
                ctx.translate(tx, ty);
                // Inverse of a pure translation is just subtracting the offset.
                const childLocalBBox: GDSBBox = {
                  x1: localVisibleBBox.x1 - tx,
                  y1: localVisibleBBox.y1 - ty,
                  x2: localVisibleBBox.x2 - tx,
                  y2: localVisibleBBox.y2 - ty,
                };
                drawCellRecursive(target, depth + 1, childLocalBBox, effectiveScale);
                ctx.restore();
                // After restore the canvas state reverts to its pre-save values,
                // so invalidate our tracking so the next shape forces a re-apply.
                resetCtxState();
              } else {
                const T: GDSTransform = { ...ref.transform, x: tx, y: ty };
                // Apply the GDS transform to the canvas so that cell-local coords map to world coords.
                const rad = (T.angle * Math.PI) / 180;
                const cosA = Math.cos(rad);
                const sinA = Math.sin(rad);
                const m = T.mag;
                ctx.save();
                ctx.transform(
                  cosA * m,
                  sinA * m,
                  T.reflect ? sinA * m : -sinA * m,
                  T.reflect ? -cosA * m : cosA * m,
                  tx,
                  ty,
                );
                // Compute the visible bbox in the target cell's local coordinate system for culling.
                const childLocalBBox = inverseTransformBBox(localVisibleBBox, T);
                // Accumulate magnification so path stroke widths are correct at this depth.
                drawCellRecursive(target, depth + 1, childLocalBBox, effectiveScale * m);
                ctx.restore();
                resetCtxState();
              }
            }
          }
        }
      };

      drawCellRecursive(selectedCell, 0, visibleBBox, absScale);
    }
    ctx.globalAlpha = 1;

    if (showRefs && !flattenRefs && selectedCell && !simplifiedActive) {
      ctx.save();
      ctx.lineWidth = 1 / absScale;
      ctx.strokeStyle = darkBg ? 'rgba(255,255,255,0.38)' : 'rgba(30,30,30,0.35)';
      for (const ref of selectedCell.references) {
        const target = gdsData.cellMap.get(ref.name);
        if (!target?.bbox) continue;
        const columns = ref.columns ?? 1;
        const rows = ref.rows ?? 1;
        const columnVector = ref.columnVector ?? { x: 0, y: 0 };
        const rowVector = ref.rowVector ?? { x: 0, y: 0 };
        const baseInstBBox = transformBBox(target.bbox, ref.transform);
        const arrayBBox = translatedArrayBBox(baseInstBBox, columnVector, rowVector, columns, rows);
        if (!intersects(arrayBBox, visibleBBox)) continue;

        let colStart = 0;
        let colEnd = columns - 1;
        let rowStart = 0;
        let rowEnd = rows - 1;
        const axisAlignedGridAxes = getAxisAlignedGridAxes(columnVector, rowVector);
        if (axisAlignedGridAxes) {
          const colRange = axisAlignedGridAxes.columnAxis === 'x'
            ? computeVisibleIndexRange(columns, columnVector.x, baseInstBBox.x1, baseInstBBox.x2, visibleBBox.x1, visibleBBox.x2)
            : computeVisibleIndexRange(columns, columnVector.y, baseInstBBox.y1, baseInstBBox.y2, visibleBBox.y1, visibleBBox.y2);
          const rowRange = axisAlignedGridAxes.rowAxis === 'x'
            ? computeVisibleIndexRange(rows, rowVector.x, baseInstBBox.x1, baseInstBBox.x2, visibleBBox.x1, visibleBBox.x2)
            : computeVisibleIndexRange(rows, rowVector.y, baseInstBBox.y1, baseInstBBox.y2, visibleBBox.y1, visibleBBox.y2);
          if (!colRange || !rowRange) continue;
          [colStart, colEnd] = colRange;
          [rowStart, rowEnd] = rowRange;
        }

        const visibleInstanceCount = (colEnd - colStart + 1) * (rowEnd - rowStart + 1);
        if (visibleInstanceCount > SIMPLIFIED_ARRAY_AGGREGATE_INSTANCES) {
          refsVisible += visibleInstanceCount;
          ctx.strokeRect(arrayBBox.x1, arrayBBox.y1, bboxWidth(arrayBBox), bboxHeight(arrayBBox));
          continue;
        }

        for (let row = rowStart; row <= rowEnd; row += 1) {
          for (let col = colStart; col <= colEnd; col += 1) {
            if (refsVisible >= MAX_REFERENCE_BOXES) { refsTruncated = true; break; }
            const dx = columnVector.x * col + rowVector.x * row;
            const dy = columnVector.y * col + rowVector.y * row;
            const instBBox = translateBBox(baseInstBBox, dx, dy);
            if (!axisAlignedGridAxes && !intersects(instBBox, visibleBBox)) continue;
            refsVisible += 1;
            ctx.strokeRect(instBBox.x1, instBBox.y1, bboxWidth(instBBox), bboxHeight(instBBox));
          }
          if (refsTruncated) break;
        }
        if (refsTruncated) break;
      }
      ctx.restore();
    }

    ctx.restore();

    // Throttle renderStats state update to ~100 ms to avoid excess re-renders on every frame.
    const newStats = {
      visible,
      culled,
      refsVisible,
      lodCulled,
      lodSimplified,
      drawMs: performance.now() - start,
      truncated: Boolean(flattened?.truncated),
      refsTruncated,
      depthLimitHit,
    };
    renderStatsLatestRef.current = newStats;
    if (!renderStatsTimerRef.current) {
      renderStatsTimerRef.current = setTimeout(() => {
        renderStatsTimerRef.current = null;
        setRenderStats(renderStatsLatestRef.current);
      }, THROTTLE_MS);
    }
  }, [absScale, canvasRef, containerSize.height, containerSize.width, darkBg, flattened, flattenRefs, gdsData.cellMap, pan.x, pan.y, renderLayers, selectedBBox, selectedCell, showRefs, simplifiedActive]);

  useEffect(() => {
    // Cancel any pending frame from the previous render so rapid state updates
    // (e.g. every mousemove during panning) only fire one draw per display frame.
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      draw();
    });
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [draw]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const rect = containerRef.current?.getBoundingClientRect();
    const sx = e.clientX - (rect?.left ?? 0);
    const sy = e.clientY - (rect?.top ?? 0);
    const before = screenToWorld(sx, sy);
    setZoom((prev) => {
      const next = Math.min(200, Math.max(0.02, prev * factor));
      const nextScale = baseScale * next;
      setPan({
        x: sx - (before.x - selectedBBox.x1) * nextScale,
        y: sy - (selectedBBox.y2 - before.y) * nextScale,
      });
      return next;
    });
  };

  const onMouseDown = (e: React.MouseEvent) => { startPan(e); };

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const pos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      cursorRef.current = pos;
      // Throttle the React state update to ~100 ms to avoid excess re-renders on every mousemove.
      if (!cursorTimerRef.current) {
        cursorTimerRef.current = setTimeout(() => {
          cursorTimerRef.current = null;
          setCursor(cursorRef.current);
        }, THROTTLE_MS);
      }
    }
    if (isPanning) updatePan(e.clientX, e.clientY);
  };

  const toggleLayer = (layer: number) => {
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  return (
    <div className="h-100 d-flex flex-column p-2">
      <Card className="mb-2">
        <Card.Body className="py-2">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <strong>GDS Layout</strong>
            <Badge bg="secondary">{filename}</Badge>
            <Badge bg="light" text="dark">lib {gdsData.libraryName || '-'}</Badge>
            <Badge bg="light" text="dark">{gdsData.cells.length} cells</Badge>
            <Badge bg="light" text="dark">{gdsData.stats.referenceCount} refs</Badge>
            <Badge bg="light" text="dark">{gdsData.stats.rectCount} rects</Badge>
            <Badge bg="light" text="dark">{gdsData.stats.polygonCount} polys</Badge>
            <Badge bg="light" text="dark">scale {absScale.toFixed(3)} px/um</Badge>
            <div className="ms-auto d-flex gap-1">
              <Button size="sm" variant="outline-secondary" onClick={() => setZoom((z) => Math.min(200, z * 1.2))}>+</Button>
              <Button size="sm" variant="outline-secondary" onClick={() => setZoom((z) => Math.max(0.02, z / 1.2))}>-</Button>
              <Button size="sm" variant="outline-secondary" onClick={fit}>Reset</Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      <Row className="flex-grow-1 g-2 row-fill">
        <Col md={3} lg={2} className="h-100">
          <Card className="h-100">
            <Card.Header className="py-2">Cells / Layers</Card.Header>
            <Card.Body className="p-2 overflow-auto">
              <Form.Label className="small">Top cell</Form.Label>
              <Form.Select size="sm" value={selectedCellName} onChange={(e) => setSelectedCellName(e.target.value)}>
                {gdsData.cells.map((cell) => (
                  <option key={cell.name} value={cell.name}>{cell.name}</option>
                ))}
              </Form.Select>
              <div className="small text-muted mt-2">
                bbox {bboxWidth(selectedBBox).toFixed(2)} x {bboxHeight(selectedBBox).toFixed(2)} um
              </div>
              <Form.Check
                className="mt-2"
                type="switch"
                id="gds-show-refs"
                label="Show cell refs"
                checked={showRefs}
                onChange={(e) => setShowRefs(e.target.checked)}
              />
              <Form.Check
                type="switch"
                id="gds-flatten-refs"
                label="Flatten refs"
                checked={flattenRefs}
                onChange={(e) => setFlattenRefs(e.target.checked)}
              />
              <Form.Check
                type="switch"
                id="gds-dark-bg"
                label="Dark background"
                checked={darkBg}
                onChange={(e) => setDarkBg(e.target.checked)}
              />
              <Form.Label className="small mt-2 mb-1">Detail mode</Form.Label>
              <Form.Select size="sm" value={detailMode} onChange={(e) => setDetailMode(e.target.value as DetailMode)}>
                <option value="auto">Auto simplify</option>
                <option value="simplified">Simplified</option>
                <option value="full">Full detail</option>
              </Form.Select>
              {simplifiedActive && (
                <div className="text-muted small mt-1">
                  Simplified: drawing limited layers and bbox outlines for smoother pan/zoom.
                </div>
              )}
              {!flattenRefs && estimatedFlattenCount > FLATTEN_WARN_SHAPES && (
                <div className="text-warning small mt-1">
                  Large cell: flatten may be slow (est. {estimatedFlattenCount >= MAX_FLATTENED_SHAPES + 1 ? `>${MAX_FLATTENED_SHAPES.toLocaleString()}` : estimatedFlattenCount.toLocaleString()} shapes).
                </div>
              )}
              {renderStats.truncated && (
                <div className="text-warning small mt-1">
                  Flattened view truncated at {MAX_FLATTENED_SHAPES.toLocaleString()} shapes.
                </div>
              )}
              {renderStats.refsTruncated && showRefs && !flattenRefs && (
                <div className="text-warning small mt-1">
                  Reference boxes truncated at {MAX_REFERENCE_BOXES.toLocaleString()} instances.
                </div>
              )}
              {renderStats.depthLimitHit && !flattenRefs && (
                <div className="text-warning small mt-1">
                  Hierarchy deeper than 32 levels; some geometry may not be shown. Enable &ldquo;Flatten refs&rdquo; to display fully.
                </div>
              )}
              <hr />
              <div className="d-flex gap-1 mb-2">
                <Button size="sm" variant="outline-secondary" onClick={() => setVisibleLayers(new Set(allLayers))}>All</Button>
                <Button size="sm" variant="outline-secondary" onClick={() => setVisibleLayers(new Set())}>None</Button>
              </div>
              {simplifiedActive && renderLayers.size < visibleLayers.size && (
                <div className="text-muted small mb-2">Rendering top {renderLayers.size} visible layers while simplified.</div>
              )}
              <ListGroup variant="flush" className="small">
                {allLayers.map((layer) => (
                  <ListGroup.Item key={layer} className="px-0 py-1 d-flex align-items-center gap-2">
                    <Form.Check checked={visibleLayers.has(layer)} onChange={() => toggleLayer(layer)} />
                    <span className="layer-swatch" style={{ background: layerColor(layer) }} />
                    <span>L{layer}</span>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Card.Body>
          </Card>
        </Col>
        <Col md={9} lg={10} className="h-100">
          <Card className="h-100">
            <Card.Body className="p-0 position-relative">
              <div
                ref={containerRef}
                style={{ cursor: isPanning ? 'grabbing' : 'grab', background: darkBg ? '#000' : '#fff' }}
                className="w-100 h-100 overflow-hidden"
                onWheel={handleWheel}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={endPan}
                onMouseLeave={() => {
                  endPan();
                  cursorRef.current = null;
                  setCursor(null);
                  if (cursorTimerRef.current) { clearTimeout(cursorTimerRef.current); cursorTimerRef.current = null; }
                }}
                onDoubleClick={fit}
              >
                <canvas ref={canvasRef} className="canvas-overlay-abs" />
                {(import.meta.env.DEV || cursor) && (
                  <div className={`position-absolute bottom-0 start-0 m-2 small border rounded px-2 py-1 ${darkBg ? 'text-light bg-dark' : 'bg-light'}`}>
                    {import.meta.env.DEV && <>visible {renderStats.visible.toLocaleString()} / refs {renderStats.refsVisible.toLocaleString()} / culled {renderStats.culled.toLocaleString()} / lod-skip {renderStats.lodCulled.toLocaleString()} / lod-bbox {renderStats.lodSimplified.toLocaleString()} / {renderStats.drawMs.toFixed(1)} ms</>}
                    {cursor && <>{import.meta.env.DEV && ' / '}x {cursor.x.toFixed(2)} um, y {cursor.y.toFixed(2)} um</>}
                  </div>
                )}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
};
