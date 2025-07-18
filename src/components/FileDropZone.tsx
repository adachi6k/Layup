import React, { useCallback, useState } from 'react';
import { Container, Row, Col, Alert } from 'react-bootstrap';

interface FileDropZoneProps {
  onFileLoad: (content: string, filename: string) => void;
  onUrlLoad?: (url: string) => void;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({ onFileLoad, onUrlLoad }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    
    // Check file extension
    if (!file.name.toLowerCase().endsWith('.lef')) {
      setError('Please select a .lef file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        onFileLoad(content, file.name);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  }, [onFileLoad]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        onFileLoad(content, file.name);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  }, [onFileLoad]);

  const loadSampleFile = useCallback(() => {
    if (onUrlLoad) {
      const sampleUrl = 'https://raw.githubusercontent.com/The-OpenROAD-Project/asap7_sram_0p0/main/generated/LEF/srambank_128x4x16_6t122.lef';
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
              <h4 className="text-muted mb-3">Drop LEF file here</h4>
              <p className="text-muted mb-3">or</p>
              
              <label className="btn btn-primary me-3">
                <i className="bi bi-folder2-open me-2"></i>
                Choose File
                <input
                  type="file"
                  accept=".lef"
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
                  Load Sample File
                </button>
              )}
            </div>
          </div>
          
          <div className="mt-3 text-center">
            <small className="text-muted">
              Supported format: LEF (Library Exchange Format) files
            </small>
          </div>
        </Col>
      </Row>
    </Container>
  );
};
