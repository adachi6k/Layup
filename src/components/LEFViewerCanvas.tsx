import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Container, Row, Col, Card, Form, Badge, ListGroup } from 'react-bootstrap';
import type { LEFData, LEFMacro, LEFRect } from '../types/lef';
import { LAYER_COLORS, getLayerColor } from '../types/lef';
import { useCanvasViewport, syncCanvasDpr } from '../hooks/useCanvasViewport';

interface LEFViewerCanvasProps { lefData: LEFData; filename: string; onFileLoad: (content: string, filename: string) => void; }

const LOW_DETAIL_THRESHOLD = 0.15;
const PIXEL_SKIP_THRESHOLD = 0.6;
const PIN_MARKER_SIZE = 6;

export const LEFViewer: React.FC<LEFViewerCanvasProps> = ({ lefData, filename, onFileLoad }) => {
  const [selectedMacro, setSelectedMacro] = useState<LEFMacro | null>(lefData.macros[0] || null);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [hoveredPin, setHoveredPin] = useState<string | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set());
  const [fitMode, setFitMode] = useState<'both'|'width'|'height'|'cover'>('width');
  const [baseFitScale, setBaseFitScale] = useState(1);
  const [dragActive, setDragActive] = useState(false);
  const frameTimesRef = useRef<number[]>([]);
  const pinScreenPosRef = useRef<{name:string;x:number;y:number}[]>([]);
  const culledRef = useRef<number>(0);
  // fps and culled are only rendered in DEV mode; tracked here to avoid conditional hook usage
  const [fps, setFps] = useState(0);
  const [culled, setCulled] = useState(0);
  const [cursorMacro, setCursorMacro] = useState<{x:number;y:number}|null>(null);

  const { containerRef, canvasRef, containerSize, zoom, setZoom, pan, setPan, isPanning, startPan, updatePan, endPan } = useCanvasViewport();

  // レイヤーTYPE (ROUTING/CUT/...) ルックアップ
  const layerTypeMap = useMemo(()=>{
    const m = new Map<string,string>();
    for(const l of lefData.layers){
      m.set((l.name||'').toString().trim().toUpperCase(), l.type);
    }
    return m;
  },[lefData.layers]);

  // レイヤー順位 (高いほど上位層として優先)
  const getLayerRank = useCallback((layerName:string): number =>{
    const key = (layerName||'').toString().trim().toUpperCase();
    const type = layerTypeMap.get(key);
    // CUT(ビア)は除外したいので最低値
    if(type === 'CUT') return -Infinity;
    // 明示的なビア表記も除外
    if(/^(?:V|VIA)(\d+)$/.test(key)) return -Infinity;
    // Metal (METALn/METn/Mn)
    const m = key.match(/^(?:METAL|MET|M)(\d+)$/);
    if(m){ return 300 + parseInt(m[1],10); }
    // Local interconnect LI1, LI2...
    const li = key.match(/^LI(\d+)$/);
    if(li){ return 200 + parseInt(li[1],10); }
    // POLY/PO は低め
    if(/^PO(LY)?$/.test(key)) return 150;
    // TYPEがROUTINGなら汎用順位
    if(type === 'ROUTING') return 120;
    // その他
    return 0;
  },[layerTypeMap]);

  // レイヤー一覧生成
  const allLayers = useMemo(()=>{ const s=new Set<string>(); lefData.macros.forEach((m:LEFMacro)=>{ m.pins.forEach(p=>p.rects.forEach(r=>s.add(r.layer))); m.obs.forEach(r=>s.add(r.layer)); }); return Array.from(s).sort(); },[lefData]);
  useEffect(()=>{ setVisibleLayers(new Set(allLayers)); },[allLayers]);
  // LEF データが更新されたら選択マクロが存在するか確認しなければ先頭にリセット
  useEffect(()=>{ if(!lefData.macros.length){ setSelectedMacro(null); return; } if(!selectedMacro || !lefData.macros.find(m=>m.name===selectedMacro.name)){ setSelectedMacro(lefData.macros[0]); } },[lefData.macros, selectedMacro]);

  // マクロ境界ボックス
  const macroBBox = useMemo(()=>{ if(!selectedMacro) return null; const {size,pins,obs}=selectedMacro; const explicit=size.width>0&&size.height>0; let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; const rects:LEFRect[]=[]; obs.forEach(r=>rects.push(r)); pins.forEach(p=>p.rects.forEach(r=>rects.push(r))); for(const r of rects){ if(r.x1<minX)minX=r.x1; if(r.y1<minY)minY=r.y1; if(r.x2>maxX)maxX=r.x2; if(r.y2>maxY)maxY=r.y2; } if(!explicit){ if(minX===Infinity){minX=0;minY=0;maxX=1;maxY=1;} return {originX:minX,originY:minY,width:(maxX-minX)||1,height:(maxY-minY)||1,derived:true}; } return {originX:0,originY:0,width:size.width||1,height:size.height||1,derived:false}; },[selectedMacro]);

  // All rects
  const allRects = useMemo(()=>{ if(!selectedMacro) return [] as LEFRect[]; const out:LEFRect[]=[]; selectedMacro.obs.forEach(r=>out.push(r)); selectedMacro.pins.forEach(p=>p.rects.forEach(r=>out.push(r))); return out; },[selectedMacro]);

  // ResizeObserver is handled by useCanvasViewport

  // Fit
  const fit=useCallback((mode:'both'|'width'|'height'|'cover', bbox=macroBBox)=>{
    if(!bbox) return;
    const {width,height}=bbox;
    const P=0.05;
    const availW=containerSize.width*(1-P*2);
    const availH=containerSize.height*(1-P*2);
    const sW=availW/width;
    const sH=availH/height;
    let s=sW;
    if(mode==='both') s=Math.min(sW,sH);
    if(mode==='height') s=sH;
    if(mode==='width') s=sW;
    if(mode==='cover') s=Math.max(sW,sH);
    setBaseFitScale(s);
    setZoom(1);
    setPan({ x:(containerSize.width-width*s)/2, y:(containerSize.height-height*s)/2 });
    setFitMode(mode);
  },[containerSize.height, containerSize.width, macroBBox]);
  useEffect(()=>{ if(macroBBox) fit(fitMode, macroBBox); },[fit, fitMode, macroBBox]);

  const absScale = baseFitScale * zoom;

  // 可視領域 (マクロ座標, Y反転考慮) : rect座標系 = 元LEF (上向き正)
  const visibleRegion = useMemo(()=>{
    if(!macroBBox||absScale===0) return null;
    const inv = 1/absScale;
    const { originX, originY, height: macroH } = macroBBox;
    // Xは通常
    const x0 = -pan.x * inv + originX;
    const x1 = x0 + containerSize.width * inv;
    // 変換: screenY = (macroH - (y - originY)) * absScale + pan.y
    // y = originY + macroH - (screenY - pan.y)/absScale
    const yTop = originY + macroH + pan.y * inv; // screenY=0
    const yBottom = originY + macroH - (containerSize.height - pan.y) * inv; // screenY = H
    return { x0, x1, y0: yBottom, y1: yTop, w: x1 - x0, h: yTop - yBottom };
  },[macroBBox,absScale,pan.x,pan.y,containerSize.width,containerSize.height]);

  // Draw routine
  const draw = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas||!macroBBox) return; const ctx=canvas.getContext('2d'); if(!ctx) return;
    const {width:cssW,height:cssH}=containerSize; syncCanvasDpr(canvas, cssW, cssH);
    const dpr=window.devicePixelRatio||1;
    ctx.save(); ctx.scale(dpr,dpr); ctx.clearRect(0,0,cssW,cssH); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,cssW,cssH);
    const {originX,originY,width:macroW,height:macroH}=macroBBox; ctx.translate(pan.x,pan.y); ctx.scale(absScale,absScale); ctx.translate(-originX,-originY); ctx.translate(0,macroH); ctx.scale(1,-1);
    const low=absScale<LOW_DETAIL_THRESHOLD; const reg=visibleRegion; const marginFactor=0.08; let vx0=-Infinity,vy0=-Infinity,vx1=Infinity,vy1=Infinity; if(reg){ const mx=reg.w*marginFactor; const my=reg.h*marginFactor; vx0=reg.x0-mx; vx1=reg.x1+mx; vy0=reg.y0-my; vy1=reg.y1+my; }
    const baseStroke=(Math.max(macroW,macroH)/1500);
    let culledCount=0;
    for(const r of allRects){
      if(!visibleLayers.has(r.layer)) continue;
      // カリング: 交差判定 (端含む)
      if(!(r.x2 >= vx0 && r.x1 <= vx1 && r.y2 >= vy0 && r.y1 <= vy1)){ culledCount++; continue; }
      const w=r.x2-r.x1; const h=r.y2-r.y1;
      if(low && w*absScale<PIXEL_SKIP_THRESHOLD && h*absScale<PIXEL_SKIP_THRESHOLD){ culledCount++; continue; }
  const color=getLayerColor(r.layer);
      ctx.fillStyle=color; ctx.globalAlpha=low?0.55:0.8; ctx.fillRect(r.x1,r.y1,w,h); ctx.globalAlpha=1; ctx.lineWidth=baseStroke/absScale; ctx.strokeStyle='#000'; ctx.strokeRect(r.x1,r.y1,w,h);
    }
    ctx.lineWidth=(Math.max(macroW,macroH)/1500)/absScale; ctx.setLineDash([ (Math.max(macroW,macroH)/600), (Math.max(macroW,macroH)/600) ]); ctx.strokeStyle='#000'; ctx.strokeRect(0,0,macroW,macroH); ctx.setLineDash([]);

    // ピン描画: 変換解除しスクリーン座標で一定サイズ表示
    ctx.restore();
    ctx.save(); ctx.scale(dpr,dpr);
  pinScreenPosRef.current = [];
  if(selectedMacro){
      ctx.font='11px system-ui, sans-serif';
      ctx.textBaseline='middle';
      ctx.textAlign='left';
      for(const pin of selectedMacro.pins){
        if(!pin.rects.length) continue;
        // ピン代表位置選択:
        //  1. CUT(ビア)を除外
        //  2. ROUTING層のうち順位が最も高いレイヤーの矩形を選択 (METn > LIn > POLY > その他ROUTING)
        //  3. 同順位が複数あれば面積最大を優先
        //  4. 見つからなければ全矩形BBox重心
        let chosen: typeof pin.rects[0] | null = null;
        let chosenRank = -Infinity;
        let chosenArea = -1;
        for(const r of pin.rects){
          const rank = getLayerRank(r.layer);
          if(rank === -Infinity) continue;
          const area = Math.max(0,(r.x2-r.x1)*(r.y2-r.y1));
          if(rank > chosenRank || (rank === chosenRank && area > chosenArea)){
            chosen = r; chosenRank = rank; chosenArea = area;
          }
        }
        let cx:number; let cy:number;
        if(!chosen){
          // フォールバック: 旧方式 BBox 重心
          let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
          for(const pr of pin.rects){ if(pr.x1<minX)minX=pr.x1; if(pr.y1<minY)minY=pr.y1; if(pr.x2>maxX)maxX=pr.x2; if(pr.y2>maxY)maxY=pr.y2; }
          cx=(minX+maxX)/2; cy=(minY+maxY)/2;
        }else{
          cx=(chosen.x1+chosen.x2)/2; cy=(chosen.y1+chosen.y2)/2;
        }
    const screenX = ( (cx - originX) * absScale ) + pan.x;
    const screenY = ( (macroH - (cy - originY)) * absScale ) + pan.y;
    pinScreenPosRef.current.push({name:pin.name,x:screenX,y:screenY});
    const isSelected = selectedPin===pin.name;
    const isHover = hoveredPin===pin.name;
    const size = PIN_MARKER_SIZE * (isSelected?1.5:(isHover?1.2:1));
    const half=size/2;
    ctx.fillStyle=isSelected?'#dc3545':'#000'; ctx.globalAlpha=0.85; ctx.fillRect(screenX-half,screenY-half,size,size);
    ctx.globalAlpha=1; ctx.fillStyle='#fff'; ctx.fillRect(screenX-half+1,screenY-half+1,size-2,size-2);
    ctx.fillStyle=isSelected?'#dc3545':(isHover?'#6610f2':'#0d6efd'); ctx.fillRect(screenX-half+2,screenY-half+2,size-4,size-4);
        const label=pin.name; const padX=4; const padY=2; const metrics=ctx.measureText(label); const labelW=metrics.width+padX*2; const labelH=12+padY; const labelX=screenX+PIN_MARKER_SIZE/2+4; const labelY=screenY;
        ctx.fillStyle='rgba(255,255,255,0.92)'; ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=1;
        // ラウンド矩形 (fallback: path)
        ctx.beginPath(); const r=3; const x=labelX; const y=labelY-labelH/2; const w=labelW; const h=labelH; ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#000'; ctx.fillText(label,labelX+padX,labelY);
      }
    }
    ctx.restore();
    const now=performance.now(); const ft=frameTimesRef.current; ft.push(now); while(ft.length && now-ft[0]>1000) ft.shift(); setFps(ft.length);
  culledRef.current = culledCount; setCulled(culledCount);
  },[macroBBox,allRects,visibleLayers,absScale,pan.x,pan.y,containerSize,visibleRegion,selectedMacro,getLayerRank,hoveredPin,selectedPin]);

  useEffect(()=>{ draw(); },[draw]);

  // Wheel zoom
  const handleWheel=(e:React.WheelEvent)=>{ if(!macroBBox) return; e.preventDefault(); const factor=e.deltaY<0?1.1:0.9; setZoom(prev=>{ const nz=Math.min(50,Math.max(0.02,prev*factor)); const rect=containerRef.current?.getBoundingClientRect(); const cx=(e.clientX-(rect?.left||0)-pan.x)/(baseFitScale*prev); const cy=(e.clientY-(rect?.top||0)-pan.y)/(baseFitScale*prev); setPan({ x:e.clientX-(rect?.left||0)-cx*baseFitScale*nz, y:e.clientY-(rect?.top||0)-cy*baseFitScale*nz }); return nz; }); };
  // Pan
  const onMouseDown=(e:React.MouseEvent)=>{ startPan(e); };
  const onMouseMove=(e:React.MouseEvent)=>{
    if(isPanning) updatePan(e.clientX, e.clientY);
    if(!macroBBox) return;
    const rect=containerRef.current?.getBoundingClientRect(); if(!rect) return;
    const sx=e.clientX-rect.left; const sy=e.clientY-rect.top;
    const {originX,originY,height:macroH}=macroBBox; const mx=originX + (sx - pan.x)/absScale; const my=originY + macroH - (sy - pan.y)/absScale; setCursorMacro({x:mx,y:my});
    const threshold=PIN_MARKER_SIZE*0.75; let found:string|null=null; for(const p of pinScreenPosRef.current){ const dxp=sx-p.x; const dyp=sy-p.y; if(Math.abs(dxp)<=threshold && Math.abs(dyp)<=threshold){ found=p.name; break; } }
    setHoveredPin(found);
  };
  const onMouseLeaveCanvas=()=>{ endPan(); setHoveredPin(null); setCursorMacro(null); };

  // コントロール群
  const zoomIn=()=>setZoom(z=>Math.min(50,z*1.2));
  const zoomOut=()=>setZoom(z=>Math.max(0.02,z/1.2));
  const resetView=()=>{ if(macroBBox) fit(fitMode, macroBBox); };
  const fitWidth=()=>macroBBox&&fit('width');
  const fitHeight=()=>macroBBox&&fit('height');
  const fitBoth=()=>macroBBox&&fit('both');
  const fitCover=()=>macroBBox&&fit('cover');
  const toggleLayer=(layer:string)=> setVisibleLayers(prev=>{
    const ns=new Set(prev);
    if(ns.has(layer)) ns.delete(layer);
    else ns.add(layer);
    return ns;
  });

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect='copy'; if(!dragActive) setDragActive(true); };
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); if(!dragActive) setDragActive(true); };
  const handleDragLeave = (e: React.DragEvent) => { if(e.currentTarget === e.target) setDragActive(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if(!files || files.length===0) return;
    const file = files[0];
    if(!file.name.toLowerCase().endsWith('.lef') && file.type && !file.type.startsWith('text')) return;
    const reader = new FileReader();
    reader.onload = () => { const text = typeof reader.result === 'string' ? reader.result : ''; if(text) onFileLoad(text, file.name); };
    reader.readAsText(file);
  };

  const renderCanvasArea=()=>{ if(!selectedMacro||!macroBBox) return null; const {width:macroW,height:macroH,derived}=macroBBox; const low=absScale<LOW_DETAIL_THRESHOLD; return (
    <Card className="h-100 d-flex flex-column" style={{userSelect:isPanning?'none':'auto'}}>
      <Card.Header>
        <h5 className="mb-0 d-flex align-items-center flex-wrap">
          <span>{selectedMacro.name}</span>
          <Badge bg="secondary" className="ms-2">{selectedMacro.className}</Badge>
          {derived && <Badge bg="warning" text="dark" className="ms-2">Derived SIZE</Badge>}
        </h5>
        <small className="text-muted">Size: {macroW.toFixed(2)} × {macroH.toFixed(2)} units {derived && '(from geometry)'} | Rects {allRects.length} {low && 'LOD'} | Scale {absScale.toFixed(3)}{import.meta.env.DEV && ` | FPS ${fps}`}</small>
      </Card.Header>
      <Card.Body className="p-1 flex-grow-1 d-flex" style={{minHeight:0}}>
        <div ref={containerRef} className="w-100 h-100 position-relative" style={{overflow:'hidden',cursor:isPanning?'grabbing':'default'}}
             onWheel={handleWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={onMouseLeaveCanvas} onMouseUp={endPan}
             onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <div style={{position:'absolute',top:6,left:6,zIndex:10,display:'flex',gap:4,background:'rgba(255,255,255,0.85)',padding:'4px 6px',borderRadius:4,boxShadow:'0 1px 3px rgba(0,0,0,0.25)',alignItems:'center'}}>
            <button className="btn btn-sm btn-outline-secondary" onClick={zoomIn}>+</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={zoomOut}>-</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={resetView}>Reset</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={fitWidth}>Fit W</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={fitHeight}>Fit H</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={fitBoth}>Fit Both</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={fitCover}>Cover</button>
            <span className="badge bg-light text-dark" style={{fontSize:10}}>{fitMode}</span>
            {import.meta.env.DEV && <span className="badge bg-light text-dark" style={{fontSize:10}}>culled {culled}</span>}
          </div>
          {cursorMacro && (
            <div style={{position:'absolute',bottom:6,left:6,zIndex:15,background:'rgba(0,0,0,0.55)',color:'#fff',padding:'2px 6px',fontSize:11,borderRadius:4}}>
              ({cursorMacro.x.toFixed(2)}, {cursorMacro.y.toFixed(2)}) {hoveredPin && <span style={{marginLeft:6,color:'#ffc107'}}>PIN: {hoveredPin}</span>}
            </div>
          )}
          {dragActive && (
            <div style={{position:'absolute',inset:0,zIndex:20,background:'rgba(0,123,255,0.15)',border:'3px dashed #0d6efd',color:'#0d6efd',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:600,fontSize:18}}>
              Drop LEF file to load
            </div>
          )}
          <canvas ref={canvasRef} style={{width:'100%',height:'100%',display:'block',background:'#fff',border:'1px solid #ddd',borderRadius:4,boxShadow:'0 2px 4px rgba(0,0,0,0.1)'}} />
          {(!selectedMacro || !macroBBox) && (
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'#666',pointerEvents:'none'}}>
              {lefData.macros.length? 'Select a macro from the list' : 'No MACRO definitions in this LEF'}
            </div>
          )}
          {selectedMacro && macroBBox && visibleLayers.size===0 && (
            <div style={{position:'absolute',top:0,left:0,right:0,padding:8,textAlign:'center',background:'rgba(255,255,0,0.25)',fontSize:12,fontWeight:600}}>All layers hidden</div>
          )}
        </div>
      </Card.Body>
    </Card>
  ); };

  return (
    <Container fluid className="p-2" style={{height:'100vh'}}>
      <Row style={{height:'100%'}}>
        <Col lg={2} md={3} className="pe-2">
          <Card className="mb-2" style={{fontSize:'0.85rem'}}>
            <Card.Header className="py-2"><h6 className="mb-0">File Information</h6></Card.Header>
            <Card.Body className="py-2">
              <div><strong>File:</strong> {filename}</div>
              <div><strong>Version:</strong> {lefData.version}</div>
              <div><strong>Macros:</strong> {lefData.macros.length}</div>
              <div><strong>Layers:</strong> {allLayers.length}</div>
            </Card.Body>
          </Card>
            <Card className="mb-2" style={{fontSize:'0.85rem'}}>
              <Card.Header className="py-2"><h6 className="mb-0">Layers</h6></Card.Header>
              <Card.Body className="py-2" style={{maxHeight:'200px',overflowY:'auto'}}>
                {allLayers.map(layer=> (
                  <Form.Check key={layer} type="checkbox" id={`layer-${layer}`}
                    label={<div className="d-flex align-items-center"><div style={{width:12,height:12,backgroundColor:LAYER_COLORS[layer]||LAYER_COLORS.default,marginRight:6,border:'1px solid #ccc'}}/> {layer}</div>}
                    checked={visibleLayers.has(layer)} onChange={()=>toggleLayer(layer)} />
                ))}
              </Card.Body>
            </Card>
          <Card style={{fontSize:'0.85rem'}}>
            <Card.Header className="py-2"><h6 className="mb-0">Macros</h6></Card.Header>
            <Card.Body className="py-2" style={{maxHeight:'250px',overflowY:'auto'}}>
              <ListGroup variant="flush">
                {lefData.macros.map((macro,i)=>(
                  <ListGroup.Item key={i} action active={selectedMacro?.name===macro.name} onClick={()=>setSelectedMacro(macro)} className="py-1 px-2" style={{fontSize:'0.8rem'}}>
                    <div className="fw-bold">{macro.name}</div>
                    <small className="text-muted">{macro.pins.length} pins, {macro.className}</small>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={7} md={6} className="px-1 d-flex flex-column" style={{height:'100%'}}>
          {renderCanvasArea()}
        </Col>
        <Col lg={3} md={3} className="ps-2">
          {selectedMacro && (
            <Card style={{fontSize:'0.85rem',height:'100%'}}>
              <Card.Header className="py-2"><h6 className="mb-0">Pins ({selectedMacro.pins.length})</h6></Card.Header>
              <Card.Body className="py-2" style={{overflow:'auto'}}>
                <ListGroup variant="flush">
                  {selectedMacro.pins.map((pin,i)=>(
                    <ListGroup.Item key={i} className="py-1 px-2" style={{fontSize:'0.8rem',cursor:'pointer',background:selectedPin===pin.name?'#ffecec':undefined}} onClick={()=>setSelectedPin(p=>p===pin.name?null:pin.name)}>
                      <div className="fw-bold">{pin.name}</div>
                      <div>
                        <Badge bg="primary" className="me-1" style={{fontSize:'0.7rem'}}>{pin.direction}</Badge>
                        <Badge bg="secondary" style={{fontSize:'0.7rem'}}>{pin.use}</Badge>
                      </div>
                      <small className="text-muted">{pin.rects.length} geometries</small>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default LEFViewer;
