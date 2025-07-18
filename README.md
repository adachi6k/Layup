# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

# LEF File Viewer

A web-based LEF (Library Exchange Format) file viewer for EDA (Electronic Design Automation) applications. This tool allows you to visualize circuit layouts, pins, and layer information from LEF files in an interactive graphical interface.

![LEF Viewer Screenshot](docs/screenshot.png)

## Features

- **Drag & Drop Interface**: Simply drag LEF files into the browser
- **URL Loading**: Load LEF files from remote URLs (including sample files)
- **Interactive Visualization**: 
  - Layer-by-layer visualization with color coding
  - Toggle layer visibility
  - Zoom and pan support
  - Pin and obstruction geometry display
- **Detailed Information**: 
  - File metadata and statistics
  - Pin information with direction and usage
  - Macro properties and dimensions
- **Responsive Design**: Works on desktop and mobile devices

## Supported Features

- LEF version 5.6+ files
- MACRO definitions with:
  - SIZE and ORIGIN information
  - PIN geometries and properties
  - OBS (obstruction) geometries
  - Multiple metal layers (M1-M8)
  - Via layers (V1-V5)
  - Power and ground pins (VDD/VSS)

## Getting Started

### Prerequisites

- Node.js 18+ (Note: Vite 7.x requires Node 20+, but will work with warnings on Node 18)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd layup
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

### Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Usage

1. **Load a LEF file**:
   - Drag and drop a `.lef` file onto the interface
   - Click "Choose File" to browse for a file
   - Click "Load Sample File" to load a demo file

2. **Navigate the interface**:
   - **Left panel**: File information, layer controls, and macro list
   - **Center panel**: Interactive visualization of the selected macro
   - **Right panel**: Detailed pin information

3. **Layer controls**:
   - Toggle individual layers on/off using checkboxes
   - Each layer is color-coded for easy identification

4. **Macro selection**:
   - Click on macros in the left panel to switch between them
   - View detailed pin information in the right panel

## Technology Stack

- **React 18** with TypeScript
- **Vite** for fast development and building
- **Bootstrap 5** with React Bootstrap for UI components
- **SVG** for scalable vector graphics rendering

## Architecture

- `src/types/lef.ts` - TypeScript interfaces for LEF data structures
- `src/utils/lefParser.ts` - LEF file parsing logic
- `src/components/FileDropZone.tsx` - File upload component
- `src/components/LEFViewer.tsx` - Main visualization component

## Sample Files

The application includes support for loading sample LEF files from the OpenROAD project:
- [ASAP7 SRAM LEF files](https://github.com/The-OpenROAD-Project/asap7_sram_0p0)

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature-name`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by the [OpenROAD](https://github.com/The-OpenROAD-Project/OpenROAD) project
- Based on the [Meno](https://github.com/shioyadan/meno) visualization tool architecture
- Uses LEF file format specifications from the EDA industry

## Future Enhancements

- [ ] 3D layer visualization
- [ ] DEF file support
- [ ] Export functionality (PNG, SVG, PDF)
- [ ] Advanced search and filtering
- [ ] Performance optimization for large files
- [ ] WebGL rendering for complex layouts

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
