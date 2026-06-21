// config.js — single source of truth for paths, ports, and tunables.
//
// Resolution order (first non-empty wins):
//   1. Environment variable
//   2. `config.local.json` next to this file (gitignored, optional)
//   3. Built-in default
//
// Examples:
//   set DASHBOARD_PORT=4000 && npm start
//   set FS25_DOCS_DIR=D:\Games\FS25-Docs && npm start
//
// Or create config.local.json:
//   {
//     "port": 4000,
//     "fs25DocsDir": "D:\\Games\\FS25-Docs",
//     "host": "0.0.0.0"
//   }

const fs   = require('fs');
const path = require('path');
const log  = require('./logger');

// When packaged with `pkg`, __dirname points inside a virtual /snapshot/.
// We want config.local.json + data/ next to the .exe on the real filesystem,
// so derive a "base" dir from process.execPath in that case.
const IS_PACKAGED = !!process.pkg;
const BASE_DIR = IS_PACKAGED ? path.dirname(process.execPath) : __dirname;

const LOCAL_PATH = path.join(BASE_DIR, 'config.local.json');
let local = {};
try {
    if (fs.existsSync(LOCAL_PATH)) {
        local = JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
    }
} catch (e) {
    log.warn('config', `failed to read ${LOCAL_PATH}: ${e.message}`);
}

function pick(envName, localKey, fallback) {
    if (process.env[envName] != null && process.env[envName] !== '') {
        return process.env[envName];
    }
    if (local[localKey] != null && local[localKey] !== '') {
        return local[localKey];
    }
    return fallback;
}

// ─── Server bind ─────────────────────────────────────────────────────────────

const PORT = parseInt(pick('DASHBOARD_PORT', 'port', '3000'), 10);
const HOST = pick('DASHBOARD_HOST', 'host', '0.0.0.0');

// Auto-open the dashboard in the default browser on startup. On by default;
// toggle from the UI (Nastavení → Připojení) or set DASHBOARD_OPEN_BROWSER=false.
const OPEN_BROWSER = String(pick('DASHBOARD_OPEN_BROWSER', 'openBrowser', 'true')) !== 'false';

// ─── FS25 user folder ────────────────────────────────────────────────────────
// On Windows this is `Documents/My Games/FarmingSimulator2025/`. The mod writes
// `dashboard_data.json` here and FS25 itself writes `log.txt` + `savegameN/`
// folders we need to read. Override with FS25_DOCS_DIR if your FS25 install
// keeps documents elsewhere (e.g. OneDrive-redirected Documents).

const FS25_DOCS = pick(
    'FS25_DOCS_DIR',
    'fs25DocsDir',
    path.join(process.env.USERPROFILE || process.env.HOME || '.',
              'Documents', 'My Games', 'FarmingSimulator2025'),
);

// ─── Per-file overrides ──────────────────────────────────────────────────────
// Usually you only override FS25_DOCS_DIR; these individual overrides exist
// for unusual setups (custom mod that writes elsewhere, log redirected, …).

const DATA_FILE = pick(
    'DASHBOARD_DATA_FILE',
    'dataFile',
    path.join(FS25_DOCS, 'dashboard_data.json'),
);
const LOG_FILE = pick(
    'FS25_LOG_FILE',
    'logFile',
    path.join(FS25_DOCS, 'log.txt'),
);

// ─── Behaviour tunables ──────────────────────────────────────────────────────

const SAVEGAME_REFRESH_MS = parseInt(pick('SAVEGAME_REFRESH_MS', 'savegameRefreshMs', '30000'), 10);

// ─── Frontend static dir + history JSONL location ────────────────────────────

const PUBLIC_DIR = path.join(__dirname, 'public');
// Source layout: <repo>/src/Dashboard/Server → data lives at <repo>/data
// Packaged exe: data/ lives next to the .exe
const DEFAULT_DATA_DIR = IS_PACKAGED
    ? path.join(BASE_DIR, 'data')
    : path.join(__dirname, '..', '..', '..', 'data');
const DATA_DIR = pick('DASHBOARD_DATA_DIR', 'dataDir', DEFAULT_DATA_DIR);

