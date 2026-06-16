#!/usr/bin/env node
// Generates realistic mock dashboard_data.json every 5s (simulates the FS25 mod).
// Use to test server + frontend WITHOUT running FS25.
//
// Usage:
//   npm run mock                              → default random scenario
//   node mock-data.js --scenario=harvest-ready
//   node mock-data.js --scenario=low-fuel /path/to/output.json
//
// Runtime scenario switching (no restart):
//   Write the scenario name to  <DATA_DIR>/mock-scenario.txt
//   The process polls that file every ~1 s and switches on change.
//   Server's  POST /mock/scenario  writes to the same file.
//
// Available scenarios:  default | empty-farm | harvest-ready | low-fuel |
//   animal-needs | wagon-filling | plan-3-years | withered-crops |
//   multi-fruit-types | mixed-ai-tasks

const fs   = require('fs');
const path = require('path');
const config = require('../config');
const { getScenario, listScenarios } = require('./mock-scenarios');

// ─── CLI argument parsing ─────────────────────────────────────────────────────
// Accepts an optional positional output path AND --scenario=<name> flag.
// argv[2] could be either the output path or a --scenario flag; handle both.

let OUTPUT        = config.DATA_FILE;
let initialScenario = 'default';

for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--scenario=')) {
        initialScenario = arg.slice('--scenario='.length).trim();
    } else if (!arg.startsWith('--')) {
        OUTPUT = arg;
    }
}

// Validate scenario name early
if (!listScenarios().includes(initialScenario)) {
    console.error(`[mock] Unknown scenario "${initialScenario}". Available: ${listScenarios().join(', ')}`);
    process.exit(1);
}

// ─── Scenario switch file ────────────────────────────────────────────────────
// The server's POST /mock/scenario writes the name here.  We poll every 1 s.
const SCENARIO_FILE = path.join(path.dirname(OUTPUT), 'mock-scenario.txt');

const ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const rf = (a, b) => Math.random() * (b - a) + a;
const pct = (n) => Math.round(n * 10) / 10;

const FRUITS = [
    { id: 'WHEAT',      name: 'Pšenice' },
    { id: 'BARLEY',     name: 'Ječmen' },
    { id: 'CANOLA',     name: 'Řepka' },
    { id: 'MAIZE',      name: 'Kukuřice' },
    { id: 'SUNFLOWER',  name: 'Slunečnice' },
    { id: 'SOYBEAN',    name: 'Sójové boby' },
    { id: 'SUGARBEET',  name: 'Cukrová řepa' },
    { id: 'POTATO',     name: 'Brambory' },
    { id: 'GRASS',      name: 'Tráva' },
];

const SELL_POINTS = ['Getreidelager Bergmann', 'BGA Bergmann', 'Sägewerk', 'Mühle Bergmann'];

// Stable vehicle list (doesn't change per tick)
const VEHICLES = [
    { name: 'Fendt 942 Vario',     typeName: 'Traktor',    fuelCap: 400,  adblueCap: 55  },
    { name: 'Fendt 516 Vario',     typeName: 'Traktor',    fuelCap: 200,  adblueCap: null },
    { name: 'CLAAS LEXION 8900',   typeName: 'Kombajn',    fuelCap: 630,  adblueCap: 65  },
    { name: 'Fendt 1100 MT',       typeName: 'Traktor',    fuelCap: 650,  adblueCap: 70  },
    { name: 'HORSCH Leeb 15 PT',   typeName: 'Postřikovač', fuelCap: 160, adblueCap: null },
    { name: 'Deutz-Fahr 5125',     typeName: 'Traktor',    fuelCap: 160,  adblueCap: null },
];

// Stable field list
const FIELDS = Array.from({ length: 22 }, (_, i) => {
    const fruitIdx = ri(0, FRUITS.length - 1);
    const hasCrop  = Math.random() > 0.15;
    return {
        id:          i + 1,
        area:        pct(rf(0.5, 9.0)),
        owned:       Math.random() > 0.25,
        fruitIdx:    hasCrop ? fruitIdx : -1,
        maxGrowth:   6,
        _growthState: hasCrop ? ri(0, 6) : 0,
        // Field condition (slowly degrade over harvests)
        _plowed:     true,
        _limed:      Math.random() > 0.3,
        _fertilized: ri(0, 2),
        _weed:       ri(0, 1),
        _stones:     ri(0, 1),
    };
});

