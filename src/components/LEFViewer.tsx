import React, { useMemo, useState } from 'react';
import { Container, Row, Col, Card, Form, Badge, ListGroup } from 'react-bootstrap';
import type { LEFData, LEFMacro, LEFRect } from '../types/lef';
import { LAYER_COLORS } from '../types/lef';

interface LEFViewerProps {
  lefData: LEFData;
  filename: string;
}

export const LEFViewer: React.FC<LEFViewerProps> = ({ lefData, filename }) => {
  const [selectedMacro, setSelectedMacro] = useState<LEFMacro | null>(
    lefData.macros.length > 0 ? lefData.macros[0] : null
  );
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set());

  // Get all unique layers from the data
  const allLayers = useMemo(() => {
    const layers = new Set<string>();
    lefData.macros.forEach(macro => {
      macro.pins.forEach(pin => {
        pin.rects.forEach(rect => layers.add(rect.layer));
      });
      macro.obs.forEach(rect => layers.add(rect.layer));
    });
    return Array.from(layers).sort();
  }, [lefData]);

  // Initialize visible layers
  React.useEffect(() => {
    setVisibleLayers(new Set(allLayers));
  }, [allLayers]);

  const toggleLayer = (layer: string) => {
    setVisibleLayers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(layer)) {
        newSet.delete(layer);
      } else {
        newSet.add(layer);
      }
      return newSet;
    });
  };

  const renderMacroVisualization = () => {
    if (!selectedMacro) return null;

    const { size, pins, obs } = selectedMacro;
    const viewBoxWidth = size.width;
    const viewBoxHeight = size.height;
    
    // Calculate scale factor for better visibility
    const scale = Math.min(400 / viewBoxWidth, 400 / viewBoxHeight);
    const svgWidth = viewBoxWidth * scale;
    const svgHeight = viewBoxHeight * scale;

    const renderRects = (rects: LEFRect[], opacity = 1) => {
      return rects
        .filter(rect => visibleLayers.has(rect.layer))
        .map((rect, index) => (
          <rect
            key={index}
            x={rect.x1}
            y={viewBoxHeight - rect.y2} // Flip Y coordinate
            width={rect.x2 - rect.x1}
            height={rect.y2 - rect.y1}
            fill={LAYER_COLORS[rect.layer] || LAYER_COLORS.default}
            stroke="#000"
            strokeWidth="0.01"
            opacity={opacity}
          >
            <title>{`${rect.layer}: (${rect.x1}, ${rect.y1}) to (${rect.x2}, ${rect.y2})`}</title>
          </rect>
        ));
    };

    return (
      <Card>
        <Card.Header>
          <h5 className="mb-0">
            {selectedMacro.name} 
            <Badge bg="secondary" className="ms-2">
              {selectedMacro.className}
            </Badge>
          </h5>
          <small className="text-muted">
            Size: {size.width} × {size.height} units
          </small>
        </Card.Header>
        <Card.Body>
          <div className="d-flex justify-content-center">
            <svg
              width={svgWidth}
              height={svgHeight}
              viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
              style={{ border: '1px solid #ddd', background: 'white' }}
            >
              {/* Render obstruction rectangles */}
              {renderRects(obs, 0.7)}
              
              {/* Render pin rectangles */}
              {pins.flatMap(pin => pin.rects).length > 0 && renderRects(pins.flatMap(pin => pin.rects))}
              
              {/* Render macro boundary */}
              <rect
                x="0"
                y="0"
                width={viewBoxWidth}
                height={viewBoxHeight}
                fill="none"
                stroke="#000"
                strokeWidth="0.02"
                strokeDasharray="0.1,0.1"
              />
            </svg>
          </div>
        </Card.Body>
      </Card>
    );
  };

  return (
    <Container fluid className="mt-4">
      <Row>
        <Col md={3}>
          {/* File Information */}
          <Card className="mb-3">
            <Card.Header>
              <h6 className="mb-0">File Information</h6>
            </Card.Header>
            <Card.Body>
              <div><strong>File:</strong> {filename}</div>
              <div><strong>Version:</strong> {lefData.version}</div>
              <div><strong>Macros:</strong> {lefData.macros.length}</div>
              <div><strong>Layers:</strong> {lefData.layers.length}</div>
            </Card.Body>
          </Card>

          {/* Layer Controls */}
          <Card className="mb-3">
            <Card.Header>
              <h6 className="mb-0">Layers</h6>
            </Card.Header>
            <Card.Body>
              {allLayers.map(layer => (
                <Form.Check
                  key={layer}
                  type="checkbox"
                  id={`layer-${layer}`}
                  label={
                    <div className="d-flex align-items-center">
                      <div
                        style={{
                          width: '16px',
                          height: '16px',
                          backgroundColor: LAYER_COLORS[layer] || LAYER_COLORS.default,
                          marginRight: '8px',
                          border: '1px solid #ccc'
                        }}
                      />
                      {layer}
                    </div>
                  }
                  checked={visibleLayers.has(layer)}
                  onChange={() => toggleLayer(layer)}
                />
              ))}
            </Card.Body>
          </Card>

          {/* Macro List */}
          <Card>
            <Card.Header>
              <h6 className="mb-0">Macros</h6>
            </Card.Header>
            <Card.Body style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <ListGroup variant="flush">
                {lefData.macros.map((macro, index) => (
                  <ListGroup.Item
                    key={index}
                    action
                    active={selectedMacro?.name === macro.name}
                    onClick={() => setSelectedMacro(macro)}
                    className="py-2"
                  >
                    <div className="fw-bold">{macro.name}</div>
                    <small className="text-muted">
                      {macro.pins.length} pins, {macro.className}
                    </small>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6}>
          {/* Visualization */}
          {renderMacroVisualization()}
        </Col>

        <Col md={3}>
          {/* Pin Information */}
          {selectedMacro && (
            <Card>
              <Card.Header>
                <h6 className="mb-0">Pins ({selectedMacro.pins.length})</h6>
              </Card.Header>
              <Card.Body style={{ maxHeight: '500px', overflowY: 'auto' }}>
                <ListGroup variant="flush">
                  {selectedMacro.pins.map((pin, index) => (
                    <ListGroup.Item key={index} className="py-2">
                      <div className="fw-bold">{pin.name}</div>
                      <div>
                        <Badge bg="primary" className="me-1">{pin.direction}</Badge>
                        <Badge bg="secondary">{pin.use}</Badge>
                      </div>
                      <small className="text-muted">
                        {pin.rects.length} geometries
                      </small>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>
    </Container>
  );
};
