import { useState, useCallback } from 'react';
import { Navbar, Container, Alert, Spinner } from 'react-bootstrap';
import { FileDropZone } from './components/FileDropZone';
// Canvas版ビューア (SVG版は components/LEFViewer.tsx に残置)
import { LEFViewer } from './components/LEFViewerCanvas';
import { LEFParser } from './utils/lefParser';
import type { LEFData } from './types/lef';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

function App() {
  const [lefData, setLefData] = useState<LEFData | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileLoad = useCallback((content: string, fileName: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const parser = new LEFParser();
      const parsed = parser.parse(content);
      setLefData(parsed);
      setFilename(fileName);
    } catch (err) {
      setError(`Failed to parse LEF file: ${err instanceof Error ? err.message : 'Unknown error'}`);
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

        {!lefData && !loading && !error && (
          <FileDropZone onFileLoad={handleFileLoad} onUrlLoad={handleUrlLoad} />
        )}

        {lefData && !loading && (
          <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
        )}
      </div>
    </div>
  );
}

export default App;
