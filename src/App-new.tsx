import 'bootstrap/dist/css/bootstrap.min.css';
import { useState } from 'react';
import { Navbar, Container, Alert, Button } from 'react-bootstrap';
import type { LEFData } from './types/lef';
import { LEFParser } from './utils/lefParser';
import { FileDropZone } from './components/FileDropZone';

function App() {
  const [lefData, setLefData] = useState<LEFData | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileLoad = async (content: string, fileName: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const parser = new LEFParser();
      const result = parser.parse(content);
      setLefData(result);
      setFilename(fileName);
      console.log('✅ LEF file loaded successfully:', fileName);
    } catch (err) {
      console.error('❌ Failed to parse LEF file:', err);
      setError(`Failed to parse LEF file: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUrlLoad = async (url: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const content = await response.text();
      const fileName = url.split('/').pop() || 'sample.lef';
      await handleFileLoad(content, fileName);
    } catch (err) {
      console.error('❌ Failed to load LEF file from URL:', err);
      setError(`Failed to load file from URL: ${err}`);
    }
  };

  const showSample = () => {
    const testContent = `VERSION 5.8 ;
BUSBITCHARS "[]" ;
DIVIDERCHAR "/" ;
MACRO test_macro
  CLASS BLOCK ;
  ORIGIN 0 0 ;
  SIZE 10 BY 10 ;
  PIN test_pin
    DIRECTION INPUT ;
    USE SIGNAL ;
    PORT 
      LAYER M1 ;
        RECT 1 1 3 3 ;
    END
  END test_pin
END test_macro
END LIBRARY`;
    
    handleFileLoad(testContent, 'sample.lef');
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      <Navbar bg="dark" variant="dark">
        <Container>
          <Navbar.Brand>🔧 LEF File Viewer</Navbar.Brand>
          {lefData && (
            <div className="text-light">
              <small>
                📁 {filename} | Version: {lefData.version} | Macros: {lefData.macros.length}
              </small>
            </div>
          )}
        </Container>
      </Navbar>
      
      <Container fluid className="p-0">
        {!lefData ? (
          <>
            <Container className="mt-4">
              <Alert variant="info">
                <Alert.Heading>🚀 LEF File Viewer</Alert.Heading>
                <p>
                  Load a LEF (Library Exchange Format) file to visualize EDA macro data.
                  You can upload a local file, load from URL, or try the sample data.
                </p>
                <hr />
                <div className="d-flex gap-2">
                  <Button variant="outline-primary" onClick={showSample}>
                    📋 Try Sample Data
                  </Button>
                </div>
              </Alert>
              
              {error && (
                <Alert variant="danger" dismissible onClose={() => setError(null)}>
                  <strong>Error:</strong> {error}
                </Alert>
              )}
              
              {loading && (
                <Alert variant="warning">
                  <div className="d-flex align-items-center">
                    <div className="spinner-border spinner-border-sm me-2" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    Loading LEF file...
                  </div>
                </Alert>
              )}
            </Container>
            
            <FileDropZone onFileLoad={handleFileLoad} onUrlLoad={handleUrlLoad} />
          </>
        ) : (
          <div>
            <div className="bg-light border-bottom">
              <Container>
                <div className="d-flex justify-content-between align-items-center py-2">
                  <div>
                    <strong>📁 {filename}</strong>
                    <Button 
                      variant="outline-secondary" 
                      size="sm" 
                      className="ms-3"
                      onClick={() => {
                        setLefData(null);
                        setFilename('');
                        setError(null);
                      }}
                    >
                      ← Back to File Selection
                    </Button>
                  </div>
                </div>
              </Container>
            </div>
            
            {/* SimpleLEFViewer は props 仕様不一致のため一時的に無効化 */}
            <div className="p-3 text-muted">Legacy SimpleLEFViewer disabled (props mismatch).</div>
          </div>
        )}
      </Container>
    </div>
  );
}

export default App;
