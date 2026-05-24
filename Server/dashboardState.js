// dashboardState.js — server-side persistence for the dashboard's
// preferences (theme, hidden items, drag order, flash toggles, KPI layout,
// notifications, …). Single JSON file in the server's data dir so that
// every browser on every device sees the same layout.
//
// Storage shape mirrors the localStorage keys the frontend already writes,
// minus the `fs25.dash.v1.` namespace prefix:
//
//   {
//     "theme": "dark-green",
//     "hidden:vehicles": ["Fendt 942 Vario"],
//     "order:sections": ["fields", "vehicles", "..."],
//     "flashEnabled": { "vehicles": true, "fields": false },
//     "notifications": { enabled: true, ... },
//     ...
//   }
//
// Keys NOT synced (per-device / session-only):
//   - "bell-dismissed" — session fingerprints, device-local
//   - "syncMode"       — the per-device opt-out toggle itself
//
// Concurrent write safety: the file is small (a few KB) and writes are
// rare (only when the user changes something), so we just fs.writeFileSync
// with a temp-rename swap. No locking dance needed at this scale.

const fs   = require('fs');
const path = require('path');

const NS = 'fs25.dash.v1.';

// Keys that intentionally do NOT roundtrip through the server. The client
// strips these from any PUT body and the server refuses to broadcast them.
const LOCAL_ONLY = new Set([
    'bell-dismissed',
    'syncMode',
]);

function stripLocalOnly(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (LOCAL_ONLY.has(k)) continue;
        out[k] = v;
    }
    return out;
}

class DashboardState {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = this.#load();
    }

    #load() {
        try {
            if (!fs.existsSync(this.filePath)) return {};
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            console.warn('[DashboardState] load error:', e.message);
            return {};
        }
    }

    #persist() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const tmp = this.filePath + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
            fs.renameSync(tmp, this.filePath);
        } catch (e) {
            console.warn('[DashboardState] persist error:', e.message);
        }
    }

    /** Returns the full state blob. */
    getAll() {
        return { ...this.data };
    }

    /** Replace entire state. `patch` shape: { key: value, ... } (no NS prefix). */
    replaceAll(payload) {
        this.data = stripLocalOnly(payload);
        this.#persist();
        return this.getAll();
    }

    /**
     * Apply a partial patch. Each entry is { key: value | null }. A null
     * value deletes the key. Returns the keys that actually changed so the
     * caller can broadcast a minimal diff.
     */
    patch(payload) {
        const clean = stripLocalOnly(payload);
        const changed = {};
        for (const [k, v] of Object.entries(clean)) {
            if (v === null) {
                if (k in this.data) {
                    delete this.data[k];
                    changed[k] = null;
                }
            } else {
                // Deep-equality check via JSON to avoid persisting noise
                if (JSON.stringify(this.data[k]) !== JSON.stringify(v)) {
                    this.data[k] = v;
                    changed[k] = v;
                }
            }
        }
        if (Object.keys(changed).length) this.#persist();
        return changed;
    }
}

module.exports = { DashboardState, NS, LOCAL_ONLY };
