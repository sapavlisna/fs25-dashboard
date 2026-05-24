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
const { DashboardState } = require('./dashboardState');
const { BridgeClient }   = require('./bridge-client');

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

const seenMod = { schemaVersion: null, modVersion: null, warnedAt: 0 };

function trackModVersion(data) {
    if (!data || typeof data !== 'object') return;
    const schema = data.schemaVersion;
    const modVer = data.modVersion;
    if (schema !== seenMod.schemaVersion || modVer !== seenMod.modVersion) {
        seenMod.schemaVersion = schema ?? null;
        seenMod.modVersion    = modVer ?? null;
        if (schema == null) {
            console.warn(`[Schema] Mod sent no schemaVersion — assuming legacy (<1). Server expects ${MIN_MOD_SCHEMA}..${MAX_MOD_SCHEMA}. Update the Lua mod.`);
        } else if (schema < MIN_MOD_SCHEMA || schema > MAX_MOD_SCHEMA) {
            console.warn(`[Schema] Mod schemaVersion=${schema} outside supported range ${MIN_MOD_SCHEMA}..${MAX_MOD_SCHEMA} (mod ${modVer ?? '?'}). See COMPATIBILITY.md.`);
        } else {
            console.log(`[Schema] Mod ${modVer ?? '?'} schemaVersion=${schema} OK (server ${SERVER_VERSION}).`);
        }
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
        console.warn('[Enrich] error:', e.message);
    }
    return data;
}

function broadcast(rawString) {
    let data;
    try { data = JSON.parse(rawString); } catch (_) { data = null; }
    if (data) trackModVersion(data);
    const enriched = data ? enrich(data) : null;
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

wss.on('connection', ws => {
    console.log(`[WS] +1 client (total: ${wss.clients.size})`);
    // Send current state immediately so page doesn't wait up to 5s
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        let data; try { data = JSON.parse(raw); } catch (_) {}
        ws.send(data ? JSON.stringify(enrich(data)) : raw);
    } catch (_) { /* file not yet written – that's fine */ }

    ws.on('close', () => console.log(`[WS] -1 client (total: ${wss.clients.size})`));
    ws.on('error', err => console.error('[WS] Error:', err.message));
});

// ─── File watcher ────────────────────────────────────────────────────────────

const watcher = chokidar.watch(DATA_FILE, {
    persistent: true,
    ignoreInitial: false,
    // Wait until the file stops changing for 150ms before firing (mod writes atomically)
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
});

// ─── Optional cloud bridge (push deltas to a remote relay) ──────────────────
// Activated when BRIDGE_UPSTREAM_URL is set. The bridge runs as a parallel
// WebSocket *client*; it does not affect local broadcast or REST endpoints.
let bridge = null;
let lastPayload = null;

const BRIDGE_UPSTREAM_URL = process.env.BRIDGE_UPSTREAM_URL || '';
const INGEST_TOKEN        = process.env.INGEST_TOKEN || '';

if (BRIDGE_UPSTREAM_URL) {
    if (!INGEST_TOKEN) {
        console.warn('[Bridge] BRIDGE_UPSTREAM_URL set but INGEST_TOKEN missing — bridge disabled.');
    } else {
        bridge = new BridgeClient({
            upstreamUrl:    BRIDGE_UPSTREAM_URL,
            ingestToken:    INGEST_TOKEN,
            db,
            dashState,
            getLastPayload: () => lastPayload,
            serverVersion:  SERVER_VERSION,
        });
        bridge.start();
    }
}

watcher.on('add',    f => console.log('[Watch] Watching:', f));
watcher.on('change', f => {
    try {
        const raw  = fs.readFileSync(f, 'utf8');
        const data = JSON.parse(raw);
        db.saveSnapshot(data);
        broadcast(raw);
        // Enriched copy is what we ship upstream (so cloud viewers see the
        // same farmBalanceDeltaDay / saveMeta / save-derived field props as
        // local viewers).
        lastPayload = enrich(data);
        if (bridge) {
            bridge.modVersion = data.modVersion || bridge.modVersion;
            bridge.pushPayload(lastPayload);
        }
        process.stdout.write('.');
    } catch (e) {
        console.warn('\n[Watch] Parse error:', e.message);
    }
});
watcher.on('error', e => console.error('[Watch] Error:', e));

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, HOST, () => {
    console.log('\n╔══════════════════════════════════════╗');
    console.log(`║   FS25 Dashboard Server  v${SERVER_VERSION.padEnd(10)} ║`);
    console.log(`║   Expects mod schema ${String(MIN_MOD_SCHEMA).padEnd(2)}..${String(MAX_MOD_SCHEMA).padEnd(11)} ║`);
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  Dashboard:  http://localhost:${PORT}    ║`);
    console.log(`║  Bound:      ${HOST.padEnd(24)} ║`);
    console.log(`║  Data file:                          ║`);
    console.log(`║  ${DATA_FILE.slice(0, 36).padEnd(36)} ║`);
    console.log('╚══════════════════════════════════════╝\n');
    console.log('Waiting for FS25 data (dots = update received)...');
});
