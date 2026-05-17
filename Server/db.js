// JSONL-based history store. No native deps.
// Files: data/balance.jsonl, data/prices.jsonl, data/fields.jsonl
// One JSON object per line. Append-only. Read into memory for queries.

const fs   = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
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

function appendJsonl(filePath, obj) {
    fs.appendFileSync(filePath, JSON.stringify(obj) + '\n');
}

// ─── State ────────────────────────────────────────────────────────────────────

// Track last saved game_day to avoid duplicate rows. Initialise from disk so
// a server restart on the same game-day doesn't append duplicates.
let lastSavedDay = (() => {
    const rows = readJsonl(FILES.balance);
    return rows.length ? rows[rows.length - 1].game_day : -1;
})();

// Track seen event keys (timestamp+fieldId+type) so we don't insert duplicates
// when the mod re-includes the same recent event in subsequent ticks.
const seenEventKeys = new Set();
(function loadSeenEvents() {
    for (const e of readJsonl(FILES.events)) {
        seenEventKeys.add(`${e.timestamp}|${e.field_id}|${e.type}`);
    }
})();

// ─── Public API ───────────────────────────────────────────────────────────────

function saveSnapshot(data) {
    const day = data.gameDay || 0;
    const now = new Date().toISOString();

    // Save events immediately, deduplicated (events fire any time, not per-day)
    saveEvents(data.events || [], data);

    // Save daily snapshots once per game day
    if (day === lastSavedDay) return;
    lastSavedDay = day;

    try {
        if (data.farmBalance != null) {
            appendJsonl(FILES.balance, { recorded_at: now, game_day: day, balance: data.farmBalance });
        }

        for (const sp of (data.prices || [])) {
            for (const item of (sp.items || [])) {
                appendJsonl(FILES.prices, {
                    recorded_at: now,
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
                    game_day:       day,
                    field_id:       f.id,
                    fruit_name:     f.fruitName || '',
                    growth_percent: f.growthPercent || 0,
                    is_ready:       f.isReadyToHarvest ? 1 : 0,
                });
            }
        }
    } catch (e) {
        console.error('[DB] Save error:', e.message);
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
    const events = readJsonl(FILES.events);
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
    const events = readJsonl(FILES.events);
    return events.slice(-1 * (parseInt(limit) || 50)).reverse();
}

function getPriceHistory(fillType, sellPoint, days) {
    const rows = readJsonl(FILES.prices);
    if (!rows.length) return [];

    const maxDay = Math.max(...rows.map(r => r.game_day));
    const minDay = days ? maxDay - parseInt(days) : 0;

    return rows.filter(r => {
        if (r.game_day < minDay) return false;
        if (fillType  && r.fill_type  !== fillType)  return false;
        if (sellPoint && r.sell_point !== sellPoint) return false;
        return true;
    }).sort((a, b) => a.game_day - b.game_day);
}

function getBalanceHistory(days) {
    const rows = readJsonl(FILES.balance);
    if (!rows.length) return [];

    const maxDay = Math.max(...rows.map(r => r.game_day));
    const minDay = maxDay - (parseInt(days) || 30);

    return rows.filter(r => r.game_day >= minDay)
               .sort((a, b) => a.game_day - b.game_day);
}

// Most-recent saved balance whose game_day is strictly before `currentDay`.
// Returns null if there isn't one yet (first session day).
function getBalanceBefore(currentDay) {
    const rows = readJsonl(FILES.balance);
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
    for (const r of readJsonl(FILES.prices)) seen.add(r.fill_type);
    return [...seen].sort().map(fill_type => ({ fill_type }));
}

function getAvailableSellPoints() {
    const seen = new Set();
    for (const r of readJsonl(FILES.prices)) seen.add(r.sell_point);
    return [...seen].sort().map(sell_point => ({ sell_point }));
}

module.exports = {
    saveSnapshot,
    getPriceHistory,
    getBalanceHistory,
    getBalanceBefore,
    getAvailableFillTypes,
    getAvailableSellPoints,
    getFieldProfit,
    getRecentEvents,
};