// Sliding window of recent events (mock simulates them)
const recentEvents = [];

function addEvent(ev) {
    recentEvents.push({
        ...ev,
        gameDay,
        timestamp: new Date().toISOString(),
    });
    while (recentEvents.length > 50) recentEvents.shift();
}

// Slowly advance field growth each tick
let growthTick = 0;

function buildFieldData(f) {
    const gs  = f._growthState;
    const mgs = f.maxGrowth;
    const hStart = mgs - 1;
    const hasCrop = f.fruitIdx >= 0;

    return {
        id:               f.id,
        area:             f.area,
        owned:            f.owned,
        fruitTypeId:      hasCrop ? FRUITS[f.fruitIdx].id : '',
        fruitName:        hasCrop ? FRUITS[f.fruitIdx].name : '',
        growthState:      gs,
        maxGrowthState:   mgs,
        growthPercent:    hasCrop ? Math.min(100, Math.floor(gs / hStart * 100)) : 0,
        isReadyToHarvest: hasCrop && gs >= hStart,
        needsSowing:      !hasCrop && f.owned,
        daysToHarvest:    hasCrop && gs < hStart ? hStart - gs : 0,
        // Condition details
        needsPlowing:       !f._plowed,
        needsCultivating:   false,
        needsLime:          !f._limed,
        fertilizationLevel: f._fertilized,
        weedLevel:          f._weed,
        stoneLevel:         f._stones,
    };
}

let gameDay  = 42;
let balance  = 250000;
let vehicleFuel = VEHICLES.map(v => ({
    fuel:   rf(0.2, 1.0),
    adblue: v.adblueCap != null ? rf(0.3, 1.0) : null,
    hours:  rf(10, 800),
    inUse:  false,
}));
let animalFood = {
    cow: rf(0.3, 1.0), pig: rf(0.2, 1.0),
    sheep: rf(0.4, 1.0), chicken: rf(0.3, 1.0),
};
// Stateful animal counts — drift ±1 occasionally to trigger flash testing
let animalCounts = { cow: 14, pig: 24, sheep: 10, chicken: 40 };
// Stateful production items — drift each tick to trigger flash testing
let productionState = [
    { name: 'Pekárna',     cap: 20000, items: { 'Mouka': 5200, 'Voda': 8500, 'Chléb': 1100 },
      recipes: [{ name: 'Chléb', in: { 'Mouka': 200, 'Voda': 100 }, out: { 'Chléb': 150 }, cost: 12 }] },
    { name: 'Pila',        cap: 30000, items: { 'Klády': 14800, 'Řezivo': 2300 },
      recipes: [{ name: 'Řezivo', in: { 'Klády': 500 }, out: { 'Řezivo': 400 }, cost: 8 }] },
    { name: 'Krmivárna',   cap: 25000, items: { 'Pšenice': 8200, 'Ječmen': 6100, 'Krmivo': 1600 },
      recipes: [{ name: 'Krmivo', in: { 'Pšenice': 150, 'Ječmen': 150 }, out: { 'Krmivo': 280 }, cost: 6 }] },
    { name: 'Řeznictví',   cap: 18000, items: { 'Vepř': 320, 'Hovězí': 145, 'Maso': 820 },
      recipes: [{ name: 'Maso', in: { 'Vepř': 40, 'Hovězí': 30 }, out: { 'Maso': 60 }, cost: 18 }] },
    { name: 'Mlékárna',    cap: 22000, items: { 'Mléko': 9400, 'Máslo': 720, 'Sýr': 410 },
      recipes: [{ name: 'Máslo', in: { 'Mléko': 200 }, out: { 'Máslo': 90 }, cost: 9 },
                { name: 'Sýr',   in: { 'Mléko': 300 }, out: { 'Sýr': 110 }, cost: 14 }] },
    { name: 'Olejárna',    cap: 24000, items: { 'Slunečnice': 6300, 'Řepka': 4100, 'Olej': 1850 },
      recipes: [{ name: 'Olej (slun.)', in: { 'Slunečnice': 180 }, out: { 'Olej': 120 }, cost: 10 },
                { name: 'Olej (řepka)', in: { 'Řepka': 180 },      out: { 'Olej': 130 }, cost: 11 }] },
    { name: 'Větrný mlýn', cap: 16000, items: { 'Pšenice': 3800, 'Mouka': 1200 },
      recipes: [{ name: 'Mouka', in: { 'Pšenice': 250 }, out: { 'Mouka': 200 }, cost: 5 }] },
];

