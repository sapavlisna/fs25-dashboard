// cloud-server.js — public relay deployed to Render / Fly / similar.
//
// Architecture
// ────────────
//   Local server  ──wss──►  THIS  ──wss──►  Browsers
//   (bridge-client)        (relay)         (viewers)
//
// This process never reads dashboard_data.json. It just relays state pushed
// up by exactly one bridge (the player's local server) and broadcasts down
// to N viewers. History, dashboard-state, snapshot, AND the auth config —
// all in memory. When the process restarts, the bridge re-bootstraps on
// next connect (~30 s).
//
// Auth model
// ──────────
// The cloud relay is **open by default**. There is no `DASHBOARD_PASSWORD`
// env var. The player decides — from their local dashboard UI — whether to
// require a password. The local server hashes the password (SHA-256 with a
// per-rotation salt), keeps the hash on disk in dashboard-state.json, and
// pushes { passwordHash, salt, version } up to the cloud. Plaintext never
// leaves the local box (except for the few microseconds inside POST
// /api/login on the cloud while we hash the candidate to compare).
//
// On every auth-config change the `version` bumps, which invalidates every
// previously-issued session cookie (the HMAC includes version) and forces
// connected viewers to re-authenticate.
//
// Endpoints
//   GET  /                        — login gate or dashboard
//   GET  /login                   — login page
//   POST /api/login               — { password } → session cookie (200 even
//                                   if no password is required)
//   POST /api/logout
//   GET  /api/version             — { cloudMode: true, hasPassword, bridge }
//   GET  /api/current             — last snapshot (auth)
//   GET  /api/history/*           — bootstrapped from bridge (auth)
//   GET  /api/savegame            — derived from snapshot.saveMeta (auth)
//   GET  /api/dashboard-state     — server-held UI prefs (auth)
//   PUT/PATCH /api/dashboard-state
//   WS   /                        — viewer feed (auth via cookie at handshake)
//   WS   /ingest                  — bridge upload (auth via hello token)

const express  = require('express');
const http     = require('http');
const crypto   = require('crypto');
const path     = require('path');
const { WebSocketServer } = require('ws');

const pkg = require('./package.json');

// ─── Config (env-only; no config.local.json in cloud) ────────────────────────

const PORT           = parseInt(process.env.PORT || '3000', 10);
const HOST           = process.env.HOST || '0.0.0.0';
const INGEST_TOKEN   = process.env.INGEST_TOKEN || '';
const SESSION_SECRET = process.env.SESSION_SECRET ||
                       crypto.randomBytes(32).toString('hex'); // ephemeral if unset
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;               // 14 days
const BRIDGE_OFFLINE_AFTER_MS = 15000;                          // 15 s silence
const LOGIN_RATE_LIMIT = { windowMs: 60000, max: 5 };           // 5 attempts/min/IP
const PUBLIC_DIR     = path.join(__dirname, 'public');

if (!INGEST_TOKEN) {
    console.error('FATAL: INGEST_TOKEN env var is required.');
    process.exit(1);
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
    dashboardState: {},

    bridge: {
        connected:      false,
        lastMessageAt:  null,
        lastSeenAt:     null,
        modVersion:     null,
        bootstrapAt:    null,
    },

    // Auth config is pushed by the bridge. When passwordHash is null the
    // relay runs in open mode (anyone with the URL can view). The `version`
    // counter is included in every session cookie's HMAC — bumping it on a
    // password change invalidates all existing cookies immediately.
    authConfig: {
        passwordHash: null,   // hex SHA-256 of (salt + plaintext)
        salt:         null,   // hex random bytes
        version:      0,
    },
};

// ─── Bridge online/offline plumbing ──────────────────────────────────────────

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
setInterval(() => {
    if (state.bridge.connected &&
        Date.now() - state.bridge.lastMessageAt > BRIDGE_OFFLINE_AFTER_MS) {
        markBridgeOffline();
    }
}, 5000);

// ─── Session + auth helpers ──────────────────────────────────────────────────
//
// Cookie format: "<timestamp>.<authVersion>.<hex-hmac>"
// HMAC input:    "<timestamp>.<authVersion>"
// Bumping authConfig.version invalidates every previously-issued cookie.

