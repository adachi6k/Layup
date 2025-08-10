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
