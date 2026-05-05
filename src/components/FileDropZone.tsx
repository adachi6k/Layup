import React, { useCallback, useState } from 'react';
import { Container, Row, Col, Alert } from 'react-bootstrap';

interface FileDropZoneProps {
  onFileLoad: (content: string, filename: string) => void;
  onBinaryFileLoad?: (content: ArrayBuffer, filename: string) => void;
  onUrlLoad?: (url: string) => void;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({ onFileLoad, onBinaryFileLoad, onUrlLoad }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readFile = useCallback((file: File) => {
    const lower = file.name.toLowerCase();
    const isTextLayout = lower.endsWith('.lef') || lower.endsWith('.def');
    const isGDS = lower.endsWith('.gds') || lower.endsWith('.gdsii');
    if (!isTextLayout && !isGDS) {
      setError('Please select a .lef, .def, .gds, or .gdsii file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (isGDS) {
        const content = event.target?.result;
        if (content instanceof ArrayBuffer) onBinaryFileLoad?.(content, file.name);
      } else {
        const content = event.target?.result as string;
        if (content) onFileLoad(content, file.name);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };

    if (isGDS) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }, [onBinaryFileLoad, onFileLoad]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setError(null);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    readFile(file);
  }, [readFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    readFile(file);
  }, [readFile]);

  const loadSampleFile = useCallback(() => {
    if (onUrlLoad) {
      const sampleUrl = `${import.meta.env.BASE_URL}samples/lm_final.gds`;
      onUrlLoad(sampleUrl);
    }
  }, [onUrlLoad]);

  return (
    <Container className="mt-4">
      <Row className="justify-content-center">
        <Col md={8}>
          {error && (
            <Alert variant="danger" dismissible onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          
          <div
            className={`border-3 border-dashed rounded p-5 text-center ${
              isDragging ? 'border-primary bg-light' : 'border-secondary'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{ minHeight: '200px', cursor: 'pointer' }}
          >
            <div className="d-flex flex-column align-items-center justify-content-center h-100">
              <i className="bi bi-file-earmark-arrow-up fs-1 text-muted mb-3"></i>
              <h4 className="text-muted mb-3">Drop LEF / DEF / GDS file here</h4>
              <p className="text-muted mb-3">or</p>
              
              <label className="btn btn-primary me-3">
                <i className="bi bi-folder2-open me-2"></i>
                Choose File
                  <input
                    type="file"
                  accept=".lef,.def,.gds,.gdsii"
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                />
              </label>
              
              {onUrlLoad && (
                <button 
                  className="btn btn-outline-primary"
                  onClick={loadSampleFile}
                >
                  <i className="bi bi-download me-2"></i>
                  Load LM GDS Sample
                </button>
              )}
            </div>
          </div>
          
          <div className="mt-3 text-center">
            <small className="text-muted">
              Supported formats: LEF (Library Exchange Format), DEF layout, and GDSII layout files
            </small>
          </div>
        </Col>
      </Row>
    </Container>
  );
};
