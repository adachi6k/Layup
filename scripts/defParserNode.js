// Minimal duplicated parser for smoke test without build tooling
function parseDEF(content){
  const lines = content.split(/\r?\n/).map(l=>l.trim());
  let version=''; let units=1000; let dieArea={x1:0,y1:0,x2:0,y2:0};
  const components=[]; let inComponents=false;
  for(const line of lines){
    if(line.startsWith('VERSION')){const m=line.match(/VERSION\s+([0-9.]+)/); if(m) version=m[1];}
    else if(line.startsWith('UNITS DISTANCE MICRONS')){const m=line.match(/UNITS DISTANCE MICRONS\s+(\d+)/); if(m) units=parseInt(m[1],10);}    else if(line.startsWith('DIEAREA')){const m=line.match(/DIEAREA\s+\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)\s+\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)/i); if(m) dieArea={x1:+m[1],y1:+m[2],x2:+m[3],y2:+m[4]};}
    else if(line.startsWith('COMPONENTS')) inComponents=true;
    else if(inComponents && line.startsWith('END COMPONENTS')) inComponents=false;
    else if(inComponents && line.startsWith('-')){const m=line.match(/-\s+(\S+)\s+(\S+)(?:\s+\+\s+PLACED\s+([\d.+-]+)\s+([\d.+-]+)\s+(\w+))?/); if(m){components.push({name:m[1],macro:m[2],x:m[3]?+m[3]:0,y:m[4]?+m[4]:0,orient:m[5]||'R0',placed:!!m[3]});}}
  }
  return {version,units,dieArea,components};
}
const sample=`VERSION 5.8 ;\nUNITS DISTANCE MICRONS 1000 ;\nDIEAREA ( 0 0 ) ( 120000 80000 ) ;\nCOMPONENTS 2 ;\n- U1 NAND2_X1 + PLACED 1000 2000 N ;\n- U2 INV_X1 + PLACED 3000 4000 FS ;\nEND COMPONENTS\nEND DESIGN`;
console.log(parseDEF(sample));
