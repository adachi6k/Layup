# LEF File Viewer - Copilot Instructions

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Project Overview

This is a LEF (Library Exchange Format) file viewer application built with React and TypeScript, inspired by the OpenROAD project. The application allows users to visualize EDA (Electronic Design Automation) LEF files graphically.

## Key Technologies

- **React 18** with TypeScript for the frontend framework
- **Vite** for fast development and building
- **Bootstrap 5** with React Bootstrap for UI components
- **SVG/Canvas** for rendering graphics and visualizations

## Code Guidelines

1. **LEF Parser**: When working with LEF file parsing, focus on extracting:
   - MACRO definitions with SIZE, PINS, and geometry data
   - LAYER information with RECT coordinates
   - VIA definitions and connectivity

2. **Visualization**: For rendering LEF data:
   - Use SVG for scalable vector graphics
   - Implement zoom and pan functionality
   - Color-code different layers (M1, M2, M3, etc.)
   - Show pin locations and connectivity

3. **File Handling**: 
   - Support drag-and-drop file upload
   - Parse LEF files line by line for large files
   - Handle URL-based file loading

4. **UI Components**:
   - Use React Bootstrap components for consistent styling
   - Implement responsive design for different screen sizes
   - Add file browser, layer controls, and property inspector panels

## Architecture Patterns

- Use React hooks for state management
- Implement custom hooks for LEF parsing and rendering logic
- Separate concerns: parser, renderer, and UI components
- Use TypeScript interfaces for LEF data structures

## Performance Considerations

- Virtualize large drawings with canvas or WebGL when needed
- Implement progressive loading for complex layouts
- Use memoization for expensive calculations
- Optimize re-renders with React.memo and useMemo
