// cloud-server.js — public relay deployed to Render / Fly / similar.
//
// Architecture
// ────────────
//   Local server  ──wss──►  THIS  ──wss──►  Browsers
//   (bridge-client)        (relay)         (viewers)
//
// THIS process never reads dashboard_data.json. It just relays state pushed
// up by exactly one bridge (the player's local server) and broadcasts down
// to N viewers. History, dashboard-state, snapshot — all in memory. When the
// process restarts, the bridge re-bootstraps on next connect (~30 s).
//
// Endpoints
//   GET  /                       — login gate or dashboard
//   GET  /login                  — login page (HTML)
//   POST /api/login              — { password } → sets session cookie
//   POST /api/logout
//   GET  /api/version            — { cloudMode: true, bridge: { connected, … } }
//   GET  /api/current            — last snapshot (auth)
//   GET  /api/history/*          — bootstrapped from bridge (auth)
//   GET  /api/savegame           — derived from snapshot.saveMeta (auth)
//   GET  /api/dashboard-state    — server-held UI prefs (auth)
//   PUT/PATCH /api/dashboard-state
//   WS   /                       — viewer feed (auth via cookie)
//   WS   /ingest                 — bridge upload (auth via hello token)

const express  = require('express');
const http     = require('http');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const { WebSocketServer } = require('ws');

const pkg = require('./package.json');

// ─── Config (env-only; no config.local.json in cloud) ────────────────────────

const PORT               = parseInt(process.env.PORT || '3000', 10);
const HOST               = process.env.HOST || '0.0.0.0';
const INGEST_TOKEN       = process.env.INGEST_TOKEN || '';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';   // empty = open
const SESSION_SECRET     = process.env.SESSION_SECRET ||
                           crypto.randomBytes(32).toString('hex'); // ephemeral if unset
const SESSION_TTL_MS     = 1000 * 60 * 60 * 24 * 14;               // 14 days
const BRIDGE_OFFLINE_AFTER_MS = 15000;                              // 15 s silence
const PUBLIC_DIR         = path.join(__dirname, 'public');

if (!INGEST_TOKEN) {
    console.error('FATAL: INGEST_TOKEN env var is required.');
    process.exit(1);
}
if (!DASHBOARD_PASSWORD) {
    console.warn('[Auth] DASHBOARD_PASSWORD is empty — dashboard is publicly accessible.');
}

// ─── In-memory state (the entire "DB" of the cloud relay) ────────────────────

const state = {
    snapshot:       null,       // last full payload from bridge
    history: {
        balance:    [],
        prices:     [],
        events:     [],
        profit:     [],
        fillTypes:  [],
        sellPoints: [],
    },
    dashboardState: {},         // bootstrapped from bridge, then mirrored by viewers

    bridge: {
        connected:      false,
        lastMessageAt:  null,
        lastSeenAt:     null,   // updated on connect *and* on disconnect timestamp
        modVersion:     null,
        bootstrapAt:    null,
    },
};

function markBridgeOnline() {
    const wasOffline = !state.bridge.connected;
    state.bridge.connected     = true;
    state.bridge.lastMessageAt = Date.now();
    state.bridge.lastSeenAt    = Date.now();
    if (wasOffline) broadcastBridgeStatus();
}
function markBridgeOffline() {
    if (!state.bridge.connected) return;
    state.bridge.connected  = false;
    state.bridge.lastSeenAt = Date.now();
    broadcastBridgeStatus();
}

// Watchdog: if no message from bridge for 15 s, mark offline.
setInterval(() => {
    if (state.bridge.connected &&
        Date.now() - state.bridge.lastMessageAt > BRIDGE_OFFLINE_AFTER_MS) {
        markBridgeOffline();
    }
}, 5000);

// ─── Session helpers (HMAC-signed, no external store) ────────────────────────

function createSession() {
    const ts = Date.now();
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(String(ts)).digest('hex');
    return `${ts}.${sig}`;
}
function verifySession(value) {
    if (!value || typeof value !== 'string') return false;
    const dot = value.indexOf('.');
    if (dot < 0) return false;
    const ts  = value.slice(0, dot);
    const sig = value.slice(dot + 1);
    const tsNum = parseInt(ts, 10);
    if (!Number.isFinite(tsNum)) return false;
    if (Date.now() - tsNum > SESSION_TTL_MS) return false;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(ts).digest('hex');
    // timing-safe compare
    if (sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
function parseCookies(header) {
    const out = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (!k) continue;
        try { out[k] = decodeURIComponent(v); } catch (_) { out[k] = v; }
    }
    return out;
}
function isAuthed(req) {
    if (!DASHBOARD_PASSWORD) return true;                  // open mode
    const cookies = parseCookies(req.headers.cookie);
    return verifySession(cookies.dashboard_sess);
}
function requireAuth(req, res, next) {
    if (isAuthed(req)) return next();
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'auth required' });
    }
    return res.redirect('/login');
}

