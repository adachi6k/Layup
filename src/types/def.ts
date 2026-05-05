// DEFファイル用型定義
// Phase A: VERSION, UNITS, DIEAREA, COMPONENTS に加え PINS / NETS(接続のみ) をサポート

export interface DEFComponent {
  name: string;
  macro: string;
  x: number; // DBU
  y: number; // DBU
  orient: string; // R0, MX, MY, R90, etc.
  placed: boolean;
}

export interface DEFPin {
  name: string;
  net?: string; // + NET <netName>
  direction?: string; // + DIRECTION INPUT/OUTPUT/INOUT/FEEDTHRU
  use?: string; // + USE SIGNAL/POWER/GROUND/CLOCK/ANALOG/SCAN/RESET
  layer?: string; // 最初に出現した + LAYER の層名
  shape?: { x1:number; y1:number; x2:number; y2:number }; // LAYER の矩形 (DBU)
  x: number; // + PLACED/FIXED 座標 (DBU)
  y: number;
  orient: string; // + PLACED/FIXED の向き (無ければ N 相当)
  placed: boolean; // PLACED or FIXED
  fixed: boolean; // FIXED の場合 true
}

export interface DEFNetConnection {
  inst?: string; // インスタンス名 (トップピンの場合 undefined)
  pin: string;   // ピン名
  isTopPin: boolean; // ( PIN <name> ) の場合 true
}

export interface DEFNet {
  name: string;
  connections: DEFNetConnection[];
}

export interface DEFData {
  version: string;
  units: number; // DBU per micron
  dieArea: { x1: number; y1: number; x2: number; y2: number };
  components: DEFComponent[];
  pins: DEFPin[];
  nets: DEFNet[]; // Phase A は ROUTED セグメント未対応（接続リストのみ）
}
