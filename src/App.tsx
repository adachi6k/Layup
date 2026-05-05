import { useState, useCallback, useEffect } from 'react';
import { Navbar, Container, Alert, Spinner } from 'react-bootstrap';
import { FileDropZone } from './components/FileDropZone';
// Canvas版ビューア (SVG版は components/LEFViewer.tsx に残置)
import { LEFViewer } from './components/LEFViewerCanvas';
import { DEFLayoutViewer } from './components/DEFLayoutViewer';
import { GDSViewer } from './components/GDSViewer';
import { LEFParser } from './utils/lefParser';
import { parseDEF } from './utils/defParser';
import { parseGDS } from './utils/gdsParser';
import type { DEFData } from './types/def';
import type { GDSData } from './types/gds';
import type { LEFData } from './types/lef';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

function App() {
  const [lefData, setLefData] = useState<LEFData | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [defData, setDefData] = useState<DEFData | null>(null);
  const [defFilename, setDefFilename] = useState('');
  const [gdsData, setGdsData] = useState<GDSData | null>(null);
  const [gdsFilename, setGdsFilename] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'split'|'lef'|'def'|'gds'>(()=>{
    const saved = typeof localStorage!=='undefined'? localStorage.getItem('layoutViewMode'):null;
    return (saved==='lef'||saved==='def'||saved==='split'||saved==='gds')? saved : 'split';
  });

  const handleBinaryFileLoad = useCallback((content: ArrayBuffer, fileName: string) => {
    setLoading(true);
    setError(null);
    try {
      const lower = fileName.toLowerCase();
      if (!lower.endsWith('.gds') && !lower.endsWith('.gdsii')) {
        throw new Error('Binary layout loading currently supports .gds and .gdsii files');
      }
      const parsed = parseGDS(content);
      setGdsData(parsed);
      setGdsFilename(fileName);
      setViewMode('gds');
    } catch (err) {
      setError(`Failed to parse GDS file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // persist view mode
  useEffect(()=>{ try{ localStorage.setItem('layoutViewMode', viewMode);}catch{/* ignore */}},[viewMode]);

  const handleFileLoad = useCallback((content: string, fileName: string) => {
    setLoading(true);
    setError(null);
    try {
      const lower = fileName.toLowerCase();
      if(lower.endsWith('.lef')){
        const parser = new LEFParser();
        const parsed = parser.parse(content);
        setLefData(parsed);
        setFilename(fileName);
        if (!defData) setViewMode('lef');
      } else if(lower.endsWith('.def')) {
        const parsed = parseDEF(content);
        setDefData(parsed);
        setDefFilename(fileName);
        if (!lefData) setViewMode('def');
      } else {
        // 拡張子で判別できない場合LEF試行→失敗ならDEF
        try {
          const parser = new LEFParser();
          const parsed = parser.parse(content);
          setLefData(parsed);
          setFilename(fileName || 'unknown.lef');
        } catch {
          const parsedD = parseDEF(content);
          setDefData(parsedD);
          setDefFilename(fileName || 'unknown.def');
        }
      }
    } catch (err) {
      setError(`Failed to parse file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [defData, lefData]);

  const handleUrlLoad = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const fileName = url.split('/').pop() || 'remote-file.lef';
      const lower = fileName.toLowerCase();
      if (lower.endsWith('.gds') || lower.endsWith('.gdsii')) {
        const content = await response.arrayBuffer();
        handleBinaryFileLoad(content, fileName);
      } else {
        const content = await response.text();
        handleFileLoad(content, fileName);
      }
    } catch (err) {
      setError(`Failed to load file from URL: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setLoading(false);
    }
  }, [handleBinaryFileLoad, handleFileLoad]);

  const loadedCount = [lefData, defData, gdsData].filter(Boolean).length;

  return (
    <div className="App" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar bg="dark" variant="dark" expand="lg">
        <Container fluid>
          <Navbar.Brand>
            <i className="bi bi-diagram-3 me-2"></i>
            Layout File Viewer
          </Navbar.Brand>
          <div className="d-flex align-items-center gap-3 ms-auto">
            {(lefData || defData || gdsData) && (
              <div className="text-light small d-none d-md-block">
                {lefData && <span className="me-2"><i className="bi bi-file-earmark-code me-1"></i>{filename||'LEF ?'}</span>}
                {defData && <span className="me-2"><i className="bi bi-diagram-3 me-1"></i>{defFilename||'DEF ?'}</span>}
                {gdsData && <span><i className="bi bi-layers me-1"></i>{gdsFilename||'GDS ?'}</span>}
              </div>
            )}
            {loadedCount > 1 && (
              <div className="btn-group btn-group-sm" role="group" aria-label="View mode">
                {lefData && <button className={`btn btn-outline-light ${viewMode==='lef'?'active':''}`} onClick={()=>setViewMode('lef')} title="LEF 単独">LEF</button>}
                {defData && <button className={`btn btn-outline-light ${viewMode==='def'?'active':''}`} onClick={()=>setViewMode('def')} title="DEF 単独">DEF</button>}
                {gdsData && <button className={`btn btn-outline-light ${viewMode==='gds'?'active':''}`} onClick={()=>setViewMode('gds')} title="GDS 単独">GDS</button>}
                {lefData && defData && <button className={`btn btn-outline-light ${viewMode==='split'?'active':''}`} onClick={()=>setViewMode('split')} title="並列表示">Split</button>}
              </div>
            )}
          </div>
        </Container>
      </Navbar>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {loading && (
          <Container className="mt-4">
            <div className="text-center">
              <Spinner animation="border" role="status">
                <span className="visually-hidden">Loading...</span>
              </Spinner>
              <p className="mt-2">Parsing layout file...</p>
            </div>
          </Container>
        )}

        {error && (
          <Container className="mt-4">
            <Alert variant="danger">
              <Alert.Heading>Error</Alert.Heading>
              {error}
            </Alert>
          </Container>
        )}

        {!lefData && !defData && !gdsData && !loading && !error && (
          <FileDropZone onFileLoad={handleFileLoad} onBinaryFileLoad={handleBinaryFileLoad} onUrlLoad={handleUrlLoad} />
        )}

        {gdsData && !loading && (viewMode==='gds' || (!lefData && !defData)) && (
          <GDSViewer gdsData={gdsData} filename={gdsFilename} />
        )}

        {/* 単独 LEF */}
        {lefData && !loading && !defData && !gdsData && (
          <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
        )}
        {/* 単独 DEF (LEF 未ロード) */}
        {defData && !lefData && !gdsData && !loading && (
          <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
            <div style={{flex:1,minHeight:0}}>
              <DEFLayoutViewer def={defData} lef={null} />
            </div>
            <div style={{padding:'2px 6px',fontSize:10,color:'#555'}}>DEF layout (LEF未ロードのためサイズ未解決あり)</div>
          </div>
        )}
        {/* 両方ロード時: モード分岐 */}
        {lefData && defData && !loading && viewMode==='split' && (
          <div className="d-flex" style={{height:'100%'}}>
            <div style={{flex:'0 0 55%',display:'flex',flexDirection:'column',borderRight:'1px solid #ddd',padding:4,minWidth:0}}>
              <div style={{flex:1,minHeight:0}}>
                <DEFLayoutViewer def={defData} lef={lefData} />
              </div>
              <div style={{padding:'2px 6px',fontSize:10,color:'#555'}}>DEF die + components (pan/zoom)</div>
            </div>
            <div style={{flex:'1 1 auto',overflow:'hidden',paddingLeft:4,minWidth:0}}>
              <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
            </div>
          </div>
        )}
        {lefData && !loading && viewMode==='lef' && (
          <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
        )}
        {defData && !loading && viewMode==='def' && (
          <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
            <div style={{flex:1,minHeight:0}}>
              <DEFLayoutViewer def={defData} lef={lefData} />
            </div>
            <div style={{padding:'2px 6px',fontSize:10,color:'#555'}}>DEF die + components (pan/zoom)</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
