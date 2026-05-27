// mock-scenarios.js — Named scenario library for the FS25 Dashboard mock server.
//
// Each export is a function  (tick) => payload  where tick is the number of
// 5-second intervals that have elapsed since the scenario was activated (starts
// at 0).  Only "wagon-filling" actually uses the tick parameter for progressive
// fill; all others return a static (but fully-shaped) payload.
//
// Schema must match what index.js enrich() + frontend expect:
//   exportedAt, gameDay, gameTime, gameYear, gameMonth, dayInMonth, daysPerMonth,
//   weather, farmBalance, fields[], vehicles[], animals[], storage[], productions[],
//   prices[], events[], availableFruits[]

'use strict';

// ─── Shared helpers ────────────────────────────────────────────────────────────

const ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const rf = (a, b)  => Math.random() * (b - a) + a;

function now() { return new Date().toISOString(); }

function baseWeather(overrides) {
    return Object.assign({
        typeId:         0,
        title:          'Jasno',
        temperature:    18,
        temperatureMin: 8,
        temperatureMax: 26,
        forecast: [
            { day: 43, daysAhead: 1, typeId: 0, title: 'Jasno',   temperatureMin: 9,  temperatureMax: 24 },
            { day: 44, daysAhead: 2, typeId: 3, title: 'Oblačno', temperatureMin: 6,  temperatureMax: 19 },
            { day: 45, daysAhead: 3, typeId: 4, title: 'Déšť',    temperatureMin: 5,  temperatureMax: 14 },
        ],
    }, overrides);
}

// Minimal available-fruits catalog (schema compatible with calendar.html)
const AVAIL_FRUITS = [
    { id: 'WHEAT',     name: 'Pšenice',      index: 0,
      plantableMonths:   [false,false,false,false,false,false,false,true,true,false,false,false],
      harvestableMonths: [false,false,false,false,true,true,false,false,false,false,false,false],
      growthTimeMonths: 9 },
    { id: 'BARLEY',    name: 'Ječmen',       index: 1,
      plantableMonths:   [false,false,false,false,false,false,false,true,true,false,false,false],
      harvestableMonths: [false,false,false,false,true,true,false,false,false,false,false,false],
      growthTimeMonths: 9 },
    { id: 'CANOLA',    name: 'Řepka',        index: 2,
      plantableMonths:   [false,false,false,false,false,false,false,true,true,false,false,false],
      harvestableMonths: [false,false,false,false,false,false,true,false,false,false,false,false],
      growthTimeMonths: 11 },
    { id: 'MAIZE',     name: 'Kukuřice',     index: 3,
      plantableMonths:   [false,false,false,false,true,true,false,false,false,false,false,false],
      harvestableMonths: [false,false,false,false,false,false,false,false,true,true,false,false],
      growthTimeMonths: 4 },
    { id: 'SUNFLOWER', name: 'Slunečnice',   index: 4,
      plantableMonths:   [false,false,false,false,true,true,false,false,false,false,false,false],
      harvestableMonths: [false,false,false,false,false,false,false,false,true,false,false,false],
      growthTimeMonths: 4 },
    { id: 'SOYBEAN',   name: 'Sójové boby',  index: 5,
      plantableMonths:   [false,false,false,false,true,true,false,false,false,false,false,false],
      harvestableMonths: [false,false,false,false,false,false,false,false,true,false,false,false],
      growthTimeMonths: 4 },
    { id: 'GRASS',     name: 'Tráva',        index: 6,
      plantableMonths:   [true,true,true,true,true,true,true,true,true,true,true,true],
      harvestableMonths: [false,false,false,true,true,true,true,true,true,false,false,false],
      growthTimeMonths: 1 },
];