function generateData() {
    growthTick++;
    // Advance one game day every ~12 ticks (1 min real time)
    if (growthTick % 12 === 0) {
        gameDay++;
        balance += ri(-5000, 15000);
        // Grow all fields by 1 stage; randomly harvest ready ones; randomly sow empty ones
        for (const f of FIELDS) {
            if (!f.owned) continue;

            // Harvest ready fields (50 % chance per day)
            if (f.fruitIdx >= 0 && f._growthState >= f.maxGrowth - 1 && Math.random() > 0.5) {
                addEvent({
                    type: 'harvest',
                    fieldId: f.id,
                    fruitName: FRUITS[f.fruitIdx].name,
                    fruitTypeId: FRUITS[f.fruitIdx].id,
                    area: f.area,
                    wasReady: true,
                    growthAtHarvest: 100,
                });
                f.fruitIdx = -1;
                f._growthState = 0;
                f._fertilized = Math.max(0, f._fertilized - 1);
                if (Math.random() > 0.7) f._plowed = false;
            }
            // Sow empty fields (30 % chance per day)
            else if (f.fruitIdx < 0 && Math.random() > 0.7) {
                f.fruitIdx = ri(0, FRUITS.length - 1);
                f._growthState = 0;
                f._plowed = true;
                f._fertilized = ri(1, 2);
                addEvent({
                    type: 'sowing',
                    fieldId: f.id,
                    fruitName: FRUITS[f.fruitIdx].name,
                    fruitTypeId: FRUITS[f.fruitIdx].id,
                    area: f.area,
                });
            }
            // Grow normally
            else if (f.fruitIdx >= 0 && f._growthState < f.maxGrowth) {
                f._growthState++;
            }
        }
    }

    // Slowly drain fuel
    vehicleFuel.forEach((v, i) => {
        v.fuel    = Math.max(0, v.fuel    - rf(0.001, 0.008));
        if (v.adblue != null) v.adblue = Math.max(0, v.adblue - rf(0.0005, 0.003));
        v.inUse   = Math.random() < 0.15;
    });
    Object.keys(animalFood).forEach(k => {
        animalFood[k] = Math.max(0, animalFood[k] - rf(0.005, 0.02));
    });
    // Animal counts — small drift (~15 % chance per tick per herd) to fire flashes
    Object.keys(animalCounts).forEach(k => {
        if (Math.random() < 0.15) {
            animalCounts[k] = Math.max(0, animalCounts[k] + (Math.random() < 0.5 ? -1 : 1));
        }
    });
    // Production items — drift each tick (small +- delta)
    for (const p of productionState) {
        for (const name of Object.keys(p.items)) {
            const delta = ri(-300, 800);
            p.items[name] = Math.max(0, Math.min(p.cap, p.items[name] + delta));
        }
    }

    const hour = Math.floor((Date.now() / 1000 / 60) % 24);

    return {
        exportedAt:  new Date().toISOString(),
        gameDay,
        gameTime:    `${hour}:${String(ri(0, 59)).padStart(2, '0')}`,
        weather: {
            typeId:      ri(0, 6),
            title:       ['Jasno', 'Slunečno', 'Polojasno', 'Oblačno', 'Déšť', 'Sněžení', 'Bouřka'][ri(0, 6)],
            temperature: ri(5, 32),
            temperatureMin: ri(0, 18),
            temperatureMax: ri(20, 35),
            forecast: [
                { day: gameDay + 1, daysAhead: 1, typeId: ri(0, 6), title: '', temperatureMin: ri(0, 18), temperatureMax: ri(20, 35) },
                { day: gameDay + 2, daysAhead: 2, typeId: ri(0, 6), title: '', temperatureMin: ri(0, 18), temperatureMax: ri(20, 35) },
                { day: gameDay + 3, daysAhead: 3, typeId: ri(0, 6), title: '', temperatureMin: ri(0, 18), temperatureMax: ri(20, 35) },
            ],
        },
        farmBalance: Math.max(0, balance),
        fields: FIELDS.map(buildFieldData),
        storage: [
            {
                storageName: 'Hlavní silo',
                items: [
                    { name: 'Pšenice',    amount: ri(0,  200000), capacity: 200000 },
                    { name: 'Ječmen',     amount: ri(0,  150000), capacity: 200000 },
                    { name: 'Řepka',      amount: ri(0,  100000), capacity: 200000 },
                    { name: 'Kukuřice',   amount: ri(0,  180000), capacity: 200000 },
                ].filter(i => i.amount > 0),
            },
            {
                storageName: 'Silo – Cukrovka',
                items: [{ name: 'Cukrová řepa', amount: ri(0, 50000), capacity: 80000 }]
                    .filter(i => i.amount > 0),
            },
        ],
        prices: SELL_POINTS.map(sp => ({
            sellPoint: sp,
            items: FRUITS.filter(() => Math.random() > 0.4).map(f => ({
                name: f.name, pricePerTon: ri(150, 850),
            })),
        })).filter(sp => sp.items.length > 0),
        // Seasonal price forecast — 12-month multiplier curve per fruit so the
        // history page's "Sezónní křivka" renders (and the click-to-watch
        // feature has bars to click). Deterministic per-fruit phase so the
        // curve is stable across ticks but differs between commodities.
        priceForecast: {
            currentPeriod: ((gameDay % 12) + 1),
            daysPerPeriod: 1,
            fillTypes: FRUITS.map((f, fi) => {
                const base = 400 + fi * 60;
                // 12-element, 0-indexed (matches the mod's JSON: index 0 = FS25
                // period 1 = March). Sine hump offset per fruit so each crop
                // peaks in a different month.
                const factors = [];
                for (let p = 0; p < 12; p++) {
                    const phase = (p + fi * 2) / 12 * Math.PI * 2;
                    factors.push(+(1 + 0.35 * Math.sin(phase)).toFixed(3));
                }
                return { name: f.name, fillType: f.id, pricePerTon: base, factors };
            }),
        },
        animals: [
            { husbandryName: 'Kravín',  type: 'COW',     count: animalCounts.cow,     foodPercent: Math.round(animalFood.cow * 100),     waterPercent: ri(40, 100), productivity: ri(70, 100) },
            { husbandryName: 'Vepřín',  type: 'PIG',     count: animalCounts.pig,     foodPercent: Math.round(animalFood.pig * 100),     waterPercent: ri(50, 100), productivity: ri(60, 100) },
            { husbandryName: 'Ovčín',   type: 'SHEEP',   count: animalCounts.sheep,   foodPercent: Math.round(animalFood.sheep * 100),   waterPercent: ri(30, 100), productivity: ri(75, 100), pallets: [
                { type: 'Vlna',       liters: ri(20, 1500), capacity: 2000, percent: ri(1, 95) },
                { type: 'Kozí mléko', liters: ri(0, 600),   capacity: 1500, percent: ri(0, 40) },
            ] },
            { husbandryName: 'Kurník',  type: 'CHICKEN', count: animalCounts.chicken, foodPercent: Math.round(animalFood.chicken * 100), waterPercent: ri(60, 100), productivity: ri(65, 100) },
        ],
        productions: productionState.map(p => ({
            name:  p.name,
            items: Object.entries(p.items).map(([name, amount]) => ({ name, amount, capacity: p.cap })),
            productions: (p.recipes || []).map((rec, idx) => {
                // First recipe runs; a later one may stall on missing input so
                // the status palette (active / noInput / outputFull) is exercised.
                const status = idx === 0 ? 'active' : (ri(0, 1) ? 'active' : 'noInput');
                const running = status === 'active';
                return {
                    name:          rec.name,
                    status,
                    cyclesPerHour: running ? ri(10, 80) : 0,
                    costsPerHour:  running ? rec.cost : 0,
                    inputs:  Object.entries(rec.in).map(([name, amount])  => ({ name, amount })),
                    outputs: Object.entries(rec.out).map(([name, amount]) => ({ name, amount })),
                };
            }),
        })),
        vehicles: VEHICLES.map((v, i) => {
            const s = vehicleFuel[i];
            const entry = {
                name:         v.name,
                typeName:     v.typeName,
                isInUse:      s.inUse,
                motorHours:   Math.round(s.hours * 10) / 10,
                fuelPercent:  Math.round(s.fuel * 100),
                fuelLiters:   Math.round(s.fuel * v.fuelCap),
                fuelCapacity: v.fuelCap,
                // Condition (deterministic-ish per vehicle so it's stable) + speed
                // (only the in-use ones are moving). Surfaces the condition/speed UI.
                conditionPercent: [100, 95, 88, 72, 46, 99][i % 6],
                speedKmh:         s.inUse ? ri(6, 22) : 0,
            };
            if (v.adblueCap != null) {
                entry.adBluePercent  = Math.round(s.adblue * 100);
                entry.adBlueLiters   = Math.round(s.adblue * v.adblueCap);
                entry.adBlueCapacity = v.adblueCap;
            }
            // First tractor pulls a grain trailer so the implement fill row +
            // flash-on-change behaviour is visible in the default mock.
            if (i === 0) {
                const cap = 24000;
                const pct = 20 + (Math.floor(Date.now() / 5000) % 8) * 10;  // steps each tick
                entry.implements = [
                    { name: 'Krampe Bandit', fillUnits: [
                        { fillType: 'WHEAT', typeTitle: 'Pšenice',
                          levelL: Math.round(cap * pct / 100), capacityL: cap, percent: pct },
                    ] },
                ];
            }
            return entry;
        }),
        events: recentEvents,
    };
}

