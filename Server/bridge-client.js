// bridge-client.js — uploads dashboard data to a remote cloud relay.
//
// Activated when BRIDGE_UPSTREAM_URL is set. The local server still runs as
// before; this module is a parallel WebSocket *client* that pushes every
// game-data tick up to https://<your>.onrender.com so external viewers can
// see live data without exposing the local machine to the public internet.
//
// Wire format (all envelopes are JSON, sent as text frames):
//
//   client → server:
//     { type: "hello",     token: "<INGEST_TOKEN>", modVersion, serverVersion }
//     { type: "bootstrap", snapshot: <full payload>, history: { balance, prices, events, profit, dashboardState } }
//     { type: "snapshot",  data: <full payload> }              // every BRIDGE_FULL_SYNC_MS
//     { type: "delta",     changed: { <top-level keys that differ> } }
//     { type: "history-append", balance?, prices?, events? }   // incremental history rows
//     { type: "ping" }                                          // keepalive
//
//   server → client:
//     { type: "welcome" }     — token accepted; client may proceed to bootstrap
//     { type: "pong" }
//     { type: "error", code, message }
//
// Delta strategy: shallow diff on top-level keys. If a key's JSON string
// changed since the last send, the whole new value is included. For typical
// FS25 payloads this is ~10× smaller than the full snapshot per tick.

const WebSocket = require('ws');

const FULL_SYNC_MS         = parseInt(process.env.BRIDGE_FULL_SYNC_MS || '60000', 10);
const HISTORY_APPEND_MS    = parseInt(process.env.BRIDGE_HISTORY_APPEND_MS || '300000', 10);
const PING_MS              = parseInt(process.env.BRIDGE_PING_MS || '25000', 10);
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

class BridgeClient {
    constructor({ upstreamUrl, ingestToken, db, dashState, getLastPayload, modVersion, serverVersion }) {
        if (!upstreamUrl) throw new Error('BridgeClient: upstreamUrl is required');
        if (!ingestToken) throw new Error('BridgeClient: ingestToken is required');

        this.upstreamUrl     = upstreamUrl;
        this.ingestToken     = ingestToken;
        this.db              = db;
        this.dashState       = dashState;
        this.getLastPayload  = getLastPayload || (() => null);
        this.modVersion      = modVersion;
        this.serverVersion   = serverVersion;

        this.ws              = null;
        this.welcomed        = false;          // server accepted our token
        this.lastSnapshotMap = {};             // top-level key → JSON string
        this.lastFullSyncAt  = 0;
        this.lastHistoryAt   = 0;
        this.reconnectIdx    = 0;
        this.reconnectTimer  = null;
        this.pingTimer       = null;
        this.stopped         = false;

        this.bytesSent       = 0;
        this.deltaCount      = 0;
        this.fullCount       = 0;
        this.statsTimer      = null;
    }

    start() {
        console.log(`[Bridge] Upstream: ${this.upstreamUrl}`);
        this._connect();
        this.statsTimer = setInterval(() => this._logStats(), 5 * 60 * 1000);
    }

    stop() {
        this.stopped = true;
        clearTimeout(this.reconnectTimer);
        clearInterval(this.pingTimer);
        clearInterval(this.statsTimer);
        if (this.ws) {
            try { this.ws.close(); } catch (_) {}
            this.ws = null;
        }
    }

    // Called from the file watcher each time dashboard_data.json changes.
    pushPayload(data) {
        if (!this.welcomed || !data) return;

        const now = Date.now();
        const forceFull = (now - this.lastFullSyncAt) >= FULL_SYNC_MS;

        if (forceFull) {
            this._sendFullSnapshot(data);
            this.lastFullSyncAt = now;
        } else {
            this._sendDelta(data);
        }

        if ((now - this.lastHistoryAt) >= HISTORY_APPEND_MS) {
            this._sendHistoryAppend();
            this.lastHistoryAt = now;
        }
    }

    // ─── Connection lifecycle ────────────────────────────────────────────────

