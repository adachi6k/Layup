import { useCallback, useEffect, useState } from 'react';
import { parseDEF } from '../utils/defParser';
import { parseGDS } from '../utils/gdsParser';
import { LEFParser } from '../utils/lefParser';
import type { DEFData } from '../types/def';
import type { GDSData } from '../types/gds';
import type { LEFData } from '../types/lef';

export const VIEW_MODES = ['split', 'lef', 'def', 'gds'] as const;

/** ViewMode stays in sync with VIEW_MODES so validation and state typing share one source of truth. */
export type ViewMode = typeof VIEW_MODES[number];

const isViewMode = (value: string | null): value is ViewMode =>
  VIEW_MODES.includes(value as ViewMode);

export const useLayoutFiles = () => {
  const [lefData, setLefData] = useState<LEFData | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [defData, setDefData] = useState<DEFData | null>(null);
  const [defFilename, setDefFilename] = useState('');
  const [gdsData, setGdsData] = useState<GDSData | null>(null);
  const [gdsFilename, setGdsFilename] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('layoutViewMode') : null;
    return isViewMode(saved) ? saved : 'split';
  });

  useEffect(() => {
    try {
      localStorage.setItem('layoutViewMode', viewMode);
    } catch {
      // Ignore storage errors in restricted browser contexts.
    }
  }, [viewMode]);

  const handleBinaryFileLoad = useCallback((content: ArrayBuffer, fileName: string) => {
    setLoading(true);
    setError(null);
    try {
      const lower = fileName.toLowerCase();
      if (!lower.endsWith('.gds') && !lower.endsWith('.gdsii')) {
        throw new Error('Binary layout loading currently supports .gds and .gdsii files');
      }
      const parsed = parseGDS(content);
      setGdsData(parsed);
      setGdsFilename(fileName);
      setViewMode('gds');
    } catch (err) {
      setError(`Failed to parse GDS file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFileLoad = useCallback((content: string, fileName: string) => {
    setLoading(true);
    setError(null);
    try {
      const lower = fileName.toLowerCase();
      if (lower.endsWith('.lef')) {
        const parser = new LEFParser();
        const parsed = parser.parse(content);
        setLefData(parsed);
        setFilename(fileName);
        if (!defData) setViewMode('lef');
      } else if (lower.endsWith('.def')) {
        const parsed = parseDEF(content);
        setDefData(parsed);
        setDefFilename(fileName);
        if (!lefData) setViewMode('def');
      } else {
        try {
          const parser = new LEFParser();
          const parsed = parser.parse(content);
          setLefData(parsed);
          setFilename(fileName || 'unknown.lef');
        } catch {
          const parsedD = parseDEF(content);
          setDefData(parsedD);
          setDefFilename(fileName || 'unknown.def');
        }
      }
    } catch (err) {
      setError(`Failed to parse file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [defData, lefData]);

  const handleUrlLoad = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const fileName = url.split('/').pop() || 'remote-file.lef';
      const lower = fileName.toLowerCase();
      if (lower.endsWith('.gds') || lower.endsWith('.gdsii')) {
        const content = await response.arrayBuffer();
        handleBinaryFileLoad(content, fileName);
      } else {
        const content = await response.text();
        handleFileLoad(content, fileName);
      }
    } catch (err) {
      setError(`Failed to load file from URL: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setLoading(false);
    }
  }, [handleBinaryFileLoad, handleFileLoad]);

  return {
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
  };
};
