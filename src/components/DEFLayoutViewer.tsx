import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { DEFData } from '../types/def';
import type { LEFData } from '../types/lef';
import { useCanvasViewport, syncCanvasDpr } from '../hooks/useCanvasViewport';

interface DEFLayoutViewerProps { def: DEFData; lef: LEFData | null; }

interface DEFComponentDraw {
  name: string;
  macro: string;
  resolved: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  orient: string;
}

interface HighlightRule {
  id: string;
  label: string;
  pattern: string;
  color: string;
  enabled: boolean;
}

interface CompiledHighlightRule {
  ruleIndex: number;
  regex: RegExp;
}

const DEF_DETAIL_COMPONENT_LIMIT = 30_000;
const DEF_OVERVIEW_DOT_LIMIT = 18_000;
const DEF_OVERVIEW_MAX_SCALE = 2.5;
const DEF_OVERVIEW_DOT_PX = 1.4;
const DEF_OVERVIEW_HIGHLIGHT_DOT_LIMIT = 30_000;
const DEF_DETAIL_GAP_PX = 0.8;
const HIGHLIGHT_RULES_STORAGE_KEY = 'defHighlightRules';
const DEFAULT_HIGHLIGHT_RULES: HighlightRule[] = [
  { id: 'preset-ifu', label: 'IFU', pattern: 'ifu', color: '#ff4dd2', enabled: true },
  { id: 'preset-lsu', label: 'LSU', pattern: 'lsu', color: '#00d1ff', enabled: true },
  { id: 'preset-exu', label: 'EXU', pattern: 'exu', color: '#ffd400', enabled: true },
  { id: 'preset-mlu', label: 'MLU', pattern: 'mlu', color: '#7cff6b', enabled: true },
  { id: 'preset-dvu', label: 'DVU', pattern: 'dvu', color: '#ff8a3d', enabled: true },
  { id: 'preset-lm', label: 'LM', pattern: 'LM', color: '#b388ff', enabled: true },
];

const createHighlightRule = (label='New', pattern='', color='#ff4dd2'): HighlightRule => ({
  id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,
  label,
  pattern,
  color,
  enabled: true,
});

const isHighlightRule = (value: unknown): value is HighlightRule => {
  if(!value || typeof value !== 'object') return false;
  const rule = value as Record<string, unknown>;
  return typeof rule.id === 'string'
    && typeof rule.label === 'string'
    && typeof rule.pattern === 'string'
    && typeof rule.color === 'string'
    && typeof rule.enabled === 'boolean';
};

const loadHighlightRules = (): HighlightRule[] => {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(HIGHLIGHT_RULES_STORAGE_KEY) : null;
    if(!saved) return DEFAULT_HIGHLIGHT_RULES;
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) && parsed.every(isHighlightRule) ? parsed : DEFAULT_HIGHLIGHT_RULES;
  } catch {
    return DEFAULT_HIGHLIGHT_RULES;
  }
};

