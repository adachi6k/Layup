import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { DEFData } from '../types/def';
import type { LEFData } from '../types/lef';
import { useCanvasViewport, syncCanvasDpr } from '../hooks/useCanvasViewport';

interface DEFLayoutViewerProps { def: DEFData; lef: LEFData | null; }

export const DEFLayoutViewer: React.FC<DEFLayoutViewerProps> = ({ def, lef }) => {
  const { containerRef, canvasRef, containerSize, zoom, setZoom, pan, setPan, isPanning, panStartRef, startPan, endPan } = useCanvasViewport();
  const [baseScale, setBaseScale] = useState(1);
  // Pan input rAF throttling
  const panPendingRef = useRef<{x:number;y:number}|null>(null);
  const panCommitRafRef = useRef<number|null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [cursorUm, setCursorUm] = useState<{x:number;y:number}|null>(null);
  const [perf, setPerf] = useState<{total:number;visible:number;culled:number;drawMs:number}|null>(null);
  // LOD thresholds (absScale based)
  const LOD_HIGH = 1;
  const LOD_GRID_MIN = 0.15;
  const { dieArea, units } = def;
  const dbuToUm = useCallback((v:number) => v / units, [units]);
  const dieWUm = Math.max(1, dbuToUm(dieArea.x2 - dieArea.x1));
  const dieHUm = Math.max(1, dbuToUm(dieArea.y2 - dieArea.y1));
  // 事前計算結果とグリッドインデックス
  const precomputedRef = useRef<{x:number;y:number;w:number;h:number;color:string;marker:boolean;orient:string}[]>([]);
  interface GridIndex { cellSize:number; cols:number; rows:number; cells:Uint32Array[]; originX:number; originY:number; }
  const gridRef = useRef<GridIndex|null>(null);

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
  },[containerSize.width,containerSize.height,dieWUm,dieHUm,dieArea.x1,dieArea.y1,dbuToUm]);
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

  const draw = useCallback(()=>{ const canvas=canvasRef.current; if(!canvas) return; const ctx=canvas.getContext('2d'); if(!ctx) return; const cssW=containerSize.width; const cssH=containerSize.height; syncCanvasDpr(canvas, cssW, cssH); const dpr=window.devicePixelRatio||1; const start=performance.now(); ctx.save(); ctx.scale(dpr,dpr); ctx.clearRect(0,0,cssW,cssH); ctx.fillStyle='#fff'; ctx.fillRect(0,0,cssW,cssH); ctx.translate(pan.x,pan.y); ctx.scale(absScale,absScale); // die outline
    ctx.save(); ctx.lineWidth=2/absScale; ctx.strokeStyle='#222'; ctx.setLineDash([8/absScale,6/absScale]); ctx.strokeRect(dbuToUm(dieArea.x1),dbuToUm(dieArea.y1),dieWUm,dieHUm); ctx.setLineDash([]); ctx.restore();
    // グリッド (LOD)
    const fastPan = isPanning; // パン中は軽量表示
    if(!fastPan && absScale>=LOD_GRID_MIN){ const gridPath = getGridPath(); if(gridPath){ ctx.save(); ctx.lineWidth=1/absScale; ctx.strokeStyle='rgba(0,0,0,0.08)'; ctx.stroke(gridPath); ctx.restore(); } }
    // コンポーネント
    const leftWorld = (-pan.x)/absScale, topWorld=(-pan.y)/absScale, rightWorld=(cssW-pan.x)/absScale, bottomWorld=(cssH-pan.y)/absScale;
    let visible=0, culled=0;
  const highDetail = !fastPan && absScale >= LOD_HIGH;
  // 品質優先評価モード: サンプリング無効化
  const sampleStep = 1; // ← テスト用: 常に全件描画 (性能影響を計測するため)
    // 色別 Path 集約 (低〜中 LOD のみ)
    const pathMap:Record<string,Path2D> = {};
    const markerPaths:Record<string,Path2D> = {};
    const getPath=(color:string)=>{ return pathMap[color]||(pathMap[color]=new Path2D()); };
    const getMarkerPath=(color:string)=>{ return markerPaths[color]||(markerPaths[color]=new Path2D()); };
    const grid = gridRef.current;
    if(grid){
      const gx0 = Math.max(0, Math.floor((leftWorld - grid.originX)/grid.cellSize));
      const gy0 = Math.max(0, Math.floor((topWorld - grid.originY)/grid.cellSize));
      const gx1 = Math.min(grid.cols-1, Math.floor((rightWorld - grid.originX)/grid.cellSize));
      const gy1 = Math.min(grid.rows-1, Math.floor((bottomWorld - grid.originY)/grid.cellSize));
      for(let gy=gy0; gy<=gy1; gy++){
        for(let gx=gx0; gx<=gx1; gx++){
          const arr = grid.cells[gy*grid.cols+gx];
          for(let i=0;i<arr.length;i++){
            const idx = arr[i];
            if(sampleStep>1 && (idx % sampleStep)!==0) continue;
            const pc = precomputedRef.current[idx]; if(!pc) continue;
            if(pc.x+pc.w < leftWorld || pc.x > rightWorld || pc.y+pc.h < topWorld || pc.y > bottomWorld){ culled++; continue; }
            visible++;
            const p = getPath(pc.color); p.rect(pc.x,pc.y,pc.w,pc.h);
            if(highDetail && pc.marker){ const mp=getMarkerPath(pc.color); const size=0.25; const cx=pc.x+0.3; const cy=pc.y+0.3; switch(pc.orient){ case 'N': case 'FN': mp.moveTo(cx,cy); mp.lineTo(cx+size,cy); mp.lineTo(cx+size/2,cy+size); break; case 'S': case 'FS': mp.moveTo(cx,cy+size); mp.lineTo(cx+size,cy+size); mp.lineTo(cx+size/2,cy); break; case 'E': case 'FE': mp.moveTo(cx,cy); mp.lineTo(cx,cy+size); mp.lineTo(cx+size,cy+size/2); break; case 'W': case 'FW': mp.moveTo(cx+size,cy); mp.lineTo(cx+size,cy+size); mp.lineTo(cx,cy+size/2); break; }
            }
          }
        }
      }
    } else {
      precomputedRef.current.forEach((pc,idx)=>{ if(idx % sampleStep!==0) return; if(pc.x+pc.w < leftWorld || pc.x > rightWorld || pc.y+pc.h < topWorld || pc.y > bottomWorld){ culled++; return; } visible++; const p = getPath(pc.color); p.rect(pc.x,pc.y,pc.w,pc.h); if(highDetail && pc.marker){ const mp=getMarkerPath(pc.color); const size=0.25; const cx=pc.x+0.3; const cy=pc.y+0.3; switch(pc.orient){ case 'N': case 'FN': mp.moveTo(cx,cy); mp.lineTo(cx+size,cy); mp.lineTo(cx+size/2,cy+size); break; case 'S': case 'FS': mp.moveTo(cx,cy+size); mp.lineTo(cx+size,cy+size); mp.lineTo(cx+size/2,cy); break; case 'E': case 'FE': mp.moveTo(cx,cy); mp.lineTo(cx,cy+size); mp.lineTo(cx+size,cy+size/2); break; case 'W': case 'FW': mp.moveTo(cx+size,cy); mp.lineTo(cx+size,cy+size); mp.lineTo(cx,cy+size/2); break; } } });
    }
    // Stroke batched paths
    ctx.save(); ctx.lineWidth=1/absScale; Object.entries(pathMap).forEach(([color,p])=>{ ctx.strokeStyle=color; ctx.stroke(p); }); if(highDetail){ Object.entries(markerPaths).forEach(([color,p])=>{ ctx.fillStyle=color; ctx.fill(p,'nonzero'); }); } ctx.restore();
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
    const end=performance.now();
    setPerf({ total: precomputedRef.current.length, visible, culled, drawMs: end-start });
  },[containerSize.width,containerSize.height,pan.x,pan.y,absScale,isPanning,dieArea.x1,dieArea.y1,dieWUm,dieHUm,dbuToUm,def.pins,getGridPath]);

  // Stable ref to the latest draw function so the precompute effect can
  // schedule a redraw without adding draw (and all its deps) to its own dep array.
  const drawRef = useRef(draw);
  useEffect(()=>{ drawRef.current = draw; });

  // マクロ解決をメモ化 (描画毎に Map を構築しない)
  const resolveMacroRef = useRef<((name:string)=>{w:number;h:number;raw:string}|undefined)>(undefined);
  useEffect(()=>{ const macroMap=new Map<string,{w:number;h:number;raw:string}>(); const macroMapLower=new Map<string,{w:number;h:number;raw:string}>(); const macroMapNoUnderscore=new Map<string,{w:number;h:number;raw:string}>(); if(lef){ for(const m of lef.macros){ macroMap.set(m.name,{w:m.size.width,h:m.size.height,raw:m.name}); macroMapLower.set(m.name.toLowerCase(),{w:m.size.width,h:m.size.height,raw:m.name}); macroMapNoUnderscore.set(m.name.replace(/_/g,'').toLowerCase(),{w:m.size.width,h:m.size.height,raw:m.name}); } } const resolve=(name:string)=>{ const original=name; const trimmed=name.replace(/;$/,''); return macroMap.get(trimmed)||macroMap.get(original)||macroMapLower.get(trimmed.toLowerCase())||macroMapLower.get(original.toLowerCase())||macroMapNoUnderscore.get(trimmed.replace(/_/g,'').toLowerCase())||undefined; }; resolveMacroRef.current=resolve; const colorMap:Record<string,string>={ N:'rgba(0,123,255,0.85)', S:'rgba(0,92,191,0.85)', E:'rgba(40,167,69,0.85)', W:'rgba(32,140,58,0.85)', FN:'rgba(255,193,7,0.85)', FS:'rgba(255,159,64,0.85)', FE:'rgba(111,66,193,0.85)', FW:'rgba(102,16,242,0.85)' }; const pre=[] as {x:number;y:number;w:number;h:number;color:string;marker:boolean;orient:string}[]; const PLACEHOLDER=2; let unresolved=0; for(const c of def.components){ if(!c.placed) continue; const dim=resolve(c.macro); if(!dim) unresolved++; const orient=normalizeOrient(c.orient||'N'); let w=dim?dim.w:PLACEHOLDER; let h=dim?dim.h:PLACEHOLDER; const swapped=/^(E|W|FE|FW)$/.test(orient); if(dim && swapped){ w=dim.h; h=dim.w; } pre.push({ x:dbuToUm(c.x), y:dbuToUm(c.y), w, h, color: colorMap[orient]||'rgba(0,123,255,0.85)', marker: w>0.4 && h>0.4, orient }); } precomputedRef.current=pre; setUnresolvedCount(unresolved); // grid build
    const originX = dbuToUm(dieArea.x1); const originY = dbuToUm(dieArea.y1);
    const targetCellsDim = 140; let cellSize = Math.max(1, Math.min(dieWUm,dieHUm)/targetCellsDim);
    if(pre.length>0){ const sampleN=Math.min(pre.length,800); let acc=0; for(let i=0;i<sampleN;i++){ const p=pre[i]; acc += (p.w+p.h)/2; } const avgComp=(acc/sampleN)||1; cellSize = Math.max(cellSize, avgComp*2); }
    const cols = Math.max(1, Math.ceil(dieWUm / cellSize)); const rows = Math.max(1, Math.ceil(dieHUm / cellSize));
    const temp: number[][] = Array.from({length: cols*rows}, ()=>[]);
    pre.forEach((p,idx)=>{ const gx=Math.min(cols-1,Math.max(0,Math.floor((p.x-originX)/cellSize))); const gy=Math.min(rows-1,Math.max(0,Math.floor((p.y-originY)/cellSize))); temp[gy*cols+gx].push(idx); });
    const cells = temp.map(a=>new Uint32Array(a));
    gridRef.current = { cellSize, cols, rows, cells, originX, originY };
    // Schedule a redraw so the canvas reflects the new LEF data immediately
    // without waiting for the next pan/zoom/resize interaction.
    requestAnimationFrame(()=>{ drawRef.current(); });
  },[lef,def.components,dbuToUm,dieArea.x1,dieArea.y1,dieWUm,dieHUm]);

  // rAF draw throttling
  const drawRequestedRef = useRef(false);
  const requestDraw = useCallback(()=>{ if(drawRequestedRef.current) return; drawRequestedRef.current=true; requestAnimationFrame(()=>{ drawRequestedRef.current=false; draw(); }); },[draw]);
  useEffect(()=>{ requestDraw(); },[requestDraw,containerSize.width,containerSize.height,pan.x,pan.y,absScale,def.components,def.pins]);

  const handleWheel=(e:React.WheelEvent)=>{ e.preventDefault();
  if(pendingFitRafRef.current!=null){ cancelAnimationFrame(pendingFitRafRef.current); pendingFitRafRef.current=null; }
  userInteractedRef.current = true;
    const up = e.deltaY < 0;
    const factorBase = e.ctrlKey ? 1.2 : 1.1;
    const factor = up ? factorBase : 1 / factorBase;
    setZoom(prev=>{ const nz=Math.min(120,Math.max(0.02,prev*factor)); if(nz===prev) return prev; const rect=containerRef.current?.getBoundingClientRect(); if(rect){ const cx=(e.clientX-rect.left-pan.x)/(baseScale*prev); const cy=(e.clientY-rect.top-pan.y)/(baseScale*prev); setPan({ x:e.clientX-rect.left-cx*baseScale*nz, y:e.clientY-rect.top-cy*baseScale*nz }); } return nz; }); };
  const onMouseDown=(e:React.MouseEvent)=>{
    if(e.button!==0 && e.button!==1) return;
    if(pendingFitRafRef.current!=null){ cancelAnimationFrame(pendingFitRafRef.current); pendingFitRafRef.current=null; }
    userInteractedRef.current = true;
    startPan(e);
  };
  const onMouseMove=(e:React.MouseEvent)=>{
    const rect=containerRef.current?.getBoundingClientRect();
    if(rect){
      const xUm=(e.clientX-rect.left-pan.x)/absScale;
      const yUm=(e.clientY-rect.top-pan.y)/absScale;
      setCursorUm({x:xUm,y:yUm});
    }
    if(isPanning && panStartRef.current){
      // Intentionally not calling hook's updatePan() here: we apply pan via rAF
      // throttling to avoid excessive state updates during fast mouse moves.
      const next = { x:panStartRef.current.origX+(e.clientX-panStartRef.current.x), y:panStartRef.current.origY+(e.clientY-panStartRef.current.y) };
      panPendingRef.current = next;
      if(panCommitRafRef.current==null){
        panCommitRafRef.current = requestAnimationFrame(()=>{
          if(panPendingRef.current) setPan(panPendingRef.current);
          panPendingRef.current=null;
          panCommitRafRef.current=null;
        });
      }
    }
  };
  const onMouseLeave=()=>{ endPan(); setCursorUm(null); };
  const onDoubleClick=()=>{ computeFit(); };
  const zoomIn=()=>setZoom(z=>Math.min(80,z*1.2));
  const zoomOut=()=>setZoom(z=>Math.max(0.05,z/1.2));
  const resetView=()=>{ // ユーザー明示操作なので初期フィット扱いを再設定
    if(pendingFitRafRef.current!=null){ cancelAnimationFrame(pendingFitRafRef.current); pendingFitRafRef.current=null; }
    userInteractedRef.current=false; // リセット後に再度フィット → 直後のリサイズで再フィットさせたい場合は false のまま
    initialFitDoneRef.current=true; // 再度自動初期フィットを走らせる必要はない
    computeFit();
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

  return <div className="d-flex flex-column h-100">
    <div style={{padding:'4px 6px',background:'#f8f9fa',border:'1px solid #ddd',borderRadius:4,marginBottom:4,display:'flex',alignItems:'center',gap:6,fontSize:12}}>
      <strong className="me-2">DEF Layout</strong>
      <button className="btn btn-sm btn-outline-secondary" onClick={zoomIn}>+</button>
      <button className="btn btn-sm btn-outline-secondary" onClick={zoomOut}>-</button>
      <button className="btn btn-sm btn-outline-secondary" onClick={resetView}>Reset</button>
      {import.meta.env.DEV && <button className="btn btn-sm btn-outline-secondary" onClick={()=>setShowDebug(s=>!s)}>{showDebug?'Hide Debug':'Show Debug'}</button>}
      <span className="badge bg-light text-dark">Scale {absScale.toFixed(3)} px/µm</span>
      <span className="badge bg-light text-dark">Zoom {zoom.toFixed(2)}</span>
      {unresolvedCount > 0 && <span className="badge bg-warning text-dark" title="Some component macros could not be resolved against the loaded LEF. Load the matching LEF file to fix.">⚠ {unresolvedCount} unresolved</span>}
    </div>
    <div ref={containerRef} style={{position:'relative',flex:1,overflow:'hidden',border:'1px solid #ddd',borderRadius:4,cursor:isPanning?'grabbing':'default'}}
         onWheel={handleWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} onMouseUp={endPan} onDoubleClick={onDoubleClick}>
      <canvas ref={canvasRef} style={{position:'absolute',inset:0}} />
      {def.components.filter(c=>c.placed).length===0 && (
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'#666',pointerEvents:'none',background:'rgba(255,255,255,0.6)'}}>
          No placed components parsed (check COMPONENTS / + PLACED lines)
        </div>
      )}
      {cursorUm && (
        <div style={{position:'absolute',left:6,bottom:6,zIndex:15,background:'rgba(0,0,0,0.55)',color:'#fff',padding:'2px 6px',fontSize:11,borderRadius:4,display:'flex',gap:6}}>
          <span>{cursorUm.x.toFixed(2)}, {cursorUm.y.toFixed(2)} µm</span>
          <span style={{opacity:0.75}}>scale {absScale.toFixed(2)} px/µm</span>
        </div>
      )}
      {import.meta.env.DEV && perf && (
        <div style={{position:'absolute',right:6,bottom:6,zIndex:15,background:'rgba(0,0,0,0.55)',color:'#fff',padding:'2px 6px',fontSize:10,borderRadius:4,lineHeight:1.2}}>
          <div>draw {perf.drawMs.toFixed(1)} ms</div>
          <div>vis {perf.visible}/{perf.total} (culled {perf.culled})</div>
        </div>
      )}
      {import.meta.env.DEV && showDebug && debugRows.length>0 && (
        <div style={{position:'absolute',top:6,right:6,maxHeight:'70%',width:340,overflow:'auto',background:'rgba(255,255,255,0.95)',border:'1px solid #ccc',borderRadius:4,fontSize:11,padding:6,boxShadow:'0 2px 4px rgba(0,0,0,0.2)'}}>
          <div className="d-flex justify-content-between align-items-center mb-1">
            <strong>Components (preview)</strong>
            <span style={{fontSize:10}}>first {debugRows.length}</span>
          </div>
          <div style={{fontSize:10,marginBottom:4}}>
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
          <div style={{marginTop:4,lineHeight:1.2}}>
            <div>Swapped orientations: E/W/FE/FW (90°/270°)</div>
            <div className="mt-1" style={{display:'flex',flexWrap:'wrap',gap:4}}>
              <span className="badge bg-warning text-dark">Swapped (E/W/FE/FW)</span>
              <span className="badge bg-danger">Unresolved</span>
              <span className="badge text-bg-light" style={{border:'1px solid #ccc'}}>dashed red = 2µm placeholder</span>
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