// ─── Express ─────────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '256kb' }));

// Public pages (no auth)
app.get('/login', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/api/login', (req, res) => {
    const password = (req.body && req.body.password) || '';
    if (DASHBOARD_PASSWORD && password !== DASHBOARD_PASSWORD) {
        return res.status(401).json({ ok: false, error: 'invalid password' });
    }
    const sess = createSession();
    res.setHeader('Set-Cookie',
        `dashboard_sess=${encodeURIComponent(sess)}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; SameSite=Lax`);
    res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `dashboard_sess=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    res.json({ ok: true });
});

// Everything below requires auth
app.use(requireAuth);

app.get('/api/version', (_req, res) => {
    res.json({
        cloudMode:  true,
        server:     pkg.version,
        schema:     { min: 1, max: 1 },
        mod:        { modVersion: state.bridge.modVersion },
        bridge: {
            connected:  state.bridge.connected,
            lastSeenAt: state.bridge.lastSeenAt,
            bootstrapAt: state.bridge.bootstrapAt,
        },
    });
});

app.get('/api/current', (_req, res) => {
    if (!state.snapshot) return res.status(503).json({ error: 'no data yet' });
    res.json(state.snapshot);
});

app.get('/api/history/balance', (req, res) => {
    const days = parseInt(req.query.days || '30', 10);
    res.json(filterByDays(state.history.balance, days));
});

app.get('/api/history/prices', (req, res) => {
    const { fillType, sellPoint } = req.query;
    const days = parseInt(req.query.days || '30', 10);
    let rows = filterByDays(state.history.prices, days);
    if (fillType)  rows = rows.filter(r => r.fill_type  === fillType);
    if (sellPoint) rows = rows.filter(r => r.sell_point === sellPoint);
    res.json(rows);
});

app.get('/api/history/fill-types',  (_req, res) => res.json(state.history.fillTypes));
app.get('/api/history/sell-points', (_req, res) => res.json(state.history.sellPoints));
app.get('/api/profit/fields',       (_req, res) => res.json(state.history.profit));
app.get('/api/events', (req, res) => {
    const limit = parseInt(req.query.limit || '50', 10);
    res.json(state.history.events.slice(0, limit));
});

// Cloud relay doesn't parse XML; surface what the snapshot already carries.
app.get('/api/savegame', (_req, res) => {
    const meta = state.snapshot && state.snapshot.saveMeta;
    res.json({
        saveDir:   null,
        meta:      meta || null,
        farms:     [],
        farmlands: null,
        fields:    [],
        readAt:    state.bridge.lastMessageAt
                   ? new Date(state.bridge.lastMessageAt).toISOString()
                   : null,
    });
});

// Dashboard state — viewers mutate, server broadcasts to other viewers.
// Bridge bootstraps this on first connect but does not push updates after.
app.get('/api/dashboard-state', (_req, res) => res.json(state.dashboardState));
app.put('/api/dashboard-state', (req, res) => {
    state.dashboardState = req.body || {};
    broadcastToViewers({ __dashboardStatePatch: state.dashboardState, fullReplace: true });
    res.json(state.dashboardState);
});
app.patch('/api/dashboard-state', (req, res) => {
    const patch = req.body || {};
    const changed = {};
    for (const [k, v] of Object.entries(patch)) {
        if (v === null) { delete state.dashboardState[k]; changed[k] = null; }
        else if (JSON.stringify(state.dashboardState[k]) !== JSON.stringify(v)) {
            state.dashboardState[k] = v;
            changed[k] = v;
        }
    }
    if (Object.keys(changed).length) {
        broadcastToViewers({ __dashboardStatePatch: changed });
    }
    res.json({ changed });
});

// Static dashboard (after auth)
app.use(express.static(PUBLIC_DIR));

// Root: redirect to dashboard or login
app.get('/', (req, res) => {
    if (!isAuthed(req)) return res.redirect('/login');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ─── WebSocket server ────────────────────────────────────────────────────────
//
// One WSS, two URL paths:
//   /ingest  → bridge uploads. Auth via "hello" envelope (token in payload).
//   /        → viewers. Auth via session cookie at handshake time.

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    const url = req.url || '/';

    if (url.startsWith('/ingest')) {
        wss.handleUpgrade(req, socket, head, ws => {
            ws._role = 'ingest';
            wss.emit('connection', ws, req);
        });
        return;
    }

    // Viewer path — enforce auth at upgrade time so we never accept anonymous WS.
    if (!isAuthed(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
        ws._role = 'viewer';
        wss.emit('connection', ws, req);
    });
});

wss.on('connection', (ws, req) => {
    if (ws._role === 'ingest') {
        handleIngest(ws, req);
    } else {
        handleViewer(ws, req);
    }
});

// ─── Bridge (ingest) handling ────────────────────────────────────────────────

let activeIngest = null;   // only one bridge expected; the latest wins

function handleIngest(ws, req) {
    const ip = req.socket.remoteAddress;
    let helloOk = false;
    console.log(`[Ingest] +1 connection from ${ip}`);

    ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

        if (!helloOk) {
            if (msg.type === 'hello' && msg.token === INGEST_TOKEN) {
                helloOk = true;
                if (activeIngest && activeIngest !== ws) {
                    try { activeIngest.close(4000, 'replaced'); } catch (_) {}
                }
                activeIngest = ws;
                state.bridge.modVersion = msg.modVersion || null;
                ws.send(JSON.stringify({ type: 'welcome' }));
                markBridgeOnline();
                console.log(`[Ingest] Authenticated (modVersion=${msg.modVersion || '?'})`);
            } else {
                ws.send(JSON.stringify({ type: 'error', code: 'auth', message: 'bad token' }));
                ws.close(4001, 'auth');
            }
            return;
        }

        state.bridge.lastMessageAt = Date.now();
        if (!state.bridge.connected) markBridgeOnline();

        if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
        } else if (msg.type === 'bootstrap') {
            state.snapshot       = msg.snapshot || null;
            state.history        = Object.assign(state.history, msg.history || {});
            state.dashboardState = msg.dashboardState || {};
            state.bridge.bootstrapAt = Date.now();
            console.log('[Ingest] Bootstrap received');
            // Push fresh snapshot + history-applied state to every viewer
            if (state.snapshot) broadcastToViewers(state.snapshot);
            broadcastToViewers({ __dashboardStatePatch: state.dashboardState, fullReplace: true });
        } else if (msg.type === 'snapshot') {
            state.snapshot = msg.data || null;
            if (state.snapshot) broadcastToViewers(state.snapshot);
        } else if (msg.type === 'delta') {
            if (state.snapshot && msg.changed) {
                for (const [k, v] of Object.entries(msg.changed)) {
                    if (v === null) delete state.snapshot[k];
                    else state.snapshot[k] = v;
                }
                broadcastToViewers(state.snapshot);
            }
        } else if (msg.type === 'history-append') {
            if (msg.full) {
                if (msg.balance)    state.history.balance    = msg.balance;
                if (msg.prices)     state.history.prices     = msg.prices;
                if (msg.events)     state.history.events     = msg.events;
                if (msg.profit)     state.history.profit     = msg.profit;
                if (msg.fillTypes)  state.history.fillTypes  = msg.fillTypes;
                if (msg.sellPoints) state.history.sellPoints = msg.sellPoints;
            }
        }
    });

    ws.on('close', () => {
        if (activeIngest === ws) {
            activeIngest = null;
            markBridgeOffline();
            console.log('[Ingest] -1 connection');
        }
    });
    ws.on('error', err => console.warn('[Ingest] WS error:', err.message));
}

// ─── Viewer handling ─────────────────────────────────────────────────────────

function handleViewer(ws, _req) {
    console.log(`[Viewer] +1 (total: ${countViewers()})`);
    // Immediate state to first paint: snapshot + bridge status + dashboard-state
    if (state.snapshot) ws.send(JSON.stringify(state.snapshot));
    ws.send(JSON.stringify({
        type: 'bridge-status',
        connected:  state.bridge.connected,
        lastSeenAt: state.bridge.lastSeenAt,
    }));
    if (Object.keys(state.dashboardState).length) {
        ws.send(JSON.stringify({
            __dashboardStatePatch: state.dashboardState,
            fullReplace: true,
        }));
    }

    ws.on('close', () => console.log(`[Viewer] -1 (total: ${countViewers()})`));
    ws.on('error', err => console.warn('[Viewer] WS error:', err.message));
}

function countViewers() {
    let n = 0;
    for (const c of wss.clients) if (c._role === 'viewer') n++;
    return n;
}

function broadcastToViewers(obj) {
    const msg = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const c of wss.clients) {
        if (c._role === 'viewer' && c.readyState === 1) {
            try { c.send(msg); } catch (_) {}
        }
    }
}

function broadcastBridgeStatus() {
    broadcastToViewers({
        type: 'bridge-status',
        connected:  state.bridge.connected,
        lastSeenAt: state.bridge.lastSeenAt,
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filterByDays(rows, days) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const maxDay = rows.reduce((m, r) => Math.max(m, r.game_day || 0), 0);
    const minDay = maxDay - days;
    return rows.filter(r => (r.game_day || 0) >= minDay);
}

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, HOST, () => {
    console.log('\n╔══════════════════════════════════════╗');
    console.log(`║   FS25 Dashboard Cloud Relay v${pkg.version.padEnd(6)} ║`);
    console.log(`║   Mode: ${(DASHBOARD_PASSWORD ? 'password-gated' : 'OPEN ACCESS  ').padEnd(28)} ║`);
    console.log('╠══════════════════════════════════════╣');
    console.log(`║   Listening on ${HOST}:${PORT}`.padEnd(40) + '║');
    console.log('╚══════════════════════════════════════╝\n');
    console.log('Waiting for bridge to connect on /ingest...');
});
