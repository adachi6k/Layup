// DEFファイル用型定義（MVP: DIEAREA, COMPONENTS, UNITS, VERSIONのみ）

export interface DEFComponent {
  name: string;
  macro: string;
  x: number;
  y: number;
  orient: string; // R0, MX, MY, R90, etc.
  placed: boolean;
}

export interface DEFData {
  version: string;
  units: number; // DBU per micron
  dieArea: { x1: number; y1: number; x2: number; y2: number };
  components: DEFComponent[];
}
