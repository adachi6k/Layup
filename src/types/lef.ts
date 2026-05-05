// LEF file data structures

export interface LEFCoordinate {
  x: number;
  y: number;
}

export interface LEFRect {
  layer: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LEFPin {
  name: string;
  direction: 'INPUT' | 'OUTPUT' | 'INOUT' | 'FEEDTHRU' | 'UNKNOWN';
  use: 'SIGNAL' | 'POWER' | 'GROUND' | 'CLOCK' | 'ANALOG' | 'SCAN' | 'RESET' | 'UNKNOWN';
  rects: LEFRect[];
}

export interface LEFMacro {
  name: string;
  className: string;
  origin: LEFCoordinate;
  size: {
    width: number;
    height: number;
  };
  pins: LEFPin[];
  obs: LEFRect[]; // Obstruction rectangles
}

export interface LEFLayer {
  name: string;
  type: 'ROUTING' | 'CUT' | 'OVERLAP' | 'MASTERSLICE';
  spacing?: number;
}

export interface LEFData {
  version: string;
  layers: LEFLayer[];
  macros: LEFMacro[];
  via?: unknown[]; // VIA definitions if needed
}

// Color mapping for different layers
// ビビッドな配色 (認識性・暗背景両対応)
// 目的:
//  - 隣接メタル層で十分な色差を確保 (Hue 距離 + 彩度を高めて明瞭に)
//  - ビアは段階的な明度グレイで統一 (明るめ設定で暗背景にも対応)
//  - 電源/グラウンドは従来色を維持 (VDD=赤, VSS=グレー)
//  - 黒・白背景どちらでも視認性を確保
export const LAYER_COLORS: Record<string, string> = {
  M1: '#00AAFF',      // Vivid Sky Blue
  M2: '#FF3333',      // Vivid Red
  M3: '#33DD33',      // Vivid Green
  M4: '#FFD700',      // Vivid Gold / Yellow
  M5: '#FF44CC',      // Vivid Pink/Magenta
  M6: '#00EEBB',      // Vivid Cyan/Teal
  M7: '#FF8800',      // Vivid Orange
  M8: '#BB55FF',      // Vivid Violet
  // ビア (明るめグレイで暗背景対応)
  V1: '#888888',
  V2: '#999999',
  V3: '#AAAAAA',
  V4: '#BBBBBB',
  V5: '#CCCCCC',
  // 電源/グラウンド
  VDD: '#FF2222',
  VSS: '#999999',
  // フォールバック
  default: '#AAAAAA'
};

// 未定義レイヤー色の決定規則
// 1) 既知名 (LAYER_COLORS) はそのまま使用
// 2) Metal: M<number> は M1..M8 以外にも対応し、番号から色を生成
// 3) Via:   V<number> は明度違いのグレイスケールを生成
// 4) その他はレイヤー名のハッシュからHSL色を安定生成
const toHex = (n: number) => n.toString(16).padStart(2, '0');
const hslToHex = (h: number, s: number, l: number): string => {
  // h:[0,360), s/l:[0,100]
  const S = s / 100, L = l / 100;
  const C = (1 - Math.abs(2 * L - 1)) * S;
  const Hp = (h % 360) / 60;
  const X = C * (1 - Math.abs((Hp % 2) - 1));
  let r=0, g=0, b=0;
  if (0 <= Hp && Hp < 1) { r=C; g=X; b=0; }
  else if (1 <= Hp && Hp < 2) { r=X; g=C; b=0; }
  else if (2 <= Hp && Hp < 3) { r=0; g=C; b=X; }
  else if (3 <= Hp && Hp < 4) { r=0; g=X; b=C; }
  else if (4 <= Hp && Hp < 5) { r=X; g=0; b=C; }
  else { r=C; g=0; b=X; }
  const m = L - C/2;
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return `#${toHex(R)}${toHex(G)}${toHex(B)}`;
};

const hash32 = (str: string): number => {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const getLayerColor = (layerName: string): string => {
  if (!layerName) return LAYER_COLORS.default;
  const key = layerName.trim().toUpperCase();
  if (LAYER_COLORS[key]) return LAYER_COLORS[key];

  // Metal N (beyond predefined)
  const m = key.match(/^M(\d+)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 8) return LAYER_COLORS[key] || LAYER_COLORS.default;
    // 周期色 (8色) + 番号に応じた明度微調整で差別化
    const baseHues = [45, 95, 320, 205, 50, 25, 265, 185]; // 既存配色に近いヒュー
    const idx = (n - 1) % baseHues.length;
    const tier = Math.floor((n - 1) / baseHues.length); // 0,1,2...
    const h = baseHues[idx];
    const s = 62;
    const l = Math.max(35, Math.min(70, 55 + (tier % 3 - 1) * 8)); // 47/55/63 付近
    return hslToHex(h, s, l);
  }

  // Via N
  const v = key.match(/^V(\d+)$/);
  if (v) {
    const n = parseInt(v[1], 10);
    const l = Math.max(30, Math.min(85, 45 + n * 5)); // 番号で少しずつ明るく
    return hslToHex(0, 0, l);
  }

  // その他は安定ハッシュ
  const h = hash32(key);
  const hue = h % 360;
  const sat = 58 + (h >>> 10) % 12; // 58-69
  const lig = 48 + (h >>> 20) % 12; // 48-59
  return hslToHex(hue, sat, lig);
};
