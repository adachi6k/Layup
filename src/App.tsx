import { useState, useCallback, useEffect } from 'react';
import { Navbar, Container, Alert, Spinner } from 'react-bootstrap';
import { FileDropZone } from './components/FileDropZone';
// Canvas版ビューア (SVG版は components/LEFViewer.tsx に残置)
import { LEFViewer } from './components/LEFViewerCanvas';
import { DEFLayoutViewer } from './components/DEFLayoutViewer';
import { LEFParser } from './utils/lefParser';
import { parseDEF } from './utils/defParser';
import type { DEFData } from './types/def';
import type { LEFData } from './types/lef';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

function App() {
  const [lefData, setLefData] = useState<LEFData | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [defData, setDefData] = useState<DEFData | null>(null);
  const [defFilename, setDefFilename] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'split'|'lef'|'def'>(()=>{
    const saved = typeof localStorage!=='undefined'? localStorage.getItem('layoutViewMode'):null;
    return (saved==='lef'||saved==='def'||saved==='split')? saved : 'split';
  });

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
      } else if(lower.endsWith('.def')) {
        const parsed = parseDEF(content);
        setDefData(parsed);
        setDefFilename(fileName);
      } else {
        // 拡張子で判別できない場合LEF試行→失敗ならDEF
        try {
          const parser = new LEFParser();
          const parsed = parser.parse(content);
          setLefData(parsed);
          setFilename(fileName || 'unknown.lef');
        } catch {
          try {
            const parsedD = parseDEF(content);
            setDefData(parsedD);
            setDefFilename(fileName || 'unknown.def');
          } catch(err2){
            throw err2;
          }
        }
      }
    } catch (err) {
      setError(`Failed to parse file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUrlLoad = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const content = await response.text();
      const fileName = url.split('/').pop() || 'remote-file.lef';
      handleFileLoad(content, fileName);
    } catch (err) {
      setError(`Failed to load file from URL: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setLoading(false);
    }
  }, [handleFileLoad]);

  return (
    <div className="App" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar bg="dark" variant="dark" expand="lg">
        <Container fluid>
          <Navbar.Brand>
            <i className="bi bi-diagram-3 me-2"></i>
            LEF File Viewer
          </Navbar.Brand>
          <div className="d-flex align-items-center gap-3 ms-auto">
            {(lefData || defData) && (
              <div className="text-light small d-none d-md-block">
                {lefData && <span className="me-2"><i className="bi bi-file-earmark-code me-1"></i>{filename||'LEF ?'}</span>}
                {defData && <span><i className="bi bi-diagram-3 me-1"></i>{defFilename||'DEF ?'}</span>}
              </div>
            )}
            {lefData && defData && (
              <div className="btn-group btn-group-sm" role="group" aria-label="View mode">
                <button className={`btn btn-outline-light ${viewMode==='lef'?'active':''}`} onClick={()=>setViewMode('lef')} title="LEF 単独 (1)">LEF</button>
                <button className={`btn btn-outline-light ${viewMode==='def'?'active':''}`} onClick={()=>setViewMode('def')} title="DEF 単独 (2)">DEF</button>
                <button className={`btn btn-outline-light ${viewMode==='split'?'active':''}`} onClick={()=>setViewMode('split')} title="並列表示 (3)">Split</button>
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
              <p className="mt-2">Parsing LEF file...</p>
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

        {!lefData && !defData && !loading && !error && (
          <FileDropZone onFileLoad={handleFileLoad} onUrlLoad={handleUrlLoad} />
        )}

        {/* 単独 LEF */}
        {lefData && !loading && !defData && (
          <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
        )}
        {/* 単独 DEF (LEF 未ロード) */}
        {defData && !lefData && !loading && (
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
        {lefData && defData && !loading && viewMode==='lef' && (
          <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
        )}
        {lefData && defData && !loading && viewMode==='def' && (
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
