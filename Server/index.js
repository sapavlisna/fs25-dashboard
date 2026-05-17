const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');
const path  = require('path');
const fs    = require('fs');
const db       = require('./db');
const savegame = require('./savegame');
const config   = require('./config');

const { PORT, HOST, DATA_FILE, PUBLIC_DIR } = config;

// ─── Express ─────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(express.static(PUBLIC_DIR));

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
    const enriched = data ? enrich(data) : null;
    const msg = enriched ? JSON.stringify(enriched) : rawString;
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

watcher.on('add',    f => console.log('[Watch] Watching:', f));
watcher.on('change', f => {
    try {
        const raw  = fs.readFileSync(f, 'utf8');
        const data = JSON.parse(raw);
        db.saveSnapshot(data);
        broadcast(raw);
        process.stdout.write('.');
    } catch (e) {
        console.warn('\n[Watch] Parse error:', e.message);
    }
});
watcher.on('error', e => console.error('[Watch] Error:', e));

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, HOST, () => {
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║       FS25 Dashboard Server          ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  Dashboard:  http://localhost:${PORT}    ║`);
    console.log(`║  Bound:      ${HOST.padEnd(24)} ║`);
    console.log(`║  Data file:                          ║`);
    console.log(`║  ${DATA_FILE.slice(0, 36).padEnd(36)} ║`);
    console.log('╚══════════════════════════════════════╝\n');
    console.log('Waiting for FS25 data (dots = update received)...');
});
