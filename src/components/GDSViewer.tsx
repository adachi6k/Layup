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

interface RefBox {
  name: string;
  bbox: GDSBBox;
}

const MAX_FLATTENED_SHAPES = 250_000;
const FLATTEN_WARN_SHAPES = 50_000;
const MAX_REFERENCE_BOXES = 75_000;
/** Maximum GDS hierarchy depth the hierarchy renderer will descend before stopping. */
const MAX_HIERARCHY_DEPTH = 32;
/** Throttle interval (ms) for React state updates driven by frequent events (mousemove, draw). */
const THROTTLE_MS = 100;

const layerColor = (layer: number): string => {
  const hues = [45, 95, 320, 205, 50, 25, 265, 185, 0, 150, 285, 15];
  const hue = hues[Math.abs(layer) % hues.length];
  const light = 48 + ((Math.abs(layer) * 7) % 18);
  return `hsl(${hue} 64% ${light}%)`;
};

const bboxWidth = (bbox: GDSBBox) => Math.max(1e-9, bbox.x2 - bbox.x1);
const bboxHeight = (bbox: GDSBBox) => Math.max(1e-9, bbox.y2 - bbox.y1);

const intersects = (a: GDSBBox, b: GDSBBox): boolean =>
  a.x2 >= b.x1 && a.x1 <= b.x2 && a.y2 >= b.y1 && a.y1 <= b.y2;

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

const collectReferenceBoxes = (cell: GDSCell, data: GDSData): { boxes: RefBox[]; truncated: boolean } => {
  const boxes: RefBox[] = [];
  let truncated = false;
  for (const ref of cell.references) {
    const target = data.cellMap.get(ref.name);
    if (!target?.bbox) continue;
    const columns = ref.columns ?? 1;
    const rows = ref.rows ?? 1;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        if (boxes.length >= MAX_REFERENCE_BOXES) {
          truncated = true;
          return { boxes, truncated };
        }
        const dx = (ref.columnVector?.x ?? 0) * col + (ref.rowVector?.x ?? 0) * row;
        const dy = (ref.columnVector?.y ?? 0) * col + (ref.rowVector?.y ?? 0) * row;
        boxes.push({
          name: ref.name,
          bbox: transformBBox(target.bbox, { ...ref.transform, x: ref.transform.x + dx, y: ref.transform.y + dy }),
        });
      }
    }
  }
  return { boxes, truncated };
};

