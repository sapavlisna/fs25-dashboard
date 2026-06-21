// index.js — FS25 Dashboard relay.
//
// A standalone, read-only fan-out server. A local dashboard server connects
// OUTBOUND as a "publisher" (authenticated by a per-publisher key) and gets a
// room with a shareable viewer URL. Browsers connect as "viewers" (no password,
// just an unguessable room token in the URL) and receive the live frame stream.
//
//   publisher  ──wss /ws/publish (Authorization: Bearer <key>)──►  RELAY
//                                                                     │ fan-out
//   viewers    ◄──wss /ws/view/:token (read-only, never the reverse)──┘
//
// There are NO mutating endpoints here on purpose — the relay forwards bytes and
// nothing else. Security/limits live in the CONFIG block below (all env-tunable).

const express   = require('express');
const http      = require('http');
const crypto    = require('crypto');
const fs        = require('fs');
const path      = require('path');
const { WebSocketServer } = require('ws');
const log       = require('./logger');

// ─── Config (env > default) ───────────────────────────────────────────────────

const num = (name, def) => {
    const v = parseInt(process.env[name], 10);
    return Number.isFinite(v) ? v : def;
};

const CFG = {
    PORT:                  num('RELAY_PORT', 8080),
    PUBLISHERS_FILE:       process.env.PUBLISHERS_FILE || path.join(__dirname, 'publishers.json'),
    // Docker image copies the frontend to ./public; in dev it lives at
    // ../Server/public (sibling of the Relay/ folder).
    PUBLIC_DIR:            process.env.PUBLIC_DIR ||
                           (fs.existsSync(path.join(__dirname, 'public'))
                                ? path.join(__dirname, 'public')
                                : path.join(__dirname, '..', 'Server', 'public')),
    // Origin allowlist for viewer browsers (comma-separated). Same-origin (Origin
    // host === Host header) is always allowed, so this is only for edge setups.
    ALLOWED_ORIGINS:       (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    // Caps
    MAX_ROOMS:             num('MAX_ROOMS', 50),
    MAX_VIEWERS_PER_ROOM:  num('MAX_VIEWERS_PER_ROOM', 30),
    MAX_CONNS_PER_IP:      num('MAX_CONNS_PER_IP', 5),
    MAX_ROOMS_PER_PUBLISHER: num('MAX_ROOMS_PER_PUBLISHER', 3),
    IDLE_ROOM_MIN:         num('IDLE_ROOM_MIN', 10),
    // Grace after the publisher drops: keep the room (viewers see the "source
    // offline" overlay) and let a crashed/restarted publisher reclaim the same
    // stable-token room. 5 min by default; a graceful {__bye} ends it immediately.
    GRACE_SEC:             num('GRACE_SEC', 300),
    // Limits
    MAX_FRAME_BYTES:       num('MAX_FRAME_BYTES', 262144),     // 256 KB
    MAX_BUFFER_BYTES:      num('MAX_BUFFER_BYTES', 1048576),   // 1 MB backpressure drop threshold
    // Viewer enumeration throttle
    MAX_VIEW_FAILS:        num('MAX_VIEW_FAILS', 5),
    VIEW_FAIL_WINDOW_MS:   num('VIEW_FAIL_WINDOW_MS', 60000),
    VIEW_BLOCK_MS:         num('VIEW_BLOCK_MS', 60000),
    // How long to wait for a first-message {key} when no Authorization header.
    PUBLISH_AUTH_TIMEOUT_MS: num('PUBLISH_AUTH_TIMEOUT_MS', 2000),
    // Stable per-publisher room token → the shareable viewer URL stays the same
    // across publisher restarts/reconnects (derived from the key, nothing stored).
    // Set RELAY_STABLE_ROOMS=false to revert to a fresh random token per connect.
    STABLE_ROOMS: String(process.env.RELAY_STABLE_ROOMS || 'true').toLowerCase() !== 'false',
};

// WebSocket close codes (4xxx = application-defined).
const CLOSE = {
    AUTH_FAIL:      4401,  // bad / missing publisher key
    ROOM_NOT_FOUND: 4404,  // unknown or expired room token
    PUBLISHER_GONE: 4410,  // publisher disconnected, room ended
    POLICY:         1008,  // cap exceeded / rate-limited
    TOO_BIG:        1009,  // message over MAX_FRAME_BYTES
    ORIGIN:         1002,  // origin not allowed (CSWSH guard)
};

const TOKEN_RE = /^[a-f0-9]{32}$/;
// Allow any printable label (incl. diacritics, e.g. "Pavlův traktor") up to 40
// chars, but reject control chars and angle brackets (defence-in-depth — the
// label is only echoed back to the publisher's own trusted server, never to
// viewers, but we keep it HTML-safe regardless).
const LABEL_RE = /^[^\x00-\x1f<>]{0,40}$/;

// ─── Publisher allowlist ───────────────────────────────────────────────────────
//
// publishers.json: [{ id, label, key, enabled }]. Re-read on every publish
// connect so enable/disable takes effect on the next (re)connect without a
// restart. Missing file → empty allowlist (everyone rejected) but keep running.
// Malformed JSON at startup → fail-fast; malformed on reload → keep last good.

let lastGoodPublishers = [];

function loadPublishers({ strict } = {}) {
    let raw;
    try {
        raw = fs.readFileSync(CFG.PUBLISHERS_FILE, 'utf8');
    } catch (e) {
        if (strict) {
            log.warn('auth', `${CFG.PUBLISHERS_FILE} chybí — allowlist prázdný (vše odmítáno). Zkopíruj publishers.example.json.`);
        }
        lastGoodPublishers = [];
        return lastGoodPublishers;
    }
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) throw new Error('kořen není pole');
        lastGoodPublishers = arr.filter(p => p && typeof p.key === 'string' && p.key.length > 0);
        return lastGoodPublishers;
    } catch (e) {
        if (strict) {
            log.error('auth', `${CFG.PUBLISHERS_FILE} je nevalidní JSON: ${e.message} — končím (fail-fast).`);
            process.exit(1);
        }
        log.error('auth', `${CFG.PUBLISHERS_FILE} nevalidní při reloadu (${e.message}) — používám poslední platný allowlist.`);
        return lastGoodPublishers;
    }
}

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest();

