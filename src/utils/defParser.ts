// DEF parser for DIEAREA, COMPONENTS, PINS, and optional NET connectivity.
import type { DEFData, DEFComponent, DEFPin, DEFNet } from '../types/def';

interface DEFParseOptions {
  parseNets?: boolean;
}

export function parseDEF(content: string, options: DEFParseOptions = {}): DEFData {
  const parseNets = options.parseNets ?? false;
  const rawLines = content.split(/\r?\n/);
  let version = '';
  let units = 1000; // default fallback
  let dieArea = { x1: 0, y1: 0, x2: 0, y2: 0 };
  const components: DEFComponent[] = [];
  let inComponents = false;
  let currentComp: { name:string; macro:string; block:string[] } | null = null;
  // PINS
  const pins: DEFPin[] = [];
  let inPins = false;
  let currentPin: { name:string; block:string[] } | null = null;
  // NETS (接続のみ)
  const nets: DEFNet[] = [];
  let inNets = false;
  let inSpecialNets = false;
  let currentNet: { name:string; conns: {inst?:string; pin:string; isTopPin:boolean}[] } | null = null;

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
  const flushPin = () => {
    if(!currentPin) return;
    const full = currentPin.block.join(' ');
    // 例: - PAD1 + NET CLK + DIRECTION INPUT + USE SIGNAL + LAYER M3 ( 100 200 ) ( 120 220 ) + PLACED ( 100 200 ) N ;
    const name = currentPin.name;
    let net: string|undefined; const netM = full.match(/\+\s+NET\s+(\S+)/i); if(netM) net=netM[1];
    let direction: string|undefined; const dirM = full.match(/\+\s+DIRECTION\s+(INPUT|OUTPUT|INOUT|FEEDTHRU)/i); if(dirM) direction=dirM[1].toUpperCase();
    let use: string|undefined; const useM = full.match(/\+\s+USE\s+(SIGNAL|POWER|GROUND|CLOCK|ANALOG|SCAN|RESET)/i); if(useM) use=useM[1].toUpperCase();
    let layer: string|undefined; let shape: {x1:number;y1:number;x2:number;y2:number}|undefined;
    const layerRectM = full.match(/\+\s+LAYER\s+(\S+)\s+\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)\s*\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)/i);
    if(layerRectM){ layer=layerRectM[1]; shape={ x1:+layerRectM[2], y1:+layerRectM[3], x2:+layerRectM[4], y2:+layerRectM[5] }; }
    // 位置: + PLACED ( x y ) N  / + FIXED ( x y ) N
    let x=0,y=0,orient='N',placed=false,fixed=false;
    const placedM = full.match(/\+\s+(PLACED|FIXED)\s*\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)\s*(\w+)?/i);
    if(placedM){ placed=true; fixed=/FIXED/i.test(placedM[1]); x=+placedM[2]; y=+placedM[3]; if(placedM[4]) orient=placedM[4]; }
    pins.push({ name, net, direction, use, layer, shape, x, y, orient, placed, fixed });
    currentPin=null;
  };
  const flushNet = () => {
    if(!currentNet) return;
    nets.push({ name: currentNet.name, connections: currentNet.conns });
    currentNet=null;
  };

  for(let i=0;i<rawLines.length;i++){
    const line = rawLines[i].replace(/\t/g,' ').trim();
    if(line.length===0) continue;
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
    } else if(line.startsWith('PINS ')){
      inPins=true; continue;
    } else if(inPins && line.startsWith('END PINS')){
      if(currentPin) flushPin();
      inPins=false; continue;
    } else if(line.startsWith('SPECIALNETS ')){
      inSpecialNets=true; continue;
    } else if(inSpecialNets && line.startsWith('END SPECIALNETS')){
      inSpecialNets=false; continue;
    } else if(line.startsWith('NETS ')){
      inNets=true; continue;
    } else if(inNets && line.startsWith('END NETS')){
      if(currentNet) flushNet();
      inNets=false; continue;
    } else if(inComponents && line.startsWith('-')){
      // 新規コンポーネント開始: - <name> <macro> ... ; (継続あり)
      if(currentComp) flushComponent();
      const m=line.match(/-\s+(\S+)\s+(\S+)/);
      if(m){
        currentComp={ name:m[1], macro:m[2], block:[line] };
        if(/;\s*$/.test(line)) flushComponent(); // 単行完結
      }
      continue;
    } else if(inPins && line.startsWith('-')){
      if(currentPin) flushPin();
      const m=line.match(/-\s+(\S+)/);
      if(m){ currentPin={ name:m[1], block:[line] }; if(/;\s*$/.test(line)) flushPin(); }
      continue;
    } else if(inNets && parseNets && line.startsWith('-')){
      if(currentNet) flushNet();
      // ネット開始: - <netName> ( inst pin ) ( PIN <pinName> ) ... ;
      const m=line.match(/-\s+(\S+)/);
      if(m){ currentNet={ name:m[1], conns:[] }; }
      // この行に既に接続が含まれる場合もあるので後で共通処理
    }
    if(inSpecialNets) {
      continue;
    } else if(inNets && !parseNets) {
      continue;
    } else if(inNets && currentNet){
      // 接続トークン抽出: ( inst pin ) or ( PIN <name> )
      const connRe=/\(\s*(PIN|\S+)\s+(\S+)\s*\)/g; let cm:RegExpExecArray|null;
      while((cm=connRe.exec(line))){
        if(cm[1]==='PIN') currentNet.conns.push({ isTopPin:true, pin:cm[2] });
        else currentNet.conns.push({ inst:cm[1], pin:cm[2], isTopPin:false });
      }
      if(/;\s*$/.test(line)) flushNet();
      continue;
    } else if(inComponents && currentComp){
      currentComp.block.push(line);
      if(/;\s*$/.test(line)) flushComponent();
      continue;
    } else if(inPins && currentPin){
      currentPin.block.push(line);
      if(/;\s*$/.test(line)) flushPin();
      continue;
    }
  }
  if(currentComp) flushComponent();
  if(currentPin) flushPin();
  if(currentNet) flushNet();

  const result: DEFData = { version, units, dieArea, components, pins, nets };
  return result;
}