function basePrices() {
    return [
        {
            sellPoint: 'Getreidelager Bergmann',
            items: [
                { name: 'Pšenice',  pricePerTon: 240 },
                { name: 'Ječmen',   pricePerTon: 210 },
                { name: 'Řepka',    pricePerTon: 480 },
                { name: 'Kukuřice', pricePerTon: 195 },
            ],
        },
        {
            sellPoint: 'BGA Bergmann',
            items: [
                { name: 'Kukuřice', pricePerTon: 230 },
                { name: 'Tráva',    pricePerTon: 180 },
            ],
        },
    ];
}

// Seasonal price forecast — 12-month multiplier curve per fruit so the
// history page's "Sezónní křivka" renders under any scenario (and the
// click-to-watch feature has bars to interact with). Each fruit peaks in a
// different month via a phase-shifted sine. factors are 0-indexed (index 0 =
// FS25 period 1 = March), matching the real mod's JSON shape.
function basePriceForecast(gameMonth) {
    return {
        currentPeriod: gameMonth || 1,
        daysPerPeriod: 1,
        fillTypes: AVAIL_FRUITS.map((f, fi) => {
            const base = 400 + fi * 60;
            const factors = [];
            for (let p = 0; p < 12; p++) {
                const phase = (p + fi * 2) / 12 * Math.PI * 2;
                factors.push(+(1 + 0.35 * Math.sin(phase)).toFixed(3));
            }
            return { name: f.name, fillType: f.id, pricePerTon: base, factors };
        }),
    };
}

function baseProductions() {
    return [
        {
            name: 'Pekárna',
            items: [
                { name: 'Mouka', amount: 5200, capacity: 20000 },
                { name: 'Voda',  amount: 8500, capacity: 20000 },
                { name: 'Chléb', amount: 1100, capacity: 20000 },
            ],
            productions: [{ name: 'Recept #1', status: 'active', cyclesPerHour: 40 }],
        },
        {
            name: 'Pila',
            items: [
                { name: 'Klády',   amount: 14800, capacity: 30000 },
                { name: 'Řezivo',  amount:  2300, capacity: 30000 },
            ],
            productions: [{ name: 'Recept #1', status: 'active', cyclesPerHour: 25 }],
        },
    ];
}

// ─── Scenario implementations ─────────────────────────────────────────────────

/**
 * vehicles-rich — exercises the vehicle row extras (backlog 2026-05 body 1/2/4):
 *  - a tractor with an ATTACHED TRAILER whose fill % CHANGES every tick
 *    (drives the "flash on fill change" — body 1)
 *  - an EMPTY trailer at 0 % that must still be visible (body 2)
 *  - mixed conditionPercent incl. a low one + speeds (body 4)
 * tick-varying fill so consecutive WS payloads differ.
 */