// Deterministic, unguessable room token for a publisher (see CFG.STABLE_ROOMS).
// SHA-256 is preimage-resistant, so the public token never leaks the publish key.
function stableToken(pub) {
    return crypto.createHash('sha256').update('fs25-relay-room:' + pub.key, 'utf8').digest('hex').slice(0, 32);
}

// Constant-length, timing-safe match. Returns the matched publisher or null.
function matchPublisher(providedKey) {
    if (!providedKey) return null;
    const provided = sha(providedKey);
    let matched = null;
    for (const p of loadPublishers()) {
        if (!p.enabled) continue;
        const candidate = sha(p.key);
        // timingSafeEqual needs equal-length buffers; sha256 is always 32 bytes.
        if (crypto.timingSafeEqual(provided, candidate)) matched = p;
    }
    return matched;
}

// ─── Rooms + per-IP state ──────────────────────────────────────────────────────

/** token -> { token, publisherId, label, publisherWs, viewers:Set<ws>, lastFrame, lastTs, disconnectedAt } */
const rooms = new Map();
const connsPerIp = new Map();        // ip -> active connection count
const viewFails  = new Map();        // ip -> { count, first, until }

function ipOf(req) {
    const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = xff || req.socket.remoteAddress || '?';
    return ip.replace(/^::ffff:/, '');
}

function totalViewers() {
    let n = 0;
    for (const r of rooms.values()) n += r.viewers.size;
    return n;
}

function roomsForPublisher(id) {
    let n = 0;
    for (const r of rooms.values()) if (r.publisherId === id) n++;
    return n;
}

function incIp(ip) {
    const n = (connsPerIp.get(ip) || 0) + 1;
    connsPerIp.set(ip, n);
    return n;
}
function decIp(ip) {
    const n = (connsPerIp.get(ip) || 1) - 1;
    if (n <= 0) connsPerIp.delete(ip); else connsPerIp.set(ip, n);
}

function noteViewFail(ip) {
    const now = Date.now();
    let e = viewFails.get(ip);
    if (!e || now - e.first > CFG.VIEW_FAIL_WINDOW_MS) e = { count: 0, first: now, until: 0 };
    e.count++;
    if (e.count >= CFG.MAX_VIEW_FAILS) {
        e.until = now + CFG.VIEW_BLOCK_MS;
        log.warn('throttle', `IP ${ip} blokována ${CFG.VIEW_BLOCK_MS / 1000}s po ${e.count} neplatných tokenech`);
    }
    viewFails.set(ip, e);
}
function isViewBlocked(ip) {
    const e = viewFails.get(ip);
    return !!(e && e.until && Date.now() < e.until);
}

function closeRoom(room, code, reason) {
    for (const v of room.viewers) {
        try { v.close(code, reason); } catch (_) {}
    }
    room.viewers.clear();
    rooms.delete(room.token);
    log.drop('room', `room ${room.token.slice(0, 8)}… (pub=${room.label}) zrušen — ${reason}`);
}

