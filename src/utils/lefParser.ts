import type { LEFData, LEFMacro, LEFPin, LEFRect, LEFLayer } from '../types/lef';

const LAYER_TYPES: LEFLayer['type'][] = ['ROUTING', 'CUT', 'OVERLAP', 'MASTERSLICE'];
const PIN_DIRECTIONS: LEFPin['direction'][] = ['INPUT', 'OUTPUT', 'INOUT', 'FEEDTHRU'];
const PIN_USES: LEFPin['use'][] = ['SIGNAL', 'POWER', 'GROUND', 'CLOCK', 'ANALOG', 'SCAN', 'RESET'];

const parseLayerType = (value: string): LEFLayer['type'] =>
  LAYER_TYPES.includes(value as LEFLayer['type']) ? value as LEFLayer['type'] : 'ROUTING';

const parsePinDirection = (value: string): LEFPin['direction'] =>
  PIN_DIRECTIONS.includes(value as LEFPin['direction']) ? value as LEFPin['direction'] : 'UNKNOWN';

const parsePinUse = (value: string): LEFPin['use'] =>
  PIN_USES.includes(value as LEFPin['use']) ? value as LEFPin['use'] : 'UNKNOWN';

export class LEFParser {
  private lines: string[] = [];
  private currentIndex = 0;

  parse(content: string): LEFData {
    this.lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    this.currentIndex = 0;

    const lefData: LEFData = {
      version: '',
      layers: [],
      macros: []
    };

    while (this.currentIndex < this.lines.length) {
      const line = this.getCurrentLine();
      
      if (line.startsWith('VERSION')) {
        lefData.version = this.parseVersion(line);
      } else if (line.startsWith('LAYER') && !line.includes('RECT')) {
        const layer = this.parseLayer();
        if (layer) lefData.layers.push(layer);
      } else if (line.startsWith('MACRO')) {
        const macro = this.parseMacro();
        if (macro) lefData.macros.push(macro);
      } else {
        this.nextLine();
      }
    }

    return lefData;
  }

  private getCurrentLine(): string {
    return this.currentIndex < this.lines.length ? this.lines[this.currentIndex] : '';
  }

  private nextLine(): string {
    this.currentIndex++;
    return this.getCurrentLine();
  }

  private parseVersion(line: string): string {
    const match = line.match(/VERSION\s+([0-9.]+)/);
    this.nextLine();
    return match ? match[1] : '';
  }

  private parseLayer(): LEFLayer | null {
    const line = this.getCurrentLine();
    const match = line.match(/LAYER\s+(\w+)/);
    if (!match) {
      this.nextLine();
      return null;
    }

    const layer: LEFLayer = {
      name: match[1],
      type: 'ROUTING'
    };

    this.nextLine();
    
    // Parse layer properties
    while (this.getCurrentLine() && !this.getCurrentLine().startsWith('END')) {
      const propLine = this.getCurrentLine();
      
      if (propLine.includes('TYPE')) {
        const typeMatch = propLine.match(/TYPE\s+(\w+)/);
        if (typeMatch) {
          layer.type = parseLayerType(typeMatch[1]);
        }
      } else if (propLine.includes('SPACING')) {
        const spacingMatch = propLine.match(/SPACING\s+([0-9.]+)/);
        if (spacingMatch) {
          layer.spacing = parseFloat(spacingMatch[1]);
        }
      }
      
      this.nextLine();
    }

    if (this.getCurrentLine().startsWith('END')) {
      this.nextLine();
    }

    return layer;
  }

