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
  direction: 'INPUT' | 'OUTPUT' | 'INOUT';
  use: 'SIGNAL' | 'POWER' | 'GROUND';
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
  via?: any[]; // VIA definitions if needed
}

// Color mapping for different layers
// Virtuoso風の落ち着いた配色 (一般的な金属層の色イメージ / 認識性とコントラストを考慮)
// 目的:
//  - 隣接メタル層で十分な色差を確保 (Hue 距離 + 明度差)
//  - ビアは段階的な明度グレイで統一
//  - 電源/グラウンドは従来色を維持 (VDD=赤, VSS=黒)
//  - 背景が白でも視認性を確保 (WCAG近似コントラスト > 3:1 を目安)
export const LAYER_COLORS: Record<string, string> = {
  M1: '#C8B560',      // Warm buff / poly~metal1系を意識した落ち着いた黄土
  M2: '#6DAA2C',      // 緑系 (M1との色相差大)
  M3: '#D16BA5',      // マゼンタ寄り (配線密度把握で視認性高い)
  M4: '#2F8FCC',      // ブルー (冷色でM3と対比)
  M5: '#F3C623',      // 明るいゴールド (高層メタルを強調)
  M6: '#FF8C42',      // オレンジ (熱色、M5との差異確保)
  M7: '#8F6BD1',      // バイオレット (高層識別)
  M8: '#23B5AF',      // ティール (他高層との彩度差)
  // ビア (階層ごと明度変化)
  V1: '#606060',
  V2: '#777777',
  V3: '#929292',
  V4: '#ADADAD',
  V5: '#C7C7C7',
  // 電源/グラウンド
  VDD: '#FF0000',
  VSS: '#000000',
  // フォールバック
  default: '#808080'
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