function createSession(authVersion) {
    const ts  = Date.now();
    const sig = crypto.createHmac('sha256', SESSION_SECRET)
                      .update(`${ts}.${authVersion}`).digest('hex');
    return `${ts}.${authVersion}.${sig}`;
}
function verifySession(value, requiredVersion) {
    if (!value || typeof value !== 'string') return false;
    const parts = value.split('.');
    if (parts.length !== 3) return false;
    const [ts, ver, sig] = parts;
    const tsNum  = parseInt(ts, 10);
    const verNum = parseInt(ver, 10);
    if (!Number.isFinite(tsNum) || !Number.isFinite(verNum)) return false;
    if (verNum !== requiredVersion) return false;             // version mismatch
    if (Date.now() - tsNum > SESSION_TTL_MS) return false;
    const expected = crypto.createHmac('sha256', SESSION_SECRET)
                           .update(`${ts}.${ver}`).digest('hex');
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
    if (!state.authConfig.passwordHash) return true;          // open mode
    const cookies = parseCookies(req.headers.cookie);
    return verifySession(cookies.dashboard_sess, state.authConfig.version);
}
function requireAuth(req, res, next) {
    if (isAuthed(req)) return next();
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'auth required' });
    }
    return res.redirect('/login');
}

// Hash + constant-time compare. Both inputs already hex.
function hashCandidate(plaintext, saltHex) {
    return crypto.createHmac('sha256', Buffer.from(saltHex, 'hex'))
                 .update(plaintext, 'utf8').digest('hex');
}
function constantTimeEqualHex(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// ─── Login rate-limit (in-memory token bucket per IP) ────────────────────────
const loginAttempts = new Map();   // ip → [{ ts }]
function loginRateLimited(ip) {
    const now = Date.now();
    const arr = (loginAttempts.get(ip) || []).filter(t => now - t < LOGIN_RATE_LIMIT.windowMs);
    if (arr.length >= LOGIN_RATE_LIMIT.max) {
        loginAttempts.set(ip, arr);
        return true;
    }
    arr.push(now);
    loginAttempts.set(ip, arr);
    return false;
}

// ─── Express ─────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.set('trust proxy', 1);            // Render is behind a reverse proxy
app.use(express.json({ limit: '256kb' }));

// Public pages (no auth)
app.get('/login', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/api/login', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (loginRateLimited(ip)) {
        return res.status(429).json({ ok: false, error: 'too many attempts' });
    }

    // Open mode — anyone may obtain a session.
    if (!state.authConfig.passwordHash) {
        const sess = createSession(state.authConfig.version);
        setSessionCookie(res, sess);
        return res.json({ ok: true, openMode: true });
    }

    const password = (req.body && typeof req.body.password === 'string') ? req.body.password : '';
    if (!password) return res.status(401).json({ ok: false, error: 'invalid password' });

    const candidate = hashCandidate(password, state.authConfig.salt);
    if (!constantTimeEqualHex(candidate, state.authConfig.passwordHash)) {
        return res.status(401).json({ ok: false, error: 'invalid password' });
    }
    const sess = createSession(state.authConfig.version);
    setSessionCookie(res, sess);
    res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', 'dashboard_sess=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    res.json({ ok: true });
});

function setSessionCookie(res, sess) {
    // Secure flag only when running behind https (Render gives us https; local
    // smoke test uses http — so we infer from PORT/headers rather than hardcode).
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie',
        `dashboard_sess=${encodeURIComponent(sess)}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure}`);
}

// /api/version is intentionally unauth — the login page needs to know
// whether a password is required.
app.get('/api/version', (_req, res) => {
    res.json({
        cloudMode:   true,
        server:      pkg.version,
        schema:      { min: 1, max: 1 },
        mod:         { modVersion: state.bridge.modVersion },
        hasPassword: !!state.authConfig.passwordHash,
        authVersion: state.authConfig.version,
        bridge: {
            connected:   state.bridge.connected,
            lastSeenAt:  state.bridge.lastSeenAt,
            bootstrapAt: state.bridge.bootstrapAt,
        },
    });
});

// Everything below requires auth
app.use(requireAuth);

app.get('/api/current', (_req, res) => {
    if (!state.snapshot) return res.status(503).json({ error: 'no data yet' });
    res.json(state.snapshot);
});