export const GDSViewer: React.FC<GDSViewerProps> = ({ gdsData, filename }) => {
  const { containerRef, canvasRef, containerSize, zoom, setZoom, pan, setPan, isPanning, startPan, updatePan, endPan } = useCanvasViewport();
  const [selectedCellName, setSelectedCellName] = useState(gdsData.topCellName);
  const [visibleLayers, setVisibleLayers] = useState<Set<number>>(new Set());
  const [showRefs, setShowRefs] = useState(true);
  const [flattenRefs, setFlattenRefs] = useState(false);
  const [baseScale, setBaseScale] = useState(1);

  // Cursor: keep actual coords in a ref (updated every mousemove) and throttle the
  // React state update to ~100 ms so that frequent mouse moves don't trigger excessive re-renders.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RenderStats: throttled to avoid re-renders every animation frame.
  const renderStatsLatestRef = useRef({ visible: 0, culled: 0, refsVisible: 0, drawMs: 0, truncated: false, refsTruncated: false, depthLimitHit: false });
  const renderStatsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renderStats, setRenderStats] = useState({ visible: 0, culled: 0, refsVisible: 0, drawMs: 0, truncated: false, refsTruncated: false, depthLimitHit: false });

  // Clean up throttle timers on unmount.
  useEffect(() => () => {
    if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    if (renderStatsTimerRef.current) clearTimeout(renderStatsTimerRef.current);
  }, []);

  const selectedCell = gdsData.cellMap.get(selectedCellName) ?? gdsData.cellMap.get(gdsData.topCellName) ?? gdsData.cells[0];
  const selectedBBox = selectedCell?.bbox ?? gdsData.bbox;
  const absScale = baseScale * zoom;

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
  }, [containerSize.height, containerSize.width, selectedBBox]);

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

  const refBoxResult = useMemo(() => (selectedCell ? collectReferenceBoxes(selectedCell, gdsData) : { boxes: [], truncated: false }), [gdsData, selectedCell]);
  const refBoxes = refBoxResult.boxes;

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
    ctx.fillStyle = '#ffffff';
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
    ctx.strokeStyle = '#222';
    ctx.setLineDash([8 / absScale, 6 / absScale]);
    ctx.strokeRect(selectedBBox.x1, selectedBBox.y1, bboxWidth(selectedBBox), bboxHeight(selectedBBox));
    ctx.setLineDash([]);
    ctx.restore();

    let visible = 0;
    let culled = 0;
    let refsVisible = 0;
    let depthLimitHit = false;

    if (flattenRefs && flattened) {
      // Flatten mode: draw pre-flattened polygons and paths directly (all in world coords).
      for (const polygon of flattened.polygons) {
        if (!visibleLayers.has(polygon.layer)) continue;
        if (!intersects(polygon.bbox, visibleBBox)) { culled += 1; continue; }
        visible += 1;
        ctx.globalAlpha = 0.68;
        ctx.fillStyle = layerColor(polygon.layer);
        renderPolygon(ctx, polygon);
      }
      for (const path of flattened.paths) {
        if (!visibleLayers.has(path.layer)) continue;
        if (!intersects(path.bbox, visibleBBox)) { culled += 1; continue; }
        visible += 1;
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = layerColor(path.layer);
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
        ctx.globalAlpha = 0.68;
        for (const rect of cell.rects) {
          if (!visibleLayers.has(rect.layer)) continue;
          if (!intersects(rect, localVisibleBBox)) { culled += 1; continue; }
          visible += 1;
          ctx.fillStyle = layerColor(rect.layer);
          renderRect(ctx, rect);
        }

        // Draw polygons
        for (const polygon of cell.polygons) {
          if (!visibleLayers.has(polygon.layer)) continue;
          if (!intersects(polygon.bbox, localVisibleBBox)) { culled += 1; continue; }
          visible += 1;
          ctx.fillStyle = layerColor(polygon.layer);
          renderPolygon(ctx, polygon);
        }

        // Draw paths — use effectiveScale so the 1px minimum stroke is correct at this
        // depth even when the canvas has accumulated magnification from parent transforms.
        ctx.globalAlpha = 0.8;
        for (const path of cell.paths) {
          if (!visibleLayers.has(path.layer)) continue;
          if (!intersects(path.bbox, localVisibleBBox)) { culled += 1; continue; }
          visible += 1;
          ctx.strokeStyle = layerColor(path.layer);
          renderPath(ctx, path, effectiveScale);
        }

        // Recurse into references with cell-level bbox culling.
        for (const ref of cell.references) {
          const target = gdsData.cellMap.get(ref.name);
          if (!target?.bbox) continue;
          const columns = ref.columns ?? 1;
          const rows = ref.rows ?? 1;
          for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < columns; col += 1) {
              const dx = (ref.columnVector?.x ?? 0) * col + (ref.rowVector?.x ?? 0) * row;
              const dy = (ref.columnVector?.y ?? 0) * col + (ref.rowVector?.y ?? 0) * row;
              const T: GDSTransform = { ...ref.transform, x: ref.transform.x + dx, y: ref.transform.y + dy };
              // Cell-level bbox culling: skip if the instance's world bbox doesn't intersect viewport.
              const instBBox = transformBBox(target.bbox, T);
              if (!intersects(instBBox, localVisibleBBox)) continue;
              refsVisible += 1;
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
                T.x,
                T.y,
              );
              // Compute the visible bbox in the target cell's local coordinate system for culling.
              const childLocalBBox = inverseTransformBBox(localVisibleBBox, T);
              // Accumulate magnification so path stroke widths are correct at this depth.
              drawCellRecursive(target, depth + 1, childLocalBBox, effectiveScale * m);
              ctx.restore();
            }
          }
        }
      };

      drawCellRecursive(selectedCell, 0, visibleBBox, absScale);
    }
    ctx.globalAlpha = 1;

    if (showRefs && !flattenRefs) {
      ctx.save();
      ctx.lineWidth = 1 / absScale;
      ctx.strokeStyle = 'rgba(30,30,30,0.35)';
      refBoxes.forEach((ref) => {
        if (!intersects(ref.bbox, visibleBBox)) return;
        refsVisible += 1;
        ctx.strokeRect(ref.bbox.x1, ref.bbox.y1, bboxWidth(ref.bbox), bboxHeight(ref.bbox));
      });
      ctx.restore();
    }

    ctx.restore();

    // Throttle renderStats state update to ~100 ms to avoid excess re-renders on every frame.
    const newStats = {
      visible,
      culled,
      refsVisible,
      drawMs: performance.now() - start,
      truncated: Boolean(flattened?.truncated),
      refsTruncated: refBoxResult.truncated,
      depthLimitHit,
    };
    renderStatsLatestRef.current = newStats;
    if (!renderStatsTimerRef.current) {
      renderStatsTimerRef.current = setTimeout(() => {
        renderStatsTimerRef.current = null;
        setRenderStats(renderStatsLatestRef.current);
      }, THROTTLE_MS);
    }
  }, [absScale, canvasRef, containerSize.height, containerSize.width, flattened, flattenRefs, gdsData.cellMap, pan.x, pan.y, refBoxResult.truncated, refBoxes, selectedBBox, selectedCell, showRefs, visibleLayers]);

  useEffect(() => {
    draw();
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
                style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
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
                  <div className="position-absolute bottom-0 start-0 m-2 small bg-light border rounded px-2 py-1">
                    {import.meta.env.DEV && <>visible {renderStats.visible.toLocaleString()} / refs {renderStats.refsVisible.toLocaleString()} / culled {renderStats.culled.toLocaleString()} / {renderStats.drawMs.toFixed(1)} ms</>}
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