// ─── Relay (optional outbound sharing) ───────────────────────────────────────
// When RELAY_URL is set, the server also publishes its frame stream to a relay
// (see relay-client.js) so people can watch a read-only copy over the internet.
// RELAY_PUBLISH_KEY is this publisher's personal key; it must exist (enabled) in
// the relay's publishers.json. Leave RELAY_URL empty to keep everything local.
const RELAY_URL         = pick('RELAY_URL', 'relayUrl', '');
const RELAY_PUBLISH_KEY = pick('RELAY_PUBLISH_KEY', 'relayPublishKey', '');
// Enabled by default once a URL is set; the UI toggle persists this.
const RELAY_ENABLED     = String(pick('RELAY_ENABLED', 'relayEnabled', RELAY_URL ? 'true' : 'false')) !== 'false';

if (RELAY_URL && RELAY_ENABLED && !RELAY_PUBLISH_KEY) {
    log.warn('config', 'RELAY_URL je nastavená, ale RELAY_PUBLISH_KEY chybí — relay publisher se nepřipojí.');
}

// Merge-write a patch into config.local.json (used by the UI relay settings).
// Only the keys passed are touched; the rest of the file is preserved.
function saveLocal(patch) {
    let current = {};
    try {
        if (fs.existsSync(LOCAL_PATH)) current = JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
    } catch (e) {
        log.warn('config', `config.local.json nešel přečíst, přepisuji: ${e.message}`);
    }
    const merged = { ...current, ...patch };
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(merged, null, 2));
    return merged;
}

// ─── Setup wizard helpers ────────────────────────────────────────────────────
// The first-run UI (Nastavení → Připojení) needs to tell the user whether a
// candidate FS25 docs folder actually contains the files we read. These are
// read-only probes — they never throw, an unreadable/missing dir just reports
// everything as false/0.

function probeDir(dir) {
    const out = { dir, exists: false, dataFileExists: false, logFileExists: false, savegamesFound: 0 };
    if (!dir) return out;
    try {
        out.exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
        if (!out.exists) return out;
        out.dataFileExists = fs.existsSync(path.join(dir, 'dashboard_data.json'));
        out.logFileExists  = fs.existsSync(path.join(dir, 'log.txt'));
        out.savegamesFound = fs.readdirSync(dir)
            .filter(name => /^savegame\d+$/i.test(name)).length;
    } catch (_) { /* unreadable dir → leave defaults */ }
    return out;
}

// Candidate FS25 docs folders to offer as one-click suggestions: the currently
// resolved dir plus the standard Documents path. Deduplicated, order preserved.
// The frontend only shows chips for ones that actually exist.
function candidateDirs() {
    const home = process.env.USERPROFILE || process.env.HOME || '.';
    const list = [
        FS25_DOCS,
        path.join(home, 'Documents', 'My Games', 'FarmingSimulator2025'),
    ];
    return [...new Set(list)];
}

// Open a native folder-picker dialog ON THE SERVER MACHINE (this is a local app —
// browser + server share a machine) and resolve to the chosen path, or null if
// the user cancelled. Shells out to system PowerShell so it works in the packaged
// .exe too. Best-effort: resolves null on any failure.
function browseForFolder(initialDir) {
    return new Promise(resolve => {
        const { spawn } = require('child_process');
        const init = (initialDir || '').replace(/'/g, "''");
        const ps = `
            Add-Type -AssemblyName System.Windows.Forms
            $f = New-Object System.Windows.Forms.FolderBrowserDialog
            $f.Description = 'Vyber složku FarmingSimulator2025'
            $f.ShowNewFolderButton = $false
            if ('${init}' -ne '' -and (Test-Path -LiteralPath '${init}')) { $f.SelectedPath = '${init}' }
            $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
            if ($f.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
                [Console]::Out.Write($f.SelectedPath)
            }`;
        let out = '';
        try {
            const child = spawn('powershell.exe',
                ['-NoProfile', '-STA', '-NonInteractive', '-Command', ps],
                { windowsHide: true });
            child.stdout.on('data', d => { out += d.toString(); });
            child.on('error', () => resolve(null));
            child.on('close', () => resolve(out.trim() || null));
        } catch (_) { resolve(null); }
    });
}

module.exports = {
    PORT, HOST,
    FS25_DOCS, DATA_FILE, LOG_FILE,
    SAVEGAME_REFRESH_MS,
    PUBLIC_DIR, DATA_DIR,
    RELAY_URL, RELAY_PUBLISH_KEY, RELAY_ENABLED,
    OPEN_BROWSER,
    LOCAL_PATH, IS_PACKAGED, saveLocal,
    probeDir, candidateDirs, browseForFolder,
};
