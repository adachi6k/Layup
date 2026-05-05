import { Container, Navbar } from 'react-bootstrap';
import type { Dispatch, SetStateAction } from 'react';
import type { ViewMode } from '../hooks/useLayoutFiles';

interface AppNavbarProps {
  lefLoaded: boolean;
  defLoaded: boolean;
  gdsLoaded: boolean;
  filename: string;
  defFilename: string;
  gdsFilename: string;
  viewMode: ViewMode;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
}

export const AppNavbar = ({
  lefLoaded,
  defLoaded,
  gdsLoaded,
  filename,
  defFilename,
  gdsFilename,
  viewMode,
  setViewMode,
}: AppNavbarProps) => {
  const loadedCount = [lefLoaded, defLoaded, gdsLoaded].filter(Boolean).length;

  return (
    <Navbar bg="dark" variant="dark" expand="lg">
      <Container fluid>
        <Navbar.Brand>
          <i className="bi bi-diagram-3 me-2"></i>
          Layout File Viewer
        </Navbar.Brand>
        <div className="d-flex align-items-center gap-3 ms-auto">
          {(lefLoaded || defLoaded || gdsLoaded) && (
            <div className="text-light small d-none d-md-block">
              {lefLoaded && <span className="me-2"><i className="bi bi-file-earmark-code me-1"></i>{filename || 'Untitled LEF'}</span>}
              {defLoaded && <span className="me-2"><i className="bi bi-diagram-3 me-1"></i>{defFilename || 'Untitled DEF'}</span>}
              {gdsLoaded && <span><i className="bi bi-layers me-1"></i>{gdsFilename || 'Untitled GDS'}</span>}
            </div>
          )}
          {loadedCount > 1 && (
            <div className="btn-group btn-group-sm" role="group" aria-label="View mode">
              {lefLoaded && <button className={`btn btn-outline-light ${viewMode === 'lef' ? 'active' : ''}`} onClick={() => setViewMode('lef')} title="LEF only">LEF</button>}
              {defLoaded && <button className={`btn btn-outline-light ${viewMode === 'def' ? 'active' : ''}`} onClick={() => setViewMode('def')} title="DEF only">DEF</button>}
              {gdsLoaded && <button className={`btn btn-outline-light ${viewMode === 'gds' ? 'active' : ''}`} onClick={() => setViewMode('gds')} title="GDS only">GDS</button>}
              {lefLoaded && defLoaded && <button className={`btn btn-outline-light ${viewMode === 'split' ? 'active' : ''}`} onClick={() => setViewMode('split')} title="Split view">Split</button>}
            </div>
          )}
        </div>
      </Container>
    </Navbar>
  );
};
