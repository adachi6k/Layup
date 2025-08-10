import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Container, Row, Col, Card, Form, Badge, ListGroup } from 'react-bootstrap';
import type { LEFData, LEFMacro, LEFRect } from '../types/lef';
import { LAYER_COLORS } from '../types/lef';

interface LEFViewerCanvasProps { lefData: LEFData; filename: string; }

const LOW_DETAIL_THRESHOLD = 0.15; // 絶対スケール閾値
const PIXEL_SKIP_THRESHOLD = 0.6;   // 低詳細時にスキップするピクセルサイズ

export const LEFViewer: React.FC<LEFViewerCanvasProps> = ({ lefData, filename }) => {
  const [selectedMacro, setSelectedMacro] = useState<LEFMacro | null>(lefData.macros[0] || null);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set());
  const [fitMode, setFitMode] = useState<'both'|'width'|'height'|'cover'>('width');
  const [zoom, setZoom] = useState(1); // baseFitScale * zoom = absScale
  const [pan, setPan] = useState({ x:0, y:0 }); // ピクセル座標
  const [baseFitScale, setBaseFitScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{x:number;y:number;origX:number;origY:number}|null>(null);
  const containerRef = useRef<HTMLDivElement|null>(null);
  const canvasRef = useRef<HTMLCanvasElement|null>(null);
  const [containerSize, setContainerSize] = useState({ width:100, height:100 });
  const [fps, setFps] = useState(0);
  const frameTimesRef = useRef<number[]>([]);

  // レイヤー一覧生成
  const allLayers = useMemo(()=>{ const s=new Set<string>(); lefData.macros.forEach((m:LEFMacro)=>{ m.pins.forEach(p=>p.rects.forEach(r=>s.add(r.layer))); m.obs.forEach(r=>s.add(r.layer)); }); return Array.from(s).sort(); },[lefData]);
  useEffect(()=>{ setVisibleLayers(new Set(allLayers)); },[allLayers]);

  // マクロ境界ボックス
  const macroBBox = useMemo(()=>{ if(!selectedMacro) return null; const {size,pins,obs}=selectedMacro; const explicit=size.width>0&&size.height>0; let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; const rects:LEFRect[]=[]; obs.forEach(r=>rects.push(r)); pins.forEach(p=>p.rects.forEach(r=>rects.push(r))); for(const r of rects){ if(r.x1<minX)minX=r.x1; if(r.y1<minY)minY=r.y1; if(r.x2>maxX)maxX=r.x2; if(r.y2>maxY)maxY=r.y2; } if(!explicit){ if(minX===Infinity){minX=0;minY=0;maxX=1;maxY=1;} return {originX:minX,originY:minY,width:(maxX-minX)||1,height:(maxY-minY)||1,derived:true}; } return {originX:0,originY:0,width:size.width||1,height:size.height||1,derived:false}; },[selectedMacro]);

  // 全矩形配列
  const allRects = useMemo(()=>{ if(!selectedMacro) return [] as LEFRect[]; const out:LEFRect[]=[]; selectedMacro.obs.forEach(r=>out.push(r)); selectedMacro.pins.forEach(p=>p.rects.forEach(r=>out.push(r))); return out; },[selectedMacro]);

  // リサイズ監視
  useEffect(()=>{ if(!containerRef.current) return; const el=containerRef.current; const update=()=>{ const r=el.getBoundingClientRect(); setContainerSize({width:r.width,height:r.height}); }; update(); const ro=new ResizeObserver(update); ro.observe(el); return ()=>ro.disconnect(); },[]);

  // フィット
  const fit=(mode:'both'|'width'|'height'|'cover', bbox=macroBBox)=>{ if(!bbox) return; const {width,height}=bbox; const P=0.05; const availW=containerSize.width*(1-P*2); const availH=containerSize.height*(1-P*2); const sW=availW/width; const sH=availH/height; let s=sW; if(mode==='both') s=Math.min(sW,sH); if(mode==='height') s=sH; if(mode==='width') s=sW; if(mode==='cover') s=Math.max(sW,sH); setBaseFitScale(s); setZoom(1); setPan({ x:(containerSize.width-width*s)/2, y:(containerSize.height-height*s)/2 }); setFitMode(mode); };
  useEffect(()=>{ if(macroBBox) fit(fitMode, macroBBox); /* eslint-disable-next-line */ },[macroBBox, containerSize.width, containerSize.height]);
  useEffect(()=>{ if(macroBBox) fit(fitMode, macroBBox); /* eslint-disable-next-line */ },[selectedMacro]);

  const absScale = baseFitScale * zoom;

  // 可視領域 (マクロ座標)
  const visibleRegion = useMemo(()=>{ if(!macroBBox||absScale===0) return null; const inv=1/absScale; return { x0:-pan.x*inv+macroBBox.originX, y0:-pan.y*inv+macroBBox.originY, w:containerSize.width*inv, h:containerSize.height*inv }; },[macroBBox,absScale,pan.x,pan.y,containerSize]);

  // 描画ルーチン
  const draw = useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas||!macroBBox) return; const ctx=canvas.getContext('2d'); if(!ctx) return;
    const dpr=window.devicePixelRatio||1; const {width:cssW,height:cssH}=containerSize; if(canvas.width!==Math.round(cssW*dpr) || canvas.height!==Math.round(cssH*dpr)){ canvas.width=Math.round(cssW*dpr); canvas.height=Math.round(cssH*dpr); canvas.style.width=cssW+'px'; canvas.style.height=cssH+'px'; }
    ctx.save(); ctx.scale(dpr,dpr); ctx.clearRect(0,0,cssW,cssH); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,cssW,cssH);
    const {originX,originY,width:macroW,height:macroH}=macroBBox; ctx.translate(pan.x,pan.y); ctx.scale(absScale,absScale); ctx.translate(-originX,-originY); ctx.translate(0,macroH); ctx.scale(1,-1);
    const low=absScale<LOW_DETAIL_THRESHOLD; const reg=visibleRegion; const marginFactor=0.08; let vx0=-Infinity,vy0=-Infinity,vx1=Infinity,vy1=Infinity; if(reg){ const mx=reg.w*marginFactor; const my=reg.h*marginFactor; vx0=reg.x0-mx; vy0=reg.y0-my; vx1=reg.x0+reg.w+mx; vy1=reg.y0+reg.h+my; }
    const baseStroke=(Math.max(macroW,macroH)/1500); for(const r of allRects){ if(!visibleLayers.has(r.layer)) continue; if(!(r.x2>=vx0 && r.x1<=vx1 && r.y2>=vy0 && r.y1<=vy1)) continue; const w=r.x2-r.x1; const h=r.y2-r.y1; if(low && w*absScale<PIXEL_SKIP_THRESHOLD && h*absScale<PIXEL_SKIP_THRESHOLD) continue; const color=LAYER_COLORS[r.layer]||LAYER_COLORS.default; ctx.fillStyle=color; ctx.globalAlpha=low?0.55:0.8; ctx.fillRect(r.x1,r.y1,w,h); ctx.globalAlpha=1; ctx.lineWidth=baseStroke/absScale; ctx.strokeStyle='#000'; ctx.strokeRect(r.x1,r.y1,w,h); }
    ctx.lineWidth=(Math.max(macroW,macroH)/1500)/absScale; ctx.setLineDash([ (Math.max(macroW,macroH)/600), (Math.max(macroW,macroH)/600) ]); ctx.strokeStyle='#000'; ctx.strokeRect(0,0,macroW,macroH); ctx.setLineDash([]); ctx.restore();
    const now=performance.now(); const ft=frameTimesRef.current; ft.push(now); while(ft.length && now-ft[0]>1000) ft.shift(); setFps(ft.length);
  },[macroBBox,allRects,visibleLayers,absScale,pan.x,pan.y,containerSize,visibleRegion]);

  useEffect(()=>{ draw(); },[draw]);

  // ホイールズーム
  const handleWheel=(e:React.WheelEvent)=>{ if(!macroBBox) return; e.preventDefault(); const factor=e.deltaY<0?1.1:0.9; setZoom(prev=>{ const nz=Math.min(50,Math.max(0.02,prev*factor)); const rect=containerRef.current?.getBoundingClientRect(); const cx=(e.clientX-(rect?.left||0)-pan.x)/(baseFitScale*prev); const cy=(e.clientY-(rect?.top||0)-pan.y)/(baseFitScale*prev); setPan({ x:e.clientX-(rect?.left||0)-cx*baseFitScale*nz, y:e.clientY-(rect?.top||0)-cy*baseFitScale*nz }); return nz; }); };
  // パン操作
  const onMouseDown=(e:React.MouseEvent)=>{ if(e.button!==0)return; panStart.current={x:e.clientX,y:e.clientY,origX:pan.x,origY:pan.y}; setIsPanning(true); };
  const onMouseMove=(e:React.MouseEvent)=>{ if(!isPanning||!panStart.current)return; const dx=e.clientX-panStart.current.x; const dy=e.clientY-panStart.current.y; setPan({ x:panStart.current.origX+dx, y:panStart.current.origY+dy }); };
  const endPan=()=>{ setIsPanning(false); panStart.current=null; };

  // コントロール群
  const zoomIn=()=>setZoom(z=>Math.min(50,z*1.2));
  const zoomOut=()=>setZoom(z=>Math.max(0.02,z/1.2));
  const resetView=()=>{ if(macroBBox) fit(fitMode, macroBBox); };
  const fitWidth=()=>macroBBox&&fit('width');
  const fitHeight=()=>macroBBox&&fit('height');
  const fitBoth=()=>macroBBox&&fit('both');
  const fitCover=()=>macroBBox&&fit('cover');
  const toggleLayer=(layer:string)=> setVisibleLayers(prev=>{ const ns=new Set(prev); ns.has(layer)?ns.delete(layer):ns.add(layer); return ns; });

  const renderCanvasArea=()=>{ if(!selectedMacro||!macroBBox) return null; const {width:macroW,height:macroH,derived}=macroBBox; const low=absScale<LOW_DETAIL_THRESHOLD; return (
    <Card className="h-100 d-flex flex-column" style={{userSelect:isPanning?'none':'auto'}}>
      <Card.Header>
        <h5 className="mb-0 d-flex align-items-center flex-wrap">
          <span>{selectedMacro.name}</span>
          <Badge bg="secondary" className="ms-2">{selectedMacro.className}</Badge>
          {derived && <Badge bg="warning" text="dark" className="ms-2">Derived SIZE</Badge>}
        </h5>
        <small className="text-muted">Size: {macroW.toFixed(2)} × {macroH.toFixed(2)} units {derived && '(from geometry)'} | Rects {allRects.length} {low && 'LOD'} | Scale {absScale.toFixed(3)} | FPS {fps}</small>
      </Card.Header>
      <Card.Body className="p-1 flex-grow-1 d-flex" style={{minHeight:0}}>
        <div ref={containerRef} className="w-100 h-100 position-relative" style={{overflow:'hidden',cursor:isPanning?'grabbing':'default'}}
             onWheel={handleWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={endPan} onMouseUp={endPan}>
          <div style={{position:'absolute',top:6,left:6,zIndex:10,display:'flex',gap:4,background:'rgba(255,255,255,0.85)',padding:'4px 6px',borderRadius:4,boxShadow:'0 1px 3px rgba(0,0,0,0.25)',alignItems:'center'}}>
            <button className="btn btn-sm btn-outline-secondary" onClick={zoomIn}>+</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={zoomOut}>-</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={resetView}>Reset</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={fitWidth}>Fit W</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={fitHeight}>Fit H</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={fitBoth}>Fit Both</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={fitCover}>Cover</button>
            <span className="badge bg-light text-dark" style={{fontSize:10}}>{fitMode}</span>
          </div>
          <canvas ref={canvasRef} style={{width:'100%',height:'100%',display:'block',background:'#fff',border:'1px solid #ddd',borderRadius:4,boxShadow:'0 2px 4px rgba(0,0,0,0.1)'}} />
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
                    <ListGroup.Item key={i} className="py-1 px-2" style={{fontSize:'0.8rem'}}>
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
