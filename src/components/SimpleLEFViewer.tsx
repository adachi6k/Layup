import React, { useState, useCallback } from 'react';
import { Button } from 'react-bootstrap';
import { FileDropZone } from './FileDropZone';
import type { LEFData } from '../types/lef';
import { LEFParser } from '../utils/lefParser';

interface SimpleLEFViewerProps {
  onFileLoad: (content: string, filename: string) => void;
  onUrlLoad: (url: string) => void;
  onShowSample: () => void;
}

const LAYER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
  '#F7DC6F', '#BB8FCE', '#85C1E9', '#F8C471', '#82E0AA',
  '#F1948A', '#85C1E9', '#F8C471', '#BB8FCE', '#98D8C8'
];

export const SimpleLEFViewer: React.FC<SimpleLEFViewerProps> = ({
  onFileLoad,
  onShowSample,
}) => {
  const [lefData, setLefData] = useState<LEFData | null>(null);
  const [selectedMacro, setSelectedMacro] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // レイヤー表示状態
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set());
  const [availableLayers, setAvailableLayers] = useState<string[]>([]);

  // ファイル処理関数
  const handleFileLoad = useCallback(async (content: string, filename: string) => {
    try {
      setError(null);
      console.log('🔄 Processing LEF content...');
      
      const parser = new LEFParser();
      const data = parser.parse(content);
      
      console.log('📋 Parsed LEF data:', data);
      console.log('📦 Macros found:', data.macros.length);
      
      if (data.macros.length > 0) {
        const macro = data.macros[0];
        console.log('🎯 First macro:', macro.name);
        console.log('📏 Size:', macro.size);
        console.log('📍 Origin:', macro.origin);
        console.log('🔧 Pins:', macro.pins?.length || 0);
        console.log('🚧 Obstructions:', macro.obs?.length || 0);
      }
      
      setLefData(data);
      
      // 利用可能なレイヤーを収集
      const layers = new Set<string>();
      data.macros.forEach(macro => {
        macro.obs?.forEach(rect => layers.add(rect.layer));
        macro.pins?.forEach(pin => {
          pin.rects?.forEach(rect => layers.add(rect.layer));
        });
      });
      
      const layerList = Array.from(layers).sort();
      setAvailableLayers(layerList);
      setVisibleLayers(new Set(layerList));
      
      if (data.macros.length > 0) {
        setSelectedMacro(data.macros[0].name);
      }
      onFileLoad(content, filename);
    } catch (err) {
      console.error('❌ LEF parsing error:', err);
      setError(`解析エラー: ${err}`);
    }
  }, [onFileLoad]);

  // レイヤー表示切り替え
  const toggleLayer = (layerName: string) => {
    setVisibleLayers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(layerName)) {
        newSet.delete(layerName);
      } else {
        newSet.add(layerName);
      }
      return newSet;
    });
  };

  // 全レイヤー表示/非表示
  const toggleAllLayers = (show: boolean) => {
    if (show) {
      setVisibleLayers(new Set(availableLayers));
    } else {
      setVisibleLayers(new Set());
    }
  };

  // SVG生成関数
  const generateMacroSVG = () => {
    const macro = lefData?.macros.find(m => m.name === selectedMacro);
    if (!macro) {
      console.log('❌ No macro found for:', selectedMacro);
      return null;
    }

    console.log('🎨 Generating SVG for:', macro.name);

    // 簡単なテスト用SVG
    return (
      <svg 
        width="100%" 
        height="100%" 
        viewBox="0 0 200 200"
        style={{ border: '2px solid red', backgroundColor: 'lightgray' }}
      >
        {/* テスト用の図形 */}
        <rect x="10" y="10" width="180" height="180" fill="lightblue" stroke="blue" strokeWidth="2" />
        <circle cx="100" cy="100" r="50" fill="red" opacity="0.7" />
        <text x="100" y="100" textAnchor="middle" fill="white" fontSize="14">
          {macro.name}
        </text>
        <text x="100" y="120" textAnchor="middle" fill="black" fontSize="10">
          Size: {macro.size.width}x{macro.size.height}
        </text>
        
        {/* 実際のOBSとPINを描画 */}
        {macro.obs?.filter(rect => visibleLayers.has(rect.layer)).map((rect, index) => {
          const layerIndex = availableLayers.indexOf(rect.layer) % LAYER_COLORS.length;
          return (
            <rect
              key={`obs-${index}`}
              x={rect.x1}
              y={rect.y1}
              width={Math.abs(rect.x2 - rect.x1)}
              height={Math.abs(rect.y2 - rect.y1)}
              fill={LAYER_COLORS[layerIndex]}
              fillOpacity={0.6}
              stroke="#333"
              strokeWidth={0.5}
            />
          );
        })}

        {macro.pins?.map((pin, pinIndex) =>
          pin.rects?.filter(rect => visibleLayers.has(rect.layer)).map((rect, rectIndex) => {
            const layerIndex = availableLayers.indexOf(rect.layer) % LAYER_COLORS.length;
            return (
              <rect
                key={`pin-${pinIndex}-${rectIndex}`}
                x={rect.x1}
                y={rect.y1}
                width={Math.abs(rect.x2 - rect.x1)}
                height={Math.abs(rect.y2 - rect.y1)}
                fill={LAYER_COLORS[layerIndex]}
                fillOpacity={0.8}
                stroke="#000"
                strokeWidth={1}
              />
            );
          })
        )}
      </svg>
    );
  };

  return (
    <div className="w-100 h-100 d-flex flex-column">
      {/* ツールバー */}
      <div className="d-flex gap-2 p-3">
        <Button onClick={onShowSample} variant="primary">
          📖 サンプル表示
        </Button>
        {lefData && (
          <span className="align-self-center">
            Macro: {selectedMacro} | Layers: {availableLayers.length}
          </span>
        )}
      </div>

      {/* レイヤーコントロール */}
      {availableLayers.length > 0 && (
        <div className="d-flex gap-2 px-3 pb-3">
          <Button size="sm" onClick={() => toggleAllLayers(true)}>全て表示</Button>
          <Button size="sm" onClick={() => toggleAllLayers(false)}>全て非表示</Button>
          {availableLayers.map((layer, index) => {
            const isVisible = visibleLayers.has(layer);
            const layerColor = LAYER_COLORS[index % LAYER_COLORS.length];
            return (
              <Button
                key={layer}
                size="sm"
                variant={isVisible ? "primary" : "outline-secondary"}
                onClick={() => toggleLayer(layer)}
                style={{ borderColor: layerColor }}
              >
                <span 
                  style={{ 
                    display: 'inline-block',
                    width: '8px', 
                    height: '8px', 
                    backgroundColor: layerColor,
                    marginRight: '4px'
                  }}
                />
                {layer}
              </Button>
            );
          })}
        </div>
      )}

      {/* メインビューエリア */}
      <div className="flex-grow-1 position-relative">
        {error ? (
          <div className="h-100 d-flex align-items-center justify-content-center">
            <div className="text-center text-danger">
              <h4>エラー</h4>
              <p>{error}</p>
            </div>
          </div>
        ) : !lefData ? (
          <div className="h-100 d-flex align-items-center justify-content-center">
            <div className="text-center">
              <h4>LEFビューアー</h4>
              <p>「サンプル表示」ボタンをクリックするか、ファイルをドロップしてください</p>
              <div className="mt-3">
                <FileDropZone onFileLoad={handleFileLoad} />
              </div>
            </div>
          </div>
        ) : !selectedMacro ? (
          <div className="h-100 d-flex align-items-center justify-content-center">
            <div className="text-center">
              <h4>マクロが見つかりません</h4>
            </div>
          </div>
        ) : (
          <div className="w-100 h-100">
            {generateMacroSVG()}
          </div>
        )}
      </div>
    </div>
  );
};

export default SimpleLEFViewer;
