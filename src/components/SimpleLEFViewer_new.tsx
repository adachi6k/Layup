import React, { useState, useCallback } from 'react';
import { Button, Offcanvas } from 'react-bootstrap';
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
  const [showSidebar, setShowSidebar] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // ズーム・パン状態
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // レイヤー表示状態
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set());
  const [availableLayers, setAvailableLayers] = useState<string[]>([]);

  // ファイル処理関数
  const handleFileLoad = useCallback(async (content: string, filename: string) => {
    try {
      setError(null);
      
      // 入力データの検証
      if (typeof content !== 'string') {
        throw new Error(`Expected string content, got ${typeof content}`);
      }
      
      if (!content || content.trim().length === 0) {
        throw new Error('Content is empty or null');
      }
      
      const parser = new LEFParser();
      const data = parser.parse(content);
      
      // デバッグ情報を出力
      console.log('📋 Parsed LEF data:', data);
      if (data.macros.length > 0) {
        const macro = data.macros[0];
        console.log('📦 Macro:', macro.name);
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
      // デフォルトで全レイヤーを表示
      setVisibleLayers(new Set(layerList));
      
      if (data.macros.length > 0) {
        setSelectedMacro(data.macros[0].name);
      }
      onFileLoad(content, filename);
    } catch (err) {
      console.error('LEF parsing error:', err);
      const errorMessage = err instanceof Error 
        ? `Failed to parse LEF file: ${err.message}` 
        : 'ファイルの解析に失敗しました';
      setError(errorMessage);
    }
  }, [onFileLoad]);

  const handleFileRead = useCallback(async (file: File) => {
    try {
      if (!file) {
        throw new Error('No file provided');
      }
      
      if (file.size === 0) {
        throw new Error('File is empty');
      }
      
      const text = await file.text();
      
      if (typeof text !== 'string') {
        throw new Error(`Expected string from file.text(), got ${typeof text}`);
      }
      
      handleFileLoad(text, file.name);
    } catch (err) {
      console.error('File reading error:', err);
      setError(`ファイルの読み込みに失敗しました: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [handleFileLoad]);

  // レイヤー表示切り替え
  const toggleLayer = useCallback((layerName: string) => {
    setVisibleLayers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(layerName)) {
        newSet.delete(layerName);
      } else {
        newSet.add(layerName);
      }
      return newSet;
    });
  }, []);

  // 全レイヤー表示/非表示
  const toggleAllLayers = useCallback((show: boolean) => {
    if (show) {
      setVisibleLayers(new Set(availableLayers));
    } else {
      setVisibleLayers(new Set());
    }
  }, [availableLayers]);

  // ドラッグ&ドロップ処理（グローバル）
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    const lefFile = files.find(file => 
      file.name.toLowerCase().endsWith('.lef') || 
      file.type === 'text/plain'
    );
    
    if (lefFile) {
      handleFileRead(lefFile);
    } else {
      setError('LEFファイル (.lef) を選択してください');
    }
  }, [handleFileRead]);

  // マウス・ホイール操作
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * -0.01;
    const newScale = Math.min(Math.max(0.1, scale * (1 + delta)), 10);
    setScale(newScale);
  }, [scale]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX - panX, y: e.clientY - panY });
  }, [panX, panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPanX(e.clientX - panStart.x);
    setPanY(e.clientY - panStart.y);
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setPanX(0);
    setPanY(0);
  }, []);

  // SVG生成関数
  const generateMacroSVG = () => {
    const macro = lefData?.macros.find(m => m.name === selectedMacro);
    if (!macro) return null;

    const allLayers = new Set<string>();
    
    // obstruction から全レイヤーを収集
    macro.obs?.forEach(rect => {
      allLayers.add(rect.layer);
    });

    // pins の rects から全レイヤーを収集
    macro.pins?.forEach(pin => {
      pin.rects?.forEach(rect => {
        allLayers.add(rect.layer);
      });
    });

    const layers = Array.from(allLayers);

    // マクロサイズを使用してビューボックスを設定
    const macroWidth = macro.size.width;
    const macroHeight = macro.size.height;
    const originX = macro.origin.x;
    const originY = macro.origin.y;

    // LEF座標系からSVG座標系への変換のためのベース座標
    const leftX = originX;
    const bottomY = originY;
    const topY = originY + macroHeight;

    const margin = Math.max(macroWidth, macroHeight) * 0.1; // 10%のマージン
    const viewBoxWidth = macroWidth + 2 * margin;
    const viewBoxHeight = macroHeight + 2 * margin;
    const viewBoxX = leftX - margin;
    const viewBoxY = bottomY - margin;

    // LEF座標をSVG座標に変換する関数
    const lefToSvgY = (lefY: number) => {
      // LEFのY座標を上下反転してSVG座標系に変換
      return topY + bottomY - lefY;
    };

    return (
      <svg 
        width="100%" 
        height="100%" 
        viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`}
        style={{ 
          cursor: isPanning ? 'grabbing' : 'grab',
          transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
          transformOrigin: 'center center'
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* マクロの境界線 */}
        <rect
          x={leftX}
          y={lefToSvgY(topY)}
          width={macroWidth}
          height={macroHeight}
          fill="none"
          stroke="#666"
          strokeWidth={2}
          strokeDasharray="5,5"
        />

        {/* Obstructions */}
        {macro.obs?.filter(rect => visibleLayers.has(rect.layer)).map((rect, index) => {
          const layerIndex = layers.indexOf(rect.layer) % LAYER_COLORS.length;
          const x = Math.min(rect.x1, rect.x2);
          const y = lefToSvgY(Math.max(rect.y1, rect.y2));
          const width = Math.abs(rect.x2 - rect.x1);
          const height = Math.abs(rect.y2 - rect.y1);
          
          return (
            <rect
              key={`obs-${index}`}
              x={x}
              y={y}
              width={width}
              height={height}
              fill={LAYER_COLORS[layerIndex]}
              fillOpacity={0.6}
              stroke="#333"
              strokeWidth={0.5}
            />
          );
        })}

        {/* Pins */}
        {macro.pins?.map((pin, pinIndex) =>
          pin.rects?.filter(rect => visibleLayers.has(rect.layer)).map((rect, rectIndex) => {
            const layerIndex = layers.indexOf(rect.layer) % LAYER_COLORS.length;
            const x = Math.min(rect.x1, rect.x2);
            const y = lefToSvgY(Math.max(rect.y1, rect.y2));
            const width = Math.abs(rect.x2 - rect.x1);
            const height = Math.abs(rect.y2 - rect.y1);
            
            return (
              <rect
                key={`pin-${pinIndex}-${rectIndex}`}
                x={x}
                y={y}
                width={width}
                height={height}
                fill={LAYER_COLORS[layerIndex]}
                fillOpacity={0.8}
                stroke="#000"
                strokeWidth={1}
              />
            );
          })
        )}

        {/* Pin labels */}
        {macro.pins?.map((pin, pinIndex) => {
          // ピンの最初のrectの中心にラベルを配置
          const firstRect = pin.rects?.[0];
          if (!firstRect) return null;
          
          const centerX = (firstRect.x1 + firstRect.x2) / 2;
          const centerY = lefToSvgY((firstRect.y1 + firstRect.y2) / 2);
          
          return (
            <text
              key={`pin-label-${pinIndex}`}
              x={centerX}
              y={centerY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={Math.min(macroWidth, macroHeight) * 0.05}
              fill="#000"
              fontWeight="bold"
            >
              {pin.name}
            </text>
          );
        })}
      </svg>
    );
  };

  return (
    <div 
      className="position-relative w-100 h-100"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* グローバルドラッグオーバーレイ */}
      {isDragOver && (
        <div 
          className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style={{ 
            backgroundColor: 'rgba(0, 123, 255, 0.1)', 
            zIndex: 9999,
            border: '3px dashed #007bff',
            pointerEvents: 'none'
          }}
        >
          <div className="text-center">
            <h2 className="text-primary">📁 LEFファイルをドロップしてください</h2>
            <p className="text-muted">新しいファイルに切り替わります</p>
          </div>
        </div>
      )}

      {/* フローティングツールバー（左上） */}
      <div 
        className="position-absolute top-0 start-0 m-3 d-flex gap-2"
        style={{ zIndex: 1000 }}
      >
        <Button 
          variant="primary" 
          size="sm"
          onClick={() => setShowSidebar(true)}
          style={{ 
            backgroundColor: 'rgba(0, 123, 255, 0.9)',
            border: 'none',
            backdropFilter: 'blur(10px)'
          }}
        >
          📁 ファイル選択
        </Button>
        <Button 
          variant="secondary" 
          size="sm"
          onClick={onShowSample}
          style={{ 
            backgroundColor: 'rgba(108, 117, 125, 0.9)',
            border: 'none',
            backdropFilter: 'blur(10px)'
          }}
        >
          📖 サンプル表示
        </Button>
      </div>

      {/* フローティングズームコントロール（右上） */}
      {lefData && (
        <div 
          className="position-absolute top-0 end-0 m-3 d-flex align-items-center gap-2"
          style={{ zIndex: 1000 }}
        >
          <span 
            className="text-white px-2 py-1 rounded"
            style={{ 
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(10px)',
              fontSize: '0.875rem'
            }}
          >
            ズーム: {(scale * 100).toFixed(0)}%
          </span>
          <Button 
            variant="outline-light" 
            size="sm" 
            onClick={resetView}
            style={{ 
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.3)'
            }}
          >
            🔄 リセット
          </Button>
        </div>
      )}

      {/* フローティングレイヤーコントロール（左下） */}
      {lefData && availableLayers.length > 0 && (
        <div 
          className="position-absolute bottom-0 start-0 m-3 p-3 rounded"
          style={{ 
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(10px)',
            zIndex: 1000,
            maxWidth: '300px',
            maxHeight: '50vh',
            overflowY: 'auto'
          }}
        >
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h6 className="text-white mb-0">🎨 レイヤー</h6>
            <div className="d-flex gap-1">
              <Button 
                variant="outline-light" 
                size="sm"
                onClick={() => toggleAllLayers(true)}
                style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }}
              >
                全て
              </Button>
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={() => toggleAllLayers(false)}
                style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }}
              >
                なし
              </Button>
            </div>
          </div>
          
          <div className="d-flex flex-wrap gap-1">
            {availableLayers.map((layer, index) => {
              const isVisible = visibleLayers.has(layer);
              const layerColor = LAYER_COLORS[index % LAYER_COLORS.length];
              return (
                <Button
                  key={layer}
                  variant={isVisible ? "light" : "outline-light"}
                  size="sm"
                  onClick={() => toggleLayer(layer)}
                  className="d-flex align-items-center gap-1"
                  style={{ 
                    fontSize: '0.75rem', 
                    padding: '0.25rem 0.5rem',
                    opacity: isVisible ? 1 : 0.5,
                    border: `2px solid ${layerColor}`
                  }}
                >
                  <div 
                    style={{ 
                      width: '8px', 
                      height: '8px', 
                      backgroundColor: layerColor,
                      borderRadius: '2px'
                    }}
                  />
                  {layer}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* 全画面ビューポート */}
      <div className="w-100 h-100 position-relative overflow-hidden">
        {error ? (
          <div className="h-100 d-flex align-items-center justify-content-center">
            <div className="text-center">
              <div className="text-danger fs-1 mb-3">⚠️</div>
              <h4 className="text-danger">エラーが発生しました</h4>
              <p className="text-muted">{error}</p>
            </div>
          </div>
        ) : !lefData ? (
          <div className="h-100 d-flex align-items-center justify-content-center">
            <div className="text-center">
              <div className="fs-1 mb-3">📄</div>
              <h4>LEFビューアー</h4>
              <p className="text-muted">ファイルを選択するか、ドラッグ&ドロップしてください</p>
              <div className="mt-3">
                <FileDropZone onFileLoad={handleFileLoad} />
              </div>
            </div>
          </div>
        ) : !selectedMacro ? (
          <div className="h-100 d-flex align-items-center justify-content-center">
            <div className="text-center">
              <div className="text-warning fs-1 mb-3">📦</div>
              <h4>マクロが見つかりません</h4>
              <p className="text-muted">LEFファイルにマクロが含まれていません</p>
            </div>
          </div>
        ) : (
          <div className="w-100 h-100">
            {generateMacroSVG()}
          </div>
        )}
      </div>

      {/* サイドバー */}
      <Offcanvas show={showSidebar} onHide={() => setShowSidebar(false)} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>ファイル選択</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <div className="mb-3">
            <h6>LEFファイルを読み込み</h6>
            <FileDropZone onFileLoad={handleFileLoad} />
          </div>
          
          {lefData && (
            <div className="mt-4">
              <h6>マクロ選択</h6>
              <div className="list-group">
                {lefData.macros.map((macro) => (
                  <button
                    key={macro.name}
                    className={`list-group-item list-group-item-action ${
                      selectedMacro === macro.name ? 'active' : ''
                    }`}
                    onClick={() => setSelectedMacro(macro.name)}
                  >
                    {macro.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {lefData && availableLayers.length > 0 && (
            <div className="mt-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6>レイヤー表示</h6>
                <div className="d-flex gap-1">
                  <Button 
                    variant="outline-primary" 
                    size="sm"
                    onClick={() => toggleAllLayers(true)}
                  >
                    全て表示
                  </Button>
                  <Button 
                    variant="outline-secondary" 
                    size="sm"
                    onClick={() => toggleAllLayers(false)}
                  >
                    全て非表示
                  </Button>
                </div>
              </div>
              
              <div className="row g-2">
                {availableLayers.map((layer, index) => {
                  const isVisible = visibleLayers.has(layer);
                  const layerColor = LAYER_COLORS[index % LAYER_COLORS.length];
                  return (
                    <div key={layer} className="col-6">
                      <Button
                        variant={isVisible ? "primary" : "outline-secondary"}
                        size="sm"
                        onClick={() => toggleLayer(layer)}
                        className="w-100 d-flex align-items-center justify-content-center gap-2"
                        style={{ 
                          opacity: isVisible ? 1 : 0.6,
                          border: `2px solid ${layerColor}`
                        }}
                      >
                        <div 
                          style={{ 
                            width: '12px', 
                            height: '12px', 
                            backgroundColor: layerColor,
                            borderRadius: '2px',
                            border: '1px solid rgba(0,0,0,0.2)'
                          }}
                        />
                        <span>{layer}</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </div>
  );
};

export default SimpleLEFViewer;
