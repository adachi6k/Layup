// DEFファイルMVPパーサ（DIEAREA, COMPONENTS, UNITS, VERSIONのみ）
import type { DEFData, DEFComponent } from '../types/def';

export function parseDEF(content: string): DEFData {
  const rawLines = content.split(/\r?\n/);
  const lines = rawLines.map(l => l.replace(/\t/g,' ').trim()).filter(l => l.length>0);
  let version = '';
  let units = 1000; // default fallback
  let dieArea = { x1: 0, y1: 0, x2: 0, y2: 0 };
  const components: DEFComponent[] = [];
  let inComponents = false;
  let currentComp: { name:string; macro:string; block:string[] } | null = null;

  const flushComponent = () => {
    if(!currentComp) return;
    const full = currentComp.block.join(' ');
    // PLACED 形式バリエーション対応: + PLACED ( x y ) N ; / + PLACED x y N ;
    let placed=false, x=0,y=0, orient='R0';
    const placedParen = full.match(/\+\s+PLACED\s*\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)\s+(\w+)/i);
    const placedNoParen = !placedParen ? full.match(/\+\s+PLACED\s+([\d.+-]+)\s+([\d.+-]+)\s+(\w+)/i) : null;
    if(placedParen){ placed=true; x=+placedParen[1]; y=+placedParen[2]; orient=placedParen[3]; }
    else if(placedNoParen){ placed=true; x=+placedNoParen[1]; y=+placedNoParen[2]; orient=placedNoParen[3]; }
    components.push({ name: currentComp.name, macro: currentComp.macro, x, y, orient, placed });
    currentComp=null;
  };

  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    if(line.startsWith('VERSION')){
      const m=line.match(/VERSION\s+([0-9.]+)/); if(m) version=m[1];
    } else if(line.startsWith('UNITS DISTANCE MICRONS')){
      const m=line.match(/UNITS DISTANCE MICRONS\s+(\d+)/); if(m) units=parseInt(m[1],10);
    } else if(line.startsWith('DIEAREA')){
      const m=line.match(/DIEAREA\s+\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)\s+\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)/i);
      if(m) dieArea={ x1:+m[1], y1:+m[2], x2:+m[3], y2:+m[4] };
    } else if(line.startsWith('COMPONENTS ')){
      inComponents=true; continue;
    } else if(inComponents && line.startsWith('END COMPONENTS')){
      // flush any pending
      if(currentComp) flushComponent();
      inComponents=false; continue;
    } else if(inComponents && line.startsWith('-')){
      // 新規コンポーネント開始: - <name> <macro> ... ; (継続あり)
      if(currentComp) flushComponent();
      const m=line.match(/-\s+(\S+)\s+(\S+)/);
      if(m){
        currentComp={ name:m[1], macro:m[2], block:[line] };
        if(/;\s*$/.test(line)) flushComponent(); // 単行完結
      }
      continue;
    } else if(inComponents && currentComp){
      currentComp.block.push(line);
      if(/;\s*$/.test(line)) flushComponent();
      continue;
    }
  }
  if(currentComp) flushComponent();

  const result: DEFData = { version, units, dieArea, components };
  if((import.meta as any)?.env?.DEV){
    // eslint-disable-next-line no-console
    console.log('[DEF Parser]', {
      version, units,
      dieArea: `${dieArea.x1},${dieArea.y1} -> ${dieArea.x2},${dieArea.y2}`,
      componentCount: components.length,
      placed: components.filter(c=>c.placed).length,
      sample: components.slice(0,3)
    });
  }
  return result;
}
