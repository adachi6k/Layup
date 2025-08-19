import React, { useRef, useEffect } from 'react';
import type { DEFData } from '../types/def';
import type { LEFData } from '../types/lef';

interface DEFOverlayCanvasProps {
  def: DEFData;
  lef: LEFData | null;
  scale: number; // μm -> screen px (caller supplies)
}

// 単純版: DIEAREA / COMPONENTS の矩形輪郭だけ
export const DEFOverlayCanvas: React.FC<DEFOverlayCanvasProps> = ({ def, lef, scale }) => {
  const ref = useRef<HTMLCanvasElement|null>(null);

  useEffect(()=>{
    const canvas = ref.current; if(!canvas) return; const ctx = canvas.getContext('2d'); if(!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr); ctx.scale(dpr,dpr);
    ctx.clearRect(0,0,w,h);
    // 背景透明: LEF側に重ねる前提
    const { dieArea, units } = def;
    const dbuToUm = (v:number)=> v / units;

    if(dieArea.x1 !== dieArea.x2 || dieArea.y1 !== dieArea.y2){
      const x = dbuToUm(dieArea.x1)*scale;
      const y = dbuToUm(dieArea.y1)*scale;
      const ww = (dbuToUm(dieArea.x2)-dbuToUm(dieArea.x1))*scale;
      const hh = (dbuToUm(dieArea.y2)-dbuToUm(dieArea.y1))*scale;
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.setLineDash([6,4]);
      ctx.strokeRect(x,y,ww,hh);
      ctx.setLineDash([]);
    }

    // Components (暫定: マクロ寸法がLEFにある場合のみ描く)
    if(lef){
      const macroMap = new Map<string, {w:number;h:number}>();
      for(const m of lef.macros){ macroMap.set(m.name, {w:m.size.width, h:m.size.height}); }
      ctx.strokeStyle = 'rgba(0,123,255,0.7)';
      ctx.lineWidth = 1;
      for(const c of def.components){
        if(!c.placed) continue;
        const dim = macroMap.get(c.macro);
        if(!dim) continue;
        const x = dbuToUm(c.x)*scale;
        const y = dbuToUm(c.y)*scale;
        const wum = dim.w*scale;
        const hum = dim.h*scale;
        ctx.strokeRect(x,y,wum,hum);
      }
    }
  },[def,lef,scale]);

  return <canvas ref={ref} style={{position:'absolute', inset:0, pointerEvents:'none'}} />;
};
