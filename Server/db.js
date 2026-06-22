// JSONL-based history store. No native deps.
// Files: data/balance.jsonl, data/prices.jsonl, data/fields.jsonl
// One JSON object per line. Append-only. Read into memory for queries.

const fs   = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const log = require('./logger');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
    balance: path.join(DATA_DIR, 'balance.jsonl'),
    prices:  path.join(DATA_DIR, 'prices.jsonl'),
    fields:  path.join(DATA_DIR, 'fields.jsonl'),
    events:  path.join(DATA_DIR, 'events.jsonl'),
};

// ─── Read helpers ─────────────────────────────────────────────────────────────

function readJsonl(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return [];
    const out = [];
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch (_) { /* skip bad line */ }
    }
    return out;
}

// In-memory cache of each JSONL file, keyed by path. The history files (esp.
// prices.jsonl) grow to 100k+ rows; re-reading + reparsing the whole file from
// disk on every /api/history/* request is the real cost. Read once, then serve
// queries from RAM and keep the cache in step on every append/rewrite.
// (Future step: split per save_id into separate files for bounded size +
// per-save deletion — see CHANGELOG/db notes.)
const cache = Object.create(null);
function getRows(filePath) {
    let rows = cache[filePath];
    if (!rows) { rows = readJsonl(filePath); cache[filePath] = rows; }
    return rows;
}

function appendJsonl(filePath, obj) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(obj) + '\n');
    getRows(filePath).push(obj);   // keep cache in step
}

function writeJsonl(filePath, rows) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    cache[filePath] = rows.slice();   // replace cache with the rewritten set
}

// ─── State ────────────────────────────────────────────────────────────────────

// Track last saved game_day to avoid duplicate rows. Initialise from disk so
// a server restart on the same game-day doesn't append duplicates.
let lastSavedDay = (() => {
    const rows = getRows(FILES.balance);
    return rows.length ? rows[rows.length - 1].game_day : -1;
})();

// Track seen event keys (timestamp+fieldId+type) so we don't insert duplicates
// when the mod re-includes the same recent event in subsequent ticks.
const seenEventKeys = new Set();
(function loadSeenEvents() {
    for (const e of getRows(FILES.events)) {
        seenEventKeys.add(`${e.timestamp}|${e.field_id}|${e.type}`);
    }
})();

// ─── Public API ───────────────────────────────────────────────────────────────

// Build a stable identifier for the current savegame so history queries
// can filter to one playthrough at a time. Without this, switching slots
// (or even reloading a different save) interleaves rows in the same JSONL
// — the chart then shows balance from one game-day and crop prices from
// another, which is what gave the user a 68 M Kč "chart vs 1.3 M Kč in
// game" mismatch.
function buildSaveId(data) {
    const m = data && data.saveMeta;
    if (!m) return '';
    const name = m.name || '';
    const map  = m.mapTitle || '';
    return name && map ? `${name}|${map}` : (name || map || '');
}

function saveSnapshot(data) {
    const day = data.gameDay || 0;
    const now = new Date().toISOString();
    const saveId = buildSaveId(data);

    // Save events immediately, deduplicated (events fire any time, not per-day)
    saveEvents(data.events || [], data);

    // Save daily snapshots once per game day
    if (day === lastSavedDay) return;
    lastSavedDay = day;

    try {
        if (data.farmBalance != null) {
            appendJsonl(FILES.balance, { recorded_at: now, save_id: saveId, game_day: day, balance: data.farmBalance });
        }

        for (const sp of (data.prices || [])) {
            for (const item of (sp.items || [])) {
                appendJsonl(FILES.prices, {
                    recorded_at: now,
                    save_id:     saveId,
                    game_day:    day,
                    sell_point:  sp.sellPoint,
                    fill_type:   item.name,
                    price_ton:   item.pricePerTon,
                });
            }
        }

        for (const f of (data.fields || [])) {
            if (f.owned) {
                appendJsonl(FILES.fields, {
                    recorded_at:    now,
                    save_id:        saveId,
                    game_day:       day,
                    field_id:       f.id,
                    fruit_name:     f.fruitName || '',
                    growth_percent: f.growthPercent || 0,
                    is_ready:       f.isReadyToHarvest ? 1 : 0,
                });
            }
        }
    } catch (e) {
        log.error('db', `save: ${e.message}`);
    }
}

// Estimated cost/yield per hectare per crop. Rough vanilla-FS25 numbers.
// Used when mod doesn't report exact values – good enough for trend tracking.
const SEED_COST_PER_HA   = 200;   // CZK
const FERT_COST_PER_HA   = 150;   // CZK (assumed half fertilization)
const YIELD_LITERS_PER_HA = {
    DEFAULT:    20000,
    WHEAT:      9000,
    BARLEY:     8500,
    CANOLA:     5500,
    MAIZE:      18000,
    SUNFLOWER:  4500,
    SOYBEAN:    4000,
    SUGARBEET:  90000,
    POTATO:     65000,
    GRASS:      25000,
};

