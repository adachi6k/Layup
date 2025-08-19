import { useState, useCallback } from 'react';
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
          <small className="text-light">EDA Layout Visualization Tool</small>
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

        {lefData && !loading && !defData && (
          <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
        )}
        {lefData && defData && !loading && (
          <div className="d-flex" style={{height:'100%'}}>
            <div style={{flex:'0 0 55%',display:'flex',flexDirection:'column',borderRight:'1px solid #ddd',padding:4}}>
              <DEFLayoutViewer def={defData} lef={lefData} />
              <div style={{padding:'2px 6px',fontSize:10,color:'#555'}}>DEF die + components (pan/zoom)</div>
            </div>
            <div style={{flex:'1 1 auto',overflow:'hidden',paddingLeft:4}}>
              <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
            </div>
          </div>
        )}
        {defData && !loading && (
          <div style={{padding:16}}>
            <h5>DEF Loaded: {defFilename}</h5>
            <p style={{fontSize:'0.85rem'}}>
              Version: {defData.version || '(unknown)'} / UNITS (DBU/μm): {defData.units}<br/>
              DIEAREA: ({defData.dieArea.x1},{defData.dieArea.y1}) - ({defData.dieArea.x2},{defData.dieArea.y2})<br/>
              Components: {defData.components.length}
            </p>
            <p style={{fontSize:'0.75rem',color:'#666'}}>※ 現段階: 配置描画は未実装 (次ステップでCanvas統合)</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
