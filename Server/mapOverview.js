// mapOverview.js — extracts each map mod's `overview.dds` (the same top-down
// image GIANTS uses for the in-game PDA/map) and converts it to a PNG the
// Live Map page can use as a background. One-time per map, cached in
// data/map-overview/ keyed by mod name; never blocks the main export pipeline.
//
// No new npm dependency: zip reading shells out to PowerShell's
// System.IO.Compression (same pattern as config.js's browseForFolder), DDS
// decoding shells out to ffmpeg. Both best-effort — any missing piece (mod
// zip not found, ffmpeg not installed) just means no background image, never
// a crash.

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const log    = require('./logger');

const CACHE_DIR = path.join(config.DATA_DIR, 'map-overview');
const inFlight  = new Map();   // mapId -> Promise<string|null>, dedupes concurrent requests

// FS25's log.txt prints "Mod Directory: <path>" at every startup — more
// reliable than config.MODS_DIR's static default when mods live outside the
// standard Documents folder (e.g. a custom Steam library mount).
function discoverModsDir() {
    try {
        const text = fs.readFileSync(config.LOG_FILE, 'utf8');
        const matches = [...text.matchAll(/Mod Directory:\s*(.+)/g)];
        if (matches.length) return matches[matches.length - 1][1].trim();
    } catch (_) { /* log not readable yet */ }
    return null;
}

function candidateModsDirs() {
    return [...new Set([discoverModsDir(), config.MODS_DIR].filter(Boolean))];
}

function sanitize(name) {
    return name.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function findModZip(modName) {
    for (const dir of candidateModsDirs()) {
        const p = path.join(dir, `${modName}.zip`);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function extractOverviewDds(zipPath, outPath) {
    return new Promise(resolve => {
        const zp = zipPath.replace(/'/g, "''");
        const op = outPath.replace(/'/g, "''");
        const ps = `
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $z = [System.IO.Compression.ZipFile]::OpenRead('${zp}')
            $entry = $z.Entries | Where-Object { $_.FullName -match 'overview\\.dds$' } | Select-Object -First 1
            if ($entry) {
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${op}', $true)
                [Console]::Out.Write('OK')
            }
            $z.Dispose()`;
        let child;
        try {
            child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
        } catch (_) { return resolve(false); }
        let out = '';
        child.stdout.on('data', d => { out += d.toString(); });
        child.on('error', () => resolve(false));
        child.on('close', () => resolve(out.trim() === 'OK' && fs.existsSync(outPath)));
    });
}

function convertDdsToPng(ddsPath, pngPath) {
    return new Promise(resolve => {
        let child;
        try {
            child = spawn('ffmpeg', ['-y', '-i', ddsPath, '-vf', 'scale=1024:1024', pngPath], { windowsHide: true });
        } catch (_) { return resolve(false); }
        child.on('error', () => resolve(false));   // ffmpeg not installed — degrade gracefully
        child.on('close', code => resolve(code === 0 && fs.existsSync(pngPath)));
    });
}

async function buildOverviewImage(mapId) {
    const modName = mapId.split('.')[0];   // "FS25_Kolonia.SampleModMap" -> "FS25_Kolonia"
    const pngPath = path.join(CACHE_DIR, `${sanitize(modName)}.png`);

    const zipPath = findModZip(modName);
    if (!zipPath) return null;

    try {
        const zipStat = fs.statSync(zipPath);
        const pngStat = fs.statSync(pngPath);
        if (pngStat.mtimeMs >= zipStat.mtimeMs) return pngPath;   // cache hit
    } catch (_) { /* no cache yet */ }

    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const ddsPath = path.join(CACHE_DIR, `${sanitize(modName)}.dds`);

    const extracted = await extractOverviewDds(zipPath, ddsPath);
    if (!extracted) {
        log.warn('map', `no overview.dds found in ${zipPath} — Live Map will show no background`);
        return null;
    }

    const converted = await convertDdsToPng(ddsPath, pngPath);
    try { fs.unlinkSync(ddsPath); } catch (_) {}
    if (!converted) {
        log.warn('map', 'ffmpeg unavailable or conversion failed — Live Map will show no background');
        return null;
    }

    log.info('map', `overview image ready for ${modName}`);
    return pngPath;
}

function ensureOverviewImage(mapId) {
    if (!mapId) return Promise.resolve(null);
    if (inFlight.has(mapId)) return inFlight.get(mapId);
    const promise = buildOverviewImage(mapId).finally(() => inFlight.delete(mapId));
    inFlight.set(mapId, promise);
    return promise;
}

module.exports = { ensureOverviewImage };
