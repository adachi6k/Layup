import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { DEFData } from '../types/def';
import type { LEFData } from '../types/lef';

interface DEFLayoutViewerProps { def: DEFData; lef: LEFData | null; }

export const DEFLayoutViewer: React.FC<DEFLayoutViewerProps> = ({ def, lef }) => {
  const containerRef = useRef<HTMLDivElement|null>(null);
  const canvasRef = useRef<HTMLCanvasElement|null>(null);
  const [containerSize, setContainerSize] = useState({ width: 100, height: 100 });
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [cursorUm, setCursorUm] = useState<{x:number;y:number}|null>(null);
  const [perf, setPerf] = useState<{total:number;visible:number;culled:number;drawMs:number}|null>(null);
  const panStart = useRef<{x:number;y:number;origX:number;origY:number}|null>(null);
  const { dieArea, units } = def;
  // NOTE: dbuToUm を useCallback 化して参照の変化で computeFit が毎レンダー呼ばれズームが初期化される問題を防ぐ
  const dbuToUm = useCallback((v:number) => v / units, [units]);
  const dieWUm = Math.max(1, dbuToUm(dieArea.x2 - dieArea.x1));
  const dieHUm = Math.max(1, dbuToUm(dieArea.y2 - dieArea.y1));

  const userInteractedRef = useRef(false);
  const initialFitDoneRef = useRef(false);
  // 初期フィット用の requestAnimationFrame ID 保持 (ユーザー操作でキャンセルする)
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
  // 依存を最小化 (units 変更やダイ寸法/コンテナ寸法変更時のみリフィット)
  },[containerSize.width,containerSize.height,dieWUm,dieHUm,dieArea.x1,dieArea.y1,dbuToUm]);
  useEffect(()=>{ if(!containerRef.current) return; const el=containerRef.current; const update=()=>{ const r=el.getBoundingClientRect(); setContainerSize({width:r.width,height:r.height}); if(!initialFitDoneRef.current && !userInteractedRef.current){ // 既存の予約があればキャンセル
        if(pendingFitRafRef.current!=null){ cancelAnimationFrame(pendingFitRafRef.current); }
        pendingFitRafRef.current = requestAnimationFrame(()=>{ // 実行直前に再チェック (操作後のリセットを防ぐ)
          if(initialFitDoneRef.current || userInteractedRef.current) return; // ユーザー操作後はスキップ
          computeFit();
          initialFitDoneRef.current=true;
          pendingFitRafRef.current=null;
        });
      } }; update(); const ro=new ResizeObserver(update); ro.observe(el); return ()=>{ ro.disconnect(); if(pendingFitRafRef.current!=null) cancelAnimationFrame(pendingFitRafRef.current); }; },[computeFit]);
  // 以前の自動フィット副作用は ResizeObserver 内に統合済み
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

  const draw = useCallback(()=>{ const canvas=canvasRef.current; if(!canvas) return; const ctx=canvas.getContext('2d'); if(!ctx) return; const dpr=window.devicePixelRatio||1; const cssW=containerSize.width; const cssH=containerSize.height; if(canvas.width!==Math.round(cssW*dpr)||canvas.height!==Math.round(cssH*dpr)){ canvas.width=Math.round(cssW*dpr); canvas.height=Math.round(cssH*dpr); canvas.style.width=cssW+'px'; canvas.style.height=cssH+'px'; } ctx.save(); ctx.scale(dpr,dpr); ctx.clearRect(0,0,cssW,cssH); ctx.fillStyle='#fff'; ctx.fillRect(0,0,cssW,cssH); ctx.translate(pan.x,pan.y); ctx.scale(absScale,absScale); // ダイ枠
    ctx.save(); ctx.lineWidth=2/absScale; ctx.strokeStyle='#222'; ctx.setLineDash([8/absScale,6/absScale]); ctx.strokeRect(dbuToUm(dieArea.x1),dbuToUm(dieArea.y1),dieWUm,dieHUm); ctx.setLineDash([]); ctx.restore();
    // グリッド
    const targetCellPx=80; const cellUm=targetCellPx/absScale; if(cellUm>0){ const stepRaw=cellUm; const mag=Math.pow(10,Math.floor(Math.log10(stepRaw))); const norm=stepRaw/mag; let gridStep=mag; if(norm>5) gridStep=10*mag; else if(norm>2) gridStep=5*mag; else if(norm>1) gridStep=2*mag; const startX=Math.floor(dbuToUm(dieArea.x1)/gridStep)*gridStep; const endX=dbuToUm(dieArea.x1)+dieWUm; const startY=Math.floor(dbuToUm(dieArea.y1)/gridStep)*gridStep; const endY=dbuToUm(dieArea.y1)+dieHUm; ctx.save(); ctx.lineWidth=1/absScale; ctx.strokeStyle='rgba(0,0,0,0.08)'; ctx.beginPath(); for(let x=startX;x<=endX;x+=gridStep){ ctx.moveTo(x,startY); ctx.lineTo(x,endY);} for(let y=startY;y<=endY;y+=gridStep){ ctx.moveTo(startX,y); ctx.lineTo(endX,y);} ctx.stroke(); ctx.restore(); }
    // コンポーネント描画 (ビューポート外をカリング)
    const t0=performance.now();
    const PLACEHOLDER=2; // µm 固定サイズ
    const leftWorld = (-pan.x)/absScale;
    const topWorld = (-pan.y)/absScale;
    const rightWorld = (cssW - pan.x)/absScale;
    const bottomWorld = (cssH - pan.y)/absScale;
    const colorMap:Record<string,string>={ N:'rgba(0,123,255,0.85)', S:'rgba(0,92,191,0.85)', E:'rgba(40,167,69,0.85)', W:'rgba(32,140,58,0.85)', FN:'rgba(255,193,7,0.85)', FS:'rgba(255,159,64,0.85)', FE:'rgba(111,66,193,0.85)', FW:'rgba(102,16,242,0.85)' };
    let visible=0, culled=0;
    ctx.save(); ctx.lineWidth=1/absScale;
  def.components.forEach((c)=>{ if(!c.placed){ return; } const resolver=resolveMacroRef.current; const dim=resolver?resolver(c.macro):undefined; const rawOrient=(c.orient||'N'); const orient=normalizeOrient(rawOrient); const xUm=dbuToUm(c.x); const yUm=dbuToUm(c.y); let wUm=dim?dim.w:PLACEHOLDER; let hUm=dim?dim.h:PLACEHOLDER; const swapped=/^(E|W|FE|FW)$/.test(orient); if(dim && swapped){ wUm=dim.h; hUm=dim.w; }
      // カリング判定
      if(xUm+wUm < leftWorld || xUm > rightWorld || yUm+hUm < topWorld || yUm > bottomWorld){ culled++; return; }
      visible++;
      if(dim){
        ctx.strokeStyle=colorMap[orient]||'rgba(0,123,255,0.85)';
        ctx.strokeRect(xUm,yUm,wUm,hUm);
        if(wUm>0.4 && hUm>0.4){ ctx.save(); ctx.fillStyle=ctx.strokeStyle; ctx.beginPath(); const cx=xUm+0.3; const cy=yUm+0.3; const size=0.25; switch(orient){ case 'N': case 'FN': ctx.moveTo(cx,cy); ctx.lineTo(cx+size,cy); ctx.lineTo(cx+size/2,cy+size); break; case 'S': case 'FS': ctx.moveTo(cx,cy+size); ctx.lineTo(cx+size,cy+size); ctx.lineTo(cx+size/2,cy); break; case 'E': case 'FE': ctx.moveTo(cx,cy); ctx.lineTo(cx,cy+size); ctx.lineTo(cx+size,cy+size/2); break; case 'W': case 'FW': ctx.moveTo(cx+size,cy); ctx.lineTo(cx+size,cy+size); ctx.lineTo(cx,cy+size/2); break; } ctx.closePath(); ctx.fill(); ctx.restore(); }
      } else {
        ctx.save(); ctx.setLineDash([4/absScale,3/absScale]); ctx.strokeStyle='rgba(220,53,69,0.85)'; ctx.strokeRect(xUm,yUm,wUm,hUm); ctx.restore();
      }
    });
    ctx.restore();
    ctx.restore();
    const t1=performance.now();
    setPerf({ total: def.components.length, visible, culled, drawMs: t1-t0 });
  },[containerSize.width,containerSize.height,pan.x,pan.y,absScale,dieArea.x1,dieArea.y1,dieWUm,dieHUm,def.components,dbuToUm]);

  // マクロ解決をメモ化 (描画毎に Map を構築しない)
  const resolveMacroRef = useRef<((name:string)=>{w:number;h:number;raw:string}|undefined)>(undefined);
  useEffect(()=>{ const macroMap=new Map<string,{w:number;h:number;raw:string}>(); const macroMapLower=new Map<string,{w:number;h:number;raw:string}>(); const macroMapNoUnderscore=new Map<string,{w:number;h:number;raw:string}>(); if(lef){ for(const m of lef.macros){ macroMap.set(m.name,{w:m.size.width,h:m.size.height,raw:m.name}); macroMapLower.set(m.name.toLowerCase(),{w:m.size.width,h:m.size.height,raw:m.name}); macroMapNoUnderscore.set(m.name.replace(/_/g,'').toLowerCase(),{w:m.size.width,h:m.size.height,raw:m.name}); } } const resolve=(name:string)=>{ const original=name; const trimmed=name.replace(/;$/,''); return macroMap.get(trimmed)||macroMap.get(original)||macroMapLower.get(trimmed.toLowerCase())||macroMapLower.get(original.toLowerCase())||macroMapNoUnderscore.get(trimmed.replace(/_/g,'').toLowerCase())||undefined; }; resolveMacroRef.current=resolve; },[lef]);

  // rAF スロットリング: 状態変化ごとに複数回 draw が走らないように
  const drawRequestedRef = useRef(false);
  const requestDraw = useCallback(()=>{ if(drawRequestedRef.current) return; drawRequestedRef.current=true; requestAnimationFrame(()=>{ drawRequestedRef.current=false; draw(); }); },[draw]);
  useEffect(()=>{ requestDraw(); },[requestDraw,containerSize.width,containerSize.height,pan.x,pan.y,absScale,def.components]);

  const handleWheel=(e:React.WheelEvent)=>{ e.preventDefault();
  // 初期フィット予約が残っていればキャンセル
  if(pendingFitRafRef.current!=null){ cancelAnimationFrame(pendingFitRafRef.current); pendingFitRafRef.current=null; }
  userInteractedRef.current = true;
    // Ctrlキー押下時はズーム倍率を少し大きくする
    const up = e.deltaY < 0;
    const factorBase = e.ctrlKey ? 1.2 : 1.1;
    const factor = up ? factorBase : 1 / factorBase;
    setZoom(prev=>{ const nz=Math.min(120,Math.max(0.02,prev*factor)); if(nz===prev) return prev; const rect=containerRef.current?.getBoundingClientRect(); if(rect){ const cx=(e.clientX-rect.left-pan.x)/(baseScale*prev); const cy=(e.clientY-rect.top-pan.y)/(baseScale*prev); setPan({ x:e.clientX-rect.left-cx*baseScale*nz, y:e.clientY-rect.top-cy*baseScale*nz }); } return nz; }); };
  const onMouseDown=(e:React.MouseEvent)=>{ // 左 or 中クリックでパン開始
    if(e.button!==0 && e.button!==1) return;
  if(pendingFitRafRef.current!=null){ cancelAnimationFrame(pendingFitRafRef.current); pendingFitRafRef.current=null; }
  userInteractedRef.current = true;
    panStart.current={x:e.clientX,y:e.clientY,origX:pan.x,origY:pan.y}; setIsPanning(true);
  };
  const onMouseMove=(e:React.MouseEvent)=>{
    // カーソル座標（µm）更新
    const rect=containerRef.current?.getBoundingClientRect();
    if(rect){
      const xUm=(e.clientX-rect.left-pan.x)/absScale;
      const yUm=(e.clientY-rect.top-pan.y)/absScale;
      setCursorUm({x:xUm,y:yUm});
    }
    if(isPanning && panStart.current){ const dx=e.clientX-panStart.current.x; const dy=e.clientY-panStart.current.y; setPan({ x:panStart.current.origX+dx, y:panStart.current.origY+dy }); }
  };
  const endPan=()=>{ setIsPanning(false); panStart.current=null; };
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
  <button className="btn btn-sm btn-outline-secondary" onClick={()=>setShowDebug(s=>!s)}>{showDebug?'Hide Debug':'Show Debug'}</button>
      <span className="badge bg-light text-dark">Scale {absScale.toFixed(3)} px/µm</span>
      <span className="badge bg-light text-dark">Zoom {zoom.toFixed(2)}</span>
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
      {perf && (
        <div style={{position:'absolute',right:6,bottom:6,zIndex:15,background:'rgba(0,0,0,0.55)',color:'#fff',padding:'2px 6px',fontSize:10,borderRadius:4,lineHeight:1.2}}>
          <div>draw {perf.drawMs.toFixed(1)} ms</div>
          <div>vis {perf.visible}/{perf.total} (culled {perf.culled})</div>
        </div>
      )}
      {showDebug && debugRows.length>0 && (
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
            <div>Swap対象: E/W/FE/FW (90/270°)</div>
            <div className="mt-1" style={{display:'flex',flexWrap:'wrap',gap:4}}>
              <span className="badge bg-warning text-dark">Swap(E/W/FE/FW)</span>
              <span className="badge bg-danger">未解決</span>
              <span className="badge text-bg-light" style={{border:'1px solid #ccc'}}>赤破線=2µm placeholder</span>
              <span className="badge" style={{background:'#0d6efd'}}>N</span>
              <span className="badge" style={{background:'#005cbf'}}>S</span>
              <span className="badge" style={{background:'#28a745'}}>E</span>
              <span className="badge" style={{background:'#208c3a'}}>W</span>
              <span className="badge" style={{background:'#ffc107',color:'#000'}}>FN</span>
              <span className="badge" style={{background:'#ff9f40'}}>FS</span>
              <span className="badge" style={{background:'#6f42c1'}}>FE</span>
              <span className="badge" style={{background:'#6610f2'}}>FW</span>
            </div>
            <div>マウスホイール: ズーム / ドラッグ: パン</div>
          </div>
        </div>
      )}
    </div>
  </div>;
};

export default DEFLayoutViewer;
