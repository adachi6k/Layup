# Layup - Web-based Layout File Viewer

Layup is a lightweight, browser-based viewer for LEF, DEF, and GDSII layout files.  
It helps you quickly inspect MACRO geometry, pins, layers, and obstructions (OBS) for library / layout understanding and early verification—without installing heavy EDA tools.

https://adachi6k.github.io/Layup/

<img width="1255" height="956" alt="screenshot" src="https://github.com/user-attachments/assets/0995b07c-a8f4-450e-84bc-95f91e62ee6b" />

---

## Key Features

- Drag & drop, file picker, or sample URL loading
- LEF, DEF, and GDSII file loading
- Layer visibility toggling (Metal / Via / PIN / OBS)
- Zoom & pan (mouse & touch)
- Macro switching with size / origin display
- Pin list with direction, use, and geometry preview
- Obstruction (OBS) visualization
- File statistics (macro count, pin count, etc.)
- Responsive layout (desktop / mobile)

---

## Supported LEF Elements (Current Scope)

| Category  | Supported Items |
|-----------|------------------|
| Version   | 5.6+ core constructs (progressively expanding) |
| MACRO     | NAME, CLASS, SIZE, ORIGIN, SYMMETRY (when present) |
| PIN       | DIRECTION, USE, PORT (LAYER / RECT) |
| LAYER     | Common metal layers (M1–M8) and via layers (V1–V5) |
| OBS       | LAYER / RECT |
| Not yet   | ANTENNAMODEL, advanced SPACINGTABLE forms, complex SITE usage, POLYGON, etc. |

Open an issue if you need unsupported constructs.

---

## Usage Workflow

1. Provide a `.lef`, `.def`, `.gds`, or `.gdsii` file (drag & drop, choose file, or load a sample).
2. Use the left panel to:
   - View file summary
   - Toggle layer visibility
   - Select macros
3. Explore the central Canvas view:
   - Zoom with mouse wheel / pinch
   - Pan by dragging
4. Inspect pins in the right panel:
   - Direction / use / layer rectangles
5. Iterate across macros as needed.

All parsing happens locally inside the browser (no server upload).

---

## Quick Start (Development)

### Prerequisites

- Node.js 18+
- npm / yarn / pnpm

### Setup

```bash
git clone https://github.com/adachi6k/Layup.git
cd Layup
npm install
npm run dev
# Open http://localhost:5173
```

### Production Build

```bash
npm run build
npm run preview  # Optional local preview
```

Build artifacts are emitted to `dist/` and can be hosted on any static hosting (GitHub Pages, Vercel, Netlify, etc.).

---

## Architecture Overview

| Path | Purpose |
|------|---------|
| `src/App.tsx` | Application shell that chooses the active LEF / DEF / GDS viewer |
| `src/hooks/useLayoutFiles.ts` | File loading, URL loading, parser dispatch, and view-mode state |
| `src/components/AppNavbar.tsx` | Loaded-file summary and LEF / DEF / GDS view-mode switcher |
| `src/components/FileDropZone.tsx` | Initial drag-and-drop, file picker, and sample-file loading UI |
| `src/types/lef.ts` | TypeScript interfaces for LEF entities |
| `src/utils/lefParser.ts` | Text → normalized in‑memory model |
| `src/components/LEFViewerCanvas.tsx` | Main LEF Canvas visualization with macro, layer, and pin panels |
| `src/types/def.ts` | TypeScript interfaces for DEF entities |
| `src/utils/defParser.ts` | DEF text parser for die area, components, pins, and net connectivity |
| `src/components/DEFLayoutViewer.tsx` | DEF Canvas visualization for die, components, pins, and LEF-assisted macro sizes |
| `src/types/gds.ts` | TypeScript interfaces for GDSII entities |
| `src/utils/gdsParser.ts` | Binary GDSII → normalized in-memory model |
| `src/components/GDSViewer.tsx` | GDSII canvas visualization |

### Data Flow

```
Raw LEF / DEF text or GDSII binary data
    ↓ (tokenization / parsing)
Normalized layout model (macros / pins / layers / rects / polygons / references)
    ↓
React state
    ↓
Canvas rendering (grouped per layer -> geometry -> styled)
```

### Rendering Strategy

- LEF, DEF, and GDS coordinates are mapped into Canvas world coordinates.
- Each viewer owns format-specific drawing while sharing common interaction concepts: wheel zoom, drag pan, reset / fit, cursor coordinates, and layer visibility.
- LEF uses a Canvas renderer as the active production viewer; the older SVG and debug viewer variants have been removed to keep the codebase focused.
- Colors are deterministic per layer or orientation, with format-specific palettes.

### Development Checks

```bash
npm install
npm run lint
npm run build
```

There is no dedicated `npm test` script yet; parser and coordinate-transform tests are planned future work.

---

## Limitations / Known Gaps

- Very large LEF files (tens of thousands of rects) may impact performance.
- DEF support parses DIEAREA, COMPONENTS, PINS, and NET connectivity, but routed net geometry is not yet rendered.
- GDS support focuses on BOUNDARY, PATH, SREF, and AREF geometry. Full text/property rendering is not yet supported.
- VIA compound definitions simplified to rectangles.
- Error handling for malformed LEF is basic.
- No POLYGON support (currently RECT only).

---

## Roadmap (Planned Enhancements)

- [ ] 3D layer extrusion / stacked preview
- [ ] Richer DEF rendering for routed nets and pin shapes
- [ ] Export (PNG / SVG / PDF)
- [ ] Advanced filtering (pin name / layer / direction)
- [ ] Performance optimizations (tiling / virtualization)
- [ ] WebGL / Canvas backend for heavy geometry
- [ ] Ruler & coordinate probe
- [ ] Dark theme
- [ ] Internationalization (i18n)
- [ ] POLYGON & complex VIA support

Contributions / suggestions welcome.

---

## Sample Sources

You can load public LEF samples (subject to CORS):

- ASAP7 SRAM LEF: https://github.com/The-OpenROAD-Project/asap7_sram_0p0

Paste raw file URLs into the URL input field.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Implement & test: `npm run dev`
4. (Optional) Lint / types: `npm run lint && npm run typecheck` (add script if missing)
5. Commit: `git commit -m "feat: add your feature"`
6. Push & open a Pull Request

### Optional ESLint Setup

```js
// eslint.config.js (example)
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'
import tseslint from 'typescript-eslint'

export default tseslint.config([
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      reactX.configs['recommended-typescript'],
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
])
```

---

## FAQ

Q: Does the file ever leave my machine?  
A: No. Parsing and rendering happen entirely in the browser.

Q: What units are shown?  
A: LEF units (micron scale) are scaled proportionally into Canvas world coordinates.

Q: Are non-rectangular shapes supported?  
A: Not yet—RECT only. File an issue if you require POLYGON.

Q: How are colors chosen?  
A: Deterministic hash of layer names (planned customizable palette).

---

## License

MIT License – see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [OpenROAD](https://github.com/The-OpenROAD-Project/OpenROAD)
- Architectural inspiration from [Meno](https://github.com/shioyadan/meno)
- LEF specification and broader EDA community efforts

---

## Short Summary (TL;DR)

Layup is an in-browser layout viewer: drop a file, toggle layers, inspect pins and geometry, and explore layouts without backend dependencies. Roadmap includes richer DEF/GDS support, exports, performance tuning, and a WebGL backend.

---

Bug reports & feature requests: please include reproduction steps and (if possible) a minimal LEF snippet.

Happy hacking!