export const DEFLayoutViewer: React.FC<DEFLayoutViewerProps> = ({ def, lef }) => {
  const { containerRef, canvasRef, containerSize, zoom, setZoom, pan, setPan, isPanning, panStartRef, startPan, endPan } = useCanvasViewport();
  const [baseScale, setBaseScale] = useState(1);
  const panPreviewRafRef = useRef<number|null>(null);
  const panPreviewOffsetRef = useRef({ x: 0, y: 0 });
  const panPreviewRef = useRef<{x:number;y:number}|null>(null);
  const clearPreviewAfterDrawRef = useRef(false);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const cursorLatestRef = useRef<{x:number;y:number}|null>(null);
  const hoveredLatestRef = useRef<DEFComponentDraw|null>(null);
  const highlightMatchesRef = useRef<Int16Array>(new Int16Array());
  const highlightGridCellsRef = useRef<Uint32Array[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [showHighlightPanel, setShowHighlightPanel] = useState(false);
  const [highlightRules, setHighlightRules] = useState<HighlightRule[]>(loadHighlightRules);
  const [highlightCounts, setHighlightCounts] = useState<number[]>([]);
  const [highlightMatchVersion, setHighlightMatchVersion] = useState(0);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [placedComponentCount, setPlacedComponentCount] = useState(0);
  const [cursorUm, setCursorUm] = useState<{x:number;y:number}|null>(null);
  const [hoveredComponent, setHoveredComponent] = useState<DEFComponentDraw|null>(null);
  const [perf, setPerf] = useState<{total:number;visible:number;culled:number;drawMs:number}|null>(null);
  const LOD_GRID_MIN = 0.15;
  const CURSOR_THROTTLE_MS = 80;
  const { dieArea, units } = def;
  const dbuToUm = useCallback((v:number) => v / units, [units]);
  const dieWUm = Math.max(1, dbuToUm(dieArea.x2 - dieArea.x1));
  const dieHUm = Math.max(1, dbuToUm(dieArea.y2 - dieArea.y1));
  // 事前計算結果とグリッドインデックス
  const precomputedRef = useRef<DEFComponentDraw[]>([]);
  interface GridIndex { cellSize:number; cols:number; rows:number; cells:Uint32Array[]; originX:number; originY:number; }
  const gridRef = useRef<GridIndex|null>(null);

  const setCanvasPreviewOffset = useCallback((x:number, y:number)=>{
    const canvas = canvasRef.current;
    if(!canvas) return;
    canvas.style.transform = x===0 && y===0 ? '' : `translate3d(${x}px, ${y}px, 0)`;
    canvas.style.willChange = x===0 && y===0 ? '' : 'transform';
  },[canvasRef]);

  const resetCanvasPreview = useCallback(()=>{
    if(panPreviewRafRef.current!=null){
      cancelAnimationFrame(panPreviewRafRef.current);
      panPreviewRafRef.current=null;
    }
    panPreviewOffsetRef.current = { x:0, y:0 };
    panPreviewRef.current = null;
    setCanvasPreviewOffset(0,0);
  },[setCanvasPreviewOffset]);

  const scheduleCanvasPreview = useCallback((x:number, y:number)=>{
    panPreviewOffsetRef.current = { x, y };
    if(panPreviewRafRef.current!=null) return;
    panPreviewRafRef.current = requestAnimationFrame(()=>{
      panPreviewRafRef.current=null;
      const offset = panPreviewOffsetRef.current;
      setCanvasPreviewOffset(offset.x, offset.y);
    });
  },[setCanvasPreviewOffset]);

  useEffect(()=>()=>{ if(cursorTimerRef.current) clearTimeout(cursorTimerRef.current); resetCanvasPreview(); },[resetCanvasPreview]);

  const userInteractedRef = useRef(false);
  const initialFitDoneRef = useRef(false);
  const pendingFitRafRef = useRef<number| null>(null);
  const computeFit = useCallback(()=>{
    const P=0.05;
    const availW=containerSize.width*(1-P*2);
    const availH=containerSize.height*(1-P*2);
    const s=Math.min(availW/dieWUm, availH/dieHUm);
    setBaseScale(s);
    setZoom(1);
    const viewW=dieWUm*s; const viewH=dieHUm*s;
    setPan({ x:(containerSize.width-viewW)/2 - dbuToUm(dieArea.x1)*s, y:(containerSize.height-viewH)/2 - dbuToUm(dieArea.y1)*s });
  },[containerSize.width,containerSize.height,dieWUm,dieHUm,dieArea.x1,dieArea.y1,dbuToUm,setPan,setZoom]);
  // ResizeObserver is handled by useCanvasViewport; trigger auto-fit when containerSize changes
  useEffect(()=>{
    if(!initialFitDoneRef.current && !userInteractedRef.current){
      if(pendingFitRafRef.current!=null){ cancelAnimationFrame(pendingFitRafRef.current); }
      pendingFitRafRef.current = requestAnimationFrame(()=>{
        if(initialFitDoneRef.current || userInteractedRef.current) return;
        computeFit();
        initialFitDoneRef.current=true;
        pendingFitRafRef.current=null;
      });
    }
    return ()=>{ if(pendingFitRafRef.current!=null) cancelAnimationFrame(pendingFitRafRef.current); };
  },[containerSize, computeFit]);
  const absScale = baseScale * zoom;

  const compiledHighlightRules = useMemo(()=>{
    const compiled: CompiledHighlightRule[] = [];
    highlightRules.forEach((rule, ruleIndex)=>{
      if(!rule.enabled || !rule.pattern.trim()) return;
      try {
        compiled.push({ ruleIndex, regex: new RegExp(rule.pattern, 'i') });
      } catch {
        // Invalid rules are shown in the panel and skipped here.
      }
    });
    return compiled;
  },[highlightRules]);
  const highlightRuleErrors = useMemo(()=>highlightRules.map((rule)=>{
    if(!rule.pattern.trim()) return '';
    try { new RegExp(rule.pattern, 'i'); return ''; }
    catch(err) { return err instanceof Error ? err.message : 'Invalid regex'; }
  }),[highlightRules]);
  const totalHighlightedCount = highlightCounts.reduce((sum,count)=>sum+count,0);
  const getHighlightColor = useCallback((componentIndex:number): string|null => {
    if(componentIndex < 0 || componentIndex >= highlightMatchesRef.current.length) return null;
    const ruleIndex = highlightMatchesRef.current[componentIndex];
    return ruleIndex >= 0 ? highlightRules[ruleIndex]?.color ?? null : null;
  },[highlightRules]);

  useEffect(()=>{
    try {
      localStorage.setItem(HIGHLIGHT_RULES_STORAGE_KEY, JSON.stringify(highlightRules));
    } catch {
      // Ignore storage errors in restricted browser contexts.
    }
  },[highlightRules]);

  useEffect(()=>{
    const components = precomputedRef.current;
    const matches = new Int16Array(components.length);
    matches.fill(-1);
    const counts = Array.from({length: highlightRules.length}, ()=>0);
    for(let i=0; i<components.length; i++){
      const name = components[i].name;
      for(const rule of compiledHighlightRules){
        if(rule.regex.test(name)){
          matches[i] = rule.ruleIndex;
          counts[rule.ruleIndex] += 1;
          break;
        }
      }
    }
    highlightMatchesRef.current = matches;
    const grid = gridRef.current;
    if(grid && compiledHighlightRules.length>0){
      const emptyCell = new Uint32Array(0);
      highlightGridCellsRef.current = grid.cells.map((cell)=>{
        let highlighted: number[]|null = null;
        for(let i=0; i<cell.length; i++){
          const idx = cell[i];
          if(matches[idx] < 0) continue;
          if(highlighted==null) highlighted = [];
          highlighted.push(idx);
        }
        return highlighted ? new Uint32Array(highlighted) : emptyCell;
      });
    } else {
      highlightGridCellsRef.current = [];
    }
    setHighlightCounts(counts);
    setHighlightMatchVersion(version=>version+1);
  },[compiledHighlightRules, highlightRules.length, placedComponentCount]);

  const hitTestComponent = useCallback((x:number, y:number): DEFComponentDraw|null => {
    const grid = gridRef.current;
    const components = precomputedRef.current;
    if(!grid || components.length===0) return null;
    const gx = Math.floor((x-grid.originX)/grid.cellSize);
    const gy = Math.floor((y-grid.originY)/grid.cellSize);
    const tolerance = Math.max(6/absScale, 0.01);
    let best: DEFComponentDraw|null = null;
    let bestDistance = Infinity;
    let bestArea = Infinity;
    const seen = new Set<number>();
    for(let yy=Math.max(0,gy-1); yy<=Math.min(grid.rows-1,gy+1); yy++){
      for(let xx=Math.max(0,gx-1); xx<=Math.min(grid.cols-1,gx+1); xx++){
        const arr = grid.cells[yy*grid.cols+xx];
        for(let i=0; i<arr.length; i++){
          const idx = arr[i];
          if(seen.has(idx)) continue;
          seen.add(idx);
          const pc = components[idx];
          if(!pc) continue;
          const dx = pc.resolved ? (x < pc.x ? pc.x-x : x > pc.x+pc.w ? x-(pc.x+pc.w) : 0) : x-pc.x;
          const dy = pc.resolved ? (y < pc.y ? pc.y-y : y > pc.y+pc.h ? y-(pc.y+pc.h) : 0) : y-pc.y;
          const distance = Math.hypot(dx, dy);
          if(distance > tolerance) continue;
          const area = pc.resolved ? pc.w*pc.h : Number.POSITIVE_INFINITY;
          if(distance < bestDistance || (distance===bestDistance && area < bestArea)){
            best = pc;
            bestDistance = distance;
            bestArea = area;
          }
        }
      }
    }
    return best;
  },[absScale]);

  // オリエンテーション正規化 (GDS系表記→LEF/DEF正規表記)
  const normalizeOrient = (raw:string): string => {
    if(!raw) return 'N';
    const o = raw.toUpperCase();
    // 既に LEF/DEF 正規表現
    if(/^(N|S|E|W|FN|FS|FE|FW)$/.test(o)) return o;
    // GDS 互換表記マッピング
    switch(o){
      case 'R0': return 'N';
      case 'R90': return 'W'; // R90 は CCW 90 -> W
      case 'R180': return 'S';
      case 'R270': return 'E';
      case 'MX': return 'FS'; // X 反転 = 下上反転 = FS
      case 'MY': return 'FN'; // Y 反転 = 左右反転 = FN
      case 'MXR90': return 'FW';
      case 'MYR90': return 'FE';
      default: return 'N';
    }
  };

  // グリッド Path キャッシュ
  const gridCacheRef = useRef<{step:number; path:Path2D}|null>(null);
  const getGridPath = useCallback(()=>{ const targetCellPx=80; const cellUm=targetCellPx/absScale; if(cellUm<=0) return null; const stepRaw=cellUm; const mag=Math.pow(10,Math.floor(Math.log10(stepRaw))); const norm=stepRaw/mag; let gridStep=mag; if(norm>5) gridStep=10*mag; else if(norm>2) gridStep=5*mag; else if(norm>1) gridStep=2*mag; const cache=gridCacheRef.current; if(cache && cache.step===gridStep) return cache.path; // rebuild
    const startX=Math.floor(dbuToUm(dieArea.x1)/gridStep)*gridStep; const endX=dbuToUm(dieArea.x1)+dieWUm; const startY=Math.floor(dbuToUm(dieArea.y1)/gridStep)*gridStep; const endY=dbuToUm(dieArea.y1)+dieHUm; const p=new Path2D(); for(let x=startX;x<=endX;x+=gridStep){ p.moveTo(x,startY); p.lineTo(x,endY);} for(let y=startY;y<=endY;y+=gridStep){ p.moveTo(startX,y); p.lineTo(endX,y);} gridCacheRef.current={step:gridStep,path:p}; return p; },[absScale,dbuToUm,dieArea.x1,dieArea.y1,dieWUm,dieHUm]);

  const draw = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const cssW=containerSize.width; const cssH=containerSize.height;
    syncCanvasDpr(canvas, cssW, cssH);
    const dpr=window.devicePixelRatio||1;
    const start=performance.now();
    ctx.save();
    ctx.scale(dpr,dpr);
    ctx.clearRect(0,0,cssW,cssH);
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,cssW,cssH);
    ctx.translate(pan.x,pan.y);
    ctx.scale(absScale,absScale);

    ctx.save();
    ctx.lineWidth=2/absScale;
    ctx.strokeStyle='#d0d0d0';
    ctx.setLineDash([8/absScale,6/absScale]);
    ctx.strokeRect(dbuToUm(dieArea.x1),dbuToUm(dieArea.y1),dieWUm,dieHUm);
    ctx.setLineDash([]);
    ctx.restore();

    const fastPan = isPanning;
    if(!fastPan && absScale>=LOD_GRID_MIN){
      const gridPath = getGridPath();
      if(gridPath){
        ctx.save();
        ctx.lineWidth=1/absScale;
        ctx.strokeStyle='rgba(255,255,255,0.08)';
        ctx.stroke(gridPath);
        ctx.restore();
      }
    }

    const leftWorld = (-pan.x)/absScale, topWorld=(-pan.y)/absScale, rightWorld=(cssW-pan.x)/absScale, bottomWorld=(cssH-pan.y)/absScale;
    let visible=0, culled=0;
    const minDrawablePx = fastPan ? 0.9 : 0.35;
    const pathMap:Record<string,Path2D> = {};
    const highlightedPath:Record<string,Path2D> = {};
    const getPath=(color:string)=>{ return pathMap[color]||(pathMap[color]=new Path2D()); };
    const addComponent=(pc:DEFComponentDraw, componentIndex:number)=>{
      if(pc.x+pc.w < leftWorld || pc.x > rightWorld || pc.y+pc.h < topWorld || pc.y > bottomWorld){ culled++; return; }
      visible++;
      const highlightColor = getHighlightColor(componentIndex);
      const path = highlightColor ? highlightedPath[highlightColor] ?? (highlightedPath[highlightColor]=new Path2D()) : getPath(pc.color);
      if(!pc.resolved){
        const pointSize = 1.6/absScale;
        path.rect(pc.x-pointSize/2, pc.y-pointSize/2, pointSize, pointSize);
        return;
      }
      if(absScale*Math.max(pc.w,pc.h) < minDrawablePx){ culled++; return; }
      const gapX = Math.min(DEF_DETAIL_GAP_PX / absScale, pc.w * 0.22);
      const gapY = Math.min(DEF_DETAIL_GAP_PX / absScale, pc.h * 0.22);
      const drawW = Math.max(pc.w - gapX * 2, Math.min(pc.w, 1 / absScale));
      const drawH = Math.max(pc.h - gapY * 2, Math.min(pc.h, 1 / absScale));
      path.rect(pc.x + (pc.w-drawW)/2, pc.y + (pc.h-drawH)/2, drawW, drawH);
    };
    const grid = gridRef.current;
    if(grid){
      const gx0 = Math.max(0, Math.floor((leftWorld - grid.originX)/grid.cellSize));
      const gy0 = Math.max(0, Math.floor((topWorld - grid.originY)/grid.cellSize));
      const gx1 = Math.min(grid.cols-1, Math.floor((rightWorld - grid.originX)/grid.cellSize));
      const gy1 = Math.min(grid.rows-1, Math.floor((bottomWorld - grid.originY)/grid.cellSize));
      let visibleComponentCount = 0;
      let visibleCountComplete = true;
      const seenVisible = new Set<number>();
      countVisible: for(let gy=gy0; gy<=gy1; gy++){
        for(let gx=gx0; gx<=gx1; gx++){
          const arr = grid.cells[gy*grid.cols+gx];
          for(let i=0; i<arr.length; i++){
            const idx = arr[i];
            if(seenVisible.has(idx)) continue;
            seenVisible.add(idx);
            const pc = precomputedRef.current[idx];
            if(!pc || pc.x+pc.w < leftWorld || pc.x > rightWorld || pc.y+pc.h < topWorld || pc.y > bottomWorld) continue;
            visibleComponentCount++;
            if(visibleComponentCount > DEF_DETAIL_COMPONENT_LIMIT){
              visibleCountComplete = false;
              break countVisible;
            }
          }
        }
      }
      const useOverview = !visibleCountComplete || absScale < DEF_OVERVIEW_MAX_SCALE;

      if(useOverview){
        const dotPaths:Record<string,Path2D> = {};
        const highlightedDotPaths:Record<string,Path2D> = {};
        const getDotPath=(color:string)=>{ return dotPaths[color]||(dotPaths[color]=new Path2D()); };
        const occupiedCellsPath = new Path2D();
        let nonEmptyCells = 0;
        let highlightedNonEmptyCells = 0;
        const highlightCells = highlightGridCellsRef.current;
        const hasHighlightCells = highlightCells.length === grid.cells.length;
        for(let gy=gy0; gy<=gy1; gy++){
          for(let gx=gx0; gx<=gx1; gx++){
            const cellIndex = gy*grid.cols+gx;
            const count = grid.cells[cellIndex].length;
            if(count===0) continue;
            nonEmptyCells++;
            if(hasHighlightCells && highlightCells[cellIndex].length>0) highlightedNonEmptyCells++;
          }
        }
        const dotsPerCell = Math.max(1, Math.floor(DEF_OVERVIEW_DOT_LIMIT / Math.max(1, nonEmptyCells)));
        const highlightDotsPerCell = Math.max(1, Math.floor(DEF_OVERVIEW_HIGHLIGHT_DOT_LIMIT / Math.max(1, highlightedNonEmptyCells)));
        const dotSize = DEF_OVERVIEW_DOT_PX / absScale;
        const halfDot = dotSize/2;
        const highlightDotSize = (DEF_OVERVIEW_DOT_PX*2.2) / absScale;
        const halfHighlightDot = highlightDotSize/2;
        let dotsDrawn = 0;
        let highlightDotsDrawn = 0;
        for(let gy=gy0; gy<=gy1; gy++){
          for(let gx=gx0; gx<=gx1; gx++){
            const cellIndex = gy*grid.cols+gx;
            const arr = grid.cells[cellIndex];
            if(arr.length===0) continue;
            const cellX = grid.originX + gx*grid.cellSize;
            const cellY = grid.originY + gy*grid.cellSize;
            occupiedCellsPath.rect(cellX, cellY, grid.cellSize, grid.cellSize);
            const step = Math.max(1, Math.ceil(arr.length / dotsPerCell));
            const highlightArr = hasHighlightCells ? highlightCells[cellIndex] : undefined;
            const highlightStep = highlightArr ? Math.max(1, Math.ceil(highlightArr.length / highlightDotsPerCell)) : 1;
            for(let i=0; highlightArr && i<highlightArr.length && highlightDotsDrawn<DEF_OVERVIEW_HIGHLIGHT_DOT_LIMIT; i+=highlightStep){
              const idx = highlightArr[i];
              const pc = precomputedRef.current[idx];
              if(!pc) continue;
              const highlightColor = getHighlightColor(idx);
              if(!highlightColor) continue;
              const path = highlightedDotPaths[highlightColor] ?? (highlightedDotPaths[highlightColor]=new Path2D());
              const cx = pc.resolved ? pc.x + pc.w/2 : pc.x;
              const cy = pc.resolved ? pc.y + pc.h/2 : pc.y;
              path.rect(cx - halfHighlightDot, cy - halfHighlightDot, highlightDotSize, highlightDotSize);
              highlightDotsDrawn++;
            }
            for(let i=0; i<arr.length && dotsDrawn<DEF_OVERVIEW_DOT_LIMIT; i+=step){
              const pc = precomputedRef.current[arr[i]];
              if(!pc) continue;
              const path = getDotPath(pc.color);
              const cx = pc.resolved ? pc.x + pc.w/2 : pc.x;
              const cy = pc.resolved ? pc.y + pc.h/2 : pc.y;
              path.rect(cx - halfDot, cy - halfDot, dotSize, dotSize);
              dotsDrawn++;
            }
          }
        }
        ctx.save();
        ctx.lineWidth = 1/absScale;
        ctx.strokeStyle = 'rgba(80, 210, 255, 0.14)';
        ctx.stroke(occupiedCellsPath);
        Object.entries(dotPaths).forEach(([color,path])=>{
          ctx.fillStyle = color;
          ctx.fill(path);
        });
        Object.entries(highlightedDotPaths).forEach(([color,path])=>{
          ctx.fillStyle = color;
          ctx.fill(path);
        });
        ctx.restore();
        visible = visibleComponentCount;
        culled = Math.max(0, precomputedRef.current.length - visibleComponentCount);
        if(import.meta.env.DEV) {
          ctx.save();
          ctx.setTransform(dpr,0,0,dpr,0,0);
          ctx.fillStyle='rgba(0,0,0,0.55)';
          ctx.fillRect(6,6,224,20);
          ctx.fillStyle='rgba(255,255,255,0.85)';
          ctx.font='11px system-ui, sans-serif';
          ctx.fillText(`overview dots: ${dotsDrawn.toLocaleString()} / ${visibleComponentCount.toLocaleString()}${visibleCountComplete ? '' : '+'}`,12,20);
          ctx.restore();
        }
      } else {
        const seen = new Set<number>();
        for(let gy=gy0; gy<=gy1; gy++){
          for(let gx=gx0; gx<=gx1; gx++){
            const arr = grid.cells[gy*grid.cols+gx];
            for(let i=0;i<arr.length;i++){
              const idx = arr[i];
              if(seen.has(idx)) continue;
              seen.add(idx);
              const pc = precomputedRef.current[idx];
              if(pc) addComponent(pc, idx);
            }
          }
        }
      }
    } else {
      precomputedRef.current.forEach(addComponent);
    }

    ctx.save();
    ctx.lineWidth=Math.max(1.2/absScale, 0.04);
    Object.entries(pathMap).forEach(([color,p])=>{
      ctx.strokeStyle=color;
      ctx.stroke(p);
    });
    ctx.lineWidth=Math.max(2.4/absScale, 0.08);
    Object.entries(highlightedPath).forEach(([color,path])=>{
      ctx.strokeStyle=color;
      ctx.stroke(path);
    });
    if(hoveredComponent){
      ctx.save();
      ctx.lineWidth=Math.max(3/absScale, 0.08);
      ctx.strokeStyle='#ffd400';
      ctx.shadowColor='rgba(255,212,0,0.75)';
      ctx.shadowBlur=6/absScale;
      if(hoveredComponent.resolved){
        const gapX = Math.min(DEF_DETAIL_GAP_PX / absScale, hoveredComponent.w * 0.22);
        const gapY = Math.min(DEF_DETAIL_GAP_PX / absScale, hoveredComponent.h * 0.22);
        const drawW = Math.max(hoveredComponent.w - gapX * 2, Math.min(hoveredComponent.w, 1 / absScale));
        const drawH = Math.max(hoveredComponent.h - gapY * 2, Math.min(hoveredComponent.h, 1 / absScale));
        ctx.strokeRect(hoveredComponent.x + (hoveredComponent.w-drawW)/2, hoveredComponent.y + (hoveredComponent.h-drawH)/2, drawW, drawH);
      } else {
        ctx.beginPath();
        ctx.arc(hoveredComponent.x, hoveredComponent.y, 7/absScale, 0, Math.PI*2);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
    // PINS (Phase A): 低ズームでは省略、一定ズーム以上で描画
    const PIN_MIN_SCALE = 0.6; // px/um しきい値
    if(absScale >= PIN_MIN_SCALE && def.pins && def.pins.length){
      ctx.save();
      const pinSizeUm = 1.2; // 正方形サイズ (um)
      const half = pinSizeUm/2;
      ctx.lineWidth = 1/absScale;
      const fill = new Path2D();
      for(const p of def.pins){ if(!p.placed) continue; const xUm=dbuToUm(p.x); const yUm=dbuToUm(p.y); fill.rect(xUm-half, yUm-half, pinSizeUm, pinSizeUm); }
      ctx.fillStyle='rgba(200,0,0,0.85)'; ctx.strokeStyle='rgba(120,0,0,0.9)'; ctx.fill(fill); ctx.stroke(fill);
      ctx.restore();
    }
    if(clearPreviewAfterDrawRef.current){
      clearPreviewAfterDrawRef.current=false;
      resetCanvasPreview();
    }
    const end=performance.now();
    if(import.meta.env.DEV) setPerf({ total: precomputedRef.current.length, visible, culled, drawMs: end-start });
  },[absScale, canvasRef, containerSize.height, containerSize.width, dbuToUm, def.pins, dieArea.x1, dieArea.y1, dieHUm, dieWUm, getHighlightColor, getGridPath, hoveredComponent, isPanning, pan.x, pan.y, resetCanvasPreview]);

  // Stable ref to the latest draw function so the precompute effect can
  // schedule a redraw without adding draw (and all its deps) to its own dep array.
  const drawRef = useRef(draw);
  useEffect(()=>{ drawRef.current = draw; });

  // マクロ解決をメモ化 (描画毎に Map を構築しない)
  const resolveMacroRef = useRef<((name:string)=>{w:number;h:number;raw:string}|undefined)>(undefined);
  useEffect(()=>{
    const macroMap=new Map<string,{w:number;h:number;raw:string}>();
    const macroMapLower=new Map<string,{w:number;h:number;raw:string}>();
    const macroMapNoUnderscore=new Map<string,{w:number;h:number;raw:string}>();
    if(lef){
      for(const m of lef.macros){
        macroMap.set(m.name,{w:m.size.width,h:m.size.height,raw:m.name});
        macroMapLower.set(m.name.toLowerCase(),{w:m.size.width,h:m.size.height,raw:m.name});
        macroMapNoUnderscore.set(m.name.replace(/_/g,'').toLowerCase(),{w:m.size.width,h:m.size.height,raw:m.name});
      }
    }
    const resolve=(name:string)=>{
      const original=name;
      const trimmed=name.replace(/;$/,'');
      return macroMap.get(trimmed)||macroMap.get(original)||macroMapLower.get(trimmed.toLowerCase())||macroMapLower.get(original.toLowerCase())||macroMapNoUnderscore.get(trimmed.replace(/_/g,'').toLowerCase())||undefined;
    };
    resolveMacroRef.current=resolve;
    const colorMap:Record<string,string>={ N:'rgba(0,123,255,0.85)', S:'rgba(0,92,191,0.85)', E:'rgba(40,167,69,0.85)', W:'rgba(32,140,58,0.85)', FN:'rgba(255,193,7,0.85)', FS:'rgba(255,159,64,0.85)', FE:'rgba(111,66,193,0.85)', FW:'rgba(102,16,242,0.85)' };
    const pre: DEFComponentDraw[] = [];
    let unresolved=0;
    for(const c of def.components){
      if(!c.placed) continue;
      const dim=resolve(c.macro);
      const resolved = Boolean(dim);
      if(!resolved) unresolved++;
      const orient=normalizeOrient(c.orient||'N');
      let w=dim?dim.w:0;
      let h=dim?dim.h:0;
      const swapped=/^(E|W|FE|FW)$/.test(orient);
      if(dim && swapped){ w=dim.h; h=dim.w; }
      pre.push({ name:c.name, macro:c.macro, resolved, x:dbuToUm(c.x), y:dbuToUm(c.y), w, h, color: colorMap[orient]||'rgba(0,123,255,0.85)', orient });
    }
    precomputedRef.current=pre;
    highlightGridCellsRef.current = [];
    setPlacedComponentCount(pre.length);
    setUnresolvedCount(unresolved);

    const originX = dbuToUm(dieArea.x1);
    const originY = dbuToUm(dieArea.y1);
    const targetCellsDim = 140;
    let cellSize = Math.max(1, Math.min(dieWUm,dieHUm)/targetCellsDim);
    if(pre.length>0){
      const sampleN=Math.min(pre.length,800);
      let acc=0;
      for(let i=0;i<sampleN;i++){ const p=pre[i]; acc += (p.w+p.h)/2; }
      const avgComp=(acc/sampleN)||1;
      cellSize = Math.max(cellSize, avgComp*2);
    }
    const cols = Math.max(1, Math.ceil(dieWUm / cellSize));
    const rows = Math.max(1, Math.ceil(dieHUm / cellSize));
    const temp: number[][] = Array.from({length: cols*rows}, ()=>[]);
    pre.forEach((p,idx)=>{
      const gx0=Math.min(cols-1,Math.max(0,Math.floor((p.x-originX)/cellSize)));
      const gy0=Math.min(rows-1,Math.max(0,Math.floor((p.y-originY)/cellSize)));
      const gx1=Math.min(cols-1,Math.max(0,Math.floor((p.x+p.w-originX)/cellSize)));
      const gy1=Math.min(rows-1,Math.max(0,Math.floor((p.y+p.h-originY)/cellSize)));
      for(let gy=gy0; gy<=gy1; gy++){
        for(let gx=gx0; gx<=gx1; gx++){
          temp[gy*cols+gx].push(idx);
        }
      }
    });
    const cells = temp.map(a=>new Uint32Array(a));
    gridRef.current = { cellSize, cols, rows, cells, originX, originY };
    // Schedule a redraw so the canvas reflects the new LEF data immediately
    // without waiting for the next pan/zoom/resize interaction.
    requestAnimationFrame(()=>{ drawRef.current(); });
  },[lef,def.components,dbuToUm,dieArea.x1,dieArea.y1,dieWUm,dieHUm]);

  // rAF draw throttling
  const drawRequestedRef = useRef(false);
  const requestDraw = useCallback(()=>{ if(drawRequestedRef.current) return; drawRequestedRef.current=true; requestAnimationFrame(()=>{ drawRequestedRef.current=false; draw(); }); },[draw]);
  useEffect(()=>{ void highlightMatchVersion; requestDraw(); },[requestDraw,containerSize.width,containerSize.height,pan.x,pan.y,absScale,def.components,def.pins,highlightMatchVersion]);

  const handleWheel=(e:React.WheelEvent)=>{ e.preventDefault();
  if(pendingFitRafRef.current!=null){ cancelAnimationFrame(pendingFitRafRef.current); pendingFitRafRef.current=null; }
  userInteractedRef.current = true;
    const up = e.deltaY < 0;
    const factorBase = e.ctrlKey ? 1.2 : 1.1;
    const factor = up ? factorBase : 1 / factorBase;
    setZoom(prev=>{ const nz=Math.min(120,Math.max(0.02,prev*factor)); if(nz===prev) return prev; const rect=containerRef.current?.getBoundingClientRect(); if(rect){ const cx=(e.clientX-rect.left-pan.x)/(baseScale*prev); const cy=(e.clientY-rect.top-pan.y)/(baseScale*prev); setPan({ x:e.clientX-rect.left-cx*baseScale*nz, y:e.clientY-rect.top-cy*baseScale*nz }); } return nz; }); };
  const onMouseDown=(e:React.MouseEvent)=>{
    if(e.button!==0 && e.button!==1) return;
    e.preventDefault();
    if(pendingFitRafRef.current!=null){ cancelAnimationFrame(pendingFitRafRef.current); pendingFitRafRef.current=null; }
    userInteractedRef.current = true;
    resetCanvasPreview();
    startPan(e);
  };
  const onMouseMove=(e:React.MouseEvent)=>{
    let viewportPan = panPreviewRef.current ?? pan;
    if(isPanning && panStartRef.current){
      const start = panStartRef.current;
      const next = { x:start.origX+(e.clientX-start.x), y:start.origY+(e.clientY-start.y) };
      panPreviewRef.current = next;
      viewportPan = next;
      scheduleCanvasPreview(next.x-start.origX, next.y-start.origY);
    }

    const rect=containerRef.current?.getBoundingClientRect();
    if(rect){
      const xUm=(e.clientX-rect.left-viewportPan.x)/absScale;
      const yUm=(e.clientY-rect.top-viewportPan.y)/absScale;
      cursorLatestRef.current = { x:xUm, y:yUm };
      hoveredLatestRef.current = hitTestComponent(xUm, yUm);
      if(cursorTimerRef.current==null){
        cursorTimerRef.current = setTimeout(()=>{
          cursorTimerRef.current=null;
          setCursorUm(cursorLatestRef.current);
          setHoveredComponent(prev=>{
            const next = hoveredLatestRef.current;
            return prev?.name===next?.name ? prev : next;
          });
        }, CURSOR_THROTTLE_MS);
      }
    }
  };
  const commitPanPreview=()=>{
    const next = panPreviewRef.current;
    if(next){
      clearPreviewAfterDrawRef.current=true;
      setPan(next);
    } else {
      resetCanvasPreview();
    }
    endPan();
  };
  const onMouseLeave=()=>{
    commitPanPreview();
    cursorLatestRef.current=null;
    hoveredLatestRef.current=null;
    setCursorUm(null);
    setHoveredComponent(null);
    if(cursorTimerRef.current){ clearTimeout(cursorTimerRef.current); cursorTimerRef.current=null; }
  };
  const onDoubleClick=()=>{ computeFit(); };
  const zoomIn=()=>setZoom(z=>Math.min(80,z*1.2));
  const zoomOut=()=>setZoom(z=>Math.max(0.05,z/1.2));
  const resetView=()=>{ // ユーザー明示操作なので初期フィット扱いを再設定
    if(pendingFitRafRef.current!=null){ cancelAnimationFrame(pendingFitRafRef.current); pendingFitRafRef.current=null; }
    userInteractedRef.current=false; // リセット後に再度フィット → 直後のリサイズで再フィットさせたい場合は false のまま
    initialFitDoneRef.current=true; // 再度自動初期フィットを走らせる必要はない
    computeFit();
  };
  const updateHighlightRule = (id:string, patch:Partial<Omit<HighlightRule,'id'>>) => {
    setHighlightRules(rules=>rules.map(rule=>rule.id===id ? {...rule, ...patch} : rule));
  };
  const addHighlightRule = () => {
    setHighlightRules(rules=>[...rules, createHighlightRule()]);
    setShowHighlightPanel(true);
  };
  const removeHighlightRule = (id:string) => {
    setHighlightRules(rules=>rules.filter(rule=>rule.id!==id));
  };
  const resetHighlightRules = () => {
    setHighlightRules(DEFAULT_HIGHLIGHT_RULES);
  };
  const stopHighlightPanelMouse = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  const stopHighlightPanelWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  // Debug用テーブルデータ (DEV時 & showDebug時のみ計算)
  const debugRows = useMemo(()=>{
    if(!showDebug) return [] as {name:string;macro:string;resolved?:string;orient:string;macroW:number;macroH:number;drawW:number;drawH:number;swapped:boolean;found:boolean}[];
    const macroMap=new Map<string,{w:number;h:number;raw:string}>();
    const macroMapLower=new Map<string,{w:number;h:number;raw:string}>();
    const macroMapNoUnderscore=new Map<string,{w:number;h:number;raw:string}>();
    if(lef){ for(const m of lef.macros){ macroMap.set(m.name,{w:m.size.width,h:m.size.height,raw:m.name}); macroMapLower.set(m.name.toLowerCase(),{w:m.size.width,h:m.size.height,raw:m.name}); macroMapNoUnderscore.set(m.name.replace(/_/g,'').toLowerCase(),{w:m.size.width,h:m.size.height,raw:m.name}); } }
    const resolve=(macro:string)=>{ const trimmed=macro.replace(/;$/,''); return macroMap.get(trimmed)||macroMap.get(macro)||macroMapLower.get(trimmed.toLowerCase())||macroMapLower.get(macro.toLowerCase())||macroMapNoUnderscore.get(trimmed.replace(/_/g,'').toLowerCase())||null; };
    const PLACEHOLDER=2;
  return def.components.slice(0,200).map(c=>{ const dim=resolve(c.macro); const raw=(c.orient||'N'); const orient=normalizeOrient(raw); if(!dim) return {name:c.name,macro:c.macro,orient:raw,macroW:0,macroH:0,drawW:PLACEHOLDER,drawH:PLACEHOLDER,swapped:false,found:false}; let w=dim.w,h=dim.h; const swapped=/^(E|W|FE|FW)$/.test(orient); if(swapped){ w=dim.h; h=dim.w; } return {name:c.name,macro:c.macro,resolved:dim.raw,orient,macroW:dim.w,macroH:dim.h,drawW:w,drawH:h,swapped,found:true}; });
  },[def.components,lef,showDebug]);

  return <div className="def-viewer-root">
    <div className="def-toolbar">
      <strong className="me-2">DEF Layout</strong>
      <button className="btn btn-sm btn-outline-secondary" onClick={zoomIn}>+</button>
      <button className="btn btn-sm btn-outline-secondary" onClick={zoomOut}>-</button>
      <button className="btn btn-sm btn-outline-secondary" onClick={resetView}>Reset</button>
      {import.meta.env.DEV && <button className="btn btn-sm btn-outline-secondary" onClick={()=>setShowDebug(s=>!s)}>{showDebug?'Hide Debug':'Show Debug'}</button>}
      <span className="badge bg-light text-dark">Scale {absScale.toFixed(3)} px/µm</span>
      <span className="badge bg-light text-dark">Zoom {zoom.toFixed(2)}</span>
      <button className="btn btn-sm btn-outline-secondary" onClick={()=>setShowHighlightPanel(v=>!v)}>Highlights</button>
      <span className="badge bg-info text-dark">{totalHighlightedCount.toLocaleString()} highlighted</span>
      {highlightRuleErrors.some(Boolean) && <span className="badge bg-danger">invalid highlight regex</span>}
      {unresolvedCount > 0 && <span className="badge bg-warning text-dark" title="Some component macros could not be resolved against the loaded LEF. Load the matching LEF file to fix.">⚠ {unresolvedCount} unresolved</span>}
    </div>
    <div ref={containerRef} className="def-canvas-container"
         style={{cursor:isPanning?'grabbing':'grab', background:'#000'}}
         onWheel={handleWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} onMouseUp={commitPanPreview} onDoubleClick={onDoubleClick}>
      <canvas ref={canvasRef} className="canvas-overlay-abs" />
      {showHighlightPanel && (
        <div
          className="def-highlight-panel"
          onMouseDown={stopHighlightPanelMouse}
          onMouseMove={stopHighlightPanelMouse}
          onMouseUp={stopHighlightPanelMouse}
          onDoubleClick={stopHighlightPanelMouse}
          onWheel={stopHighlightPanelWheel}
        >
          <div className="def-highlight-panel-header">
            <strong>Highlight Rules</strong>
            <div className="d-flex gap-1">
              <button className="btn btn-sm btn-outline-secondary" onClick={addHighlightRule}>Add</button>
              <button className="btn btn-sm btn-outline-secondary" onClick={resetHighlightRules}>Reset</button>
              <button className="btn btn-sm btn-outline-secondary" onClick={()=>setShowHighlightPanel(false)}>Close</button>
            </div>
          </div>
          <div className="def-highlight-rules">
            {highlightRules.map((rule,index)=>(
              <div key={rule.id} className={`def-highlight-rule ${highlightRuleErrors[index] ? 'has-error' : ''}`}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e)=>updateHighlightRule(rule.id,{enabled:e.target.checked})}
                  aria-label={`Enable ${rule.label} highlight`}
                />
                <input
                  type="color"
                  value={rule.color}
                  onChange={(e)=>updateHighlightRule(rule.id,{color:e.target.value})}
                  aria-label={`${rule.label} highlight color`}
                />
                <input
                  className="def-highlight-label-input"
                  value={rule.label}
                  onChange={(e)=>updateHighlightRule(rule.id,{label:e.target.value})}
                  aria-label="Highlight label"
                />
                <input
                  className="def-highlight-regex-input"
                  value={rule.pattern}
                  onChange={(e)=>updateHighlightRule(rule.id,{pattern:e.target.value})}
                  placeholder="component name regex"
                  spellCheck={false}
                  aria-label={`${rule.label} regex`}
                />
                <span className="def-highlight-count">{(highlightCounts[index] ?? 0).toLocaleString()}</span>
                <button className="btn btn-sm btn-outline-danger" onClick={()=>removeHighlightRule(rule.id)}>Delete</button>
                {highlightRuleErrors[index] && <div className="def-highlight-error">{highlightRuleErrors[index]}</div>}
              </div>
            ))}
          </div>
          <div className="def-highlight-help">
            Rules match DEF component instance names. First enabled match wins when multiple rules match.
          </div>
        </div>
      )}
      {placedComponentCount===0 && (
        <div className="canvas-empty-msg">
          No placed components parsed (check COMPONENTS / + PLACED lines)
        </div>
      )}
      {cursorUm && (
        <div className="canvas-cursor-hud">
          <span>{cursorUm.x.toFixed(2)}, {cursorUm.y.toFixed(2)} µm</span>
          <span style={{opacity:0.75}}>scale {absScale.toFixed(2)} px/µm</span>
        </div>
      )}
      {hoveredComponent && (
        <div className="canvas-hover-hud">
          <strong>{hoveredComponent.name}</strong>
          <span>{hoveredComponent.macro}</span>
          <span>
            {hoveredComponent.resolved
              ? `${hoveredComponent.orient} / ${hoveredComponent.w.toFixed(2)}×${hoveredComponent.h.toFixed(2)} µm`
              : `${hoveredComponent.orient} / macro size unresolved`}
          </span>
        </div>
      )}
      {import.meta.env.DEV && perf && (
        <div className="canvas-perf-hud">
          <div>draw {perf.drawMs.toFixed(1)} ms</div>
          <div>vis {perf.visible}/{perf.total} (culled {perf.culled})</div>
        </div>
      )}
      {import.meta.env.DEV && showDebug && debugRows.length>0 && (
        <div className="def-debug-panel">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <strong>Components (preview)</strong>
            <span className="small text-muted">first {debugRows.length}</span>
          </div>
          <div className="mb-1" style={{fontSize:10}}>
            <span className="badge bg-primary me-1">resolved {debugRows.filter(r=>r.found).length}</span>
            <span className="badge bg-danger">unresolved {debugRows.filter(r=>!r.found).length}</span>
          </div>
          <table className="table table-sm table-bordered mb-0" style={{fontSize:10}}>
            <thead className="table-light" style={{position:'sticky',top:0}}>
              <tr>
                <th>Name</th><th>Macro</th><th>Resolved</th><th>Orient</th><th>Macro W×H</th><th>Draw W×H</th><th>Swap</th>
              </tr>
            </thead>
            <tbody>
              {debugRows.map((r)=> (
                <tr key={r.name} className={`${r.swapped?'table-warning':''} ${!r.found?'table-danger':''}`}>
                  <td>{r.name}</td>
                  <td>{r.macro}</td>
                  <td>{r.resolved||''}</td>
                  <td>{r.orient}</td>
                  <td>{r.macroW}×{r.macroH}</td>
                  <td>{r.drawW}×{r.drawH}</td>
                  <td>{r.swapped?'Y':''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1" style={{lineHeight:1.2,fontSize:10}}>
            <div>Swapped orientations: E/W/FE/FW (90°/270°)</div>
            <div className="mt-1 d-flex flex-wrap gap-1">
              <span className="badge bg-warning text-dark">Swapped (E/W/FE/FW)</span>
              <span className="badge bg-danger">Unresolved</span>
              <span className="badge text-bg-light border">dashed red = 2µm placeholder</span>
              <span className="badge" style={{background:'#0d6efd'}}>N</span>
              <span className="badge" style={{background:'#005cbf'}}>S</span>
              <span className="badge" style={{background:'#28a745'}}>E</span>
              <span className="badge" style={{background:'#208c3a'}}>W</span>
              <span className="badge" style={{background:'#ffc107',color:'#000'}}>FN</span>
              <span className="badge" style={{background:'#ff9f40'}}>FS</span>
              <span className="badge" style={{background:'#6f42c1'}}>FE</span>
              <span className="badge" style={{background:'#6610f2'}}>FW</span>
            </div>
            <div>Scroll: zoom / drag: pan</div>
          </div>
        </div>
      )}
    </div>
  </div>;
};

export default DEFLayoutViewer;
