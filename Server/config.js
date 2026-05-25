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

module.exports = {
    PORT, HOST,
    FS25_DOCS, DATA_FILE, LOG_FILE,
    SAVEGAME_REFRESH_MS,
    PUBLIC_DIR, DATA_DIR,
};