// ─── Active scenario state ────────────────────────────────────────────────────
let activeScenario  = initialScenario;
let scenarioTick    = 0;           // increments only for the active scenario
let lastScenarioMod = 0;           // mtime of SCENARIO_FILE when we last read it

function readScenarioFile() {
    try {
        const stat = fs.statSync(SCENARIO_FILE);
        if (stat.mtimeMs === lastScenarioMod) return;   // unchanged
        lastScenarioMod = stat.mtimeMs;
        const name = fs.readFileSync(SCENARIO_FILE, 'utf8').trim();
        if (name && listScenarios().includes(name) && name !== activeScenario) {
            activeScenario = name;
            scenarioTick   = 0;
            console.log(`\n[mock] Switched to scenario: ${activeScenario}`);
            // Write immediately so the server picks up the new scenario without
            // waiting up to 5 s for the next scheduled tick.
            tick();
        }
    } catch (_) { /* file may not exist yet */ }
}

// Write immediately, then every 5s
function tick() {
    readScenarioFile();

    let data;
    if (activeScenario === 'default') {
        data = generateData();
    } else {
        const payload = getScenario(activeScenario, scenarioTick);
        if (payload === null) {
            data = generateData();       // scenario returned null → use default
        } else {
            data = payload;
        }
        scenarioTick++;
    }

    fs.writeFileSync(OUTPUT, JSON.stringify(data));
    const fuelPct = data.vehicles && data.vehicles[0] ? data.vehicles[0].fuelPercent + '%' : 'n/a';
    process.stdout.write(`\r[mock] scenario=${activeScenario} | Day ${data.gameDay} | ${new Date().toLocaleTimeString('cs-CZ')} | fuel[0]=${fuelPct}    `);
}

// Ensure output directory exists
const outDir = path.dirname(OUTPUT);
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

tick();
const interval = setInterval(tick, 5000);
// Poll scenario file every 1 s (lightweight, no chokidar dependency here)
const scenarioPoll = setInterval(readScenarioFile, 1000);

console.log('\n[mock] Writing to:', OUTPUT);
console.log(`[mock] Active scenario: ${activeScenario}`);
console.log('[mock] Ctrl+C to stop.\n');
console.log('[mock] To switch scenario at runtime:');
console.log(`[mock]   Write name to ${SCENARIO_FILE}`);
console.log('[mock]   Or POST { "scenario": "<name>" } to /mock/scenario\n');

process.on('SIGINT', () => {
    clearInterval(interval);
    clearInterval(scenarioPoll);
    console.log('\n[mock] Stopped.');
    process.exit(0);
});