function estimateYield(fruitTypeId, area, growthPercent) {
    const perHa = YIELD_LITERS_PER_HA[fruitTypeId] || YIELD_LITERS_PER_HA.DEFAULT;
    return Math.floor(area * perHa * (growthPercent / 100));
}

function saveEvents(events, snapshot) {
    if (!Array.isArray(events) || events.length === 0) return;

    // Tag events with the current playthrough id so filterCurrentSave() can scope
    // them like balance/prices/fields — otherwise switching savegame slots mixes
    // events from different playthroughs into one feed.
    const saveId = buildSaveId(snapshot);

    // Build current price map (sellPoint+fillType → price/t) for revenue estimate
    const priceMap = {};
    let bestPriceByFruit = {};
    for (const sp of (snapshot.prices || [])) {
        for (const item of (sp.items || [])) {
            priceMap[`${sp.sellPoint}|${item.name}`] = item.pricePerTon;
            if (!bestPriceByFruit[item.name] || bestPriceByFruit[item.name] < item.pricePerTon) {
                bestPriceByFruit[item.name] = item.pricePerTon;
            }
        }
    }

    for (const ev of events) {
        const key = `${ev.timestamp}|${ev.fieldId}|${ev.type}`;
        if (seenEventKeys.has(key)) continue;
        seenEventKeys.add(key);

        const row = {
            timestamp:   ev.timestamp,
            save_id:     saveId,
            game_day:    ev.gameDay,
            field_id:    ev.fieldId,
            type:        ev.type,
            fruit_name:  ev.fruitName,
            fruit_type:  ev.fruitTypeId,
            area:        ev.area,
        };

        if (ev.type === 'sowing') {
            row.cost_estimated = Math.round((ev.area || 0) * SEED_COST_PER_HA);
        } else if (ev.type === 'harvest') {
            const yieldLiters = estimateYield(ev.fruitTypeId, ev.area || 0, ev.growthAtHarvest || 0);
            const pricePerTon = bestPriceByFruit[ev.fruitName] || 0;
            row.yield_liters     = yieldLiters;
            row.revenue_estimated = Math.round((yieldLiters / 1000) * pricePerTon);
            row.was_ready        = ev.wasReady ? 1 : 0;
            row.growth_at_harvest = ev.growthAtHarvest;
        }

        appendJsonl(FILES.events, row);
    }
}

// ─── Profit aggregation ───────────────────────────────────────────────────────

function getFieldProfit(fieldIds) {
    const events = filterCurrentSave(getRows(FILES.events));
    const byField = {};

    for (const e of events) {
        const id = e.field_id;
        if (fieldIds && !fieldIds.includes(id)) continue;
        if (!byField[id]) {
            byField[id] = {
                fieldId: id,
                totalCost: 0,
                totalRevenue: 0,
                profit: 0,
                events: 0,
                sowings: 0,
                harvests: 0,
                lastEventDay: 0,
                lastFruit: '',
                lastFruitType: '',
            };
        }
        const f = byField[id];
        f.events++;
        f.lastEventDay = Math.max(f.lastEventDay, e.game_day || 0);

        if (e.type === 'sowing') {
            f.sowings++;
            f.totalCost += (e.cost_estimated || 0);
            f.lastFruit = e.fruit_name;
            f.lastFruitType = e.fruit_type || '';
        } else if (e.type === 'harvest') {
            f.harvests++;
            f.totalRevenue += (e.revenue_estimated || 0);
        }
        f.profit = f.totalRevenue - f.totalCost;
    }

    return Object.values(byField).sort((a, b) => b.profit - a.profit);
}

function getRecentEvents(limit) {
    const events = filterCurrentSave(getRows(FILES.events));
    return events.slice(-1 * (parseInt(limit) || 50)).reverse();
}

// Helper: max game_day via reduce (NOT Math.max(...arr) — that blows the
// call stack at ~100 k arguments, which is what happens once the price log
// gets a few weeks of multi-station data in it).
function maxGameDay(rows) {
    let m = -Infinity;
    for (const r of rows) if (r.game_day > m) m = r.game_day;
    return m;
}

// Keep one row per group (last wins) so the chart isn't cluttered with the
// ~10 identical snapshots every game-day produces under the 2-second WS tick.
function dedupeLast(rows, keyFn) {
    const map = new Map();
    for (const r of rows) map.set(keyFn(r), r);
    return [...map.values()];
}

// Filter rows down to the current savegame. The "current" save_id is whatever
// the most recent record carries; older rows from previous playthroughs (or
// pre-tagging legacy rows with no save_id) are excluded so the chart shows
// one consistent timeline. If the latest row has no save_id either (early in
// a fresh install or right after a wipe), nothing is filtered.
function filterCurrentSave(rows) {
    if (!rows.length) return rows;
    const latest = rows[rows.length - 1];
    const currentSaveId = latest.save_id || '';
    if (!currentSaveId) return rows;
    return rows.filter(r => (r.save_id || '') === currentSaveId);
}

