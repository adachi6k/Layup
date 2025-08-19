import { parseDEF } from '../src/utils/defParser';

const sample = `VERSION 5.8 ;
UNITS DISTANCE MICRONS 1000 ;
DIEAREA ( 0 0 ) ( 120000 80000 ) ;
COMPONENTS 2 ;
- U1 NAND2_X1 + PLACED 1000 2000 N ;
- U2 INV_X1 + PLACED 3000 4000 FS ;
END COMPONENTS
END DESIGN`; 

const data = parseDEF(sample);
console.log('version', data.version);
console.log('units', data.units);
console.log('dieArea', data.dieArea);
console.log('components', data.components);