app.get('/api/history/balance', (req, res) => {
    res.json(filterByDays(state.history.balance, parseInt(req.query.days || '30', 10)));
});
app.get('/api/history/prices', (req, res) => {
    const { fillType, sellPoint } = req.query;
    let rows = filterByDays(state.history.prices, parseInt(req.query.days || '30', 10));
    if (fillType)  rows = rows.filter(r => r.fill_type  === fillType);
    if (sellPoint) rows = rows.filter(r => r.sell_point === sellPoint);
    res.json(rows);
});
app.get('/api/history/fill-types',  (_req, res) => res.json(state.history.fillTypes));
app.get('/api/history/sell-points', (_req, res) => res.json(state.history.sellPoints));
app.get('/api/profit/fields',       (_req, res) => res.json(state.history.profit));
app.get('/api/events', (req, res) => {
    res.json(state.history.events.slice(0, parseInt(req.query.limit || '50', 10)));
});

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

app.use(express.static(PUBLIC_DIR));

app.get('/', (req, res) => {
    if (!isAuthed(req)) return res.redirect('/login');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ─── WebSocket server ────────────────────────────────────────────────────────

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
    // Viewer path — enforce auth at upgrade. Open mode lets anyone in.
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
    if (ws._role === 'ingest') handleIngest(ws, req);
    else                       handleViewer(ws, req);
});

// ─── Ingest (bridge) ─────────────────────────────────────────────────────────

let activeIngest = null;

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

        switch (msg.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong' }));
                break;

            case 'bootstrap':
                state.snapshot       = msg.snapshot || null;
                state.history        = Object.assign(state.history, msg.history || {});
                state.dashboardState = msg.dashboardState || {};
                state.bridge.bootstrapAt = Date.now();
                if (msg.authConfig) applyAuthConfig(msg.authConfig, 'bootstrap');
                console.log('[Ingest] Bootstrap received');
                if (state.snapshot) broadcastToViewers(state.snapshot);
                broadcastToViewers({ __dashboardStatePatch: state.dashboardState, fullReplace: true });
                break;

            case 'snapshot':
                state.snapshot = msg.data || null;
                if (state.snapshot) broadcastToViewers(state.snapshot);
                break;

            case 'delta':
                if (state.snapshot && msg.changed) {
                    for (const [k, v] of Object.entries(msg.changed)) {
                        if (v === null) delete state.snapshot[k];
                        else            state.snapshot[k] = v;
                    }
                    broadcastToViewers(state.snapshot);
                }
                break;

            case 'history-append':
                if (msg.full) {
                    if (msg.balance)    state.history.balance    = msg.balance;
                    if (msg.prices)     state.history.prices     = msg.prices;
                    if (msg.events)     state.history.events     = msg.events;
                    if (msg.profit)     state.history.profit     = msg.profit;
                    if (msg.fillTypes)  state.history.fillTypes  = msg.fillTypes;
                    if (msg.sellPoints) state.history.sellPoints = msg.sellPoints;
                }
                break;

            case 'auth-config':
                applyAuthConfig(msg, 'update');
                break;
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

function applyAuthConfig(cfg, reason) {
    const next = {
        passwordHash: cfg.passwordHash || null,
        salt:         cfg.salt         || null,
        version:      Number.isFinite(cfg.version) ? cfg.version : state.authConfig.version + 1,
    };
    const prev = state.authConfig;
    const changed = prev.passwordHash !== next.passwordHash ||
                    prev.salt         !== next.salt         ||
                    prev.version      !== next.version;
    if (!changed) return;

    state.authConfig = next;
    console.log(`[Auth] config ${reason}: ${next.passwordHash ? 'password REQUIRED' : 'OPEN ACCESS'} (version=${next.version})`);

    // Kick every viewer — their cookies are now invalid. They reconnect, hit
    // requireAuth, and either pass (open mode) or get redirected to /login.
    for (const c of wss.clients) {
        if (c._role === 'viewer' && c.readyState === 1) {
            try { c.close(4002, 'auth-rotated'); } catch (_) {}
        }
    }
}

// ─── Viewer ──────────────────────────────────────────────────────────────────

function handleViewer(ws, _req) {
    console.log(`[Viewer] +1 (total: ${countViewers()})`);
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
    console.log(`║   Auth: OPEN until bridge says otherwise ║`);
    console.log('╠══════════════════════════════════════╣');
    console.log(`║   Listening on ${HOST}:${PORT}`.padEnd(40) + '║');
    console.log('╚══════════════════════════════════════╝\n');
    console.log('Waiting for bridge to connect on /ingest...');
});
