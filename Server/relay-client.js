// relay-client.js — optional OUTBOUND publisher to a relay server.
//
// If a relay URL + publish key are configured (via config.local.json / env, or
// live from the UI via reconfigure()), this opens a single wss connection to
// <url>/ws/publish and forwards every frame the server broadcasts to its local
// WS clients. The relay fans those out to viewers, so the home uplink carries
// ONE stream regardless of viewer count.
//
// Disabled (no URL, no key, or toggled off) → send() is a no-op, status 'disabled'.

const WebSocket = require('ws');
const log    = require('./logger');
const config = require('./config');

const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 30000;

let relayUrl   = (config.RELAY_URL || '').replace(/\/+$/, '');
let publishKey = config.RELAY_PUBLISH_KEY || '';
let enabled    = config.RELAY_ENABLED !== false;

let ws = null;
let status = 'disabled';      // disabled | connecting | connected | error
let viewerUrl = null;
let lastFrame = null;
let backoff = BACKOFF_MIN;
let timer = null;
let started = false;          // true = we want to be connected
let onRoomReady = null;       // called when a room is (re)created — push current layout

function publishUrl() { return relayUrl + '/ws/publish'; }
function viewerBase() { return relayUrl.replace(/^ws/i, 'http'); } // ws→http, wss→https

function scheduleReconnect() {
    if (!started) return;
    clearTimeout(timer);
    const jitter = Math.floor(backoff * 0.2 * Math.random());
    timer = setTimeout(connect, backoff + jitter);
    backoff = Math.min(Math.round(backoff * 1.5), BACKOFF_MAX);
}

function connect() {
    status = 'connecting';
    try {
        ws = new WebSocket(publishUrl(), { headers: { Authorization: `Bearer ${publishKey}` } });
    } catch (e) {
        log.warn('relay', `nelze otevřít spojení: ${e.message}`);
        return scheduleReconnect();
    }

    ws.on('open', () => log.info('relay', `připojeno k ${relayUrl}, čekám na room…`));

    ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
        if (m && m.room) {
            backoff = BACKOFF_MIN;
            status = 'connected';
            viewerUrl = viewerBase() + (m.viewerPath || ('/#' + m.room));
            log.banner([
                'Relay room připraven — sdílej tento odkaz divákům:',
                `▸ ${viewerUrl}`,
            ]);
            if (onRoomReady) { try { onRoomReady(); } catch (_) {} }   // push current layout
            if (lastFrame != null) safeSend(lastFrame);   // seed the fresh room
        }
    });

    ws.on('close', (code) => {
        const wasConnected = status === 'connected';
        status = 'error';
        viewerUrl = null;
        if (code === 4401) {
            log.error('relay', 'odmítnuto: neplatný publish klíč — zkontroluj klíč a záznam v publishers.json na relay');
        } else if (wasConnected) {
            log.warn('relay', `odpojeno (${code}) — obnovuji spojení`);
        }
        scheduleReconnect();
    });

    ws.on('error', (e) => log.debug('relay', `chyba: ${e.message}`));
}

function safeSend(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch (_) {}
    }
}

// Forward one already-serialized frame (string) to the relay. No-op when off.
function send(msg) {
    if (!started) return;
    lastFrame = msg;
    safeSend(msg);
}

function stop() {
    started = false;
    clearTimeout(timer);
    if (ws) {
        try { ws.removeAllListeners(); ws.close(); } catch (_) {}
        ws = null;
    }
    viewerUrl = null;
}

function start() {
    if (!enabled)  { status = 'disabled'; return; }
    if (!relayUrl) { status = 'disabled'; return; }
    if (!/^wss?:\/\//i.test(relayUrl)) {
        log.warn('relay', `RELAY_URL musí začínat ws:// nebo wss:// (dostal jsem "${relayUrl}") — relay vypnut`);
        status = 'disabled';
        return;
    }
    if (!publishKey) {
        log.warn('relay', 'chybí publish klíč — relay se nepřipojí');
        status = 'disabled';
        return;
    }
    started = true;
    backoff = BACKOFF_MIN;
    connect();
}

function init() { start(); }

// Live reconfigure from the UI. Persisting to config.local.json is the caller's
// job (index.js); this just swaps the running connection.
function reconfigure({ url, key, enabled: en } = {}) {
    stop();
    if (typeof url === 'string')  relayUrl = url.trim().replace(/\/+$/, '');
    if (typeof key === 'string' && key.length) publishKey = key;
    if (typeof en === 'boolean')  enabled = en;
    start();
    return getState();
}

// Safe to expose to the UI — never returns the key itself, only whether it's set.
function getState() {
    return { url: relayUrl, hasKey: !!publishKey, enabled, status, viewerUrl };
}

function setRoomReadyHook(fn) { onRoomReady = fn; }

// Graceful shutdown: tell the relay we're leaving on purpose ({__bye}) so it ends
// the room immediately (viewers get the terminal overlay) instead of waiting out
// the reconnect grace. Resolves once the bye is flushed or a short safety timeout
// fires — never blocks process exit.
function shutdown() {
    return new Promise((resolve) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) { stop(); return resolve(); }
        let done = false;
        const finish = () => { if (done) return; done = true; stop(); resolve(); };
        try { ws.send(JSON.stringify({ __bye: true }), () => finish()); }
        catch (_) { return finish(); }
        setTimeout(finish, 300);   // safety: shutdown must never hang on the relay
    });
}

module.exports = {
    init, send, reconfigure, getState, setRoomReadyHook, shutdown,
    get status()    { return status; },
    get viewerUrl() { return viewerUrl; },
};
