export function parseDEF(content) {
    const lines = content.split(/\r?\n/).map(l => l.trim());
    let version = '';
    let units = 1000;
    let dieArea = { x1: 0, y1: 0, x2: 0, y2: 0 };
    const components = [];
    let inComponents = false;
    let compName = '', compMacro = '', compX = 0, compY = 0, compOrient = 'R0', compPlaced = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('VERSION')) {
            const m = line.match(/VERSION\s+([0-9.]+)/);
            if (m)
                version = m[1];
        }
        else if (line.startsWith('UNITS DISTANCE MICRONS')) {
            const m = line.match(/UNITS DISTANCE MICRONS\s+(\d+)/);
            if (m)
                units = parseInt(m[1], 10);
        }
        else if (line.startsWith('DIEAREA')) {
            // Common form: DIEAREA ( x1 y1 ) ( x2 y2 ) ;
            const m = line.match(/DIEAREA\s+\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)\s+\(\s*([\d.+-]+)\s+([\d.+-]+)\s*\)/i);
            if (m)
                dieArea = { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
        }
        else if (line.startsWith('COMPONENTS')) {
            inComponents = true;
        }
        else if (inComponents && line.startsWith('END COMPONENTS')) {
            inComponents = false;
        }
        else if (inComponents && line.startsWith('-')) {
            // - name macro + PLACED x y N ;
            const m = line.match(/-\s+(\S+)\s+(\S+)(?:\s+\+\s+PLACED\s+([\d.+-]+)\s+([\d.+-]+)\s+(\w+))?/);
            if (m) {
                compName = m[1];
                compMacro = m[2];
                compPlaced = !!m[3];
                compX = m[3] ? +m[3] : 0;
                compY = m[4] ? +m[4] : 0;
                compOrient = m[5] || 'R0';
                components.push({ name: compName, macro: compMacro, x: compX, y: compY, orient: compOrient, placed: compPlaced });
            }
        }
    }
    const result = { version, units, dieArea, components };
    // Vite 環境以外(tsc単体)での一時実行時は import.meta.env が未定義なので安全チェック
    if (import.meta?.env?.DEV) {
        // 開発時の簡易確認ログ
        console.log('[DEF Parser]', {
            version,
            units,
            dieArea: `${dieArea.x1},${dieArea.y1} -> ${dieArea.x2},${dieArea.y2}`,
            componentCount: components.length,
            sample: components.slice(0, 3)
        });
    }
    return result;
}
