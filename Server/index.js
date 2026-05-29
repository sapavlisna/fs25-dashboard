const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');
const path  = require('path');
const fs    = require('fs');
const db       = require('./db');
const savegame = require('./savegame');
const config   = require('./config');
const pkg      = require('./package.json');
const log      = require('./logger');
const recorder = require('./recorder');
const replayer = require('./replayer');
const { DashboardState } = require('./dashboardState');

const { PORT, HOST, DATA_FILE, PUBLIC_DIR, DATA_DIR } = config;

// ─── Dashboard preferences (theme, hidden, order, …) ──────────────────────────
// Shared across every device connecting to this server. Frontend mirrors
// the keys into localStorage for offline access; the server is the source
// of truth for cross-device sync.
const dashState = new DashboardState(path.join(DATA_DIR, 'dashboard-state.json'));

// ─── Schema compatibility ────────────────────────────────────────────────────
// The mod stamps `schemaVersion` on every payload. Bump these bounds when the
// JSON shape changes in a way the server cares about. See COMPATIBILITY.md.
const SERVER_VERSION    = pkg.version;
const MIN_MOD_SCHEMA    = 1;
const MAX_MOD_SCHEMA    = 1;

// Track what mod version + schema we've seen so we warn only on change.
// We normalise undefined → null so the comparison below doesn't fire every
// single tick when a key is simply missing from the payload.
const seenMod = { schemaVersion: null, modVersion: null };

function trackModVersion(data) {
    if (!data || typeof data !== 'object') return;
    const schema = data.schemaVersion ?? null;
    const modVer = data.modVersion    ?? null;
    if (schema === seenMod.schemaVersion && modVer === seenMod.modVersion) return;

    seenMod.schemaVersion = schema;
    seenMod.modVersion    = modVer;

    if (schema === null) {
        log.warn('schema', `mod sent no schemaVersion — assuming legacy (<1). Server expects ${MIN_MOD_SCHEMA}..${MAX_MOD_SCHEMA}. Update the Lua mod.`);
    } else if (schema < MIN_MOD_SCHEMA || schema > MAX_MOD_SCHEMA) {
        log.warn('schema', `mod schemaVersion=${schema} outside supported range ${MIN_MOD_SCHEMA}..${MAX_MOD_SCHEMA} (mod ${modVer ?? '?'}). See COMPATIBILITY.md.`);
    } else {
        log.ok('schema', `mod ${modVer ?? '?'} schemaVersion=${schema} OK (server ${SERVER_VERSION})`);
    }
}

// ─── Express ─────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(express.static(PUBLIC_DIR));
app.use(express.json({ limit: '256kb' }));   // state blobs are tiny

// ─── Dashboard preferences sync ──────────────────────────────────────────────
//
//   GET   /api/dashboard-state          → full state blob
//   PUT   /api/dashboard-state          → replace entire state (rare; UI reset)
//   PATCH /api/dashboard-state          → partial update; body shape:
//                                          { "<key>": <value>, ... }
//                                          Null value deletes the key.
//
// After a successful PUT/PATCH, the server broadcasts the diff to every
// connected WS client as `{ __dashboardStatePatch: { ... } }` so other
// devices update without polling.

app.get('/api/dashboard-state', (_req, res) => {
    res.json(dashState.getAll());
});

app.put('/api/dashboard-state', (req, res) => {
    const next = dashState.replaceAll(req.body || {});
    broadcastStatePatch(next, { fullReplace: true });
    res.json(next);
});

app.patch('/api/dashboard-state', (req, res) => {
    const changed = dashState.patch(req.body || {});
    if (Object.keys(changed).length) broadcastStatePatch(changed);
    res.json({ changed });
});

