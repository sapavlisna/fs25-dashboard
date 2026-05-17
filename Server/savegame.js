// server/savegame.js — read FS25 save folder XML files for authoritative data.
//
// FS25 writes detailed XML on every save (auto + manual):
//   careerSavegame.xml — save name, map id/title, settings, dates
//   fields.xml         — all fields with fruitType, growthState, groundType,
//                        weedState (0-9), sprayLevel/limeLevel/plowLevel, ...
//   farms.xml          — farm names, money, statistics
//   farmland.xml       — farmland id → owner farmId
//
// We detect the currently-loaded save by tailing FS25's log.txt for the most
// recent "savegameN/" reference (FS25 writes that path whenever it touches a
// density map). Then we read the XML files, merge them into the WS payload
// alongside the live mod data, and re-read on a 30 s interval — XML files
// are small so this is cheap.

const fs   = require('fs');
const path = require('path');
const config = require('./config');

const { FS25_DOCS, LOG_FILE, SAVEGAME_REFRESH_MS: REFRESH_MS } = config;
const LOG_TAIL_MAX = 200_000;   // 200 KB tail is enough to find the active save

let state = {
    saveDir:    null,
    fields:     null,         // Map<fieldId, fieldData>
    meta:       null,         // { name, mapId, mapTitle, saveDate, ... }
    farms:      null,         // { farmId: { name, money } }
    farmlands:  null,         // Map<farmlandId, farmId>
    readAt:     0,
    error:      null,
};

// ─── Save-folder detection ───────────────────────────────────────────────────
// Scan the tail of log.txt for path references like "savegame3/" — FS25 writes
// these on every save and on density-map FTG flushes. Last hit wins.

function detectSaveDir() {
    try {
        const stat = fs.statSync(LOG_FILE);
        if (stat.size === 0) return null;
        const start = Math.max(0, stat.size - LOG_TAIL_MAX);
        const fd = fs.openSync(LOG_FILE, 'r');
        const buf = Buffer.alloc(stat.size - start);
        try { fs.readSync(fd, buf, 0, buf.length, start); }
        finally { fs.closeSync(fd); }
        const tail = buf.toString('utf8');

        let lastN = null;
        // Match either Unix or Windows separators.
        const re = /[\/\\]savegame(\d+)[\/\\]/g;
        let m;
        while ((m = re.exec(tail)) !== null) lastN = m[1];
        if (!lastN) return null;
        const dir = path.join(FS25_DOCS, `savegame${lastN}`);
        return fs.existsSync(dir) ? dir : null;
    } catch (_) {
        return null;
    }
}

// ─── XML helpers ─────────────────────────────────────────────────────────────
// Tiny line-based parser. FS25's XML is very regular — one element per line,
// double-quoted attributes — so we sidestep a real parser dependency.

function parseAttrs(line) {
    const out = {};
    const re = /(\w+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(line)) !== null) out[m[1]] = m[2];
    return out;
}

function intOr(s, fallback) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : fallback;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function readFieldsXml(saveDir) {
    const file = path.join(saveDir, 'fields.xml');
    if (!fs.existsSync(file)) return null;
    const xml = fs.readFileSync(file, 'utf8');
    const map = new Map();
    for (const line of xml.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('<field ')) continue;
        const a = parseAttrs(t);
        const id = intOr(a.id, NaN);
        if (!Number.isFinite(id)) continue;
        map.set(id, {
            id,
            fruitType:         a.fruitType || '',
            plannedFruit:      a.plannedFruit || '',
            growthState:       intOr(a.growthState, 0),
            lastGrowthState:   intOr(a.lastGrowthState, 0),
            groundType:        a.groundType || '',
            weedState:         intOr(a.weedState, 0),
            stoneLevel:        intOr(a.stoneLevel, 0),
            sprayType:         a.sprayType || '',
            sprayLevel:        intOr(a.sprayLevel, 0),
            limeLevel:         intOr(a.limeLevel, 0),
            rollerLevel:       intOr(a.rollerLevel, 0),
            plowLevel:         intOr(a.plowLevel, 0),
            stubbleShredLevel: intOr(a.stubbleShredLevel, 0),
            waterLevel:        intOr(a.waterLevel, 0),
        });
    }
    return map;
}

function readCareerSavegameXml(saveDir) {
    const file = path.join(saveDir, 'careerSavegame.xml');
    if (!fs.existsSync(file)) return null;
    const xml = fs.readFileSync(file, 'utf8');
    const get = key => {
        const m = xml.match(new RegExp(`<${key}>([^<]+)<\\/${key}>`));
        return m ? m[1].trim() : '';
    };
    return {
        name:              get('savegameName'),
        mapId:             get('mapId'),
        mapTitle:          get('mapTitle'),
        creationDate:      get('creationDate'),
        saveDate:          get('saveDate'),
        saveDateFormatted: get('saveDateFormatted'),
        difficulty:        get('economicDifficulty'),
    };
}

function readFarmsXml(saveDir) {
    const file = path.join(saveDir, 'farms.xml');
    if (!fs.existsSync(file)) return null;
    const xml = fs.readFileSync(file, 'utf8');
    const out = {};
    // The opening <farm ...> may span attributes liberally; match the line.
    for (const line of xml.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('<farm ')) continue;
        const a = parseAttrs(t);
        if (!a.farmId) continue;
        out[a.farmId] = {
            farmId: intOr(a.farmId, 0),
            name:   a.name || '',
            color:  intOr(a.color, 0),
            loan:   parseFloat(a.loan)  || 0,
            money:  parseFloat(a.money) || 0,
        };
    }
    return out;
}

function readFarmlandXml(saveDir) {
    const file = path.join(saveDir, 'farmland.xml');
    if (!fs.existsSync(file)) return null;
    const xml = fs.readFileSync(file, 'utf8');
    const map = new Map();
    for (const line of xml.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('<farmland ')) continue;
        const a = parseAttrs(t);
        const id = intOr(a.id, NaN);
        if (Number.isFinite(id)) map.set(id, intOr(a.farmId, 0));
    }
    return map;
}

// ─── Refresh loop ────────────────────────────────────────────────────────────

function refresh() {
    try {
        const dir = detectSaveDir();
        state.saveDir = dir;
        state.error = null;
        if (!dir) { state.fields = null; state.meta = null; return; }
        state.fields    = readFieldsXml(dir);
        state.meta      = readCareerSavegameXml(dir);
        state.farms     = readFarmsXml(dir);
        state.farmlands = readFarmlandXml(dir);
        state.readAt    = Date.now();
    } catch (e) {
        state.error = e.message || String(e);
    }
}

setInterval(refresh, REFRESH_MS);
refresh();

// ─── Public API ──────────────────────────────────────────────────────────────

function getSaveDir()  { return state.saveDir; }
function getFields()   { return state.fields; }
function getMeta()     { return state.meta; }
function getFarms()    { return state.farms; }
function getFarmlands(){ return state.farmlands; }
function getReadAt()   { return state.readAt; }

module.exports = {
    getSaveDir, getFields, getMeta, getFarms, getFarmlands, getReadAt, refresh,
};