  private parseMacro(): LEFMacro | null {
    const line = this.getCurrentLine();
    const match = line.match(/MACRO\s+(\w+)/);
    if (!match) {
      this.nextLine();
      return null;
    }

    const macro: LEFMacro = {
      name: match[1],
      className: '',
      origin: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
      pins: [],
      obs: []
    };

    this.nextLine();

    while (this.getCurrentLine() && !this.getCurrentLine().startsWith('END')) {
      const currentLine = this.getCurrentLine();

      if (currentLine.includes('CLASS')) {
        const classMatch = currentLine.match(/CLASS\s+(\w+)/);
        if (classMatch) macro.className = classMatch[1];
        this.nextLine();
      } else if (currentLine.includes('ORIGIN')) {
        const originMatch = currentLine.match(/ORIGIN\s+([0-9.-]+)\s+([0-9.-]+)/);
        if (originMatch) {
          macro.origin = {
            x: parseFloat(originMatch[1]),
            y: parseFloat(originMatch[2])
          };
        }
        this.nextLine();
      } else if (currentLine.includes('SIZE') && currentLine.includes('BY')) {
        const sizeMatch = currentLine.match(/SIZE\s+([0-9.-]+)\s+BY\s+([0-9.-]+)/);
        if (sizeMatch) {
          macro.size = {
            width: parseFloat(sizeMatch[1]),
            height: parseFloat(sizeMatch[2])
          };
        }
        this.nextLine();
      } else if (currentLine.startsWith('PIN')) {
        const pin = this.parsePin();
        if (pin) macro.pins.push(pin);
      } else if (currentLine.startsWith('OBS')) {
        const obsRects = this.parseOBS();
        macro.obs.push(...obsRects);
      } else {
        this.nextLine();
      }
    }

    if (this.getCurrentLine().startsWith('END')) {
      this.nextLine();
    }

    return macro;
  }

  private parsePin(): LEFPin | null {
    const line = this.getCurrentLine();
    const match = line.match(/PIN\s+(\S+)/);
    if (!match) {
      this.nextLine();
      return null;
    }

    const pin: LEFPin = {
      name: match[1],
      direction: 'INPUT',
      use: 'SIGNAL',
      rects: []
    };

    this.nextLine();

    while (this.getCurrentLine() && !this.getCurrentLine().startsWith('END')) {
      const currentLine = this.getCurrentLine();

      if (currentLine.includes('DIRECTION')) {
        const dirMatch = currentLine.match(/DIRECTION\s+(\w+)/);
        if (dirMatch) pin.direction = parsePinDirection(dirMatch[1]);
        this.nextLine();
      } else if (currentLine.includes('USE')) {
        const useMatch = currentLine.match(/USE\s+(\w+)/);
        if (useMatch) pin.use = parsePinUse(useMatch[1]);
        this.nextLine();
      } else if (currentLine.startsWith('PORT')) {
        const portRects = this.parsePort();
        pin.rects.push(...portRects);
      } else {
        this.nextLine();
      }
    }

    if (this.getCurrentLine().startsWith('END')) {
      this.nextLine();
    }

    return pin;
  }

  private parsePort(): LEFRect[] {
    const rects: LEFRect[] = [];
    this.nextLine(); // Skip PORT line

    let currentLayer = '';

    while (this.getCurrentLine() && !this.getCurrentLine().startsWith('END')) {
      const line = this.getCurrentLine();

      if (line.includes('LAYER')) {
        const layerMatch = line.match(/LAYER\s+(\w+)/);
        if (layerMatch) currentLayer = layerMatch[1];
        this.nextLine();
      } else if (line.includes('RECT') && currentLayer) {
        const rectMatch = line.match(/RECT\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)/);
        if (rectMatch) {
          rects.push({
            layer: currentLayer,
            x1: parseFloat(rectMatch[1]),
            y1: parseFloat(rectMatch[2]),
            x2: parseFloat(rectMatch[3]),
            y2: parseFloat(rectMatch[4])
          });
        }
        this.nextLine();
      } else {
        this.nextLine();
      }
    }

    if (this.getCurrentLine().startsWith('END')) {
      this.nextLine();
    }

    return rects;
  }

  private parseOBS(): LEFRect[] {
    const rects: LEFRect[] = [];
    this.nextLine(); // Skip OBS line

    let currentLayer = '';

    while (this.getCurrentLine() && !this.getCurrentLine().startsWith('END')) {
      const line = this.getCurrentLine();

      if (line.includes('LAYER')) {
        const layerMatch = line.match(/LAYER\s+(\w+)/);
        if (layerMatch) currentLayer = layerMatch[1];
        this.nextLine();
      } else if (line.includes('RECT') && currentLayer) {
        const rectMatch = line.match(/RECT\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)/);
        if (rectMatch) {
          rects.push({
            layer: currentLayer,
            x1: parseFloat(rectMatch[1]),
            y1: parseFloat(rectMatch[2]),
            x2: parseFloat(rectMatch[3]),
            y2: parseFloat(rectMatch[4])
          });
        }
        this.nextLine();
      } else {
        this.nextLine();
      }
    }

    if (this.getCurrentLine().startsWith('END')) {
      this.nextLine();
    }

    return rects;
  }
}