app.get('/api/current', (_req, res) => {
    try {
        res.json(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    } catch (e) {
        res.status(503).json({ error: 'Data not available', detail: e.message });
    }
});

app.get('/api/history/prices', (req, res) => {
    const { fillType, sellPoint, days } = req.query;
    res.json(db.getPriceHistory(fillType, sellPoint, days || 30));
});

app.get('/api/history/balance', (req, res) => {
    res.json(db.getBalanceHistory(req.query.days || 30));
});

app.get('/api/history/fill-types', (_req, res) => {
    res.json(db.getAvailableFillTypes());
});

app.get('/api/history/sell-points', (_req, res) => {
    res.json(db.getAvailableSellPoints());
});

app.get('/api/profit/fields', (_req, res) => {
    res.json(db.getFieldProfit());
});

app.get('/api/events', (req, res) => {
    res.json(db.getRecentEvents(req.query.limit || 50));
});

app.get('/api/version', (_req, res) => {
    res.json({
        server: SERVER_VERSION,
        schema: { min: MIN_MOD_SCHEMA, max: MAX_MOD_SCHEMA },
        mod:    { schemaVersion: seenMod.schemaVersion, modVersion: seenMod.modVersion },
    });
});

app.get('/api/savegame', (_req, res) => {
    const fieldsMap = savegame.getFields();
    const fields = fieldsMap ? Array.from(fieldsMap.values()) : [];
    res.json({
        saveDir:   savegame.getSaveDir(),
        meta:      savegame.getMeta(),
        farms:     savegame.getFarms(),
        farmlands: savegame.getFarmlands() ? Object.fromEntries(savegame.getFarmlands()) : null,
        fields,
        readAt:    savegame.getReadAt(),
    });
});

// ─── Diagnostic recording (capture & replay) ─────────────────────────────────
//
// SECURITY: these /diag/* endpoints are UNAUTHENTICATED. They can start/stop
// recording, upload arbitrary JSONL, and replay it as live data. That's fine
// for the intended local-only use (the dashboard runs on the user's own
// machine — see the "dashboard stays local" decision), but if you ever expose
// this server on an untrusted network, gate /diag/* behind auth or a flag.
//
// A user hitting a bug records the live payload stream into one self-contained
// JSONL file under <DATA_DIR>/recordings/ and sends it over; scripts/replay.js
// feeds it back through this same server so the bug renders locally. Available
// in every mode (the recorder runs on the bug-reporter's own machine).

// Status/list GETs are polled — never let the browser serve a stale cached
// response (that made the record button appear to cancel itself).
app.use('/diag', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
//
//   POST   /diag/record/start   { note?, lang? }   → { recording }
//   POST   /diag/record/stop                        → { name, frames, durationMs, … }
//   GET    /diag/record/status                      → { active, name?, frames?, … }
//   GET    /diag/recordings                         → [{ name, startedAt, note, … }]
//   GET    /diag/recordings/:name                   → download the .jsonl
//   DELETE /diag/recordings/:name                   → { deleted }

app.post('/diag/record/start', (req, res) => {
    const body = req.body || {};
    try {
        const r = recorder.start({ note: body.note, lang: body.lang });
        broadcastRecordStatus();
        res.json({ recording: r.name });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/diag/record/stop', (_req, res) => {
    const r = recorder.stop();
    broadcastRecordStatus();
    if (!r) return res.status(409).json({ error: 'No active recording' });
    res.json(r);
});

// Retroactive capture: write the always-on rolling buffer to a recording file.
app.post('/diag/record/save-buffer', (req, res) => {
    const body = req.body || {};
    const r = recorder.saveRolling({ note: body.note, lang: body.lang });
    if (!r) return res.status(409).json({ error: 'Nothing buffered yet' });
    res.json(r);
});

// Flag the current moment ("here's where it went wrong").
app.post('/diag/record/marker', (req, res) => {
    const r = recorder.addMarker((req.body || {}).label);
    broadcastRecordStatus();
    res.json(r);
});

app.get('/diag/record/status', (_req, res) => {
    res.json(recorder.status());
});

app.get('/diag/recordings', (_req, res) => {
    res.json(recorder.list());
});

app.get('/diag/recordings/:name', (req, res) => {
    const fp = recorder.resolve(req.params.name);
    if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
    res.download(fp, req.params.name);
});

app.delete('/diag/recordings/:name', (req, res) => {
    const ok = recorder.remove(req.params.name);
    res.status(ok ? 200 : 404).json({ deleted: ok });
});

// Client-side diagnostics (JS errors + a settings/env snapshot) posted by
// public/diag.js. Folded into the active recording if any; always kept in a
// small global ring so a recording started right after a crash still has them.
app.post('/diag/client-log', (req, res) => {
    const body = req.body || {};
    recorder.noteClient(body);
    res.json({ ok: true, recording: recorder.isActive() });
});

// ─── Mockup mode — replay a recording AS live data ────────────────────────────
//
// The dashboard's hidden gesture (10× click the brand) reveals controls that
// upload a recording and replay it through this server, so a bug renders
// locally without the game. While replaying, the file watcher is ignored and
// recorded frames are broadcast verbatim (already enriched — no re-enrich).
//
//   POST /diag/replay/upload?name=<orig>   (text body = JSONL) → { name }
//   POST /diag/replay/start  { name, speed?, loop? }           → status
//   POST /diag/replay/stop                                      → { active:false }
//   GET  /diag/replay/status                                    → status

const replayUpload = express.text({ type: '*/*', limit: '64mb' });

app.post('/diag/replay/upload', replayUpload, (req, res) => {
    const raw = typeof req.body === 'string' ? req.body : '';
    if (!raw.trim()) return res.status(400).json({ error: 'Empty upload' });
    // Accept only something that parses as our JSONL (a meta line or a frame).
    const looksRight = raw.split('\n').some(l => {
        try { const o = JSON.parse(l); return !!(o && (o.payload || o.meta)); } catch (_) { return false; }
    });
    if (!looksRight) return res.status(400).json({ error: 'Not a recognised recording (expected JSONL frames)' });

    const base = String(req.query.name || 'upload')
        .replace(/\.jsonl$/i, '')
        .replace(/[^0-9A-Za-z._-]+/g, '-')
        .slice(0, 40) || 'upload';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `rec-up-${stamp}-${base}.jsonl`;
    try {
        fs.mkdirSync(recorder.recordingsDir(), { recursive: true });
        fs.writeFileSync(path.join(recorder.recordingsDir(), name), raw);
        recorder.prune();
        log.add('replay', `nahrán záznam ${name} (${(raw.length / 1024).toFixed(0)} kB)`);
        res.json({ name });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/diag/replay/start', (req, res) => {
    const body = req.body || {};
    const fp = recorder.resolve(body.name);
    if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Recording not found' });
    try {
        const s = replayer.start({
            filePath: fp,
            name:     body.name,
            speed:    Number(body.speed) || 1,
            loop:     !!body.loop,
            send:     broadcastRaw,
            onStatus: broadcastReplayStatus,
        });
        broadcastReplayStatus();
        res.json(s);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/diag/replay/stop', (_req, res) => {
    replayer.stop();
    broadcastReplayStatus();
    // Return clients to live data right away.
    try { broadcast(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {}
    res.json({ active: false });
});

app.get('/diag/replay/status', (_req, res) => {
    res.json(replayer.status());
});

app.post('/diag/replay/pause',  (_req, res) => res.json(replayer.pause()));
app.post('/diag/replay/resume', (_req, res) => res.json(replayer.resume()));
app.post('/diag/replay/seek', (req, res) => {
    if (!replayer.isActive()) return res.status(409).json({ error: 'No active replay' });
    res.json(replayer.seek(Number((req.body || {}).idx) || 0));
});
app.post('/diag/replay/step', (req, res) => {
    if (!replayer.isActive()) return res.status(409).json({ error: 'No active replay' });
    res.json(replayer.step(Number((req.body || {}).delta) || 0));
});

// ─── Mock scenario switcher ──────────────────────────────────────────────────
//
//   POST /mock/scenario    { "scenario": "<name>" }
//
// Only active when DASHBOARD_MOCK=1 is set (set automatically by the Playwright
// smoke config, not in production).  Writes the scenario name to
// <DATA_DIR>/mock-scenario.txt which mock-data.js polls every 1 s.
//
// Returns:
//   200  { "scenario": "harvest-ready", "file": "/path/to/mock-scenario.txt" }
//   400  { "error": "Missing scenario name" }
//   404  { "error": "Not available outside mock mode" }   (if not in mock mode)

if (process.env.DASHBOARD_MOCK === '1') {
    const { listScenarios } = require('./scripts/mock-scenarios');
    // mock-data.js derives SCENARIO_FILE as  path.dirname(OUTPUT) + '/mock-scenario.txt'
    // where OUTPUT = DASHBOARD_DATA_FILE (the .json file path, not DATA_DIR).
    // We must write to the same directory as the JSON file, not DATA_DIR.
    const SCENARIO_FILE = path.join(path.dirname(DATA_FILE), 'mock-scenario.txt');

    app.post('/mock/scenario', (req, res) => {
        const name = (req.body && req.body.scenario) ? String(req.body.scenario).trim() : '';
        if (!name) {
            return res.status(400).json({ error: 'Missing scenario name' });
        }
        const known = listScenarios();
        if (!known.includes(name)) {
            return res.status(400).json({ error: `Unknown scenario "${name}". Known: ${known.join(', ')}` });
        }
        try {
            fs.writeFileSync(SCENARIO_FILE, name, 'utf8');
            log.info('mock', `scenario switched to "${name}"`);
            res.json({ scenario: name, file: SCENARIO_FILE });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/mock/scenario', (_req, res) => {
        let current = 'default';
        try { current = fs.readFileSync(SCENARIO_FILE, 'utf8').trim() || 'default'; } catch (_) {}
        res.json({ scenario: current, available: listScenarios() });
    });

    log.info('mock', `POST /mock/scenario habilitován (scenario file: ${SCENARIO_FILE})`);
} else {
    // Stub — return 404 so Playwright knows the server isn't in mock mode.
    app.post('/mock/scenario', (_req, res) => {
        res.status(404).json({ error: 'Not available outside mock mode. Start server with DASHBOARD_MOCK=1.' });
    });
    app.get('/mock/scenario', (_req, res) => {
        res.status(404).json({ error: 'Not available outside mock mode.' });
    });
}

// ─── WebSocket ───────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

// Augment payload with derived fields the mod doesn't compute itself.
//   • farmBalanceDeltaDay — balance now minus most-recent earlier day
//   • saveMeta            — savegame name, mapTitle, etc. (from careerSavegame.xml)
//   • each fields[] entry merged with terrain-truth from save's fields.xml:
//       saveFruitType / saveGroundType / weedState / sprayLevel / limeLevel /
//       plowLevel — used by client to show precise condition + override fruit
//       when the mod hasn't picked up a recent change yet.
function enrich(data) {
    if (!data || typeof data !== 'object') return data;
    try {
        if (data.farmBalance != null && data.gameDay != null) {
            const prev = db.getBalanceBefore(data.gameDay);
            if (prev) data.farmBalanceDeltaDay = data.farmBalance - prev.balance;
        }

        const meta = savegame.getMeta();
        if (meta) data.saveMeta = meta;

        const saveFields = savegame.getFields();
        if (saveFields && Array.isArray(data.fields)) {
            for (const f of data.fields) {
                const sd = saveFields.get(f.id);
                if (!sd) continue;
                f.saveFruitType  = sd.fruitType;
                f.plannedFruit   = sd.plannedFruit;
                f.saveGroundType = sd.groundType;
                f.weedState      = sd.weedState;
                f.sprayLevel     = sd.sprayLevel;
                f.limeLevelRaw   = sd.limeLevel;
                f.plowLevelRaw   = sd.plowLevel;
                f.stubbleLevel   = sd.stubbleShredLevel;
                f.rollerLevel    = sd.rollerLevel;

                // If mod returned no fruit (UNKNOWN/empty) but the save file
                // names one, surface it. Don't override an existing live read.
                if ((!f.fruitTypeId || f.fruitTypeId === '') &&
                    sd.fruitType && sd.fruitType !== 'UNKNOWN') {
                    f.fruitTypeId = sd.fruitType;
                }
            }
        }
    } catch (e) {
        log.warn('enrich', e.message);
    }
    return data;
}

function broadcast(rawString) {
    let data;
    try { data = JSON.parse(rawString); } catch (_) { data = null; }
    if (data) trackModVersion(data);
    const enriched = data ? enrich(data) : null;
    if (enriched) recorder.observe(enriched);
    if (recorder.isActive()) broadcastRecordStatus();   // live frame-count while recording
    const msg = enriched ? JSON.stringify(enriched) : rawString;
    wss.clients.forEach(client => {
        if (client.readyState === 1 /* OPEN */) client.send(msg);
    });
}

// Send a dashboard-state diff (or full replace) to every connected client.
// Wrapped in a dedicated envelope so the frontend can tell it apart from a
// regular game-data payload without a heuristic.
function broadcastStatePatch(patch, opts = {}) {
    const msg = JSON.stringify({
        __dashboardStatePatch: patch,
        fullReplace: !!opts.fullReplace,
    });
    wss.clients.forEach(client => {
        if (client.readyState === 1 /* OPEN */) client.send(msg);
    });
}

// Broadcast a payload object verbatim (no enrich, no recording) — used by the
// replayer so recorded frames reach clients exactly as captured.
function broadcastRaw(payloadObj) {
    const msg = JSON.stringify(payloadObj);
    wss.clients.forEach(client => {
        if (client.readyState === 1 /* OPEN */) client.send(msg);
    });
}

// Tell every client about replay (mockup) state so the banner can show/hide.
function broadcastReplayStatus() {
    const msg = JSON.stringify({ __replayStatus: replayer.status() });
    wss.clients.forEach(client => {
        if (client.readyState === 1 /* OPEN */) client.send(msg);
    });
}

// Push recording state to clients (pushed, not polled — a polled GET could be
// served stale from the browser cache, which made the button mis-toggle).
function broadcastRecordStatus() {
    const msg = JSON.stringify({ __recordStatus: recorder.status() });
    wss.clients.forEach(client => {
        if (client.readyState === 1 /* OPEN */) client.send(msg);
    });
}

wss.on('connection', (ws, req) => {
    const ip = (req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
    const ua = req.headers['user-agent'] || '';
    const browser = ua.includes('Edg/')     ? 'Edge'
                  : ua.includes('Chrome/')  ? 'Chrome'
                  : ua.includes('Firefox/') ? 'Firefox'
                  : ua.includes('Safari/')  ? 'Safari'
                  : 'unknown';
    log.add('client', `${browser} (${ip}) → ${wss.clients.size} klient${wss.clients.size === 1 ? '' : (wss.clients.size < 5 ? 'i' : 'ů')}`);

    // Tell the freshly-connected client whether a recording is in progress.
    ws.send(JSON.stringify({ __recordStatus: recorder.status() }));

    // Send current state immediately so the page doesn't wait up to 5s.
    if (replayer.isActive()) {
        // Mockup mode — hand the new client the current replay frame + status.
        const f = replayer.currentFrame();
        if (f) ws.send(JSON.stringify(f));
        ws.send(JSON.stringify({ __replayStatus: replayer.status() }));
    } else {
        try {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            let data; try { data = JSON.parse(raw); } catch (_) {}
            ws.send(data ? JSON.stringify(enrich(data)) : raw);
        } catch (_) { /* file not yet written – that's fine */ }
    }

    ws.on('close', () => {
        const n = wss.clients.size;
        log.drop('client', `${browser} (${ip}) disconnect → ${n} klient${n === 1 ? '' : (n < 5 ? 'i' : 'ů')}`);
    });
    ws.on('error', err => log.error('client', `WS error: ${err.message}`));
});

// ─── File watcher ────────────────────────────────────────────────────────────

const watcher = chokidar.watch(DATA_FILE, {
    persistent: true,
    ignoreInitial: false,
    // Wait until the file stops changing for 150ms before firing (mod writes atomically)
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
});

// ─── Per-tick stats — what came in, what we wrote, what surfaced ───────────
// We deliberately do NOT log every tick at INFO level (would scroll the
// terminal away). Instead we summarise:
//   * The very first payload (which proves "everything connected up").
//   * Every event/snapshot we actually persist to disk.
//   * A 1-minute heartbeat with totals.
//   * Anything that materially changed (new event types, new field counts).

const stats = {
    ticks:        0,
    bytes:        0,
    errors:       0,
    eventsSaved:  0,
    daysSaved:    0,
    firstPayload: false,
    lastDay:      null,
    lastFieldN:   null,
    lastVehN:     null,
    sinceLast:    Date.now(),
};
let lastEventsSnapshot = 0; // count we've seen so we can detect new ones

watcher.on('add',    f => log.info('watch', `sleduji ${f}`));
watcher.on('change', f => {
    // In mockup/replay mode the dashboard is driven by a recording, not the
    // live file — ignore writes so stale/live data can't override the replay.
    if (replayer.isActive()) return;
    try {
        const raw  = fs.readFileSync(f, 'utf8');
        const data = JSON.parse(raw);

        stats.ticks++;
        stats.bytes += raw.length;

        // First-ever payload → narrate the connection coming up.
        if (!stats.firstPayload) {
            stats.firstPayload = true;
            const kb = (raw.length / 1024).toFixed(1);
            log.ok('data', `první payload — mod ${data.modVersion ?? '?'}, schema ${data.schemaVersion ?? '<1'}, ${kb} KB`);
            log.tick('data', `${(data.fields||[]).length} polí · ${(data.vehicles||[]).length} vozidel · ${(data.storage||[]).length} skladů · €${(data.farmBalance ?? 0).toLocaleString('cs-CZ')}`);
        }

        // Surface structural shifts in payload shape — useful for noticing the
        // mod restarted or a savegame switched mid-session.
        const fN = (data.fields  || []).length;
        const vN = (data.vehicles|| []).length;
        if (stats.lastFieldN !== null && (fN !== stats.lastFieldN || vN !== stats.lastVehN)) {
            log.tick('data', `payload shape changed → ${fN} polí · ${vN} vozidel (bylo ${stats.lastFieldN}/${stats.lastVehN})`);
        }
        stats.lastFieldN = fN;
        stats.lastVehN   = vN;

        // db.saveSnapshot writes daily/event rows. Log only when it actually wrote.
        const prevEv = lastEventsSnapshot;
        const prevDay = stats.lastDay;
        db.saveSnapshot(data);
        // Detect new events by comparing the events-array contents we just received.
        const evNow = (data.events || []).length;
        if (evNow > prevEv) {
            const newOnes = (data.events || []).slice(prevEv);
            for (const e of newOnes) {
                log.write('events', `${e.type} field ${e.fieldId} (${e.fruitName ?? e.fruitTypeId ?? '?'})`);
                stats.eventsSaved++;
            }
        }
        lastEventsSnapshot = evNow;

        if (data.gameDay != null && data.gameDay !== prevDay) {
            if (prevDay !== null) {
                log.write('db', `denní snapshot — game day ${data.gameDay}, €${(data.farmBalance ?? 0).toLocaleString('cs-CZ')}`);
                stats.daysSaved++;
            }
            stats.lastDay = data.gameDay;
        }

        broadcast(raw);
    } catch (e) {
        stats.errors++;
        log.error('watch', `parse selhal: ${e.message}`);
    }
});
watcher.on('error', e => {
    stats.errors++;
    log.error('watch', e.message || String(e));
});

// 1-minute heartbeat. Shows you the server is alive and processing data,
// without spamming a line per tick.
setInterval(() => {
    if (!stats.firstPayload && stats.ticks === 0) return;   // nothing to report yet
    const since = Math.round((Date.now() - stats.sinceLast) / 1000);
    const avgKb = stats.ticks ? (stats.bytes / stats.ticks / 1024).toFixed(1) : '0';
    const peers = wss.clients.size;
    log.info('stats', `za ${since}s — ${stats.ticks} ticků · ${stats.errors} chyb · Ø ${avgKb} KB · ${peers} klient${peers === 1 ? '' : (peers < 5 ? 'i' : 'ů')}`);
    stats.ticks      = 0;
    stats.bytes      = 0;
    stats.errors     = 0;
    stats.sinceLast  = Date.now();
}, 60_000).unref();

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, HOST, () => {
    // Shorten the data-file path so the banner stays narrow.
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const dataDisplay = home && DATA_FILE.startsWith(home)
        ? '~' + DATA_FILE.slice(home.length).replace(/\\/g, '/')
        : DATA_FILE.replace(/\\/g, '/');

    log.banner([
        `FS25 Dashboard Server v${SERVER_VERSION}`,
        `▸ http://localhost:${PORT}`,
        `▸ Schema:    ${MIN_MOD_SCHEMA}..${MAX_MOD_SCHEMA}`,
        `▸ Data file: ${dataDisplay}`,
        `▸ History:   ${DATA_DIR.replace(/\\/g, '/')}`,
    ]);
    log.info('boot', 'čekám až FS25 začne psát data…');
});

// Flush an in-progress diagnostic recording before exiting so the last frames
// (the interesting ones, near the bug) aren't lost on Ctrl+C / kill.
function shutdown() {
    if (recorder.isActive()) { try { recorder.stop(); } catch (_) {} }
    if (replayer.isActive()) { try { replayer.stop(); } catch (_) {} }
    process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
