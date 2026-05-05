import { Container, Alert, Spinner } from 'react-bootstrap';
import { AppNavbar } from './components/AppNavbar';
import { FileDropZone } from './components/FileDropZone';
import { LEFViewer } from './components/LEFViewerCanvas';
import { DEFLayoutViewer } from './components/DEFLayoutViewer';
import { GDSViewer } from './components/GDSViewer';
import { useLayoutFiles } from './hooks/useLayoutFiles';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

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
    handleUrlLoad,
  } = useLayoutFiles();

  return (
    <div className="App" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
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

        {/* LEF only */}
        {lefData && !loading && !defData && !gdsData && (
          <LEFViewer lefData={lefData} filename={filename} onFileLoad={handleFileLoad} />
        )}
        {/* DEF only (no LEF loaded) */}
        {defData && !lefData && !gdsData && !loading && (
          <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
            <div style={{flex:1,minHeight:0}}>
              <DEFLayoutViewer def={defData} lef={null} />
            </div>
            <div style={{padding:'2px 6px',fontSize:10,color:'#555'}}>DEF layout (macro sizes unresolved – load a LEF file to resolve)</div>
          </div>
        )}
        {/* Both loaded – view mode split */}
        {lefData && defData && !loading && viewMode==='split' && (
          <div className="d-flex" style={{height:'100%'}}>
            <div style={{flex:'0 0 55%',display:'flex',flexDirection:'column',borderRight:'1px solid #ddd',padding:4,minWidth:0}}>
              <div style={{flex:1,minHeight:0}}>
                <DEFLayoutViewer def={defData} lef={lefData} />
              </div>
              <div style={{padding:'2px 6px',fontSize:10,color:'#555'}}>DEF die + components</div>
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
            <div style={{padding:'2px 6px',fontSize:10,color:'#555'}}>DEF die + components</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
