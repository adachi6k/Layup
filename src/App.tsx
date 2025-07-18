import { useState, useCallback } from 'react';
import { Navbar, Container, Alert, Spinner } from 'react-bootstrap';
import { FileDropZone } from './components/FileDropZone';
import { LEFViewer } from './components/LEFViewer';
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
    <div className="min-vh-100 bg-light">
      <Navbar bg="dark" variant="dark" className="mb-0">
        <Container>
          <Navbar.Brand>
            <i className="bi bi-cpu me-2"></i>
            LEF File Viewer
          </Navbar.Brand>
          <Navbar.Text>
            EDA Layout Visualization Tool
          </Navbar.Text>
        </Container>
      </Navbar>

      {error && (
        <Container className="mt-3">
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            <Alert.Heading>Error</Alert.Heading>
            {error}
          </Alert>
        </Container>
      )}

      {loading && (
        <Container className="mt-3">
          <div className="text-center">
            <Spinner animation="border" role="status">
              <span className="visually-hidden">Loading...</span>
            </Spinner>
            <div className="mt-2">Parsing LEF file...</div>
          </div>
        </Container>
      )}

      {!lefData && !loading && (
        <FileDropZone onFileLoad={handleFileLoad} onUrlLoad={handleUrlLoad} />
      )}

      {lefData && !loading && (
        <LEFViewer lefData={lefData} filename={filename} />
      )}
    </div>
  );
}

export default App;
