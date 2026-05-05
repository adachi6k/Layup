import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

/** Snapshot taken at pan start (mousedown), used to compute delta on mousemove. */
export interface PanStart {
  x: number;
  y: number;
  origX: number;
  origY: number;
}

export interface CanvasViewport {
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  containerSize: { width: number; height: number };
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  pan: { x: number; y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  isPanning: boolean;
  setIsPanning: React.Dispatch<React.SetStateAction<boolean>>;
  panStartRef: React.MutableRefObject<PanStart | null>;
  /** Begin panning on left/middle mousedown. Captures current pan as origin. */
  startPan: (e: React.MouseEvent) => void;
  /** Compute and apply pan delta from a mousemove position. */
  updatePan: (clientX: number, clientY: number) => void;
  /** End panning and clear the start snapshot. */
  endPan: () => void;
}

/**
 * Shared canvas interaction state used by all layout viewers:
 * container size (via ResizeObserver), zoom/pan state, and panning helpers.
 */
export function useCanvasViewport(): CanvasViewport {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 100, height: 100 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<PanStart | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const startPan = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    panStartRef.current = { x: e.clientX, y: e.clientY, origX: pan.x, origY: pan.y };
    setIsPanning(true);
  }, [pan.x, pan.y]);

  const updatePan = useCallback((clientX: number, clientY: number) => {
    const start = panStartRef.current;
    if (!start) return;
    setPan({ x: start.origX + (clientX - start.x), y: start.origY + (clientY - start.y) });
  }, []);

  const endPan = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  return {
    containerRef,
    canvasRef,
    containerSize,
    zoom,
    setZoom,
    pan,
    setPan,
    isPanning,
    setIsPanning,
    panStartRef,
    startPan,
    updatePan,
    endPan,
  };
}

/**
 * Resize a canvas element to match its CSS container size, applying DPR correction.
 * Call once at the start of each draw pass before scaling the context.
 */
export function syncCanvasDpr(canvas: HTMLCanvasElement, cssW: number, cssH: number): void {
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(cssW * dpr);
  const targetH = Math.round(cssH * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }
}
