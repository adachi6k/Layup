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

const getInitialViewMode = (): ViewMode => {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('layoutViewMode') : null;
    return isViewMode(saved) ? saved : 'split';
  } catch {
    return 'split';
  }
};

export const useLayoutFiles = () => {
  const [lefData, setLefData] = useState<LEFData | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [defData, setDefData] = useState<DEFData | null>(null);
  const [defFilename, setDefFilename] = useState('');
  const [gdsData, setGdsData] = useState<GDSData | null>(null);
  const [gdsFilename, setGdsFilename] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode);

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

  /**
   * Load multiple files at once (e.g. LEF + DEF dropped together).
   * All files are parsed before any state is committed so that a parse failure
   * in a later file does not leave the app in a partial / inconsistent state.
   */
  const handleMultipleFilesLoad = useCallback(
    (files: Array<{ content: string | ArrayBuffer; filename: string }>) => {
      setLoading(true);
      setError(null);
      try {
        // Parse every file first; state is only written after all succeed.
        let newLef: LEFData | null = null;
        let newLefName = '';
        let newDef: DEFData | null = null;
        let newDefName = '';
        let newGds: GDSData | null = null;
        let newGdsName = '';

        for (const { content, filename: fileName } of files) {
          const lower = fileName.toLowerCase();
          if (lower.endsWith('.lef')) {
            newLef = new LEFParser().parse(content as string);
            newLefName = fileName;
          } else if (lower.endsWith('.def')) {
            newDef = parseDEF(content as string);
            newDefName = fileName;
          } else if (lower.endsWith('.gds') || lower.endsWith('.gdsii')) {
            newGds = parseGDS(content as ArrayBuffer);
            newGdsName = fileName;
          }
        }

        // All parses succeeded — commit the new values atomically.
        if (newLef !== null) {
          setLefData(newLef);
          setFilename(newLefName);
        }
        if (newDef !== null) {
          setDefData(newDef);
          setDefFilename(newDefName);
        }
        if (newGds !== null) {
          setGdsData(newGds);
          setGdsFilename(newGdsName);
        }

        // Determine the most useful view mode after batch load.
        // GDS cannot be combined with LEF/DEF in the same view, so LEF+DEF takes priority.
        const hasLef = newLef !== null;
        const hasDef = newDef !== null;
        const hasGds = newGds !== null;
        if (hasLef && hasDef) setViewMode('split');
        else if (hasGds && !hasLef && !hasDef) setViewMode('gds');
        else if (hasLef) setViewMode('lef');
        else if (hasDef) setViewMode('def');
      } catch (err) {
        setError(`Failed to parse file: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /**
   * Fetch multiple remote URLs in parallel and load them as a batch.
   * Useful for loading a matched LEF + DEF sample pair in a single action.
   */
  const handleMultipleUrlsLoad = useCallback(async (urls: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        urls.map(async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          const fileName = url.split('/').pop() || 'remote-file';
          const lower = fileName.toLowerCase();
          if (lower.endsWith('.gds') || lower.endsWith('.gdsii')) {
            return { content: await response.arrayBuffer(), filename: fileName };
          }
          return { content: await response.text(), filename: fileName };
        }),
      );
      handleMultipleFilesLoad(results);
    } catch (err) {
      setError(`Failed to load files: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setLoading(false);
    }
  }, [handleMultipleFilesLoad]);

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
    handleMultipleFilesLoad,
    handleMultipleUrlsLoad,
    handleUrlLoad,
  };
};
