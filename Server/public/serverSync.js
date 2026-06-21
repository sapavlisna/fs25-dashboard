// serverSync.js — keep this device's localStorage in step with the server's
// dashboard-state.json so settings, hidden items, drag order, etc. sync
// across every browser hitting this server.
//
// Lifecycle:
//   1. On page load: fetch /api/dashboard-state and write each returned
//      key into localStorage. Other modules (DashState, TableTools, theme)
//      then read their values normally — they don't have to know sync exists.
//   2. When DashState / TableTools / theme write to localStorage, they call
//      ServerSync.syncWrite(key, value). syncWrite PATCHes the server with
//      a tiny { "<key>": value } body. The server broadcasts the diff via
//      WS to every other open client.
//   3. WS push: app.js's connect() callback hands the parsed message to
//      ServerSync.handleWsMessage(). If the message carries
//      `__dashboardStatePatch`, we write each entry into localStorage WITH
//      the suppress flag so syncWrite doesn't echo it back to the server.
//
// Local-only override: the user can toggle the sync off in Settings. While
// off, syncWrite is a no-op (so writes stay on this device) and incoming
// WS pushes are ignored. "Načíst ze serveru" forces a fresh GET that
// overwrites local state regardless of the toggle.

(function () {
    const NS         = 'fs25.dash.v1.';
    const SYNC_KEY   = NS + 'syncMode';        // 'server' (default) | 'local'
    const ENDPOINT   = '/api/dashboard-state';

    // Keys we deliberately don't roundtrip through the server (session-only
    // or per-device meta). Mirrors LOCAL_ONLY in dashboardState.js.
    const LOCAL_ONLY = new Set([
        'bell-dismissed',
        'syncMode',
    ]);

    // When the WS push writes into localStorage, suppress the syncWrite
    // re-send to avoid a write loop. Tracked per-key for short windows.
    const suppressUntil = new Map();
    function suppress(key) {
        suppressUntil.set(key, Date.now() + 1500);
    }
    function isSuppressed(key) {
        const t = suppressUntil.get(key);
        if (t == null) return false;
        if (Date.now() > t) { suppressUntil.delete(key); return false; }
        return true;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────
    function isEnabled() {
        try { return localStorage.getItem(SYNC_KEY) !== 'local'; } catch (_) { return true; }
    }
    function setEnabled(on) {
        try { localStorage.setItem(SYNC_KEY, on ? 'server' : 'local'); } catch (_) {}
    }
    function shortKey(fullKey) {
        // syncWrite callers pass either the namespaced or the short form;
        // the server stores by short key so normalise here.
        return fullKey.startsWith(NS) ? fullKey.slice(NS.length) : fullKey;
    }

    // Listeners that consuming modules can register for full-state replays
    // (initial load + "Načíst ze serveru" button). Each callback is invoked
    // with the keys that changed so renderers can re-fire.
    const listeners = [];
    function onReplay(fn) { listeners.push(fn); }
    function fireReplay(keys) {
        for (const fn of listeners) {
            try { fn(keys); } catch (e) { console.warn('[ServerSync] listener error:', e); }
        }
    }

    // ─── Write path ──────────────────────────────────────────────────────
    function syncWrite(rawKey, value) {
        if (window.readOnlyMode) return;   // viewer mode: never write back to the relay/server
        if (!isEnabled()) return;
        const key = shortKey(rawKey);
        if (LOCAL_ONLY.has(key)) return;
        if (isSuppressed(key)) return;
        // Fire-and-forget PATCH. Errors are logged but never block the UI.
        const body = {};
        body[key] = value;
        fetch(ENDPOINT, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).catch(err => console.warn('[ServerSync] patch failed:', err));
    }
    function syncDelete(rawKey) { syncWrite(rawKey, null); }

    // ─── Incoming WS push ────────────────────────────────────────────────
    function applyPatchToLocalStorage(patch, keysOut) {
        for (const [k, v] of Object.entries(patch)) {
            if (LOCAL_ONLY.has(k)) continue;
            const fullKey = NS + k;
            suppress(k);
            try {
                if (v === null) localStorage.removeItem(fullKey);
                else localStorage.setItem(fullKey, JSON.stringify(v));
            } catch (_) {}
            keysOut.push(k);
        }
    }

    // Relay viewers mirror the publisher's layout (hidden items + order) but keep
    // their own presentation (theme + language).
    const VIEWER_LOCAL_KEYS = new Set(['theme', 'lang']);

    function handleWsMessage(data) {
        if (!data || typeof data !== 'object') return false;
        if (!data.__dashboardStatePatch) return false;
        let patch = data.__dashboardStatePatch;
        if (window.readOnlyMode) {
            patch = {};
            for (const [k, v] of Object.entries(data.__dashboardStatePatch)) {
                if (!VIEWER_LOCAL_KEYS.has(k)) patch[k] = v;
            }
        } else if (!isEnabled()) {
            return true;   // sync off → swallow but don't apply
        }
        const keys = [];
        applyPatchToLocalStorage(patch, keys);
        if (keys.length) fireReplay(keys);
        return true;
    }

    // ─── Pull (initial load + manual reload) ─────────────────────────────
    async function pullFromServer({ force = false } = {}) {
        if (!force && !isEnabled()) return null;
        try {
            const res = await fetch(ENDPOINT);
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            const keys = [];
            // First clear any local-storage key that the server doesn't have
            // — only when force is true (the "Načíst ze serveru" button) so
            // a casual page-load doesn't blow away locally-tweaked state.
            if (force) {
                try {
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                        const k = localStorage.key(i);
                        if (!k || !k.startsWith(NS)) continue;
                        const short = k.slice(NS.length);
                        if (LOCAL_ONLY.has(short)) continue;
                        if (!(short in data)) {
                            localStorage.removeItem(k);
                            keys.push(short);
                        }
                    }
                } catch (_) {}
            }
            applyPatchToLocalStorage(data, keys);
            if (keys.length) fireReplay(keys);
            return data;
        } catch (e) {
            console.warn('[ServerSync] pull failed:', e);
            return null;
        }
    }

    // Pull once as soon as the page is alive. Run before DOMContentLoaded
    // listeners fire so the first render reads server state from
    // localStorage instead of a stale cache.
    // Viewer mode: the relay has no /api/dashboard-state — skip the pull entirely
    // (the viewer keeps its own local layout).
    const initialPull = window.readOnlyMode ? Promise.resolve(null) : pullFromServer();
    window.__serverSyncReady = initialPull;

    window.ServerSync = {
        syncWrite, syncDelete,
        pullFromServer,
        handleWsMessage,
        isEnabled, setEnabled,
        onReplay,
        LOCAL_ONLY,
    };
})();