function getPriceHistory(fillType, sellPoint, days) {
    const rows = filterCurrentSave(getRows(FILES.prices));
    if (!rows.length) return [];

    const maxDay = maxGameDay(rows);
    const minDay = days ? maxDay - parseInt(days) : 0;

    const filtered = rows.filter(r => {
        if (r.game_day < minDay) return false;
        if (fillType  && r.fill_type  !== fillType)  return false;
        if (sellPoint && r.sell_point !== sellPoint) return false;
        return true;
    });
    return dedupeLast(filtered, r => `${r.game_day}|${r.fill_type}|${r.sell_point}`)
        .sort((a, b) => a.game_day - b.game_day);
}

function getBalanceHistory(days) {
    const rows = filterCurrentSave(getRows(FILES.balance));
    if (!rows.length) return [];

    const maxDay = maxGameDay(rows);
    const minDay = maxDay - (parseInt(days) || 30);

    return dedupeLast(rows.filter(r => r.game_day >= minDay), r => r.game_day)
        .sort((a, b) => a.game_day - b.game_day);
}

// Most-recent saved balance whose game_day is strictly before `currentDay`.
// Returns null if there isn't one yet (first session day).
function getBalanceBefore(currentDay) {
    const rows = filterCurrentSave(getRows(FILES.balance));
    let best = null;
    for (const r of rows) {
        if (r.game_day < currentDay && (!best || r.game_day > best.game_day)) {
            best = r;
        }
    }
    return best;
}

function getAvailableFillTypes() {
    const seen = new Set();
    for (const r of filterCurrentSave(getRows(FILES.prices))) seen.add(r.fill_type);
    return [...seen].sort().map(fill_type => ({ fill_type }));
}

function getAvailableSellPoints() {
    const seen = new Set();
    for (const r of filterCurrentSave(getRows(FILES.prices))) seen.add(r.sell_point);
    return [...seen].sort().map(sell_point => ({ sell_point }));
}

// ─── Test-only history seeding ─────────────────────────────────────────────────
// Used by the DASHBOARD_MOCK=1 server's POST /mock/seed-history (+ the
// /mock/balance-rows, /mock/price-rows aliases) so smoke tests can inject a
// known balance/price history without a running game. Rewrites the JSONL
// files with exactly the supplied rows (last-wins semantics on re-seed) and
// resets the dedup/seen state so a fresh seed isn't blocked by an earlier one.
//
// Each balance row needs { game_day, balance }; each price row needs
// { game_day, sell_point, fill_type, price_ton }. Missing fields are filled
// with neutral defaults so callers can pass the minimal shape.
function seedHistory({ balance, prices, freezeDay } = {}) {
    const now = new Date().toISOString();

    if (Array.isArray(balance)) {
        const rows = balance.map(r => ({
            recorded_at: r.recorded_at || now,
            save_id:     r.save_id != null ? r.save_id : '',
            game_day:    r.game_day,
            balance:     r.balance,
        }));
        writeJsonl(FILES.balance, rows);
        // Suppress the live watcher from re-appending the current game-day's
        // balance row (which would clobber a seeded row for that same day).
        // freezeDay = the live payload's current gameDay; setting it as
        // lastSavedDay makes saveSnapshot skip the daily append.
        lastSavedDay = freezeDay != null
            ? freezeDay
            : (rows.length ? rows[rows.length - 1].game_day : -1);
    }

    if (Array.isArray(prices)) {
        // Distinct rows must keep distinct game_days — getPriceHistory dedupes
        // on `game_day|fill_type|sell_point`, so two rows for the same
        // commodity/point with no game_day would collapse into one. When a
        // caller omits game_day, derive it from per-(point,fill) sequence.
        const seq = {};
        const rows = prices.map(r => {
            let gd = r.game_day;
            if (gd == null) {
                const k = `${r.sell_point}|${r.fill_type}`;
                seq[k] = (seq[k] || 0) + 1;
                gd = seq[k];
            }
            return {
                recorded_at: r.recorded_at || r.ts || now,
                save_id:     r.save_id != null ? r.save_id : '',
                game_day:    gd,
                sell_point:  r.sell_point,
                fill_type:   r.fill_type,
                price_ton:   r.price_ton != null ? r.price_ton : r.price_per_ton,
            };
        });
        writeJsonl(FILES.prices, rows);
    }

    return {
        balance: Array.isArray(balance) ? balance.length : 0,
        prices:  Array.isArray(prices)  ? prices.length  : 0,
    };
}

module.exports = {
    saveSnapshot,
    seedHistory,
    getPriceHistory,
    getBalanceHistory,
    getBalanceBefore,
    getAvailableFillTypes,
    getAvailableSellPoints,
    getFieldProfit,
    getRecentEvents,
};