// Tell every viewer in a room whether the source (publisher) is currently live.
// Pure control envelope — sent directly to viewers, never cached, so it doesn't
// disturb lastFrame/lastStatePatch. Drives the viewer's "source offline" overlay.
function notifyViewers(room, online) {
    const msg = JSON.stringify({ __sourceStatus: { online } });
    for (const v of room.viewers) {
        if (v.readyState !== 1) continue;
        try { v.send(msg, { binary: false }); } catch (_) {}
    }
}

// ─── Origin check (anti-CSWSH) ─────────────────────────────────────────────────

function originAllowed(req) {
    const origin = req.headers.origin;
    // Non-browser clients (the Node publisher) send no Origin — allow.
    if (!origin) return true;
    let host;
    try { host = new URL(origin).host; } catch (_) { return false; }
    if (host === req.headers.host) return true;                 // same-origin (viewer page is served by us)
    if (/^localhost(:\d+)?$/.test(host) || /^127\.0\.0\.1(:\d+)?$/.test(host)) return true;
    return CFG.ALLOWED_ORIGINS.includes(host) || CFG.ALLOWED_ORIGINS.includes(origin);
}

// ─── HTTP (express) ────────────────────────────────────────────────────────────

const app = express();

app.use((req, res, next) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
});

app.get('/api/mode', (_req, res) => res.json({ readOnly: true, relay: true }));
app.get('/health',   (_req, res) => res.json({ ok: true, rooms: rooms.size, viewers: totalViewers() }));

// Serve only index.html + its assets. Any other *.html is a 404 (relay v1 hosts
// just the dashboard page; calendar/history are not relayed).
app.get(/.*\.html$/i, (req, res, next) => {
    if (path.basename(req.path).toLowerCase() === 'index.html') return next();
    res.status(404).type('text').send('Not found on relay (read-only viewer serves only the dashboard).');
});
app.use(express.static(CFG.PUBLIC_DIR, { index: 'index.html' }));
// Root explicitly → index.html (covered by static index, kept for clarity).
app.get('/', (_req, res) => res.sendFile(path.join(CFG.PUBLIC_DIR, 'index.html')));

const server = http.createServer(app);

// ─── WebSocket routing (noServer + manual upgrade) ─────────────────────────────

const publishWss = new WebSocketServer({ noServer: true, maxPayload: CFG.MAX_FRAME_BYTES });
const viewWss    = new WebSocketServer({ noServer: true, maxPayload: 1024 }); // viewers never send real data

server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch (_) { socket.destroy(); return; }
    const pathname = url.pathname;

    if (!originAllowed(req)) {
        log.warn('origin', `odmítnut upgrade z Origin=${req.headers.origin} (host=${req.headers.host})`);
        socket.destroy();
        return;
    }

    const ip = ipOf(req);

    if (pathname === '/ws/publish') {
        publishWss.handleUpgrade(req, socket, head, (ws) => publishWss.emit('connection', ws, req, ip));
        return;
    }
    const m = pathname.match(/^\/ws\/view\/([^/]+)$/);
    if (m) {
        req._viewToken = decodeURIComponent(m[1]);
        viewWss.handleUpgrade(req, socket, head, (ws) => viewWss.emit('connection', ws, req, ip));
        return;
    }
    socket.destroy();
});

// ─── Publisher connections ─────────────────────────────────────────────────────

