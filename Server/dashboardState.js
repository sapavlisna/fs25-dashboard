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
const log  = require('./logger');

const NS = 'fs25.dash.v1.';

// Keys that intentionally do NOT roundtrip through the server. The client
// strips these from any PUT body and the server refuses to broadcast them.
const LOCAL_ONLY = new Set([
    'bell-dismissed',
    'syncMode',
]);

// Whitelist of keys we accept from the network. Anything else gets dropped
// with a log line so a buggy or malicious client can't nuke unrelated state
// (originally PATCH would happily delete any key the body named null).
const ALLOWED_EXACT = new Set([
    'theme',
    'currency',
    'hiddenVehicles',
    'hiddenStorages',
    'hiddenProductions',
    'hiddenSections',
    'emptyAnimalsCollapsed',
    'collapsedGroups',
    'flashEnabled',
    'vehiclesExpanded',
    'vehicleShowEmptyImplements',
    'vehicleShowCondition',
    'fieldPlans',
    'kpi-layout',
    'bell-rules',
    'bell-flashEnabled',
    'fs25_notif_settings',
    'fs25_notif_cooldown',
    'forecastWatches',
]);

// Prefix patterns: any key starting with one of these is accepted. Used for
// per-scope keys whose suffix is dynamic (item/section/wrap id).
const ALLOWED_PREFIX = [
    'hidden:',
    'order:',
    'collapsed:',
    'sort.',
];

function isAllowedKey(k) {
    if (typeof k !== 'string' || !k.length) return false;
    if (ALLOWED_EXACT.has(k)) return true;
    for (const p of ALLOWED_PREFIX) if (k.startsWith(p)) return true;
    return false;
}

// Loose value sanity check. We want to reject obviously broken payloads
// (functions, undefined) without overfitting to specific shapes.
function isSaneValue(v) {
    if (v === null || v === undefined) return true; // null = delete signal
    const t = typeof v;
    if (t === 'string' || t === 'boolean' || t === 'number') return true;
    if (Array.isArray(v)) return v.every(isSaneValue);
    if (t === 'object') {
        for (const [k, val] of Object.entries(v)) {
            if (typeof k !== 'string') return false;
            if (!isSaneValue(val)) return false;
        }
        return true;
    }
    return false;
}

function stripLocalOnly(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (LOCAL_ONLY.has(k)) continue;
        if (!isAllowedKey(k)) {
            log.warn('dash-state', `rejected unknown key "${k}"`);
            continue;
        }
        if (!isSaneValue(v)) {
            log.warn('dash-state', `rejected invalid value for "${k}" (type=${typeof v})`);
            continue;
        }
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
            log.warn('dash-state', `load: ${e.message}`);
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
            log.warn('dash-state', `persist: ${e.message}`);
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
