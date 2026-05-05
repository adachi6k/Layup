import React, { useCallback, useState } from 'react';
import { Container, Row, Col, Alert } from 'react-bootstrap';

interface FileDropZoneProps {
  onFileLoad: (content: string, filename: string) => void;
  onBinaryFileLoad?: (content: ArrayBuffer, filename: string) => void;
  onMultipleFilesLoad?: (files: Array<{ content: string | ArrayBuffer; filename: string }>) => void;
  onUrlLoad?: (url: string) => void;
}

const ACCEPTED_EXTENSIONS = ['.lef', '.def', '.gds', '.gdsii'];

const isAccepted = (name: string) => ACCEPTED_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
const isGDS = (name: string) => name.toLowerCase().endsWith('.gds') || name.toLowerCase().endsWith('.gdsii');

export const FileDropZone: React.FC<FileDropZoneProps> = ({ onFileLoad, onBinaryFileLoad, onMultipleFilesLoad, onUrlLoad }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readAllFiles = useCallback((fileList: File[]) => {
    const valid = fileList.filter(f => isAccepted(f.name));
    if (valid.length === 0) {
      setError('Please select .lef, .def, .gds, or .gdsii files');
      return;
    }

    if (valid.length === 1) {
      // Single file – use the existing single-file handlers
      const file = valid[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (isGDS(file.name)) {
          const content = event.target?.result;
          if (content instanceof ArrayBuffer) onBinaryFileLoad?.(content, file.name);
        } else {
          const content = event.target?.result as string;
          if (content) onFileLoad(content, file.name);
        }
      };
      reader.onerror = () => setError('Failed to read file');
      if (isGDS(file.name)) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
      return;
    }

    // Multiple files – read all, then dispatch as a batch
    Promise.all(
      valid.map(
        (file) =>
          new Promise<{ content: string | ArrayBuffer; filename: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) =>
              resolve({ content: e.target!.result as string | ArrayBuffer, filename: file.name });
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
            if (isGDS(file.name)) reader.readAsArrayBuffer(file);
            else reader.readAsText(file);
          }),
      ),
    )
      .then((results) => {
        if (onMultipleFilesLoad) {
          onMultipleFilesLoad(results);
        } else {
          // Fallback: dispatch one by one
          results.forEach(({ content, filename }) => {
            if (content instanceof ArrayBuffer) onBinaryFileLoad?.(content, filename);
            else onFileLoad(content, filename);
          });
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [onBinaryFileLoad, onFileLoad, onMultipleFilesLoad]);

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
    readAllFiles(files);
  }, [readAllFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError(null);
    readAllFiles(Array.from(files));
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [readAllFiles]);

  const loadSampleUrl = useCallback((path: string) => {
    if (onUrlLoad) {
      onUrlLoad(`${import.meta.env.BASE_URL}${path}`);
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
              <h4 className="text-muted mb-2">Drop LEF / DEF / GDS file here</h4>
              <p className="text-muted small mb-3">
                <i className="bi bi-info-circle me-1"></i>
                Drop a <strong>LEF + DEF pair</strong> together to load both at once
              </p>

              <label className="btn btn-primary me-3">
                <i className="bi bi-folder2-open me-2"></i>
                Choose File(s)
                <input
                  type="file"
                  accept=".lef,.def,.gds,.gdsii"
                  multiple
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          </div>

          {onUrlLoad && (
            <div className="mt-3">
              <p className="text-muted small text-center mb-2">
                <i className="bi bi-lightning-charge me-1"></i>Load a sample file to get started:
              </p>
              <div className="d-flex justify-content-center gap-2 flex-wrap">
                <button
                  className="btn btn-outline-primary btn-sm"
                  onClick={() => loadSampleUrl('samples/sample.lef')}
                >
                  <i className="bi bi-file-earmark-code me-1"></i>
                  Sample LEF
                </button>
                <button
                  className="btn btn-outline-success btn-sm"
                  onClick={() => loadSampleUrl('samples/sample.def')}
                >
                  <i className="bi bi-diagram-3 me-1"></i>
                  Sample DEF
                </button>
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => loadSampleUrl('samples/lm_final.gds')}
                >
                  <i className="bi bi-layers me-1"></i>
                  Sample GDS
                </button>
              </div>
              <p className="text-muted small text-center mt-2">
                <i className="bi bi-lightbulb me-1"></i>
                Load the <strong>Sample LEF</strong> then the <strong>Sample DEF</strong> (or drop both together) for a combined view.
              </p>
            </div>
          )}

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