publishWss.on('connection', (ws, req, ip) => {
    // Per-IP cap.
    if (incIp(ip) > CFG.MAX_CONNS_PER_IP) {
        decIp(ip);
        ws.close(CLOSE.POLICY, 'too many connections');
        return;
    }

    const headerKey = (() => {
        const h = req.headers.authorization || '';
        const m = h.match(/^Bearer\s+(.+)$/i);
        return m ? m[1].trim() : null;
    })();

    let room = null;

    const authorize = (key) => {
        const pub = matchPublisher(key);
        if (!pub) {
            log.warn('auth', `publish odmítnut (ip=${ip}) — neplatný/zablokovaný klíč`);
            ws.close(CLOSE.AUTH_FAIL, 'invalid publish key');
            return;
        }
        if (!LABEL_RE.test(pub.label || '')) {
            log.warn('auth', `publisher ${pub.id} má nevalidní label — odmítnut`);
            ws.close(CLOSE.AUTH_FAIL, 'invalid label');
            return;
        }

        const token = CFG.STABLE_ROOMS
            ? stableToken(pub)
            : crypto.randomBytes(16).toString('hex');

        const existing = rooms.get(token);
        if (existing) {
            // Stable token + reconnect → reclaim the SAME room so any viewers
            // still attached keep streaming instead of being orphaned on a dead
            // room object. (Only reachable with stable tokens; random never collides.)
            existing.publisherWs = ws;
            existing.disconnectedAt = 0;
            existing.label = pub.label || pub.id;
            room = existing;
            ws._room = room;
            log.add('room', `${token.slice(0, 8)}… reconnect "${room.label}" (ip=${ip}) — ${room.viewers.size} divák(ů) drží spojení`);
            notifyViewers(room, true);   // zdroj zpět → divákům zmizí overlay
        } else {
            if (rooms.size >= CFG.MAX_ROOMS) {
                ws.close(CLOSE.POLICY, 'relay full');
                return;
            }
            if (roomsForPublisher(pub.id) >= CFG.MAX_ROOMS_PER_PUBLISHER) {
                ws.close(CLOSE.POLICY, 'too many rooms for publisher');
                return;
            }
            room = {
                token, publisherId: pub.id, label: pub.label || pub.id,
                publisherWs: ws, viewers: new Set(),
                lastFrame: null, lastStatePatch: null, lastTs: 0, disconnectedAt: 0,
            };
            rooms.set(token, room);
            ws._room = room;
            log.add('room', `${token.slice(0, 8)}… pro "${room.label}" (ip=${ip}) — ${rooms.size} room(ů)`);
        }
        ws.send(JSON.stringify({
            room: token,
            viewerPath: '/#' + token,
            publisherId: pub.id,
            publisherLabel: room.label,
        }));
    };

    // Frame from publisher → fan-out to viewers (forward identical bytes).
    ws.on('message', (data, isBinary) => {
        if (!room) {
            // First message may carry the key when no Authorization header was sent.
            if (!headerKey) {
                let msg; try { msg = JSON.parse(data.toString()); } catch (_) { msg = null; }
                if (msg && typeof msg.key === 'string') return authorize(msg.key);
            }
            return; // pre-auth noise ignored
        }
        // Cache by kind so late viewers get both the current layout (hidden
        // items + order) and the latest data frame — not a transient status
        // envelope. Cheap substring peek avoids a full JSON.parse per frame.
        let kind = 'frame';
        try {
            const s = data.toString();
            // Graceful shutdown from the publisher → end the room now, no grace wait.
            // Cheap peek on the quoted key first (per-frame), then a real parse to
            // confirm a top-level {__bye:true} so arbitrary game text can't trigger it.
            if (s.includes('"__bye"')) {
                let isBye = false;
                try { isBye = JSON.parse(s).__bye === true; } catch (_) {}
                if (isBye) {
                    log.drop('publisher', `"${room.label}" poslal bye — končím room ${room.token.slice(0, 8)}…`);
                    closeRoom(room, CLOSE.PUBLISHER_GONE, 'publisher said bye');
                    room = null;
                    return;
                }
            }
            if (s.includes('__dashboardStatePatch')) kind = 'state';
            else if (s.includes('__replayStatus') || s.includes('__recordStatus')) kind = 'status';
        } catch (_) {}
        if (kind === 'state') room.lastStatePatch = data;
        else if (kind === 'frame') { room.lastFrame = data; room.lastTs = Date.now(); }

        // Forward identical bytes to every viewer. A failing v.send() can emit
        // close synchronously → viewers.delete(v) mid-iteration; deleting from a
        // Set during for...of is safe (the removed entry is just skipped).
        for (const v of room.viewers) {
            if (v.readyState !== 1) continue;
            if (v.bufferedAmount > CFG.MAX_BUFFER_BYTES) {
                log.debug('backpressure', `drop frame pro pomalého diváka (room ${room.token.slice(0, 8)}…)`);
                continue;
            }
            try { v.send(data, { binary: isBinary }); } catch (_) {}
        }
    });

    ws.on('close', () => {
        decIp(ip);
        if (room && rooms.has(room.token)) {
            // Grace period: keep the room briefly so the publisher can reconnect.
            room.publisherWs = null;
            room.disconnectedAt = Date.now();
            log.drop('publisher', `"${room.label}" odpojen — grace ${CFG.GRACE_SEC}s (room ${room.token.slice(0, 8)}…)`);
            notifyViewers(room, false);   // zdroj pryč → divákům naskočí overlay
        }
    });

    ws.on('error', (e) => log.debug('publisher', `ws error: ${e.message}`));

    // If a header key was provided, authorize immediately; otherwise wait briefly
    // for a first-message {key}, then give up.
    if (headerKey) {
        authorize(headerKey);
    } else {
        setTimeout(() => { if (!room && ws.readyState === 1) ws.close(CLOSE.AUTH_FAIL, 'no key'); }, CFG.PUBLISH_AUTH_TIMEOUT_MS);
    }
});