function scenarioVehiclesRich(tick) {
    const t = tick || 0;
    const trailerPct = 20 + (t % 8) * 10;          // 20,30,…,90,20… — always changing
    const trailerCap = 24000;
    const trailerLvl = Math.round(trailerCap * trailerPct / 100);
    return {
        exportedAt:   now(),
        gameDay:      48, gameTime: '11:20',
        gameYear:     3, gameMonth: 5, dayInMonth: 8, daysPerMonth: 1,
        weather:      baseWeather({}),
        farmBalance:  512000,
        fields:       [],
        vehicles: [
            {
                name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: true,
                motorHours: 345, fuelPercent: 72, fuelLiters: 288, fuelCapacity: 400,
                conditionPercent: 92, speedKmh: 14,
                implements: [
                    { name: 'Krampe Bandit', fillUnits: [
                        { fillType: 'WHEAT', typeTitle: 'Pšenice', levelL: trailerLvl, capacityL: trailerCap, percent: trailerPct },
                    ] },
                ],
            },
            {
                name: 'Fendt 516 Vario', typeName: 'Traktor', isInUse: false,
                motorHours: 112, fuelPercent: 60, fuelLiters: 120, fuelCapacity: 200,
                conditionPercent: 45, speedKmh: 0,           // low condition, parked
                implements: [
                    { name: 'Prázdná vlečka', fillUnits: [
                        { fillType: 'EMPTY', typeTitle: '', levelL: 0, capacityL: 18000, percent: 0 },
                    ] },
                ],
            },
            {
                name: 'CLAAS LEXION 8900', typeName: 'Kombajn', isInUse: true,
                motorHours: 430, fuelPercent: 88, fuelLiters: 554, fuelCapacity: 630,
                conditionPercent: 67, speedKmh: 8,
                implements: [],
            },
        ],
        animals: [],
        storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  baseProductions(),
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * productions-many — 4 výrobny (backlog 2026-05 body 3). Ověřuje, že frontend
 * vykreslí všechny, ne jen jednu.
 */
function scenarioProductionsMany(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 1,
        weather:      baseWeather({}),
        farmBalance:  734000,
        fields:       [],
        vehicles:     [],
        animals:      [],
        storage:      [],
        productions: [
            { name: 'Mlékárna', items: [
                { name: 'Mléko', amount: 9000, capacity: 50000 },
                { name: 'Máslo', amount: 1200, capacity: 20000 },
                { name: 'Sýr',   amount:  800, capacity: 20000 },
            ], productions: [{ name: 'Máslo', status: 'active', cyclesPerHour: 30 },
                             { name: 'Sýr',   status: 'active', cyclesPerHour: 12 }] },
            { name: 'Pekárna', items: [
                { name: 'Mouka', amount: 5200, capacity: 20000 },
                { name: 'Chléb', amount: 1100, capacity: 20000 },
            ], productions: [{ name: 'Chléb', status: 'active', cyclesPerHour: 40 }] },
            { name: 'Pila', items: [
                { name: 'Klády',  amount: 14800, capacity: 30000 },
                { name: 'Řezivo', amount:  2300, capacity: 30000 },
            ], productions: [{ name: 'Řezivo', status: 'noInput', cyclesPerHour: 25 }] },
            { name: 'BGA Bergmann', items: [
                { name: 'Siláž',     amount: 60000, capacity: 100000 },
                { name: 'Digestát',  amount: 12000, capacity: 50000 },
            ], productions: [{ name: 'Elektřina', status: 'active', cyclesPerHour: 100 }] },
        ],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * default — same random behavior as the original mock-data.js.
 * This is a thin re-export; mock-data.js uses its own generateData()
 * when the active scenario is 'default'.  We include it here only so
 * setScenario() can validate the name without a special case.
 */
function scenarioDefault(tick) {
    // Intentionally returns null — mock-data.js falls through to its own
    // generateData() when the scenario module returns null.
    return null;
}

/**
 * empty-farm — no fields, vehicles, animals, storage or prices.
 * Tests empty-state placeholders in every section.
 */
function scenarioEmptyFarm(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      1,
        gameTime:     '08:00',
        gameYear:     1,
        gameMonth:    1,
        dayInMonth:   1,
        daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  0,
        fields:       [],
        vehicles:     [],
        animals:      [],
        storage:      [],
        productions:  [],
        prices:       [],
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * harvest-ready — all 5 owned fields are at maxGrowth (ready to harvest).
 * Tests harvest-ready highlighting, bell "ready to harvest" notifications.
 */
function scenarioHarvestReady(_tick) {
    const fields = [
        { id: 1, area: 3.2, owned: true,  fruitTypeId: 'WHEAT',     fruitName: 'Pšenice',  growthState: 5, maxGrowthState: 6, growthPercent: 100, isReadyToHarvest: true,  needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 1, weedLevel: 0, stoneLevel: 0 },
        { id: 2, area: 4.7, owned: true,  fruitTypeId: 'BARLEY',    fruitName: 'Ječmen',   growthState: 5, maxGrowthState: 6, growthPercent: 100, isReadyToHarvest: true,  needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 2, weedLevel: 0, stoneLevel: 0 },
        { id: 3, area: 2.1, owned: true,  fruitTypeId: 'CANOLA',    fruitName: 'Řepka',    growthState: 5, maxGrowthState: 6, growthPercent: 100, isReadyToHarvest: true,  needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: true,  fertilizationLevel: 1, weedLevel: 1, stoneLevel: 0 },
        { id: 4, area: 6.0, owned: true,  fruitTypeId: 'MAIZE',     fruitName: 'Kukuřice', growthState: 5, maxGrowthState: 6, growthPercent: 100, isReadyToHarvest: true,  needsSowing: false, daysToHarvest: 0, needsPlowing: true,  needsCultivating: false, needsLime: false, fertilizationLevel: 0, weedLevel: 0, stoneLevel: 1 },
        { id: 5, area: 1.5, owned: true,  fruitTypeId: 'SUNFLOWER', fruitName: 'Slunečnice',growthState: 5, maxGrowthState: 6, growthPercent: 100, isReadyToHarvest: true,  needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 2, weedLevel: 0, stoneLevel: 0 },
        { id: 6, area: 2.8, owned: false, fruitTypeId: 'WHEAT',     fruitName: 'Pšenice',  growthState: 3, maxGrowthState: 6, growthPercent: 60,  isReadyToHarvest: false, needsSowing: false, daysToHarvest: 2, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 1, weedLevel: 0, stoneLevel: 0 },
    ];
    return {
        exportedAt:   now(),
        gameDay:      42,
        gameTime:     '09:00',
        gameYear:     3,
        gameMonth:    5,
        dayInMonth:   2,
        daysPerMonth: 10,
        weather:      baseWeather({ typeId: 0, title: 'Jasno', temperature: 22 }),
        farmBalance:  340000,
        fields,
        vehicles: [
            { name: 'CLAAS LEXION 8900', typeName: 'Kombajn', isInUse: false, motorHours: 412.5, fuelPercent: 78, fuelLiters: 491, fuelCapacity: 630, adBluePercent: 65, adBlueLiters: 42, adBlueCapacity: 65 },
            { name: 'Fendt 942 Vario',   typeName: 'Traktor',  isInUse: false, motorHours: 234.0, fuelPercent: 91, fuelLiters: 364, fuelCapacity: 400 },
        ],
        animals: [
            { husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 72, waterPercent: 80, productivity: 88 },
        ],
        storage: [
            { storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] },
        ],
        productions:  baseProductions(),
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * low-fuel — first vehicle has fuelPercent ≤ 10, second has adblue ≤ 5.
 * Tests bell low-fuel notifications + red fuel bar flash.
 */
function scenarioLowFuel(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      50,
        gameTime:     '14:30',
        gameYear:     2,
        gameMonth:    3,
        dayInMonth:   5,
        daysPerMonth: 10,
        weather:      baseWeather({ typeId: 3, title: 'Oblačno', temperature: 12 }),
        farmBalance:  189000,
        fields: [
            { id: 1, area: 3.2, owned: true, fruitTypeId: 'WHEAT', fruitName: 'Pšenice', growthState: 2, maxGrowthState: 6, growthPercent: 40, isReadyToHarvest: false, needsSowing: false, daysToHarvest: 3, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 2, weedLevel: 0, stoneLevel: 0 },
        ],
        vehicles: [
            { name: 'Fendt 942 Vario',   typeName: 'Traktor',    isInUse: true,  motorHours: 621.3, fuelPercent:  8, fuelLiters:   32, fuelCapacity: 400, adBluePercent:  4, adBlueLiters:   2, adBlueCapacity: 55 },
            { name: 'Fendt 516 Vario',   typeName: 'Traktor',    isInUse: false, motorHours: 142.0, fuelPercent: 62, fuelLiters:  124, fuelCapacity: 200 },
            { name: 'CLAAS LEXION 8900', typeName: 'Kombajn',    isInUse: false, motorHours: 411.0, fuelPercent: 35, fuelLiters:  220, fuelCapacity: 630 },
            { name: 'Fendt 1100 MT',     typeName: 'Traktor',    isInUse: true,  motorHours: 288.5, fuelPercent:  6, fuelLiters:   39, fuelCapacity: 650, adBluePercent:  3, adBlueLiters:   2, adBlueCapacity: 70 },
        ],
        animals: [
            { husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 55, waterPercent: 70, productivity: 85 },
        ],
        storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Ječmen', amount: 12000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * animal-needs — husbandry with foodPercent ≤ 15 and waterPercent ≤ 10.
 * Tests bell animal-low-food notification + orange/red highlighting in animals section.
 */
function scenarioAnimalNeeds(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      28,
        gameTime:     '07:00',
        gameYear:     1,
        gameMonth:    2,
        dayInMonth:   8,
        daysPerMonth: 10,
        weather:      baseWeather({ typeId: 1, title: 'Slunečno', temperature: 9 }),
        farmBalance:  95000,
        fields: [
            { id: 1, area: 2.0, owned: true, fruitTypeId: '', fruitName: '', growthState: 0, maxGrowthState: 6, growthPercent: 0, isReadyToHarvest: false, needsSowing: true, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 0, weedLevel: 0, stoneLevel: 0 },
        ],
        vehicles: [
            { name: 'Fendt 516 Vario', typeName: 'Traktor', isInUse: false, motorHours: 38.0, fuelPercent: 88, fuelLiters: 176, fuelCapacity: 200 },
        ],
        animals: [
            { husbandryName: 'Kravín',  type: 'COW',     count: 14, foodPercent: 12, waterPercent:  8, productivity: 45 },
            { husbandryName: 'Vepřín',  type: 'PIG',     count: 24, foodPercent:  8, waterPercent: 15, productivity: 38 },
            { husbandryName: 'Ovčín',   type: 'SHEEP',   count: 10, foodPercent: 65, waterPercent: 72, productivity: 82 },
            { husbandryName: 'Kurník',  type: 'CHICKEN', count: 40, foodPercent: 90, waterPercent: 88, productivity: 95 },
        ],
        storage: [{ storageName: 'Hlavní silo', items: [] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * wagon-filling — pickup wagon fillPercent progresses 0→100 over 20 ticks.
 * Tests flash on fill-level change + implement summary chip update.
 * tick=0 → 0%, tick=20 → 100%.
 */
function scenarioWagonFilling(tick) {
    const fillPct = Math.min(100, tick * 5);    // 0 % at tick 0, 100 % at tick 20
    const wagonCap = 18000;
    const fillAmt  = Math.round(fillPct / 100 * wagonCap);
    return {
        exportedAt:   now(),
        gameDay:      60,
        gameTime:     '11:00',
        gameYear:     2,
        gameMonth:    4,
        dayInMonth:   1,
        daysPerMonth: 10,
        weather:      baseWeather({ typeId: 0, title: 'Jasno', temperature: 21 }),
        farmBalance:  220000,
        fields: [
            { id: 1, area: 5.0, owned: true, fruitTypeId: 'GRASS', fruitName: 'Tráva', growthState: 4, maxGrowthState: 5, growthPercent: 80, isReadyToHarvest: false, needsSowing: false, daysToHarvest: 1, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 2, weedLevel: 0, stoneLevel: 0 },
        ],
        vehicles: [
            {
                name:         'Fendt 942 Vario',
                typeName:     'Traktor',
                isInUse:      true,
                motorHours:   315.0,
                fuelPercent:  72,
                fuelLiters:   288,
                fuelCapacity: 400,
                implements: [
                    {
                        name:         'Opalenica T-050/1',
                        fillTypeId:   'GRASS',
                        fillTypeName: 'Tráva',
                        fillPercent:  fillPct,
                        fillAmount:   fillAmt,
                        fillCapacity: wagonCap,
                    },
                ],
            },
        ],
        animals:     [],
        storage: [
            {
                storageName: 'Silo – Tráva',
                items: [{ name: 'Tráva', amount: 8000, capacity: 60000 }],
            },
        ],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * plan-3-years — gameYear 3, availableFruits full catalog.
 * Used to test the plan editor with multi-year crops + year wrap.
 */
function scenarioPlan3Years(_tick) {
    const fields = [
        { id: 1, area: 3.2, owned: true,  fruitTypeId: 'WHEAT',  fruitName: 'Pšenice',  growthState: 1, maxGrowthState: 6, growthPercent: 20, isReadyToHarvest: false, needsSowing: false, daysToHarvest: 4, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 2, weedLevel: 0, stoneLevel: 0 },
        { id: 2, area: 4.7, owned: true,  fruitTypeId: 'CANOLA', fruitName: 'Řepka',    growthState: 3, maxGrowthState: 6, growthPercent: 60, isReadyToHarvest: false, needsSowing: false, daysToHarvest: 3, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 1, weedLevel: 0, stoneLevel: 0 },
        { id: 3, area: 2.1, owned: true,  fruitTypeId: '',       fruitName: '',          growthState: 0, maxGrowthState: 6, growthPercent: 0,  isReadyToHarvest: false, needsSowing: true,  daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 0, weedLevel: 0, stoneLevel: 0 },
        { id: 4, area: 6.0, owned: false, fruitTypeId: 'MAIZE',  fruitName: 'Kukuřice', growthState: 2, maxGrowthState: 6, growthPercent: 40, isReadyToHarvest: false, needsSowing: false, daysToHarvest: 3, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 1, weedLevel: 0, stoneLevel: 0 },
    ];
    return {
        exportedAt:   now(),
        gameDay:      121,
        gameTime:     '10:00',
        gameYear:     3,
        gameMonth:    1,
        dayInMonth:   1,
        daysPerMonth: 10,
        weather:      baseWeather({ typeId: 0, title: 'Jasno', temperature: 18 }),
        farmBalance:  512000,
        fields,
        vehicles: [
            { name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 412.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 },
        ],
        animals: [
            { husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 68, waterPercent: 75, productivity: 87 },
        ],
        storage: [
            { storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 85000, capacity: 200000 }, { name: 'Řepka', amount: 22000, capacity: 200000 }] },
        ],
        productions:  baseProductions(),
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * withered-crops — fields with growthState < 0 (withered/destroyed) and
 * one field in cut-stubble state.
 * Tests the withered crop indicator in the field table.
 */
function scenarioWitheredCrops(_tick) {
    const fields = [
        { id: 1, area: 3.2, owned: true,  fruitTypeId: 'WHEAT',  fruitName: 'Pšenice',  growthState: -1, maxGrowthState: 6, growthPercent: 0,  isReadyToHarvest: false, withered: true,  needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 1, weedLevel: 0, stoneLevel: 0 },
        { id: 2, area: 4.7, owned: true,  fruitTypeId: '',       fruitName: '',          growthState: 0,  maxGrowthState: 6, growthPercent: 0,  isReadyToHarvest: false, withered: false, needsSowing: false, daysToHarvest: 0, needsPlowing: true,  needsCultivating: false, needsLime: false, fertilizationLevel: 0, weedLevel: 0, stoneLevel: 0, saveGroundType: 'STUBBLE' },
        { id: 3, area: 2.1, owned: true,  fruitTypeId: 'BARLEY', fruitName: 'Ječmen',   growthState: -1, maxGrowthState: 6, growthPercent: 0,  isReadyToHarvest: false, withered: true,  needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: true, fertilizationLevel: 0, weedLevel: 1, stoneLevel: 0 },
        { id: 4, area: 6.0, owned: true,  fruitTypeId: 'MAIZE',  fruitName: 'Kukuřice', growthState: 3,  maxGrowthState: 6, growthPercent: 60, isReadyToHarvest: false, withered: false, needsSowing: false, daysToHarvest: 3, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 2, weedLevel: 0, stoneLevel: 0 },
    ];
    return {
        exportedAt:   now(),
        gameDay:      75,
        gameTime:     '15:00',
        gameYear:     2,
        gameMonth:    6,
        dayInMonth:   5,
        daysPerMonth: 10,
        weather:      baseWeather({ typeId: 6, title: 'Bouřka', temperature: 28 }),
        farmBalance:  145000,
        fields,
        vehicles: [
            { name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 510.0, fuelPercent: 55, fuelLiters: 220, fuelCapacity: 400 },
        ],
        animals: [],
        storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Kukuřice', amount: 31000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * multi-fruit-types — 8 fields each with a different crop.
 * Tests crop-icon display, field table scrolling, diverse fruit names.
 */
function scenarioMultiFruitTypes(_tick) {
    const crops = [
        { id: 'WHEAT',     name: 'Pšenice',       gs: 2, pct: 40 },
        { id: 'BARLEY',    name: 'Ječmen',         gs: 4, pct: 80 },
        { id: 'CANOLA',    name: 'Řepka',          gs: 1, pct: 20 },
        { id: 'MAIZE',     name: 'Kukuřice',       gs: 3, pct: 60 },
        { id: 'SUNFLOWER', name: 'Slunečnice',     gs: 5, pct: 100 },
        { id: 'SOYBEAN',   name: 'Sójové boby',    gs: 2, pct: 40 },
        { id: 'SUGARBEET', name: 'Cukrová řepa',   gs: 3, pct: 60 },
        { id: 'GRASS',     name: 'Tráva',          gs: 4, pct: 80 },
    ];
    const fields = crops.map((c, i) => ({
        id:               i + 1,
        area:             2.0 + i * 0.5,
        owned:            true,
        fruitTypeId:      c.id,
        fruitName:        c.name,
        growthState:      c.gs,
        maxGrowthState:   6,
        growthPercent:    c.pct,
        isReadyToHarvest: c.gs >= 5,
        needsSowing:      false,
        daysToHarvest:    c.gs >= 5 ? 0 : 5 - c.gs,
        needsPlowing:     false,
        needsCultivating: false,
        needsLime:        i % 3 === 0,
        fertilizationLevel: i % 3,
        weedLevel:        i % 2,
        stoneLevel:       0,
    }));
    return {
        exportedAt:   now(),
        gameDay:      90,
        gameTime:     '12:00',
        gameYear:     2,
        gameMonth:    7,
        dayInMonth:   1,
        daysPerMonth: 10,
        weather:      baseWeather({ typeId: 1, title: 'Slunečno', temperature: 24 }),
        farmBalance:  380000,
        fields,
        vehicles: [
            { name: 'Fendt 942 Vario',   typeName: 'Traktor', isInUse: false, motorHours: 280.0, fuelPercent: 71, fuelLiters: 284, fuelCapacity: 400 },
            { name: 'CLAAS LEXION 8900', typeName: 'Kombajn', isInUse: false, motorHours: 290.0, fuelPercent: 88, fuelLiters: 554, fuelCapacity: 630 },
        ],
        animals: [],
        storage: [
            {
                storageName: 'Hlavní silo',
                items: [
                    { name: 'Pšenice',  amount: 48000,  capacity: 200000 },
                    { name: 'Ječmen',   amount: 25000,  capacity: 200000 },
                    { name: 'Řepka',    amount: 12000,  capacity: 200000 },
                    { name: 'Kukuřice', amount: 60000,  capacity: 200000 },
                ],
            },
        ],
        productions:  baseProductions(),
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * mixed-ai-tasks — vehicles with vanilla AI, Courseplay, and AutoDrive.
 * Tests AI badge rendering + aiSource labeling.
 */
function scenarioMixedAiTasks(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      55,
        gameTime:     '13:45',
        gameYear:     2,
        gameMonth:    4,
        dayInMonth:   5,
        daysPerMonth: 10,
        weather:      baseWeather({ typeId: 2, title: 'Polojasno', temperature: 17 }),
        farmBalance:  267000,
        fields: [
            { id: 1, area: 3.2, owned: true, fruitTypeId: 'WHEAT', fruitName: 'Pšenice', growthState: 4, maxGrowthState: 6, growthPercent: 80, isReadyToHarvest: false, needsSowing: false, daysToHarvest: 1, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 2, weedLevel: 0, stoneLevel: 0 },
        ],
        vehicles: [
            // Vanilla FS25 AI (helper)
            { name: 'Fendt 516 Vario',   typeName: 'Traktor',     isInUse: true,  motorHours: 112.0, fuelPercent: 73, fuelLiters: 146, fuelCapacity: 200, aiActive: true,  aiSource: 'vanilla',    aiJobName: 'Sekání trávy' },
            // Courseplay
            { name: 'Fendt 942 Vario',   typeName: 'Traktor',     isInUse: true,  motorHours: 345.0, fuelPercent: 58, fuelLiters: 232, fuelCapacity: 400, aiActive: true,  aiSource: 'courseplay', aiJobName: 'Course #3 – Pšenice' },
            // AutoDrive
            { name: 'Fendt 1100 MT',     typeName: 'Traktor',     isInUse: true,  motorHours: 201.0, fuelPercent: 41, fuelLiters: 267, fuelCapacity: 650, aiActive: true,  aiSource: 'autodrive',  aiJobName: 'Silo → Pole #4' },
            // Not in use (idle)
            { name: 'CLAAS LEXION 8900', typeName: 'Kombajn',     isInUse: false, motorHours: 430.0, fuelPercent: 90, fuelLiters: 567, fuelCapacity: 630, aiActive: false, aiSource: null,         aiJobName: null },
            // Manual operation (inUse but no AI)
            { name: 'HORSCH Leeb 15 PT', typeName: 'Postřikovač', isInUse: true,  motorHours: 62.0,  fuelPercent: 85, fuelLiters: 136, fuelCapacity: 160, aiActive: false, aiSource: null,         aiJobName: null },
        ],
        animals: [],
        storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 55000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

const SCENARIOS = {
    'default':          scenarioDefault,
    'empty-farm':       scenarioEmptyFarm,
    'harvest-ready':    scenarioHarvestReady,
    'low-fuel':         scenarioLowFuel,
    'animal-needs':     scenarioAnimalNeeds,
    'wagon-filling':    scenarioWagonFilling,
    'plan-3-years':     scenarioPlan3Years,
    'withered-crops':   scenarioWitheredCrops,
    'multi-fruit-types':scenarioMultiFruitTypes,
    'mixed-ai-tasks':   scenarioMixedAiTasks,
    'vehicles-rich':    scenarioVehiclesRich,
    'productions-many': scenarioProductionsMany,
};

/**
 * Get the payload for a named scenario at a given tick.
 * Returns null for 'default' (caller should fall through to own logic).
 * Throws if the scenario name is not recognised.
 *
 * @param {string} name
 * @param {number} tick
 * @returns {object|null}
 */
function getScenario(name, tick) {
    if (!Object.prototype.hasOwnProperty.call(SCENARIOS, name)) {
        throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`);
    }
    const payload = SCENARIOS[name](tick);
    // Inject a seasonal forecast into any scenario that doesn't define its own,
    // so the history page's forecast chart + watch feature work everywhere.
    if (payload && typeof payload === 'object' && !payload.priceForecast) {
        payload.priceForecast = basePriceForecast(payload.gameMonth);
    }
    return payload;
}

/**
 * Return sorted list of all scenario names.
 * @returns {string[]}
 */
function listScenarios() {
    return Object.keys(SCENARIOS).sort();
}

module.exports = { getScenario, listScenarios, SCENARIOS };
