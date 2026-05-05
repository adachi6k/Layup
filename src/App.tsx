import { Container, Alert, Spinner } from 'react-bootstrap';
import { AppNavbar } from './components/AppNavbar';
import { FileDropZone } from './components/FileDropZone';
import { LEFViewer } from './components/LEFViewerCanvas';
import { DEFLayoutViewer } from './components/DEFLayoutViewer';
import { GDSViewer } from './components/GDSViewer';
import { useLayoutFiles } from './hooks/useLayoutFiles';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './App.css';

function App() {
  const {
    lefData,
    filename,
    defData,
    defFilename,
    gdsData,
    gdsFilename,
    loading,
    error,
    viewMode,
    setViewMode,
    handleBinaryFileLoad,
    handleFileLoad,
    handleMultipleFilesLoad,
    handleUrlLoad,
  } = useLayoutFiles();

  return (
    <div className="app-root">
      <AppNavbar
        lefLoaded={Boolean(lefData)}
        defLoaded={Boolean(defData)}
        gdsLoaded={Boolean(gdsData)}
        filename={filename}
        defFilename={defFilename}
        gdsFilename={gdsFilename}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />

      <div className="app-main">
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
          <FileDropZone
            onFileLoad={handleFileLoad}
            onBinaryFileLoad={handleBinaryFileLoad}
            onMultipleFilesLoad={handleMultipleFilesLoad}
            onUrlLoad={handleUrlLoad}
          />
        )}

        {gdsData && !loading && (viewMode==='gds' || (!lefData && !defData)) && (
          <GDSViewer gdsData={gdsData} filename={gdsFilename} />
        )}

        {/* LEF only */}
        {lefData && !loading && !defData && !gdsData && (
          <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
        )}
        {/* DEF only (no LEF loaded) */}
        {defData && !lefData && !gdsData && !loading && (
          <div className="h-100 d-flex flex-column">
            <div className="flex-grow-1" style={{minHeight:0}}>
              <DEFLayoutViewer def={defData} lef={null} />
            </div>
            <div className="viewer-label">DEF layout (macro sizes unresolved – load a LEF file to resolve)</div>
          </div>
        )}
        {/* Both loaded – view mode split */}
        {lefData && defData && !loading && viewMode==='split' && (
          <div className="split-view">
            <div className="split-def-panel">
              <div className="flex-grow-1" style={{minHeight:0}}>
                <DEFLayoutViewer def={defData} lef={lefData} />
              </div>
              <div className="viewer-label">DEF die + components</div>
            </div>
            <div className="split-lef-panel">
              <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
            </div>
          </div>
        )}
        {lefData && !loading && viewMode==='lef' && (
          <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
        )}
        {defData && !loading && viewMode==='def' && (
          <div className="h-100 d-flex flex-column">
            <div className="flex-grow-1" style={{minHeight:0}}>
              <DEFLayoutViewer def={defData} lef={lefData} />
            </div>
            <div className="viewer-label">DEF die + components</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