// ─── Viewer connections ────────────────────────────────────────────────────────

viewWss.on('connection', (ws, req, ip) => {
    const token = req._viewToken;

    if (isViewBlocked(ip)) { ws.close(CLOSE.POLICY, 'rate limited'); return; }
    if (!TOKEN_RE.test(token) || !rooms.has(token)) {
        noteViewFail(ip);
        ws.close(CLOSE.ROOM_NOT_FOUND, 'room not found');
        return;
    }
    const room = rooms.get(token);
    if (room.viewers.size >= CFG.MAX_VIEWERS_PER_ROOM) { ws.close(CLOSE.POLICY, 'room full'); return; }
    if (incIp(ip) > CFG.MAX_CONNS_PER_IP) { decIp(ip); ws.close(CLOSE.POLICY, 'too many connections'); return; }

    room.viewers.add(ws);
    log.add('viewer', `→ room ${token.slice(0, 8)}… (pub=${room.label}) — ${room.viewers.size} divák(ů)`);

    // Send the current layout first (so the first render already reflects the
    // publisher's hidden items + order), then the last data frame. Force text
    // frames ({binary:false}) — the cached values are Buffers, and a Buffer sent
    // without this flag arrives in the browser as a Blob, which JSON.parse can't
    // read (the v1 protocol is JSON text end-to-end).
    if (room.lastStatePatch != null) { try { ws.send(room.lastStatePatch, { binary: false }); } catch (_) {} }
    if (room.lastFrame != null)      { try { ws.send(room.lastFrame, { binary: false }); } catch (_) {} }
    // Source currently away → tell this late-joiner so it shows the overlay immediately.
    if (!room.publisherWs) { try { ws.send(JSON.stringify({ __sourceStatus: { online: false } }), { binary: false }); } catch (_) {} }

    // Read-only: ignore anything a viewer tries to send upstream.
    ws.on('message', () => {});
    ws.on('close', () => {
        decIp(ip);
        room.viewers.delete(ws);
        log.drop('viewer', `room ${token.slice(0, 8)}… — ${room.viewers.size} divák(ů)`);
    });
    ws.on('error', (e) => log.debug('viewer', `ws error: ${e.message}`));
});

// ─── Housekeeping: grace expiry + idle room GC ─────────────────────────────────

setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
        // Publisher gone past grace → end the room, kick viewers with a clear code.
        if (!room.publisherWs && room.disconnectedAt && now - room.disconnectedAt > CFG.GRACE_SEC * 1000) {
            closeRoom(room, CLOSE.PUBLISHER_GONE, 'publisher disconnected');
            continue;
        }
        // Idle: nobody publishing AND nobody watching for a long time.
        if (!room.publisherWs && room.viewers.size === 0 &&
            room.disconnectedAt && now - room.disconnectedAt > CFG.IDLE_ROOM_MIN * 60000) {
            closeRoom(room, CLOSE.PUBLISHER_GONE, 'idle');
        }
    }
}, 5000).unref();

// Periodic stats so an operator can see what's happening.
setInterval(() => {
    log.tick('stats', `${rooms.size} room(ů) · ${totalViewers()} divák(ů)`);
}, 60000).unref();

// ─── Start ─────────────────────────────────────────────────────────────────────

loadPublishers({ strict: true });   // fail-fast on malformed JSON at boot

server.on('error', (e) => {
    log.error('boot', `nelze nastartovat na portu ${CFG.PORT}: ${e.message}`);
    process.exit(1);
});

server.listen(CFG.PORT, () => {
    log.banner([
        `FS25 Dashboard Relay v${require('./package.json').version}`,
        `▸ port:       ${CFG.PORT} (interní; ven přes Tailscale Funnel 443)`,
        `▸ publishers: ${CFG.PUBLISHERS_FILE}`,
        `▸ public:     ${CFG.PUBLIC_DIR}`,
        `▸ capy:       ${CFG.MAX_ROOMS} room · ${CFG.MAX_VIEWERS_PER_ROOM} div/room · ${CFG.MAX_CONNS_PER_IP}/IP`,
    ]);
    const enabled = loadPublishers().filter(p => p.enabled).length;
    log.info('boot', `allowlist: ${enabled} aktivní publisher(ů). Čekám na připojení…`);
});

function shutdown() {
    for (const room of rooms.values()) closeRoom(room, 1001, 'relay shutting down');
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