    _connect() {
        if (this.stopped) return;

        try {
            this.ws = new WebSocket(this.upstreamUrl, {
                handshakeTimeout: 15000,
                perMessageDeflate: true,
            });
        } catch (e) {
            console.warn('[Bridge] Connect error:', e.message);
            return this._scheduleReconnect();
        }

        this.ws.on('open', () => {
            console.log('[Bridge] Connected');
            this.welcomed = false;
            this._send({
                type:          'hello',
                token:         this.ingestToken,
                modVersion:    this.modVersion,
                serverVersion: this.serverVersion,
            });
        });

        this.ws.on('message', raw => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

            if (msg.type === 'welcome') {
                this.welcomed     = true;
                this.reconnectIdx = 0;
                this._sendBootstrap();
                this._startPing();
            } else if (msg.type === 'pong') {
                // noop
            } else if (msg.type === 'error') {
                console.warn(`[Bridge] Server error: ${msg.code} — ${msg.message || ''}`);
                if (msg.code === 'auth') {
                    // Bad token. Don't retry-spam — wait the max backoff.
                    this.reconnectIdx = RECONNECT_BACKOFF_MS.length - 1;
                }
            }
        });

        this.ws.on('close', (code, reason) => {
            this.welcomed = false;
            clearInterval(this.pingTimer);
            if (this.stopped) return;
            console.log(`[Bridge] Disconnected (code=${code}${reason ? ' reason=' + reason : ''})`);
            this._scheduleReconnect();
        });

        this.ws.on('error', err => {
            console.warn('[Bridge] WS error:', err.message);
        });
    }

    _scheduleReconnect() {
        if (this.stopped) return;
        const delay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectIdx, RECONNECT_BACKOFF_MS.length - 1)];
        this.reconnectIdx++;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this._connect(), delay);
        console.log(`[Bridge] Reconnect in ${delay}ms`);
    }

    _startPing() {
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this._send({ type: 'ping' });
            }
        }, PING_MS);
    }

    // ─── Outbound messages ───────────────────────────────────────────────────

    _send(obj) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const s = JSON.stringify(obj);
        try {
            this.ws.send(s);
            this.bytesSent += Buffer.byteLength(s, 'utf8');
        } catch (e) {
            console.warn('[Bridge] Send failed:', e.message);
        }
    }

    _sendBootstrap() {
        const payload = this.getLastPayload();
        const history = this._collectHistory();
        const dashboardState = this.dashState ? this.dashState.getAll() : {};

        this._send({
            type:           'bootstrap',
            snapshot:       payload,
            history,
            dashboardState,
        });

        this._captureSnapshotMap(payload);
        this.lastFullSyncAt = Date.now();
        this.lastHistoryAt  = Date.now();
        this.fullCount++;
        console.log('[Bridge] Bootstrap sent (snapshot + history + dashboard-state)');
    }

    _sendFullSnapshot(data) {
        this._send({ type: 'snapshot', data });
        this._captureSnapshotMap(data);
        this.fullCount++;
    }

    _sendDelta(data) {
        const changed = {};
        let count = 0;
        for (const key of Object.keys(data)) {
            const next = JSON.stringify(data[key]);
            if (this.lastSnapshotMap[key] !== next) {
                changed[key] = data[key];
                this.lastSnapshotMap[key] = next;
                count++;
            }
        }
        // Detect removed top-level keys (rare but possible)
        for (const key of Object.keys(this.lastSnapshotMap)) {
            if (!(key in data)) {
                changed[key] = null;
                delete this.lastSnapshotMap[key];
                count++;
            }
        }
        if (count === 0) return;
        this._send({ type: 'delta', changed });
        this.deltaCount++;
    }

    _sendHistoryAppend() {
        // For now: send the full history every interval. Simple, correct, and
        // since this is rare (5 min default) the bandwidth is negligible.
        // If/when the JSONL grows large, switch to incremental tail.
        const history = this._collectHistory();
        this._send({ type: 'history-append', ...history, full: true });
    }

    _collectHistory() {
        if (!this.db) return {};
        try {
            return {
                balance: this.db.getBalanceHistory(365),
                prices:  this.db.getPriceHistory(null, null, 365),
                events:  this.db.getRecentEvents(500),
                profit:  this.db.getFieldProfit(),
                fillTypes:  this.db.getAvailableFillTypes(),
                sellPoints: this.db.getAvailableSellPoints(),
            };
        } catch (e) {
            console.warn('[Bridge] History collect failed:', e.message);
            return {};
        }
    }

    _captureSnapshotMap(data) {
        if (!data) return;
        this.lastSnapshotMap = {};
        for (const key of Object.keys(data)) {
            this.lastSnapshotMap[key] = JSON.stringify(data[key]);
        }
    }

    _logStats() {
        const kb = (this.bytesSent / 1024).toFixed(1);
        console.log(`[Bridge] 5-min stats — sent ${kb} KB, ${this.deltaCount} deltas + ${this.fullCount} full`);
        this.bytesSent = 0;
        this.deltaCount = 0;
        this.fullCount = 0;
    }
}

module.exports = { BridgeClient };
