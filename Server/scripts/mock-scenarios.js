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
            productions: [{ name: 'Chléb', status: 'active', cyclesPerHour: 40, costsPerHour: 12,
                inputs: [{ name: 'Mouka', amount: 200 }, { name: 'Voda', amount: 100 }], outputs: [{ name: 'Chléb', amount: 150 }] }],
        },
        {
            name: 'Pila',
            items: [
                { name: 'Klády',   amount: 14800, capacity: 30000 },
                { name: 'Řezivo',  amount:  2300, capacity: 30000 },
            ],
            productions: [{ name: 'Řezivo', status: 'active', cyclesPerHour: 25, costsPerHour: 8,
                inputs: [{ name: 'Klády', amount: 500 }], outputs: [{ name: 'Řezivo', amount: 400 }] }],
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
            ], productions: [{ name: 'Máslo', status: 'active', cyclesPerHour: 30, costsPerHour: 9,
                                inputs: [{ name: 'Mléko', amount: 200 }], outputs: [{ name: 'Máslo', amount: 90 }] },
                             { name: 'Sýr',   status: 'active', cyclesPerHour: 12, costsPerHour: 14,
                                inputs: [{ name: 'Mléko', amount: 300 }], outputs: [{ name: 'Sýr', amount: 110 }] }] },
            { name: 'Pekárna', items: [
                { name: 'Mouka', amount: 5200, capacity: 20000 },
                { name: 'Chléb', amount: 1100, capacity: 20000 },
            ], productions: [{ name: 'Chléb', status: 'active', cyclesPerHour: 40, costsPerHour: 12,
                                inputs: [{ name: 'Mouka', amount: 200 }], outputs: [{ name: 'Chléb', amount: 150 }] }] },
            { name: 'Pila', items: [
                { name: 'Klády',  amount: 14800, capacity: 30000 },
                { name: 'Řezivo', amount:  2300, capacity: 30000 },
            ], productions: [{ name: 'Řezivo', status: 'noInput', cyclesPerHour: 25, costsPerHour: 0,
                                inputs: [{ name: 'Klády', amount: 500 }], outputs: [{ name: 'Řezivo', amount: 400 }] }] },
            { name: 'BGA Bergmann', items: [
                { name: 'Siláž',     amount: 60000, capacity: 100000 },
                { name: 'Digestát',  amount: 12000, capacity: 50000 },
            ], productions: [{ name: 'Elektřina', status: 'active', cyclesPerHour: 100, costsPerHour: 4,
                                inputs: [{ name: 'Siláž', amount: 400 }], outputs: [{ name: 'Digestát', amount: 120 }] }] },
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
            { storageName: 'Hlavní silo', items: [
                { name: 'Pšenice',  amount: 48000, capacity: 200000 },
                { name: 'Řepka',    amount: 31000, capacity: 200000 },
                { name: 'Ječmen',   amount: 18000, capacity: 200000 },
                { name: 'Kukuřice', amount:  9000, capacity: 200000 },
            ] },
        ],
        productions:  baseProductions(),
        prices:       basePrices(),
        priceForecast: basePriceForecast(5),
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
            { husbandryName: 'Kravín', type: 'COW', count: 14, maxCount: 20, productivity: 45,
              foodPercent: 12,  foodLiters: 600,  foodCapacity: 5000,
              waterPercent: 8,  waterLiters: 80,  waterCapacity: 1000,
              strawPercent: 30, strawLiters: 300, strawCapacity: 1000,
              milkPercent: 86,  milkLiters: 1720, milkCapacity: 2000,
              manurePercent: 40, manureLiters: 800, manureCapacity: 2000,
              clusters: [
                { subType: 'COW_HOLSTEIN', count: 9, age: 24, health: 92, reproduction: 80, sellPrice: 1450 },
                { subType: 'COW_ANGUS',    count: 5, age: 18, health: 88, reproduction: 60, sellPrice: 1600 },
              ] },
            { husbandryName: 'Vepřín', type: 'PIG', count: 24, maxCount: 50, productivity: 38,
              foodPercent: 8,   foodLiters: 200,  foodCapacity: 4000,
              waterPercent: 15, waterLiters: 150, waterCapacity: 1000,
              manurePercent: 55, manureLiters: 1100, manureCapacity: 2000,
              clusters: [{ subType: 'PIG_LANDRACE', count: 24, age: 8, health: 70, reproduction: 40, sellPrice: 320 }] },
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
        { id: 1, area: 3.2, owned: true,  fruitTypeId: 'WHEAT',  fruitName: 'Pšenice',  growthState: -1, maxGrowthState: 6, growthPercent: 0,  isReadyToHarvest: false, isWithered: true,  needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 1, weedLevel: 0, stoneLevel: 0 },
        { id: 2, area: 4.7, owned: true,  fruitTypeId: 'WHEAT',  fruitName: 'Pšenice',   growthState: 0,  maxGrowthState: 6, growthPercent: 0,  isReadyToHarvest: false, isWithered: false, isCut: true, needsSowing: false, daysToHarvest: 0, needsPlowing: true,  needsCultivating: false, needsLime: false, fertilizationLevel: 0, weedLevel: 0, stoneLevel: 0 },
        { id: 3, area: 2.1, owned: true,  fruitTypeId: 'BARLEY', fruitName: 'Ječmen',   growthState: -1, maxGrowthState: 6, growthPercent: 0,  isReadyToHarvest: false, isWithered: true,  needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: true, fertilizationLevel: 0, weedLevel: 1, stoneLevel: 0 },
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

/**
 * layout-stress — many sections of very uneven height (short fields, lots of
 * storages, several productions/animals). Reproduces the masonry packing gap
 * where single-column sections pile under the span-2 sections and leave the
 * right columns empty. Used to validate the grid auto-flow fix.
 */
function scenarioLayoutStress(_tick) {
    const silo = (name, amount, cap) => ({ storageName: name, items: [{ name: 'Pšenice', amount, capacity: cap }] });
    const storages = [];
    for (let i = 1; i <= 14; i++) storages.push(silo(`Sklad ${i}`, 2000 * i, 200000));
    const prod = (name, status) => ({
        name, items: [{ name: 'Vstup', amount: 4000, capacity: 20000 }, { name: 'Výstup', amount: 1200, capacity: 20000 }],
        productions: [{ name: 'Recept', status, cyclesPerHour: status === 'active' ? 40 : 0, costsPerHour: status === 'active' ? 10 : 0,
            inputs: [{ name: 'Vstup', amount: 200 }], outputs: [{ name: 'Výstup', amount: 150 }] }],
    });
    return {
        exportedAt: now(), gameDay: 60, gameTime: '10:00', gameYear: 2, gameMonth: 4,
        dayInMonth: 6, daysPerMonth: 10,
        weather: baseWeather({ typeId: 0, title: 'Jasno', temperature: 18 }),
        farmBalance: 512000,
        fields: [
            { id: 1, area: 2.4, owned: true, fruitTypeId: 'WHEAT',  fruitName: 'Pšenice', growthState: 4, maxGrowthState: 6, growthPercent: 70, isReadyToHarvest: false, needsSowing: false, daysToHarvest: 3, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 1, weedLevel: 0, stoneLevel: 0, sprayLevel: 1 },
            { id: 2, area: 3.1, owned: true, fruitTypeId: 'BARLEY', fruitName: 'Ječmen',  growthState: 5, maxGrowthState: 6, growthPercent: 100, isReadyToHarvest: true, needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 2, weedLevel: 0, stoneLevel: 0, sprayLevel: 2 },
        ],
        vehicles: [
            { name: 'Fendt 942 Vario',   typeName: 'Traktor', isInUse: true,  motorHours: 234, fuelPercent: 64, fuelLiters: 256, fuelCapacity: 400 },
            { name: 'CLAAS LEXION 8900', typeName: 'Kombajn', isInUse: false, motorHours: 412, fuelPercent: 78, fuelLiters: 491, fuelCapacity: 630 },
            { name: 'MAN TGX',           typeName: 'Nákladní',isInUse: false, motorHours: 88,  fuelPercent: 30, fuelLiters: 120, fuelCapacity: 400 },
        ],
        animals: [
            { husbandryName: 'Kravín',  type: 'COW',     count: 18, foodPercent: 60, waterPercent: 70, productivity: 90 },
            { husbandryName: 'Vepřín',  type: 'PIG',     count: 30, foodPercent: 45, waterPercent: 80, productivity: 75 },
            { husbandryName: 'Ovčín',   type: 'SHEEP',   count: 12, foodPercent: 88, waterPercent: 60, productivity: 82 },
            { husbandryName: 'Kurník',  type: 'CHICKEN', count: 50, foodPercent: 92, waterPercent: 88, productivity: 95 },
        ],
        storage: storages,
        productions: [prod('Pekárna', 'active'), prod('Pila', 'active'), prod('Mlékárna', 'noInput'),
                      prod('Lihovar', 'active'), prod('Tkalcovna', 'outputFull'), prod('Cukrovar', 'active')],
        prices: basePrices(),
        events: [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * weather typeId tests — individual scenarios for each weather icon + label combo.
 * Each scenario sets a specific weather condition with healthy vehicles/animals/balance.
 */
function weatherScenario(typeId, title, temp, tempMin, tempMax, forecastData = []) {
    const base = {
        exportedAt:   now(),
        gameDay:      50,
        gameTime:     '12:00',
        gameYear:     2,
        gameMonth:    5,
        dayInMonth:   1,
        daysPerMonth: 10,
        farmBalance:  200000,
        fields:       [],
        vehicles: [
            { name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 300, fuelPercent: 72, fuelLiters: 288, fuelCapacity: 400 },
        ],
        animals: [
            { husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 68, waterPercent: 75, productivity: 87 },
        ],
        storage:      [],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
    base.weather = {
        typeId,
        title,
        temperature:    temp,
        temperatureMin: tempMin,
        temperatureMax: tempMax,
        forecast:       forecastData,
    };
    return base;
}

function scenarioWeatherTypeIdSun(_tick) {
    return weatherScenario(0, 'Jasno', 18, 8, 26,
        [{ day: 43, daysAhead: 1, typeId: 0, title: 'Jasno',   temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, title: 'Oblačno', temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, title: 'Déšť',    temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdSlunecno(_tick) {
    return weatherScenario(1, 'Slunečno', 22, 10, 28,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdPolojasno(_tick) {
    return weatherScenario(2, 'Polojasno', 15, 7, 21,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdOblacno(_tick) {
    return weatherScenario(3, 'Oblačno', 11, 5, 17,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdDest(_tick) {
    return weatherScenario(4, 'Déšť', 9, 4, 14,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdSnezeni(_tick) {
    return weatherScenario(5, 'Sněžení', -2, -6, 2,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdBourka(_tick) {
    return weatherScenario(6, 'Bouřka', 24, 16, 29,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdKroupy(_tick) {
    return weatherScenario(7, 'Kroupy', 6, 2, 11,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdBoundaryOk(_tick) {
    return weatherScenario(8, 'Mlha', 7, 4, 12,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdBoundaryLow(_tick) {
    return weatherScenario(-1, 'Neznámo', 15, 8, 20,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdBoundaryHigh(_tick) {
    return weatherScenario(9, 'Neznámo', 15, 8, 20,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTypeIdNull(_tick) {
    return weatherScenario(null, 'Neznámo', 15, 8, 20,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTempPresent(_tick) {
    return weatherScenario(0, 'Jasno', 18, 8, 26,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherTempMissing(_tick) {
    return weatherScenario(0, 'Jasno', null, null, null, []);
}

function scenarioWeatherMinMaxPresent(_tick) {
    return weatherScenario(0, 'Jasno', 18, 8, 26,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherMinMaxMissing(_tick) {
    return weatherScenario(0, 'Jasno', 18, null, null,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherForecastVisible(_tick) {
    return weatherScenario(0, 'Jasno', 18, 8, 26,
        [{ day: 43, daysAhead: 1, typeId: 0, temperatureMin: 9,  temperatureMax: 24 },
         { day: 44, daysAhead: 2, typeId: 3, temperatureMin: 6,  temperatureMax: 19 },
         { day: 45, daysAhead: 3, typeId: 4, temperatureMin: 5,  temperatureMax: 14 }]);
}

function scenarioWeatherForecastBoundaryOne(_tick) {
    return weatherScenario(0, 'Jasno', 18, 8, 26,
        [{ day: 43, daysAhead: 1, typeId: 2, temperatureMin: 7,  temperatureMax: 19 }]);
}

function scenarioWeatherForecastEmpty(_tick) {
    return weatherScenario(0, 'Jasno', 18, 8, 26, []);
}

function scenarioWeatherForecastNull(_tick) {
    const s = weatherScenario(0, 'Jasno', 18, 8, 26, []);
    s.weather.forecast = null;
    return s;
}

function scenarioWeatherForecastIconFallback(_tick) {
    return weatherScenario(0, 'Jasno', 18, 8, 26,
        [{ day: 43, daysAhead: 1, typeId: 99, temperatureMin: 5,  temperatureMax: 12 }]);
}

function scenarioWeatherForecastTempMissing(_tick) {
    return weatherScenario(0, 'Jasno', 18, 8, 26,
        [{ day: 43, daysAhead: 1, typeId: 2, temperatureMin: null, temperatureMax: null }]);
}

/**
 * st-bell-anim-food-boundary-low — Single animal with foodPercent=24 (< 25 threshold).
 * Isolates the food-low alert at the boundary.
 */
function scenarioBellAnimFoodBoundaryLow(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [{ husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 24, waterPercent: 80 }],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-anim-food-boundary-ok — Single animal with foodPercent=25 (not < 25 threshold).
 */
function scenarioBellAnimFoodBoundaryOk(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [{ husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 25, waterPercent: 80 }],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-anim-water-boundary-low — Single animal with waterPercent=19 (< 20 threshold).
 */
function scenarioBellAnimWaterBoundaryLow(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [{ husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 60, waterPercent: 19 }],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-anim-water-boundary-ok — Single animal with waterPercent=20 (not < 20 threshold).
 */
function scenarioBellAnimWaterBoundaryOk(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [{ husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 60, waterPercent: 20 }],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-anim-food-empty-pen — Animal with count=0, suppresses food alert.
 */
function scenarioBellAnimFoodEmptyPen(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [{ husbandryName: 'Prázdný kravín', type: 'COW', count: 0, foodPercent: 5, waterPercent: 5 }],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-anim-straw-boundary-low — Animal with strawPercent=24 (< 25 threshold).
 */
function scenarioBellAnimStrawBoundaryLow(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [{ husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 60, waterPercent: 80, strawPercent: 24 }],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-anim-straw-boundary-ok — Animal with strawPercent=25 (not < 25 threshold).
 */
function scenarioBellAnimStrawBoundaryOk(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [{ husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 60, waterPercent: 80, strawPercent: 25 }],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-anim-output-boundary-ok — Animal with milkPercent=90 (>= 90 threshold).
 */
function scenarioBellAnimOutputBoundaryOk(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [{ husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 60, waterPercent: 80, milkPercent: 90, manurePercent: 40 }],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-anim-output-boundary-low — Animal with milkPercent=89 (not >= 90 threshold).
 */
function scenarioBellAnimOutputBoundaryLow(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [{ husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 60, waterPercent: 80, milkPercent: 89, manurePercent: 40 }],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-field-ready — One owned ready field, one non-owned ready field.
 * Only owned should trigger the alert.
 */
function scenarioBellFieldReady(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields: [
            { id: 1, area: 3.2, owned: true,  fruitTypeId: 'WHEAT', fruitName: 'Pšenice', growthState: 5, maxGrowthState: 6, growthPercent: 100, isReadyToHarvest: true,  needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 1, weedLevel: 0, stoneLevel: 0 },
            { id: 2, area: 2.1, owned: false, fruitTypeId: 'MAIZE', fruitName: 'Kukuřice', growthState: 5, maxGrowthState: 6, growthPercent: 100, isReadyToHarvest: true, needsSowing: false, daysToHarvest: 0, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 1, weedLevel: 0, stoneLevel: 0 },
        ],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-veh-fuel-boundary-low — Vehicles with fuel at 14% (< 15), 35%, and 0% (no tank).
 * Only the 14% vehicle should trigger alert; 0% tank suppressed.
 */
function scenarioBellVehFuelBoundaryLow(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles: [
            { name: 'Fendt 942 Vario',   typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 14, fuelLiters: 56, fuelCapacity: 400 },
            { name: 'CLAAS LEXION 8900', typeName: 'Kombajn', isInUse: false, motorHours: 412.5, fuelPercent: 35, fuelLiters: 220, fuelCapacity: 630 },
            { name: 'Kolečko',           typeName: 'Nářadí',  isInUse: false, motorHours: 0.0,   fuelPercent: 0,  fuelLiters: 0,   fuelCapacity: 0 },
        ],
        animals:      [],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-veh-fuel-boundary-ok — Vehicles with fuel at 15% (not < 15 threshold).
 */
function scenarioBellVehFuelBoundaryOk(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 15, fuelLiters: 60, fuelCapacity: 400 }],
        animals:      [],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-storage-boundary-ok — Two silos: one at 95% (fires), one at 50% (no fire).
 */
function scenarioBellStorageBoundaryOk(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [],
        storage: [
            { storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 190000, capacity: 200000 }] },
            { storageName: 'Silo B', items: [{ name: 'Ječmen', amount: 100000, capacity: 200000 }] },
        ],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-storage-boundary-low — Silo at 94% (not >= 95 threshold).
 */
function scenarioBellStorageBoundaryLow(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields:       [],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [],
        storage:      [{ storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 188000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

/**
 * st-bell-empty-all-healthy — All domains with healthy values, no alerts.
 */
function scenarioBellEmptyAllHealthy(_tick) {
    return {
        exportedAt:   now(),
        gameDay:      60, gameTime: '09:00',
        gameYear:     3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather:      baseWeather(),
        farmBalance:  200000,
        fields: [
            { id: 1, area: 3.2, owned: true, fruitTypeId: 'WHEAT', fruitName: 'Pšenice', growthState: 4, maxGrowthState: 6, growthPercent: 80, isReadyToHarvest: false, needsSowing: false, daysToHarvest: 1, needsPlowing: false, needsCultivating: false, needsLime: false, fertilizationLevel: 1, weedLevel: 0, stoneLevel: 0 },
        ],
        vehicles:     [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals:      [{ husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 60, waterPercent: 80, strawPercent: 60, milkPercent: 50, manurePercent: 40, liquidManurePercent: 30 }],
        storage:      [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions:  [],
        prices:       basePrices(),
        events:       [],
        availableFruits: AVAIL_FRUITS,
    };
}

// ─── Animals state-coverage scenarios ────────────────────────────────────────
// Shared base: single COW husbandry "Kravín" with configurable values.
function baseAnimalPayload(overrides) {
    const animal = Object.assign({
        husbandryName: 'Kravín', type: 'COW', count: 14, maxCount: 20, productivity: 72,
        foodPercent: 60,  foodLiters: 7200,  foodCapacity: 12000,
        waterPercent: 60, waterLiters: 600,  waterCapacity: 1000,
        strawPercent: 60, strawLiters: 600,  strawCapacity: 1000,
        milkPercent:  50, milkLiters: 1000,  milkCapacity: 2000,
        manurePercent: 40, manureLiters: 800, manureCapacity: 2000,
        reproductionPercent: 70,
        clusters: [{ subType: 'COW_HOLSTEIN', count: 14, age: 24, health: 92, reproduction: 70, sellPrice: 1450 }],
    }, overrides.animal || {});
    return {
        exportedAt: now(),
        gameDay: 60, gameTime: '09:00',
        gameYear: 3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather: baseWeather(),
        farmBalance: 200000,
        fields:  [],
        vehicles: [{ name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: false, motorHours: 234.0, fuelPercent: 80, fuelLiters: 320, fuelCapacity: 400 }],
        animals: (overrides.animals !== undefined) ? overrides.animals : [animal],
        storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
        productions: [], prices: basePrices(), events: [], availableFruits: AVAIL_FRUITS,
    };
}

// Bar class: danger (pct ≤ 20)
function scenarioAnimalsBarDanger(_t)         { return baseAnimalPayload({ animal: { foodPercent: 18 } }); }
// Bar class: warn (21–50)
function scenarioAnimalsBarWarn(_t)           { return baseAnimalPayload({ animal: { foodPercent: 40 } }); }
// Bar class: ok/none (51–94)
function scenarioAnimalsBarOk(_t)             { return baseAnimalPayload({ animal: { foodPercent: 70, milkPercent: 50 } }); }
// Bar class: full (pct ≥ 95), output → "Odvézt!"
function scenarioAnimalsBarFullOutput(_t)     { return baseAnimalPayload({ animal: { foodPercent: 60, milkPercent: 96 } }); }

// Bar boundary 20/21
function scenarioAnimalsBarBoundary20(_t)     { return baseAnimalPayload({ animal: { foodPercent: 20 } }); }
function scenarioAnimalsBarBoundary21(_t)     { return baseAnimalPayload({ animal: { foodPercent: 21 } }); }
// Bar boundary 50/51
function scenarioAnimalsBarBoundary50(_t)     { return baseAnimalPayload({ animal: { foodPercent: 50 } }); }
function scenarioAnimalsBarBoundary51(_t)     { return baseAnimalPayload({ animal: { foodPercent: 51 } }); }
// Bar boundary 94/95 (output full)
function scenarioAnimalsBarBoundary94(_t)     { return baseAnimalPayload({ animal: { foodPercent: 60, milkPercent: 94 } }); }
function scenarioAnimalsBarBoundary95(_t)     { return baseAnimalPayload({ animal: { foodPercent: 60, milkPercent: 95 } }); }

// Alarm loThr boundary (default loThr=25)
function scenarioAnimalsAlarmLoThr24(_t)      { return baseAnimalPayload({ animal: { foodPercent: 24 } }); }
function scenarioAnimalsAlarmLoThr25(_t)      { return baseAnimalPayload({ animal: { foodPercent: 25 } }); }
// Alarm hiThr boundary (default hiThr=90)
function scenarioAnimalsAlarmHiThr89(_t)      { return baseAnimalPayload({ animal: { foodPercent: 60, milkPercent: 89 } }); }
function scenarioAnimalsAlarmHiThr90(_t)      { return baseAnimalPayload({ animal: { foodPercent: 60, milkPercent: 90 } }); }
// Alarm DashState toggle: low food but test sets animalsShowAlarm=false via localStorage
function scenarioAnimalsAlarmOff(_t)          { return baseAnimalPayload({ animal: { foodPercent: 10 } }); }
// Empty pen (count=0) → no alert even with extreme values; uses name "Prázdný kravín"
function scenarioAnimalsAlertEmptyPen(_t) {
    return baseAnimalPayload({ animal: { husbandryName: 'Prázdný kravín', count: 0, foodPercent: 0, waterPercent: 0, milkPercent: 100 } });
}

// Repro badges
function scenarioAnimalsReproReady(_t)        { return baseAnimalPayload({ animal: { reproductionStatus: 'ready',       reproductionPercent: 85 } }); }
function scenarioAnimalsReproCycling(_t)      { return baseAnimalPayload({ animal: { reproductionStatus: 'cycling',     reproductionPercent: 60 } }); }
function scenarioAnimalsReproPaused(_t)       { return baseAnimalPayload({ animal: { reproductionStatus: 'paused',      reproductionPercent: 50 } }); }
function scenarioAnimalsReproBlocked(_t)      { return baseAnimalPayload({ animal: { reproductionStatus: 'blocked',     reproductionPercent: 30 } }); }
function scenarioAnimalsReproYoung(_t)        { return baseAnimalPayload({ animal: { reproductionStatus: 'young',       reproductionPercent: 10 } }); }
// unsupported: uses Kurník (chicken)
function scenarioAnimalsReproUnsupported(_t) {
    return baseAnimalPayload({ animals: [
        { husbandryName: 'Kurník', type: 'CHICKEN', count: 40, maxCount: 60, productivity: 90,
          foodPercent: 80, waterPercent: 80, reproductionPercent: 0, reproductionStatus: 'unsupported',
          clusters: [{ subType: 'CHICKEN_LOHMANN', count: 40, age: 6, health: 90, reproduction: 0, sellPrice: 12, reproStatus: 'unsupported' }] },
    ]});
}
// fallback-high: no reproductionStatus, reproPct >= 90 → 🐣 c-green
function scenarioAnimalsReproFallbackHigh(_t) { return baseAnimalPayload({ animal: { reproductionPercent: 92 } }); }
// fallback-low: no reproductionStatus, reproPct < 90 → 🐣 no color
function scenarioAnimalsReproFallbackLow(_t)  { return baseAnimalPayload({ animal: { reproductionPercent: 65 } }); }
// hidden: reproPct==null → badge missing
function scenarioAnimalsReproHidden(_t)       { return baseAnimalPayload({ animal: { reproductionPercent: null } }); }

// Bar visibility: waterPercent=null for pig → no water bar
function scenarioAnimalsBarVisibilityWaterNull(_t) {
    return baseAnimalPayload({ animals: [
        { husbandryName: 'Vepřín', type: 'PIG', count: 20, maxCount: 50, productivity: 70,
          foodPercent: 60, foodLiters: 600, foodCapacity: 1000,
          waterPercent: null, waterLiters: null, waterCapacity: null,
          manurePercent: 40, manureLiters: 400, manureCapacity: 1000,
          clusters: [{ subType: 'PIG_LANDRACE', count: 20, age: 10, health: 80, reproduction: 30, sellPrice: 280 }] },
    ]});
}
// Toggles off: just need Kravín with normal data; test sets localStorage
function scenarioAnimalsBarVisibilityTogglesOff(_t) { return baseAnimalPayload({}); }

// Expanded mode: atCap (count >= maxCount)
function scenarioAnimalsExpandedAtCap(_t)     { return baseAnimalPayload({ animal: { count: 20, maxCount: 20 } }); }
// Expanded mode: herdValue > 0
function scenarioAnimalsExpandedHerdValue(_t) { return baseAnimalPayload({ animal: { clusters: [{ subType: 'COW_HOLSTEIN', count: 14, age: 24, health: 92, reproduction: 70, sellPrice: 1450 }] } }); }
// Expanded mode: capacity > 1000 → tonnes, capacity == 1000 → litres
function scenarioAnimalsExpandedLitersTonnes(_t) {
    return baseAnimalPayload({ animal: {
        foodCapacity: 12000, foodLiters: 6000, foodPercent: 50,
        waterCapacity: 1000, waterLiters: 500, waterPercent: 50,
        strawCapacity: 1000, strawLiters: 500, strawPercent: 50,
    }});
}

// Flash scenarios: oscillate between two values so flash fires on EVERY tick change
// regardless of which tick was the page's first payload.
function scenarioAnimalsFlashCount(tick) {
    const count = tick % 2 === 0 ? 10 : 12;
    return baseAnimalPayload({ animal: { count, maxCount: 20 } });
}
function scenarioAnimalsFlashBarlabel(tick) {
    const waterPercent = tick % 2 === 0 ? 60 : 65;
    return baseAnimalPayload({ animal: { waterPercent } });
}
function scenarioAnimalsFlashHealth(tick) {
    const productivity = tick % 2 === 0 ? 70 : 75;
    return baseAnimalPayload({ animal: { productivity } });
}
function scenarioAnimalsFlashRepro(tick) {
    const reproductionPercent = tick % 2 === 0 ? 70 : 75;
    return baseAnimalPayload({ animal: { reproductionPercent } });
}

// Modal: cluster repro cells (ready/cycling/paused/blocked/young/unsupported/fallback)
function scenarioAnimalsModalReproCells(_t) {
    return baseAnimalPayload({ animals: [
        { husbandryName: 'Kravín', type: 'COW', count: 28, maxCount: 40, productivity: 80,
          foodPercent: 60, foodLiters: 7200, foodCapacity: 12000,
          waterPercent: 60, waterLiters: 600, waterCapacity: 1000,
          strawPercent: 60, strawLiters: 600, strawCapacity: 1000,
          milkPercent: 50, milkLiters: 1000, milkCapacity: 2000,
          manurePercent: 40, manureLiters: 800, manureCapacity: 2000,
          reproductionPercent: 85, reproductionStatus: 'ready',
          clusters: [
            { subType: 'COW_HOLSTEIN',  count: 5, age: 30, health: 95, reproduction: 100, sellPrice: 1450, reproStatus: 'ready'       },
            { subType: 'COW_ANGUS',     count: 5, age: 24, health: 90, reproduction:  70, sellPrice: 1600, reproStatus: 'cycling'     },
            { subType: 'COW_LIMOUSIN',  count: 4, age: 20, health: 85, reproduction:  50, sellPrice: 1550, reproStatus: 'paused',  reproFactor: 0.0 },
            { subType: 'COW_HOLSTEINX', count: 4, age: 18, health: 60, reproduction:  30, sellPrice: 1400, reproStatus: 'blocked', health: 60, minHealth: 80 },
            { subType: 'COW_JERSEY',    count: 5, age:  8, health: 90, reproduction:  20, sellPrice: 1500, reproStatus: 'young',   age: 8, minAgeMonth: 12 },
            { subType: 'COW_HEREFORD',  count: 3, age: 30, health: 88, reproduction:  80, sellPrice: 1480, reproStatus: 'unsupported' },
            { subType: 'COW_BRAHMAN',   count: 2, age: 36, health: 92, reproduction:  93, sellPrice: 1600                             },
          ] },
    ]});
}

// Modal: pig fill rows — only food/water/manure present; no straw/milk/slurry
function scenarioAnimalsModalFillrowsVisibility(_t) {
    return baseAnimalPayload({ animals: [
        { husbandryName: 'Vepřín', type: 'PIG', count: 24, maxCount: 50, productivity: 75,
          foodPercent: 55, foodLiters: 2200, foodCapacity: 4000,
          waterPercent: 60, waterLiters: 600, waterCapacity: 1000,
          manurePercent: 45, manureLiters: 900, manureCapacity: 2000,
          clusters: [{ subType: 'PIG_LANDRACE', count: 24, age: 10, health: 80, reproduction: 40, sellPrice: 300 }] },
    ]});
}

// ─── Shared base payloads for state-coverage scenarios ───────────────────────
function basePayload(overrides) {
    return Object.assign({
        exportedAt: now(),
        gameDay: 60, gameTime: '10:00', gameYear: 3, gameMonth: 6, dayInMonth: 1, daysPerMonth: 10,
        weather: baseWeather(),
        farmBalance: 200000,
        farmBalanceDeltaDay: 0,
        fields: [], vehicles: [], animals: [], storage: [], productions: [], prices: basePrices(),
        events: [], availableFruits: AVAIL_FRUITS,
    }, overrides);
}

function baseField(id, overrides) {
    return Object.assign({
        id, area: 3.2, owned: true, farmlandId: id,
        fruitTypeId: 'WHEAT', fruitName: 'Pšenice',
        growthState: 3, maxGrowthState: 6, growthPercent: 60,
        isReadyToHarvest: false, needsSowing: false, daysToHarvest: 2,
        needsPlowing: false, needsCultivating: false, needsLime: false,
        fertilizationLevel: 1, sprayLevel: 1, weedLevel: 0, stoneLevel: 0, weedState: 0,
    }, overrides);
}

function baseVehicle(name, overrides) {
    return Object.assign({
        name, typeName: 'Traktor', isInUse: false, motorHours: 250,
        fuelPercent: 70, fuelLiters: 280, fuelCapacity: 400,
        conditionPercent: 90, speedKmh: 0, implements: [],
    }, overrides);
}

function baseStorage(name, amount, capacity) {
    return { storageName: name, items: [{ name: 'Pšenice', amount, capacity }] };
}

function baseProduction(name, overrides) {
    return Object.assign({
        factoryName: name, factoryType: 'FOOD_COMPANY', cyclesPerHour: 2.5, costsPerHour: 120,
        recipes: [{ name: 'Mouka', status: 'active', inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Mouka', amount: 80, capacity: 400 }] }],
    }, overrides);
}

// ─── Fields state-coverage scenarios ─────────────────────────────────────────
function scenarioFieldsTagPriority(_t) {
    return basePayload({ fields: [
        baseField(1, { saveGroundType: 'SOWN',     fruitTypeId: 'WHEAT', fruitName: 'Pšenice', isReadyToHarvest: false }),
        baseField(2, { isReadyToHarvest: true, daysToHarvest: 0, growthPercent: 100 }),
        baseField(3, { isWithered: true, fruitTypeId: 'WHEAT', fruitName: 'Pšenice' }),
        baseField(4, { isCut: true, fruitTypeId: '', fruitName: '' }),
        baseField(5, { fruitTypeId: 'WHEAT', fruitName: 'Pšenice', growthPercent: 60 }),
        baseField(6, { fruitTypeId: '', fruitName: '', needsSowing: true }),
        baseField(7, { fruitTypeId: '', fruitName: '', needsSowing: false }),
    ]});
}

function scenarioFieldsGrowthBarThresholds(_t) {
    return basePayload({ fields: [
        baseField(1, { growthPercent: 20 }),
        baseField(2, { growthPercent: 21 }),
        baseField(3, { growthPercent: 50 }),
        baseField(4, { growthPercent: 51 }),
        baseField(5, { growthPercent: 94 }),
        baseField(6, { growthPercent: 95 }),
        baseField(7, { growthPercent: 100, isReadyToHarvest: true, daysToHarvest: 0 }),
        baseField(8, { fruitTypeId: '', fruitName: '', growthPercent: 0, needsSowing: false }),
    ]});
}

function scenarioFieldsDaysToHarvest(_t) {
    return basePayload({ fields: [
        baseField(1, { daysToHarvest: 1 }),
        baseField(2, { isReadyToHarvest: true, daysToHarvest: 0, growthPercent: 100 }),
        baseField(3, { daysToHarvest: 0, isReadyToHarvest: false }),
    ]});
}

function scenarioFieldsConditionBadgeWeedstate(_t) {
    return basePayload({ fields: [
        baseField(1, { weedState: 2 }),
        baseField(2, { weedState: 3 }),
        baseField(3, { weedState: 4 }),
        baseField(4, { weedState: 5 }),
    ]});
}

function scenarioFieldsActionChips(_t) {
    return basePayload({ fields: [
        baseField(1, { needsPlowing: true }),
        baseField(2, { needsLime: true }),
        baseField(3, { isWithered: true }),
        baseField(4, { weedLevel: 1 }),
        baseField(5, { weedLevel: 2, stoneLevel: 1 }),
        baseField(6, { stoneLevel: 2 }),
    ]});
}

function scenarioFieldsSprayColumn(_t) {
    return basePayload({ fields: [
        baseField(1, { sprayLevel: 0 }),
        baseField(2, { sprayLevel: 1 }),
        baseField(3, { sprayLevel: 2 }),
    ]});
}

function scenarioFieldsExtraColumnsToggle(_t) {
    return basePayload({ fields: [
        baseField(1, { needsPlowing: true, needsLime: true, weedLevel: 1, stoneLevel: 1 }),
        baseField(2, { needsPlowing: false, needsLime: false, weedLevel: 0, stoneLevel: 0 }),
    ]});
}

function scenarioFieldsCropCell(_t) {
    return basePayload({ fields: [
        baseField(1, { fruitTypeId: 'WHEAT', fruitName: 'Pšenice' }),
        baseField(2, { fruitTypeId: 'EXOTIC_X', fruitName: 'Exotická plodina' }),
        baseField(3, { fruitTypeId: '', fruitName: '' }),
    ]});
}

function scenarioFieldsFarmlandCell(_t) {
    return basePayload({ fields: [
        baseField(1, { farmlandId: 12, area: 3.2, farmlandAreaHa: 4.0 }),
        baseField(2, { farmlandId: 15, area: 2.5, farmlandAreaHa: 2.5 }),
        baseField(3, { farmlandId: null }),
    ]});
}

function scenarioFieldsBellReadyBoundary(_t) {
    return basePayload({ fields: [
        baseField(1, { isReadyToHarvest: true, fruitTypeId: 'WHEAT', fruitName: 'Pšenice', owned: true, daysToHarvest: 0, growthPercent: 100 }),
        baseField(2, { isReadyToHarvest: false, fruitTypeId: 'WHEAT', fruitName: 'Pšenice', owned: true }),
        baseField(3, { isReadyToHarvest: true, fruitTypeId: 'CANOLA', fruitName: 'Řepka', owned: false, daysToHarvest: 0, growthPercent: 100 }),
    ]});
}

function scenarioFieldsEmptyState(_t) {
    return basePayload({ fields: [] });
}

// ─── KPI state-coverage scenarios ────────────────────────────────────────────
function scenarioKpiBalanceDeltaNeutral(_t) {
    return basePayload({ farmBalance: 250000, farmBalanceDeltaDay: 0 });
}

// ─── Flash state-coverage scenarios ──────────────────────────────────────────
function scenarioFlashNoflashStatic(_t) {
    return basePayload({
        farmBalance: 200000, farmBalanceDeltaDay: 0,
        vehicles: [baseVehicle('Fendt 942 Vario', { fuelPercent: 70 })],
        animals:  [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 60, waterPercent: 70, productivity: 80 }],
        storage:  [baseStorage('Hlavní silo', 50000, 200000)],
    });
}

function scenarioFlashBalanceBoundaryLow(tick) {
    // Balance changes by 500 (< threshold 1000) — no flash
    return basePayload({ farmBalance: tick === 0 ? 200000 : 200500, farmBalanceDeltaDay: 500 });
}

function scenarioFlashBalanceBoundaryOk(tick) {
    // Balance oscillates by 1500 (>= threshold 1000) — flash fires on every change
    return basePayload({ farmBalance: tick % 2 === 0 ? 200000 : 201500, farmBalanceDeltaDay: 1500 });
}

function scenarioFlashImplBoundaryLow(tick) {
    // Raw percent oscillates INSIDE the same integer (50.1 ↔ 50.4 — both round to
    // 50, staying below the .5 boundary) so the impl flash — which rounds via
    // Math.round before diffing (index.html:620) — sees a constant 50 and must NOT
    // flash. This actually exercises the rounding path (the raw value DOES change
    // tick-to-tick, only the rounded value is equal).
    const pct = tick % 2 === 0 ? 50.1 : 50.4;
    return basePayload({ vehicles: [baseVehicle('Fendt 942 Vario', {
        implements: [{ name: 'Sázecí stroj', fillUnits: [{ fillType: 'SEEDS', typeTitle: 'Osivo', levelL: Math.round(pct * 1000), capacityL: 100000, percent: pct }] }]
    })]});
}

function scenarioFlashImplBoundaryOk(tick) {
    // Implement fill oscillates by 1% (Math.round changes → flash fires on every change)
    const pct = tick % 2 === 0 ? 50 : 51;
    return basePayload({ vehicles: [baseVehicle('Fendt 942 Vario', {
        implements: [{ name: 'Sázecí stroj', fillUnits: [{ fillType: 'SEEDS', typeTitle: 'Osivo', levelL: pct * 1000, capacityL: 100000, percent: pct }] }]
    })]});
}

function scenarioFlashImplAirSkip(tick) {
    // Implement with AIR fill type — no flash even with percent change
    const pct = tick === 0 ? 50 : 60;
    return basePayload({ vehicles: [baseVehicle('Vzduchový vůz', {
        name: 'Vzduchový vůz', typeName: 'Traktor',
        implements: [{ name: 'Kompresor', fillUnits: [{ fillType: 'AIR', typeTitle: 'Vzduch', levelL: pct * 100, capacityL: 10000, percent: pct }] }]
    })]});
}

function scenarioFlashAnimalsCountBoundary(tick) {
    return basePayload({ animals: [{ husbandryName: 'Kravín', type: 'COW', count: tick % 2 === 0 ? 10 : 11, maxCount: 20, foodPercent: 60, waterPercent: 70, productivity: 80 }] });
}

function scenarioFlashAnimalsInputBars(tick) {
    return basePayload({ animals: [{ husbandryName: 'Kravín', type: 'COW', count: 12, maxCount: 20,
        foodPercent: tick % 2 === 0 ? 60 : 65, waterPercent: tick % 2 === 0 ? 70 : 75,
        strawPercent: tick % 2 === 0 ? 55 : 58, productivity: 80, foodLiters: 7200, foodCapacity: 12000,
        waterLiters: 700, waterCapacity: 1000, strawLiters: 550, strawCapacity: 1000 }] });
}

function scenarioFlashAnimalsOutputBars(tick) {
    return basePayload({ animals: [{ husbandryName: 'Kravín', type: 'COW', count: 12, maxCount: 20,
        foodPercent: 60, waterPercent: 70, productivity: 80,
        milkPercent: tick % 2 === 0 ? 50 : 55, manurePercent: tick % 2 === 0 ? 40 : 45,
        milkLiters: 1000, milkCapacity: 2000, manureLiters: 800, manureCapacity: 2000 }] });
}

function scenarioFlashAnimalsHealthRepro(tick) {
    return basePayload({ animals: [{ husbandryName: 'Kravín', type: 'COW', count: 12, maxCount: 20,
        foodPercent: 60, waterPercent: 70,
        productivity: tick % 2 === 0 ? 80 : 82,
        reproductionPercent: tick % 2 === 0 ? 70 : 73 }] });
}

function scenarioFlashStorageHeaderItem(tick) {
    return basePayload({ storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: tick % 2 === 0 ? 50000 : 52000, capacity: 200000 }] }] });
}

function scenarioFlashProductionsHeaderItem(tick) {
    return basePayload({ productions: [{ name: 'Pekárna', factoryType: 'FOOD_COMPANY', cyclesPerHour: 2, costsPerHour: 100,
        items: [{ name: 'Chléb', amount: tick % 2 === 0 ? 50 : 55, capacity: 200 }],
        productions: [{ name: 'Chléb', status: 'active',
            inputs: [{ name: 'Pšenice', amount: tick % 2 === 0 ? 100 : 80, capacity: 500 }],
            outputs: [{ name: 'Chléb', amount: tick % 2 === 0 ? 50 : 55, capacity: 200 }] }] }] });
}

function scenarioFlashPriceUpDown(tick) {
    const price = tick % 2 === 0 ? 300 : 350;
    return basePayload({ prices: [{ sellPoint: 'Silo Bergmann', items: [{ name: 'Pšenice', pricePerTon: price }] }] });
}

function scenarioFlashFieldGrowHarvest(tick) {
    return basePayload({ fields: [
        baseField(1, { owned: true,  fruitTypeId: 'WHEAT', fruitName: 'Pšenice', growthState: tick % 2 === 0 ? 3 : 4, growthPercent: tick % 2 === 0 ? 60 : 80 }),
        baseField(2, { owned: false, fruitTypeId: 'WHEAT', fruitName: 'Pšenice', growthState: tick % 2 === 0 ? 3 : 4, growthPercent: tick % 2 === 0 ? 60 : 80 }),
    ]});
}

function scenarioFlashAntipinContinuous(tick) {
    // Implement fill increases every tick — anti-pin logic prevents pin
    const pct = Math.min(99, tick * 5 + 10);
    return basePayload({ vehicles: [baseVehicle('Fendt 942 Vario', {
        implements: [{ name: 'Sázecí stroj', fillUnits: [{ fillType: 'SEEDS', typeTitle: 'Osivo', levelL: pct * 1000, capacityL: 100000, percent: pct }] }]
    })]});
}

function scenarioFlashToggleSuppressed(tick) {
    // Storage changes but flash toggle should be suppressed
    return basePayload({ storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: tick === 0 ? 50000 : 55000, capacity: 200000 }] }] });
}

// ─── Events state-coverage scenarios ─────────────────────────────────────────
// These scenarios provide deterministic multi-tick data for event flash tests.
// Oscillates between tick1 and tick2 so flash fires on EVERY tick change,
// regardless of which tick was the page's first WS payload.
function makeEventsScenario(tick1, tick2) {
    return function(tick) {
        const data = tick % 2 === 0 ? tick1 : tick2;
        return basePayload(data);
    };
}

// Monotonic scenario: value always moves in one direction so flash direction is
// deterministic (no matter which tick the page received first).
// deltaFn(tick) must return the overrides object for that tick.
function makeMonotonicScenario(deltaFn) {
    return function(tick) {
        return basePayload(deltaFn(tick));
    };
}

const scenarioEventsBalanceFlashUp = makeEventsScenario(
    { farmBalance: 500000, farmBalanceDeltaDay: 2000, vehicles: [baseVehicle('Fendt 942 Vario')] },
    { farmBalance: 501500, farmBalanceDeltaDay: 2000, vehicles: [baseVehicle('Fendt 942 Vario')] }
);
const scenarioEventsBalanceFlashDown = makeEventsScenario(
    { farmBalance: 300000, farmBalanceDeltaDay: -5000, vehicles: [baseVehicle('Fendt 942 Vario')] },
    { farmBalance: 298500, farmBalanceDeltaDay: -5000, vehicles: [baseVehicle('Fendt 942 Vario')] }
);
const scenarioEventsBalanceFlashBelowThreshold = makeEventsScenario(
    { farmBalance: 200000, farmBalanceDeltaDay: 0, vehicles: [baseVehicle('Fendt 942 Vario')] },
    { farmBalance: 200400, farmBalanceDeltaDay: 0, vehicles: [baseVehicle('Fendt 942 Vario')] }
);
const scenarioEventsFieldGrowthFlashUp = makeEventsScenario(
    { fields: [baseField(1, { growthState: 2, growthPercent: 40 })], vehicles: [baseVehicle('Fendt 942 Vario')] },
    { fields: [baseField(1, { growthState: 3, growthPercent: 60 })], vehicles: [baseVehicle('Fendt 942 Vario')] }
);
const scenarioEventsFieldHarvestFlashDown = makeEventsScenario(
    { fields: [baseField(1, { growthState: 5, growthPercent: 100, isReadyToHarvest: true })], vehicles: [baseVehicle('Fendt 942 Vario')] },
    { fields: [baseField(1, { growthState: 0, growthPercent: 0, fruitTypeId: '', fruitName: '', needsSowing: true })], vehicles: [baseVehicle('Fendt 942 Vario')] }
);
const scenarioEventsImplFillFlashUp = makeEventsScenario(
    { vehicles: [baseVehicle('Fendt 942 Vario', { isInUse: true, implements: [{ name: 'Opalenica', fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: 9000, capacityL: 18000, percent: 50 }] }] })] },
    { vehicles: [baseVehicle('Fendt 942 Vario', { isInUse: true, implements: [{ name: 'Opalenica', fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: 10800, capacityL: 18000, percent: 60 }] }] })] }
);
const scenarioEventsImplFillFlashDown = makeEventsScenario(
    { vehicles: [baseVehicle('Fendt 942 Vario', { isInUse: true, implements: [{ name: 'Opalenica', fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: 10800, capacityL: 18000, percent: 60 }] }] })] },
    { vehicles: [baseVehicle('Fendt 942 Vario', { isInUse: true, implements: [{ name: 'Opalenica', fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: 9000, capacityL: 18000, percent: 50 }] }] })] }
);
const scenarioEventsVehicleInUse = () => basePayload({ vehicles: [
    baseVehicle('Fendt 942 Vario', { isInUse: true, speedKmh: 12 }),
    baseVehicle('Fendt 516 Vario', { name: 'Fendt 516 Vario', isInUse: false }),
] });
const scenarioEventsFuelDangerBoundaryLow   = () => basePayload({ vehicles: [baseVehicle('Fendt 942 Vario', { fuelPercent: 20 })] });
const scenarioEventsFuelDangerBoundaryOk    = () => basePayload({ vehicles: [baseVehicle('Fendt 942 Vario', { fuelPercent: 21 })] });
const scenarioEventsFuelWarnBoundaryLow     = () => basePayload({ vehicles: [baseVehicle('Fendt 942 Vario', { fuelPercent: 50 })] });
const scenarioEventsFuelWarnBoundaryOk      = () => basePayload({ vehicles: [baseVehicle('Fendt 942 Vario', { fuelPercent: 51 })] });
const scenarioEventsFuelFullBoundaryLow     = () => basePayload({ vehicles: [baseVehicle('Fendt 942 Vario', { fuelPercent: 94 })] });
const scenarioEventsFuelFullBoundaryOk      = () => basePayload({ vehicles: [baseVehicle('Fendt 942 Vario', { fuelPercent: 95 })] });
const scenarioEventsAnimalFoodCriticalLow   = () => basePayload({ animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 20, waterPercent: 70, productivity: 80 }] });
const scenarioEventsAnimalFoodCriticalOk    = () => basePayload({ animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 21, waterPercent: 70, productivity: 80 }] });
const scenarioEventsAnimalCountFlash = makeEventsScenario(
    { animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, maxCount: 20, foodPercent: 60, productivity: 80 }] },
    { animals: [{ husbandryName: 'Kravín', type: 'COW', count: 11, maxCount: 20, foodPercent: 60, productivity: 80 }] }
);
const scenarioEventsStorageItemFlashUp = makeEventsScenario(
    { storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }] },
    { storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 52000, capacity: 200000 }] }] }
);
const scenarioEventsStorageItemFlashDown = makeEventsScenario(
    { storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }] },
    { storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 44000, capacity: 200000 }] }] }
);
// Only Pšenice changes (50000→52000), Ječmen stays fixed → header always flashes up,
// no opposing item cancel. Both items are present so the header aggregation runs.
const scenarioEventsStorageHeaderOnlyFlash = makeEventsScenario(
    { storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }, { name: 'Ječmen', amount: 20000, capacity: 200000 }] }] },
    { storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 52000, capacity: 200000 }, { name: 'Ječmen', amount: 20000, capacity: 200000 }] }] }
);
const scenarioEventsSiloDonutWarnBoundaryLow  = () => basePayload({ storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 138000, capacity: 200000 }] }] }); // 69%
const scenarioEventsSiloDonutWarnBoundaryOk   = () => basePayload({ storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 140000, capacity: 200000 }] }] }); // 70%
const scenarioEventsSiloDonutFullBoundaryLow  = () => basePayload({ storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 188000, capacity: 200000 }] }] }); // 94%
const scenarioEventsSiloDonutFullBoundaryOk   = () => basePayload({ storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 190000, capacity: 200000 }] }] }); // 95%
const scenarioEventsProductionItemFlashUp = makeEventsScenario(
    { productions: [{ name: 'Pekárna',
        items: [{ name: 'Chléb', amount: 1100, capacity: 20000 }],
        productions: [{ name: 'Chléb', status: 'active', inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Chléb', amount: 1100, capacity: 20000 }] }] }] },
    { productions: [{ name: 'Pekárna',
        items: [{ name: 'Chléb', amount: 1300, capacity: 20000 }],
        productions: [{ name: 'Chléb', status: 'active', inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Chléb', amount: 1300, capacity: 20000 }] }] }] }
);
const scenarioEventsProductionItemFlashDown = makeEventsScenario(
    { productions: [{ name: 'Pekárna',
        items: [{ name: 'Chléb', amount: 1100, capacity: 20000 }],
        productions: [{ name: 'Chléb', status: 'active', inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Chléb', amount: 1100, capacity: 20000 }] }] }] },
    { productions: [{ name: 'Pekárna',
        items: [{ name: 'Chléb', amount: 900, capacity: 20000 }],
        productions: [{ name: 'Chléb', status: 'active', inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Chléb', amount: 900, capacity: 20000 }] }] }] }
);
const scenarioEventsPriceFlashUp = makeEventsScenario(
    { prices: [{ sellPoint: 'Getreidelager Bergmann', items: [{ name: 'Pšenice', pricePerTon: 240 }] }] },
    { prices: [{ sellPoint: 'Getreidelager Bergmann', items: [{ name: 'Pšenice', pricePerTon: 265 }] }] }
);
const scenarioEventsPriceFlashDown = makeEventsScenario(
    { prices: [{ sellPoint: 'Getreidelager Bergmann', items: [{ name: 'Pšenice', pricePerTon: 240 }] }] },
    { prices: [{ sellPoint: 'Getreidelager Bergmann', items: [{ name: 'Pšenice', pricePerTon: 215 }] }] }
);
const scenarioEventsFlashSectionToggleOff = makeEventsScenario(
    { storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] },
    { storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 55000, capacity: 200000 }] }] }
);
const scenarioEventsFlashSubchannelStorageHeaderOff = makeEventsScenario(
    { storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] },
    { storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 55000, capacity: 200000 }] }] }
);
const scenarioEventsFlashSubchannelVehiclesImplOff = makeEventsScenario(
    { vehicles: [baseVehicle('Fendt 942 Vario', { implements: [{ name: 'Opalenica', fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: 9000, capacityL: 18000, percent: 50 }] }] })] },
    { vehicles: [baseVehicle('Fendt 942 Vario', { implements: [{ name: 'Opalenica', fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: 10800, capacityL: 18000, percent: 60 }] }] })] }
);

// ─── Prices state-coverage scenarios ─────────────────────────────────────────
function scenarioPricesSingleSellPoint() {
    return basePayload({ prices: [{ sellPoint: 'Silo Bergmann', items: [{ name: 'Pšenice', pricePerTon: 240 }, { name: 'Ječmen', pricePerTon: 210 }] }], storage: [{ storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] });
}
function scenarioPricesMultiSellPoint() {
    return basePayload({ prices: [
        { sellPoint: 'Silo Bergmann', items: [{ name: 'Pšenice', pricePerTon: 240 }] },
        { sellPoint: 'BGA Bergmann',  items: [{ name: 'Ječmen', pricePerTon: 210 }] },
    ], storage: [{ storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] });
}
const scenarioPricesNeutralBoundaryLow   = () => basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 499 }] }] });
const scenarioPricesMediumBoundaryLow    = () => basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 500 }] }] });
const scenarioPricesMediumBoundaryOk     = () => basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 799 }] }] });
const scenarioPricesHighBoundaryLow      = () => basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 800 }] }] });
// Monotonic flash-up: price always increases (300+tick) → always flash-up.
const scenarioPricesFlashUp = makeMonotonicScenario(function(tick) {
    return { prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 + tick }] }] };
});
// Monotonic flash-down: price always decreases (400-tick) → always flash-down.
const scenarioPricesFlashDown = makeMonotonicScenario(function(tick) {
    return { prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: Math.max(100, 400 - tick) }] }] };
});
const scenarioPricesFlashDisabled = makeEventsScenario(
    { prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 }] }] },
    { prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 340 }] }] }
);
const scenarioPricesStockVisible = () => basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 }] }], storage: [{ storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 5000, capacity: 200000 }] }] });
const scenarioPricesOwnedOnly = () => basePayload({
    prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 }, { name: 'Ječmen', pricePerTon: 210 }] }],
    storage: [{ storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 5000, capacity: 200000 }] }]
});
const scenarioPricesSellpointHidden = () => scenarioPricesMultiSellPoint();
const scenarioPricesAllHidden = () => scenarioPricesMultiSellPoint();
const scenarioPricesGroupCollapsed = () => scenarioPricesMultiSellPoint();
const scenarioPricesItemHidden = () => scenarioPricesSingleSellPoint();
function scenarioPricesForecastEmpty() {
    // Explicitly set priceForecast: null so chart shows empty state.
    const p = basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 }] }] });
    p.priceForecast = null;
    return p;
}
const scenarioPricesForecastNoDataForCommodity = () => {
    const p = basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 }] }] });
    p.priceForecast = { currentPeriod: 1, daysPerPeriod: 1, fillTypes: basePriceForecast().fillTypes.filter(f => f.name !== 'Pšenice') };
    return p;
};
const scenarioPricesForecastCurrentMonthBar    = () => { const p = basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 }] }] }); p.priceForecast = basePriceForecast(6); return p; };
const scenarioPricesForecastTop3Months         = () => { const p = basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 }] }] }); p.priceForecast = basePriceForecast(1); return p; };
const scenarioPricesForecastBottom3Months      = () => { const p = basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 }] }] }); p.priceForecast = basePriceForecast(1); return p; };
const scenarioPricesForecastWatchMarker        = () => { const p = basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 }] }] }); p.priceForecast = basePriceForecast(3); return p; };
const scenarioPricesForecastSummaryVisible     = () => { const p = basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Pšenice', pricePerTon: 300 }] }] }); p.priceForecast = basePriceForecast(1); return p; };
const scenarioPricesDropdownOwnedFirst         = () => scenarioPricesStockVisible();
const scenarioPricesBalanceTrendUp             = () => basePayload({ farmBalance: 250000, farmBalanceDeltaDay: 5000 });
const scenarioPricesBalanceTrendDown           = () => basePayload({ farmBalance: 200000, farmBalanceDeltaDay: -5000 });
const scenarioPricesBalanceTrendFlat           = () => basePayload({ farmBalance: 200000, farmBalanceDeltaDay: 0 });

// ─── Productions state-coverage scenarios ────────────────────────────────────
function makeProductionPayload(recipes, overrides) {
    // NOTE: index.html uses p.productions for recipe array (not p.recipes)
    const factory = Object.assign({ factoryName: 'Pekárna', factoryType: 'FOOD_COMPANY', cyclesPerHour: 2.5, costsPerHour: 120 }, overrides || {});
    factory.productions = recipes;  // must be 'productions' (the field name the renderer reads)
    factory.name = factory.factoryName;  // also set p.name for the key
    return basePayload({ productions: [factory] });
}
const scenarioProductionsActive = () => makeProductionPayload([{ name: 'Mouka', status: 'active', cyclesPerHour: 2.5, costsPerHour: 120, inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Mouka', amount: 80, capacity: 400 }] }]);
const scenarioProductionsInactive = () => makeProductionPayload([{ name: 'Mouka', status: 'inactive', cyclesPerHour: 0, costsPerHour: 0, inputs: [{ name: 'Pšenice', amount: 0, capacity: 500 }], outputs: [{ name: 'Mouka', amount: 20, capacity: 400 }] }]);
const scenarioProductionsNoInput = () => makeProductionPayload([{ name: 'Mouka', status: 'noInput', cyclesPerHour: 0, costsPerHour: 0, inputs: [{ name: 'Pšenice', amount: 0, capacity: 500 }], outputs: [{ name: 'Mouka', amount: 20, capacity: 400 }] }]);
const scenarioProductionsOutputFull = () => makeProductionPayload([{ name: 'Mouka', status: 'outputFull', cyclesPerHour: 0, costsPerHour: 0, inputs: [{ name: 'Pšenice', amount: 200, capacity: 500 }], outputs: [{ name: 'Mouka', amount: 390, capacity: 400 }] }]);
const scenarioProductionsUnknown = () => makeProductionPayload([{ name: 'Mouka', status: 'unknown', cyclesPerHour: 0, costsPerHour: 0, inputs: [], outputs: [{ name: 'Mouka', amount: 10, capacity: 400 }] }]);
const scenarioProductionsBarBoundaryLow  = () => makeProductionPayload([{ name: 'Mouka', status: 'active', cyclesPerHour: 2, costsPerHour: 100, inputs: [{ name: 'Pšenice', amount: 138, capacity: 200 }], outputs: [{ name: 'Mouka', amount: 138, capacity: 200 }] }], { items: [{ name: 'Mouka', amount: 138, capacity: 200 }] }); // 69%
const scenarioProductionsBarBoundaryOk   = () => makeProductionPayload([{ name: 'Mouka', status: 'active', cyclesPerHour: 2, costsPerHour: 100, inputs: [{ name: 'Pšenice', amount: 140, capacity: 200 }], outputs: [{ name: 'Mouka', amount: 140, capacity: 200 }] }], { items: [{ name: 'Mouka', amount: 140, capacity: 200 }] }); // 70%
const scenarioProductionsBarBoundary94   = () => makeProductionPayload([{ name: 'Mouka', status: 'active', cyclesPerHour: 2, costsPerHour: 100, inputs: [{ name: 'Pšenice', amount: 188, capacity: 200 }], outputs: [{ name: 'Mouka', amount: 188, capacity: 200 }] }], { items: [{ name: 'Mouka', amount: 188, capacity: 200 }] }); // 94%
const scenarioProductionsBarBoundary95   = () => makeProductionPayload([{ name: 'Mouka', status: 'active', cyclesPerHour: 2, costsPerHour: 100, inputs: [{ name: 'Pšenice', amount: 190, capacity: 200 }], outputs: [{ name: 'Mouka', amount: 190, capacity: 200 }] }], { items: [{ name: 'Mouka', amount: 190, capacity: 200 }] }); // 95%
// Monotonic increasing output amount so the production header flashes UP on
// every tick (no oscillation). Large capacity so it keeps rising for the whole
// test window without hitting the cap (which would flatten the value → no flash).
const scenarioProductionsFlash = makeMonotonicScenario(tick => {
    const amount = 1000 + tick * 500;
    return { productions: [{ name: 'Pekárna', factoryType: 'FOOD_COMPANY', cyclesPerHour: 2, costsPerHour: 100,
        items: [{ name: 'Mouka', amount, capacity: 200000 }],
        productions: [{ name: 'Mouka', status: 'active', inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Mouka', amount, capacity: 200000 }] }] }] };
});
const scenarioProductionsCycles = () => makeProductionPayload([{ name: 'Mouka', status: 'active', cyclesPerHour: 3, costsPerHour: 150, inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Mouka', amount: 80, capacity: 400 }] }]);
const scenarioProductionsCyclesHidden = () => makeProductionPayload([{ name: 'Mouka', status: 'active', cyclesPerHour: 0, costsPerHour: 0, inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Mouka', amount: 80, capacity: 400 }] }]);
const scenarioProductionsCost = () => makeProductionPayload([
    { name: 'Mouka', status: 'active', cyclesPerHour: 2, costsPerHour: 120, inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Mouka', amount: 80, capacity: 400 }] },
    { name: 'Celozrnné', status: 'inactive', cyclesPerHour: 0, costsPerHour: 0, inputs: [{ name: 'Pšenice', amount: 50, capacity: 500 }], outputs: [{ name: 'Celozrnné', amount: 40, capacity: 400 }] },
]);
const scenarioProductionsRecycled = () => makeProductionPayload([{ name: 'Biopalivo', status: 'active', cyclesPerHour: 1, costsPerHour: 80,
    inputs: [{ name: 'Plevel', amount: 10, capacity: 200 }, { name: 'Biopalivo', amount: 5, capacity: 100 }],
    outputs: [{ name: 'Biopalivo', amount: 15, capacity: 100 }] }],
    { items: [{ name: 'Plevel', amount: 10, capacity: 200 }, { name: 'Biopalivo', amount: 5, capacity: 100 }] });
const scenarioProductionsActiveOnly = () => makeProductionPayload([
    { name: 'Mouka', status: 'active', cyclesPerHour: 2, costsPerHour: 120, inputs: [], outputs: [] },
], {});
const scenarioProductionsInputsVisible = () => makeProductionPayload([{ name: 'Mouka', status: 'active', cyclesPerHour: 2, costsPerHour: 100,
    inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Mouka', amount: 80, capacity: 400 }] }]);
const scenarioProductionsMultiFactory = () => basePayload({ productions: [
    { name: 'Pekárna', factoryType: 'FOOD_COMPANY', cyclesPerHour: 2, costsPerHour: 100,
      items: [{ name: 'Mouka', amount: 5200, capacity: 20000 }],
      productions: [{ name: 'Mouka', status: 'active', inputs: [], outputs: [] }] },
    { name: 'Oleárna', factoryType: 'OIL_MILL', cyclesPerHour: 0, costsPerHour: 0,
      items: [{ name: 'Olej', amount: 800, capacity: 20000 }],
      productions: [{ name: 'Olej', status: 'inactive', inputs: [], outputs: [] }] },
] });

// ─── Storage state-coverage scenarios ────────────────────────────────────────
// Use 'Testovací silo' as the storage name since storage.spec.js expects it.
const ST_SILO = 'Testovací silo';
const scenarioStorageEmptyPayload = () => basePayload({ storage: [] });
const scenarioStorageBarWarnBoundaryLow  = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 138000, capacity: 200000 }] }] }); // 69%
const scenarioStorageBarWarnBoundaryOk   = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 140000, capacity: 200000 }] }] }); // 70%
const scenarioStorageBarFullBoundaryLow  = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 188000, capacity: 200000 }] }] }); // 94%
const scenarioStorageBarFullBoundaryOk   = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 190000, capacity: 200000 }] }] }); // 95%
const scenarioStorageDonutAbsent         = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 0, capacity: 0 }] }] });
const scenarioStorageSiloEmptyItems      = () => basePayload({ storage: [{ storageName: ST_SILO, items: [] }] });
const scenarioStorageHideEmptyFilter     = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 0, capacity: 200000 }, { name: 'Ječmen', amount: 10000, capacity: 200000 }] }] });
const scenarioStorageShowCapacityOff     = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] });
const scenarioStorageShowBarOff          = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] });
const scenarioStorageShowPercentOff      = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] });
const scenarioStorageExpandedSingle      = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] });
const scenarioStorageExpandedMulti       = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 80000, capacity: 200000 }, { name: 'Ječmen', amount: 60000, capacity: 200000 }] }] });
const scenarioStorageCollapsedGroup      = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] });
const scenarioStorageHiddenByUser        = () => basePayload({ storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }, { storageName: 'Silo B', items: [{ name: 'Ječmen', amount: 10000, capacity: 200000 }] }] });
const scenarioStorageFlashUpHeader = makeEventsScenario(
    { storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] },
    { storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 55000, capacity: 200000 }] }] }
);
const scenarioStorageFlashDownHeader = makeEventsScenario(
    { storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 55000, capacity: 200000 }] }] },
    { storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] }
);
const scenarioStorageFlashItemLevel = makeEventsScenario(
    { storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] },
    { storage: [{ storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 52000, capacity: 200000 }] }] }
);
const scenarioStorageBellFullMultiSilo   = () => basePayload({ storage: [
    { storageName: ST_SILO, items: [{ name: 'Pšenice', amount: 190000, capacity: 200000 }] }, // 95%
    { storageName: 'Silo B', items: [{ name: 'Ječmen', amount: 50000, capacity: 200000 }] },   // 25%
] });

// ─── Themes state-coverage scenarios ─────────────────────────────────────────
// Most theme tests just need dashboard data to render; stub with low-fuel data.
function scenarioThemesBase() {
    return basePayload({
        farmBalance: 200000, farmBalanceDeltaDay: 1000,
        fields: [
            baseField(1, { isReadyToHarvest: true, daysToHarvest: 0, growthPercent: 100, owned: true }),
            baseField(2, { fruitTypeId: 'WHEAT', fruitName: 'Pšenice', growthPercent: 60, owned: true, weedLevel: 1, stoneLevel: 0 }),
            baseField(3, { fruitTypeId: '', fruitName: '', needsSowing: true, owned: true }),
            baseField(4, { fruitTypeId: '', fruitName: '', owned: true }),
        ],
        vehicles: [
            baseVehicle('Fendt 942 Vario', { fuelPercent: 20, conditionPercent: 75, isInUse: true, speedKmh: 12,
                implements: [{ name: 'Opalenica', fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: 16200, capacityL: 18000, percent: 90 }] }],
                aiTask: { type: 'courseplay' } }),
            baseVehicle('CLAAS LEXION 8900', { fuelPercent: 72, conditionPercent: 45, isInUse: false, typeName: 'Kombajn',
                adBluePercent: 65, adBlueLiters: 42, adBlueCapacity: 65 }),
        ],
        animals: [
            { husbandryName: 'Kravín', type: 'COW', count: 14, maxCount: 20, productivity: 75,
              foodPercent: 24, waterPercent: 90, milkPercent: 89, reproductionStatus: 'cycling', reproductionPercent: 70,
              clusters: [
                { subType: 'COW_HOLSTEIN', count: 7, age: 24, health: 90, reproduction: 70, sellPrice: 1450, reproStatus: 'cycling' },
                { subType: 'COW_ANGUS',    count: 7, age: 18, health: 85, reproduction: 30, sellPrice: 1600, reproStatus: 'blocked' },
              ] },
        ],
        storage: [
            { storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 140000, capacity: 200000 }] },  // 70%
            { storageName: 'Silo B', items: [{ name: 'Ječmen', amount: 188000, capacity: 200000 }] },   // 94%
        ],
        productions: [
            { factoryName: 'Pekárna', factoryType: 'FOOD_COMPANY', cyclesPerHour: 2, costsPerHour: 100,
              recipes: [
                { name: 'Mouka', status: 'active', cyclesPerHour: 2, costsPerHour: 100, inputs: [{ name: 'Pšenice', amount: 100, capacity: 500 }], outputs: [{ name: 'Mouka', amount: 80, capacity: 400 }] },
                { name: 'Šrot',  status: 'noInput', cyclesPerHour: 0, costsPerHour: 0, inputs: [{ name: 'Ječmen', amount: 0, capacity: 200 }], outputs: [{ name: 'Šrot', amount: 50, capacity: 300 }] },
              ] },
        ],
        prices: [
            { sellPoint: 'Silo Bergmann', items: [{ name: 'Pšenice', pricePerTon: 820 }, { name: 'Ječmen', pricePerTon: 520 }, { name: 'Kukuřice', pricePerTon: 450 }] },
        ],
    });
}
function scenarioThemesBalanceDeltaDown() {
    return basePayload({ farmBalance: 200000, farmBalanceDeltaDay: -5000 });
}
function scenarioThemesBalanceDeltaUp() {
    return basePayload({ farmBalance: 250000, farmBalanceDeltaDay: 5000 });
}
function scenarioThemesProgressbarDangerLow() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 942 Vario', { fuelPercent: 20 }),
        baseVehicle('CLAAS LEXION', { fuelPercent: 72 }),
    ]});
}
function scenarioThemesProgressbarWarnBoundaries() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 21%', { fuelPercent: 21, name: 'Fendt 21%' }),
        baseVehicle('Fendt 50%', { fuelPercent: 50, name: 'Fendt 50%' }),
        baseVehicle('Fendt 72%', { fuelPercent: 72, name: 'Fendt 72%' }),
    ]});
}
function scenarioThemesProgressbarFullBoundary() {
    return basePayload({ storage: [
        { storageName: 'Silo 95%', items: [{ name: 'Pšenice', amount: 190000, capacity: 200000 }] },
        { storageName: 'Silo 94%', items: [{ name: 'Pšenice', amount: 188000, capacity: 200000 }] },
    ]});
}
function scenarioThemesSiloDonutBoundaries() {
    return basePayload({ storage: [
        { storageName: 'Silo 69%', items: [{ name: 'Pšenice', amount: 138000, capacity: 200000 }] },
        { storageName: 'Silo 70%', items: [{ name: 'Pšenice', amount: 140000, capacity: 200000 }] },
        { storageName: 'Silo 95%', items: [{ name: 'Pšenice', amount: 190000, capacity: 200000 }] },
    ]});
}
function scenarioThemesVehicleConditionBoundaries() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 80%', { conditionPercent: 80, name: 'Fendt 80%' }),
        baseVehicle('Fendt 79%', { conditionPercent: 79, name: 'Fendt 79%' }),
        baseVehicle('Fendt 49%', { conditionPercent: 49, name: 'Fendt 49%' }),
    ]});
}
function scenarioThemesImplementFillBoundaries() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 90%', { name: 'Fendt 90%', implements: [{ name: 'Impl90', fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: 9000, capacityL: 10000, percent: 90 }] }] }),
        baseVehicle('Fendt 50%', { name: 'Fendt 50%', implements: [{ name: 'Impl50', fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: 5000, capacityL: 10000, percent: 50 }] }] }),
        baseVehicle('Fendt 0%',  { name: 'Fendt 0%',  implements: [{ name: 'Impl0',  fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: 0, capacityL: 10000, percent: 0 }] }] }),
    ]});
}
function scenarioThemesAnimalAlertBoundaries() {
    return basePayload({ animals: [
        { husbandryName: 'Alert Kravín', type: 'COW', count: 10, foodPercent: 24, waterPercent: 80, productivity: 80 },
        { husbandryName: 'OK Vepřín', type: 'PIG', count: 10, foodPercent: 26, waterPercent: 80, productivity: 80 },
    ]});
}
function scenarioThemesAnimalMilkManureAlert() {
    return basePayload({ animals: [
        { husbandryName: 'Full Milk', type: 'COW', count: 10, foodPercent: 60, waterPercent: 80, milkPercent: 90, productivity: 80 },
        { husbandryName: 'No Alert', type: 'COW', count: 10, foodPercent: 60, waterPercent: 80, milkPercent: 89, productivity: 80 },
    ]});
}
function scenarioThemesFieldWeedBadgeBoundaries() {
    return basePayload({ fields: [
        baseField(1, { weedState: 5 }),
        baseField(2, { weedState: 4 }),
        baseField(3, { weedState: 2 }),
    ]});
}
function scenarioThemesFieldSprayLevelAll() {
    return basePayload({ fields: [
        baseField(1, { sprayLevel: 0 }),
        baseField(2, { sprayLevel: 1 }),
        baseField(3, { sprayLevel: 2 }),
    ]});
}
function scenarioThemesFieldNeedChipBad() {
    return basePayload({ fields: [
        baseField(1, { weedLevel: 2 }),
        baseField(2, { weedLevel: 1 }),
    ]});
}
function scenarioThemesFieldTagAll() {
    return basePayload({ fields: [
        baseField(1, { isReadyToHarvest: true, daysToHarvest: 0, growthPercent: 100 }),
        baseField(2, { fruitTypeId: 'WHEAT', fruitName: 'Pšenice', growthPercent: 60, isReadyToHarvest: false }),
        baseField(3, { fruitTypeId: '', fruitName: '', needsSowing: true }),
        baseField(4, { fruitTypeId: '', fruitName: '', needsSowing: false }),
    ]});
}
function scenarioThemesFieldDaysToHarvestYellow() {
    return basePayload({ fields: [
        baseField(1, { daysToHarvest: 2 }),
        baseField(2, { isReadyToHarvest: true, daysToHarvest: 0, growthPercent: 100 }),
    ]});
}
function scenarioThemesProductionStatusAll() {
    return basePayload({ productions: [{ name: 'Pekárna', factoryType: 'FOOD_COMPANY', cyclesPerHour: 2, costsPerHour: 100,
        items: [{ name: 'Active', amount: 100, capacity: 400 }],
        productions: [
        { name: 'Active', status: 'active', cyclesPerHour: 2, costsPerHour: 100, inputs: [], outputs: [] },
        { name: 'NoInput', status: 'noInput', cyclesPerHour: 0, costsPerHour: 0, inputs: [], outputs: [] },
        { name: 'OutputFull', status: 'outputFull', cyclesPerHour: 0, costsPerHour: 0, inputs: [], outputs: [] },
    ]}]});
}
function scenarioThemesCommodityPriceBoundaries() {
    return basePayload({ prices: [{ sellPoint: 'Silo', items: [{ name: 'Drahá', pricePerTon: 800 }, { name: 'Střední', pricePerTon: 550 }, { name: 'Levná', pricePerTon: 400 }] }] });
}
const scenarioThemesFlashRowDown = makeEventsScenario(
    { storage: [{ storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 55000, capacity: 200000 }] }] },
    { storage: [{ storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] }
);
const scenarioThemesFlashRowUp = makeEventsScenario(
    { storage: [{ storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }] },
    { storage: [{ storageName: 'Silo A', items: [{ name: 'Pšenice', amount: 55000, capacity: 200000 }] }] }
);
function scenarioThemesAnimalReproBadgeAll() {
    return basePayload({ animals: [
        { husbandryName: 'Kravín Cycling', type: 'COW', count: 10, foodPercent: 60, productivity: 80,
          reproductionPercent: 70, reproductionStatus: 'cycling', clusters: [] },
        { husbandryName: 'Kravín Blocked', type: 'COW', count: 5, foodPercent: 60, productivity: 75,
          reproductionPercent: 30, reproductionStatus: 'blocked', clusters: [] },
        { husbandryName: 'Kravín Young', type: 'COW', count: 8, foodPercent: 60, productivity: 70,
          reproductionPercent: 20, reproductionStatus: 'young', clusters: [] },
    ]});
}
function scenarioThemesBellHasAlerts() {
    return basePayload({
        vehicles: [baseVehicle('Fendt low', { name: 'Fendt low', fuelPercent: 8, fuelCapacity: 400 })],
        animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 10, waterPercent: 80, productivity: 80 }],
    });
}
function scenarioThemesSectionHidden() { return scenarioThemesBase(); }
function scenarioThemesExpandedSections() { return scenarioThemesBase(); }
function scenarioThemesAdblueBar() {
    return basePayload({ vehicles: [
        baseVehicle('CLAAS Adblue', { name: 'CLAAS Adblue', typeName: 'Kombajn', adBluePercent: 65, adBlueLiters: 42, adBlueCapacity: 65 }),
    ]});
}
function scenarioThemesCondBadgeAll() {
    return basePayload({ fields: [
        baseField(1, { weedState: 2, weedLevel: 0, stoneLevel: 0, needsPlowing: false }),
        baseField(2, { weedState: 4, weedLevel: 1, stoneLevel: 0, needsPlowing: false }),
        baseField(3, { weedState: 6, weedLevel: 2, stoneLevel: 2, needsPlowing: true }),
    ]});
}
function scenarioThemesSecCfgBtnHasCustom() { return scenarioThemesBase(); }
function scenarioThemesNotifBtnOn() { return scenarioThemesBase(); }
function scenarioThemesFlashToggleChecked() { return scenarioThemesBase(); }
function scenarioThemesWsDotStates() { return scenarioThemesBase(); }
function scenarioThemesMobileNav() { return scenarioThemesBase(); }
function scenarioThemesReplayBanner() { return scenarioThemesBase(); }
function scenarioThemesMockupMode() { return scenarioThemesBase(); }
function scenarioThemesSettingsTabActive() { return scenarioThemesBase(); }
function scenarioThemesBalanceHistoryDelta() {
    return basePayload({ farmBalance: 200000, farmBalanceDeltaDay: 5000 });
}

// ─── Vehicles state-coverage scenarios ───────────────────────────────────────
function scenarioVehiclesFuelBarDangerVsBell() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 942 Vario', { fuelPercent: 18 }),                 // danger + no bell (<15% threshold is 15, 18 > 15)
        baseVehicle('CLAAS LEXION 8900', { typeName: 'Kombajn', fuelPercent: 70 }), // no danger
    ]});
}
function scenarioVehiclesFuelBarBoundaryDangerWarn() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 20%', { name: 'Fendt 20%', fuelPercent: 20 }),
        baseVehicle('Fendt 21%', { name: 'Fendt 21%', fuelPercent: 21 }),
    ]});
}
function scenarioVehiclesFuelBarBoundaryWarnOk() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 50%', { name: 'Fendt 50%', fuelPercent: 50 }),
        baseVehicle('Fendt 51%', { name: 'Fendt 51%', fuelPercent: 51 }),
    ]});
}
function scenarioVehiclesFuelBarFullBoundary() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 95%', { name: 'Fendt 95%', fuelPercent: 95 }),
        baseVehicle('Fendt 94%', { name: 'Fendt 94%', fuelPercent: 94 }),
    ]});
}
function scenarioVehiclesBellLowfuelBoundary() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 14%', { name: 'Fendt 14%', fuelPercent: 14 }),    // < 15 → bell
        baseVehicle('Fendt 15%', { name: 'Fendt 15%', fuelPercent: 15 }),    // not < 15 → no bell
    ]});
}
function scenarioVehiclesBellFuelCapZeroTrap() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 0%',  { name: 'Fendt 0%', fuelPercent: 0, fuelCapacity: 0 }), // no tank = no bell
        baseVehicle('Kolečko',   { name: 'Kolečko', typeName: 'Vozík', fuelPercent: 0, fuelLiters: 0, fuelCapacity: 0 }),
    ]});
}
function scenarioVehiclesConditionGreenVsYellow() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 80%', { name: 'Fendt 80%', conditionPercent: 80 }),
        baseVehicle('Fendt 79%', { name: 'Fendt 79%', conditionPercent: 79 }),
    ]});
}
function scenarioVehiclesConditionYellowVsRed() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 50%', { name: 'Fendt 50%', conditionPercent: 50 }),
        baseVehicle('Fendt 49%', { name: 'Fendt 49%', conditionPercent: 49 }),
    ]});
}
function scenarioVehiclesSpeedShownVsHidden() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt Moving', { name: 'Fendt Moving', isInUse: true, speedKmh: 12 }),
        baseVehicle('Fendt Parked', { name: 'Fendt Parked', isInUse: false, speedKmh: 0 }),
    ]});
}
function scenarioVehiclesEngineHoursToggle() {
    return basePayload({ vehicles: [baseVehicle('Fendt 942 Vario', { motorHours: 315.5 })] });
}
function scenarioVehiclesDotActiveVsIdle() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt Active', { name: 'Fendt Active', isInUse: true, speedKmh: 5 }),
        baseVehicle('Fendt Idle',   { name: 'Fendt Idle', isInUse: false }),
    ]});
}
function scenarioVehiclesActiveOnlyFilter() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt Active', { name: 'Fendt Active', isInUse: true }),
        baseVehicle('Fendt Idle1',  { name: 'Fendt Idle1', isInUse: false }),
        baseVehicle('Fendt Idle2',  { name: 'Fendt Idle2', isInUse: false }),
    ]});
}
// Monotonic: fill always increases (50→51→52…→95) so flash-up is deterministic.
const scenarioVehiclesFlashUpDownImpl = makeMonotonicScenario(function(tick) {
    const pct = Math.min(95, 50 + tick);
    const lvl = Math.round(18000 * pct / 100);
    return { vehicles: [baseVehicle('Fendt 942 Vario', { implements: [{ name: 'Opalenica', fillUnits: [{ fillType: 'GRASS', typeTitle: 'Tráva', levelL: lvl, capacityL: 18000, percent: pct }] }] })] };
});
function scenarioVehiclesAiBadgeShownVsHidden() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt VM', { name: 'Fendt VM', isInUse: true, aiTask: { source: 'vanilla', jobClass: 'FIELDWORK' } }),
        baseVehicle('Fendt CP', { name: 'Fendt CP', isInUse: true, aiTask: { source: 'courseplay', jobClass: 'Courseplay' } }),
        baseVehicle('Fendt AD', { name: 'Fendt AD', isInUse: true, aiTask: { source: 'autodrive', mode: 1 } }),
        baseVehicle('Fendt Idle', { name: 'Fendt Idle', isInUse: false }),
    ]});
}
function scenarioVehiclesAdblueExpanded() {
    return basePayload({ vehicles: [
        baseVehicle('CLAAS Adblue', { name: 'CLAAS Adblue', typeName: 'Kombajn', fuelPercent: 70, adBluePercent: 65, adBlueLiters: 42, adBlueCapacity: 65 }),
    ]});
}
function scenarioVehiclesImplSummaryEmptyVsFilled() {
    return basePayload({ vehicles: [
        baseVehicle('Traktor-impl', { name: 'Traktor-impl', isInUse: false, implements: [
            { name: 'Impl1-empty',  fillUnits: [{ fillType: 'EMPTY',  typeTitle: '',        levelL: 0,     capacityL: 18000, percent: 0  }] },
            { name: 'Impl2-wheat',  fillUnits: [{ fillType: 'WHEAT',  typeTitle: 'Pšenice', levelL: 22800, capacityL: 24000, percent: 95 }] },
            { name: 'Impl3-wheat',  fillUnits: [{ fillType: 'WHEAT',  typeTitle: 'Pšenice', levelL: 14400, capacityL: 24000, percent: 60 }] },
            { name: 'Impl4-wheat',  fillUnits: [{ fillType: 'WHEAT',  typeTitle: 'Pšenice', levelL: 7200,  capacityL: 24000, percent: 30 }] },
        ]}),
    ]});
}
function scenarioVehiclesImplVirowBasic() {
    return basePayload({ vehicles: [
        baseVehicle('Traktor-vi', { name: 'Traktor-vi', isInUse: false, implements: [
            { name: 'Impl1-90pct',  fillUnits: [{ fillType: 'WHEAT',  typeTitle: 'Pšenice', levelL: 21600, capacityL: 24000, percent: 90 }] },
            { name: 'Impl2-water',  fillUnits: [{ fillType: 'WATER',  typeTitle: 'Voda',    levelL: 300,   capacityL: 600,   percent: 50 }] },
            { name: 'Impl3-20pct',  fillUnits: [{ fillType: 'WHEAT',  typeTitle: 'Pšenice', levelL: 4800,  capacityL: 24000, percent: 20 }] },
            { name: 'Impl4-empty',  fillUnits: [{ fillType: '',       typeTitle: '',        levelL: 0,     capacityL: 5000,  percent: 0  }] },
        ]}),
    ]});
}
function scenarioVehiclesImplChipsExpanded() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt 942 Vario', { name: 'Fendt 942 Vario', isInUse: true, implements: [
            { name: 'Impl-multi', fillUnits: [
                { fillType: 'WHEAT',  typeTitle: 'Pšenice', levelL: 12000, capacityL: 24000, percent: 50 },
                { fillType: 'BARLEY', typeTitle: 'Ječmen',  levelL: 6000,  capacityL: 24000, percent: 25 },
                { fillType: 'CANOLA', typeTitle: 'Řepka',   levelL: 2880,  capacityL: 24000, percent: 12 },
            ]},
        ]}),
    ]});
}
function scenarioVehiclesConditionNull() {
    return basePayload({ vehicles: [
        baseVehicle('Fendt NullCond', { name: 'Fendt NullCond', conditionPercent: null }),
    ]});
}
// 'custom' scenario — provides vehicles/animals that satisfy the most common inline-payload tests.
// Inline payload in POST /mock/scenario is ignored by the server; this scenario is used instead.
function scenarioCustom(_t) {
    return basePayload({
        farmBalance: 200000, farmBalanceDeltaDay: 0,
        fields: [],
        vehicles: [
            // Fendt 942 Vario with adBlue (for adblue test) and fuelPercent=18 (danger, > FUEL_LOW=15 so no bell)
            baseVehicle('Fendt 942 Vario', {
                fuelPercent: 18, fuelLiters: 72, fuelCapacity: 400,
                conditionPercent: 90, isInUse: false,
                adBluePercent: 4, adBlueLiters: 2, adBlueCapacity: 55,
                implements: [],
            }),
            // CLAAS LEXION 8900 healthy
            baseVehicle('CLAAS LEXION 8900', { typeName: 'Kombajn', fuelPercent: 70, conditionPercent: 90 }),
        ],
        animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, waterPercent: 70, productivity: 80 }],
        storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 50000, capacity: 200000 }] }],
    });
}

// ─── KPI additional scenarios ─────────────────────────────────────────────────
function scenarioKpiTimeDisplay() {
    return basePayload({ gameTime: '09:00:00' });
}

// One owned field with >3 needs so the calendar needs-cell overflows:
// weedLevel 2 (urgent) + stoneLevel 2 (urgent) + needsPlowing (warn) +
// needsLime (warn) = 4 pills → 3 shown + "+1" overflow badge.
function scenarioCalendarNeedsOverflow() {
    return basePayload({ gameDay: 121, gameYear: 3, fields: [
        baseField(1, { owned: true, fruitTypeId: 'WHEAT', fruitName: 'Pšenice',
            weedLevel: 2, stoneLevel: 2, needsPlowing: true, needsLime: true }),
    ]});
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
    'layout-stress':    scenarioLayoutStress,
    // Weather typeId tests
    'st-weather-typeid-sun':            scenarioWeatherTypeIdSun,
    'st-weather-typeid-slunecno':       scenarioWeatherTypeIdSlunecno,
    'st-weather-typeid-polojasno':      scenarioWeatherTypeIdPolojasno,
    'st-weather-typeid-oblacno':        scenarioWeatherTypeIdOblacno,
    'st-weather-typeid-dest':           scenarioWeatherTypeIdDest,
    'st-weather-typeid-snezeni':        scenarioWeatherTypeIdSnezeni,
    'st-weather-typeid-bourka':         scenarioWeatherTypeIdBourka,
    'st-weather-typeid-kroupy':         scenarioWeatherTypeIdKroupy,
    'st-weather-typeid-boundary-ok':    scenarioWeatherTypeIdBoundaryOk,
    'st-weather-typeid-boundary-low':   scenarioWeatherTypeIdBoundaryLow,
    'st-weather-typeid-boundary-high':  scenarioWeatherTypeIdBoundaryHigh,
    'st-weather-typeid-null':           scenarioWeatherTypeIdNull,
    'st-weather-temp-present':          scenarioWeatherTempPresent,
    'st-weather-temp-missing':          scenarioWeatherTempMissing,
    'st-weather-minmax-present':        scenarioWeatherMinMaxPresent,
    'st-weather-minmax-missing':        scenarioWeatherMinMaxMissing,
    'st-weather-forecast-visible':      scenarioWeatherForecastVisible,
    'st-weather-forecast-boundary-one': scenarioWeatherForecastBoundaryOne,
    'st-weather-forecast-empty':        scenarioWeatherForecastEmpty,
    'st-weather-forecast-null':         scenarioWeatherForecastNull,
    'st-weather-forecast-icon-fallback':scenarioWeatherForecastIconFallback,
    'st-weather-forecast-temp-missing': scenarioWeatherForecastTempMissing,
    // Animals state-coverage tests
    'st-animals-bar-danger':                    scenarioAnimalsBarDanger,
    'st-animals-bar-warn':                      scenarioAnimalsBarWarn,
    'st-animals-bar-ok':                        scenarioAnimalsBarOk,
    'st-animals-bar-full-output':               scenarioAnimalsBarFullOutput,
    'st-animals-bar-boundary-20-low':           scenarioAnimalsBarBoundary20,
    'st-animals-bar-boundary-21-ok':            scenarioAnimalsBarBoundary21,
    'st-animals-bar-boundary-50-warn':          scenarioAnimalsBarBoundary50,
    'st-animals-bar-boundary-51-ok':            scenarioAnimalsBarBoundary51,
    'st-animals-bar-boundary-94-ok':            scenarioAnimalsBarBoundary94,
    'st-animals-bar-boundary-95-full':          scenarioAnimalsBarBoundary95,
    'st-animals-alarm-loThr-boundary-24':       scenarioAnimalsAlarmLoThr24,
    'st-animals-alarm-loThr-boundary-25':       scenarioAnimalsAlarmLoThr25,
    'st-animals-alarm-hiThr-boundary-89':       scenarioAnimalsAlarmHiThr89,
    'st-animals-alarm-hiThr-boundary-90':       scenarioAnimalsAlarmHiThr90,
    'st-animals-alarm-off':                     scenarioAnimalsAlarmOff,
    'st-animals-alert-empty-pen-no-alert':      scenarioAnimalsAlertEmptyPen,
    'st-animals-repro-ready':                   scenarioAnimalsReproReady,
    'st-animals-repro-cycling':                 scenarioAnimalsReproCycling,
    'st-animals-repro-paused':                  scenarioAnimalsReproPaused,
    'st-animals-repro-blocked':                 scenarioAnimalsReproBlocked,
    'st-animals-repro-young':                   scenarioAnimalsReproYoung,
    'st-animals-repro-unsupported':             scenarioAnimalsReproUnsupported,
    'st-animals-repro-fallback-high':           scenarioAnimalsReproFallbackHigh,
    'st-animals-repro-fallback-low':            scenarioAnimalsReproFallbackLow,
    'st-animals-repro-hidden':                  scenarioAnimalsReproHidden,
    'st-animals-bars-visibility-water-null':    scenarioAnimalsBarVisibilityWaterNull,
    'st-animals-bars-visibility-toggles-off':   scenarioAnimalsBarVisibilityTogglesOff,
    'st-animals-expanded-atcap':                scenarioAnimalsExpandedAtCap,
    'st-animals-expanded-herdvalue':            scenarioAnimalsExpandedHerdValue,
    'st-animals-expanded-liters-tonnes':        scenarioAnimalsExpandedLitersTonnes,
    'st-animals-flash-count':                   scenarioAnimalsFlashCount,
    'st-animals-flash-barlabel':                scenarioAnimalsFlashBarlabel,
    'st-animals-flash-health':                  scenarioAnimalsFlashHealth,
    'st-animals-flash-repro':                   scenarioAnimalsFlashRepro,
    'st-animals-modal-repro-cells':             scenarioAnimalsModalReproCells,
    'st-animals-modal-fillrows-visibility':     scenarioAnimalsModalFillrowsVisibility,
    // Bell notification tests
    'st-bell-anim-food-boundary-low':   scenarioBellAnimFoodBoundaryLow,
    'st-bell-anim-food-boundary-ok':    scenarioBellAnimFoodBoundaryOk,
    'st-bell-anim-water-boundary-low':  scenarioBellAnimWaterBoundaryLow,
    'st-bell-anim-water-boundary-ok':   scenarioBellAnimWaterBoundaryOk,
    'st-bell-anim-food-empty-pen':      scenarioBellAnimFoodEmptyPen,
    'st-bell-anim-straw-boundary-low':  scenarioBellAnimStrawBoundaryLow,
    'st-bell-anim-straw-boundary-ok':   scenarioBellAnimStrawBoundaryOk,
    'st-bell-anim-output-boundary-ok':  scenarioBellAnimOutputBoundaryOk,
    'st-bell-anim-output-boundary-low': scenarioBellAnimOutputBoundaryLow,
    'st-bell-field-ready':              scenarioBellFieldReady,
    'st-bell-veh-fuel-boundary-low':    scenarioBellVehFuelBoundaryLow,
    'st-bell-veh-fuel-boundary-ok':     scenarioBellVehFuelBoundaryOk,
    'st-bell-storage-boundary-ok':      scenarioBellStorageBoundaryOk,
    'st-bell-storage-boundary-low':     scenarioBellStorageBoundaryLow,
    'st-bell-empty-all-healthy':        scenarioBellEmptyAllHealthy,
    // Fields state-coverage tests
    'st-fields-tag-priority':             scenarioFieldsTagPriority,
    'st-fields-growth-bar-thresholds':    scenarioFieldsGrowthBarThresholds,
    'st-fields-days-to-harvest':          scenarioFieldsDaysToHarvest,
    'st-fields-condition-badge-weedstate':scenarioFieldsConditionBadgeWeedstate,
    'st-fields-action-chips':             scenarioFieldsActionChips,
    'st-fields-spray-column':             scenarioFieldsSprayColumn,
    'st-fields-extra-columns-toggle':     scenarioFieldsExtraColumnsToggle,
    'st-fields-crop-cell':                scenarioFieldsCropCell,
    'st-fields-farmland-cell':            scenarioFieldsFarmlandCell,
    'st-fields-bell-ready-boundary':      scenarioFieldsBellReadyBoundary,
    'st-fields-empty-state':              scenarioFieldsEmptyState,
    // KPI additional
    'st-kpi-balance-delta-neutral':       scenarioKpiBalanceDeltaNeutral,
    'st-kpi-time-display':                scenarioKpiTimeDisplay,
    'st-calendar-needs-overflow':         scenarioCalendarNeedsOverflow,
    // Flash state-coverage tests
    'st-flash-noflash-static':            scenarioFlashNoflashStatic,
    'st-flash-balance-boundary-low':      scenarioFlashBalanceBoundaryLow,
    'st-flash-balance-boundary-ok':       scenarioFlashBalanceBoundaryOk,
    'st-flash-impl-boundary-low':         scenarioFlashImplBoundaryLow,
    'st-flash-impl-boundary-ok':          scenarioFlashImplBoundaryOk,
    'st-flash-impl-air-skip':             scenarioFlashImplAirSkip,
    'st-flash-animals-count-boundary':    scenarioFlashAnimalsCountBoundary,
    'st-flash-animals-input-bars':        scenarioFlashAnimalsInputBars,
    'st-flash-animals-output-bars':       scenarioFlashAnimalsOutputBars,
    'st-flash-animals-health-repro':      scenarioFlashAnimalsHealthRepro,
    'st-flash-storage-header-item':       scenarioFlashStorageHeaderItem,
    'st-flash-productions-header-item':   scenarioFlashProductionsHeaderItem,
    'st-flash-price-up-down':             scenarioFlashPriceUpDown,
    'st-flash-field-grow-harvest':        scenarioFlashFieldGrowHarvest,
    'st-flash-antipin-continuous':        scenarioFlashAntipinContinuous,
    'st-flash-toggle-suppressed':         scenarioFlashToggleSuppressed,
    // Events state-coverage tests
    'custom-events-balance-flash-up':                  scenarioEventsBalanceFlashUp,
    'custom-events-balance-flash-down':                scenarioEventsBalanceFlashDown,
    'custom-events-balance-flash-below-threshold':     scenarioEventsBalanceFlashBelowThreshold,
    'custom-events-field-growth-flash-up':             scenarioEventsFieldGrowthFlashUp,
    'custom-events-field-harvest-flash-down':          scenarioEventsFieldHarvestFlashDown,
    'custom-events-impl-fill-flash-up':                scenarioEventsImplFillFlashUp,
    'custom-events-impl-fill-flash-down':              scenarioEventsImplFillFlashDown,
    'custom-events-vehicle-in-use':                    scenarioEventsVehicleInUse,
    'custom-events-fuel-danger-boundary-low':          scenarioEventsFuelDangerBoundaryLow,
    'custom-events-fuel-danger-boundary-ok':           scenarioEventsFuelDangerBoundaryOk,
    'custom-events-fuel-warn-boundary-low':            scenarioEventsFuelWarnBoundaryLow,
    'custom-events-fuel-warn-boundary-ok':             scenarioEventsFuelWarnBoundaryOk,
    'custom-events-fuel-full-boundary-low':            scenarioEventsFuelFullBoundaryLow,
    'custom-events-fuel-full-boundary-ok':             scenarioEventsFuelFullBoundaryOk,
    'custom-events-animal-food-critical-boundary-low': scenarioEventsAnimalFoodCriticalLow,
    'custom-events-animal-food-critical-boundary-ok':  scenarioEventsAnimalFoodCriticalOk,
    'custom-events-animal-count-flash':                scenarioEventsAnimalCountFlash,
    'custom-events-storage-item-flash-up':             scenarioEventsStorageItemFlashUp,
    'custom-events-storage-item-flash-down':           scenarioEventsStorageItemFlashDown,
    'custom-events-storage-header-only-flash':         scenarioEventsStorageHeaderOnlyFlash,
    'custom-events-silo-donut-warn-boundary-low':      scenarioEventsSiloDonutWarnBoundaryLow,
    'custom-events-silo-donut-warn-boundary-ok':       scenarioEventsSiloDonutWarnBoundaryOk,
    'custom-events-silo-donut-full-boundary-low':      scenarioEventsSiloDonutFullBoundaryLow,
    'custom-events-silo-donut-full-boundary-ok':       scenarioEventsSiloDonutFullBoundaryOk,
    'custom-events-production-item-flash-up':          scenarioEventsProductionItemFlashUp,
    'custom-events-production-item-flash-down':        scenarioEventsProductionItemFlashDown,
    'custom-events-price-flash-up':                    scenarioEventsPriceFlashUp,
    'custom-events-price-flash-down':                  scenarioEventsPriceFlashDown,
    'custom-events-flash-section-toggle-off':          scenarioEventsFlashSectionToggleOff,
    'custom-events-flash-subchannel-storage-header-off': scenarioEventsFlashSubchannelStorageHeaderOff,
    'custom-events-flash-subchannel-vehicles-impl-off':  scenarioEventsFlashSubchannelVehiclesImplOff,
    // Prices state-coverage tests
    'st-prices-price-neutral-boundary-low':    scenarioPricesNeutralBoundaryLow,
    'st-prices-price-medium-boundary-low':     scenarioPricesMediumBoundaryLow,
    'st-prices-price-medium-boundary-ok':      scenarioPricesMediumBoundaryOk,
    'st-prices-price-high-boundary-low':       scenarioPricesHighBoundaryLow,
    'st-prices-flash-up':                      scenarioPricesFlashUp,
    'st-prices-flash-down':                    scenarioPricesFlashDown,
    'st-prices-flash-disabled':                scenarioPricesFlashDisabled,
    'st-prices-stock-visible':                 scenarioPricesStockVisible,
    'st-prices-owned-only':                    scenarioPricesOwnedOnly,
    'st-prices-sellpoint-hidden':              scenarioPricesSellpointHidden,
    'st-prices-all-hidden':                    scenarioPricesAllHidden,
    'st-prices-group-collapsed':               scenarioPricesGroupCollapsed,
    'st-prices-item-hidden':                   scenarioPricesItemHidden,
    'st-prices-forecast-empty':                scenarioPricesForecastEmpty,
    'st-prices-forecast-no-data-for-commodity':scenarioPricesForecastNoDataForCommodity,
    'st-prices-forecast-current-month-bar':    scenarioPricesForecastCurrentMonthBar,
    'st-prices-forecast-top3-months':          scenarioPricesForecastTop3Months,
    'st-prices-forecast-bottom3-months':       scenarioPricesForecastBottom3Months,
    'st-prices-forecast-watch-marker':         scenarioPricesForecastWatchMarker,
    'st-prices-forecast-summary-visible':      scenarioPricesForecastSummaryVisible,
    'st-prices-dropdown-owned-first':          scenarioPricesDropdownOwnedFirst,
    'st-prices-balance-trend-up':              scenarioPricesBalanceTrendUp,
    'st-prices-balance-trend-down':            scenarioPricesBalanceTrendDown,
    'st-prices-balance-trend-flat':            scenarioPricesBalanceTrendFlat,
    // Productions state-coverage tests
    'st-productions-active':           scenarioProductionsActive,
    'st-productions-inactive':         scenarioProductionsInactive,
    'st-productions-noinput':          scenarioProductionsNoInput,
    'st-productions-outputfull':       scenarioProductionsOutputFull,
    'st-productions-unknown':          scenarioProductionsUnknown,
    'st-productions-bar-69':           scenarioProductionsBarBoundaryLow,
    'st-productions-bar-70':           scenarioProductionsBarBoundaryOk,
    'st-productions-bar-94':           scenarioProductionsBarBoundary94,
    'st-productions-bar-95':           scenarioProductionsBarBoundary95,
    'st-productions-flash':            scenarioProductionsFlash,
    'st-productions-cycles':           scenarioProductionsCycles,
    'st-productions-cycles-hidden':    scenarioProductionsCyclesHidden,
    'st-productions-cost':             scenarioProductionsCost,
    'st-productions-recycled':         scenarioProductionsRecycled,
    'st-productions-active-only':      scenarioProductionsActiveOnly,
    'st-productions-inputs-visible':   scenarioProductionsInputsVisible,
    'st-productions-multi-factory':    scenarioProductionsMultiFactory,
    // Storage state-coverage tests
    'st-storage-empty-payload':            scenarioStorageEmptyPayload,
    'st-storage-bar-warn-boundary-low':    scenarioStorageBarWarnBoundaryLow,
    'st-storage-bar-warn-boundary-ok':     scenarioStorageBarWarnBoundaryOk,
    'st-storage-bar-full-boundary-low':    scenarioStorageBarFullBoundaryLow,
    'st-storage-bar-full-boundary-ok':     scenarioStorageBarFullBoundaryOk,
    'st-storage-donut-absent':             scenarioStorageDonutAbsent,
    'st-storage-silo-empty-items':         scenarioStorageSiloEmptyItems,
    'st-storage-hide-empty-filter':        scenarioStorageHideEmptyFilter,
    'st-storage-show-capacity-off':        scenarioStorageShowCapacityOff,
    'st-storage-show-bar-off':             scenarioStorageShowBarOff,
    'st-storage-show-percent-off':         scenarioStorageShowPercentOff,
    'st-storage-expanded-single-commodity':scenarioStorageExpandedSingle,
    'st-storage-expanded-multi-commodity-stack': scenarioStorageExpandedMulti,
    'st-storage-collapsed-group':          scenarioStorageCollapsedGroup,
    'st-storage-hidden-by-user':           scenarioStorageHiddenByUser,
    'st-storage-flash-up-header':          scenarioStorageFlashUpHeader,
    'st-storage-flash-down-header':        scenarioStorageFlashDownHeader,
    'st-storage-flash-item-level':         scenarioStorageFlashItemLevel,
    'st-storage-bell-full-multi-silo':     scenarioStorageBellFullMultiSilo,
    // Themes state-coverage tests
    'st-themes-theme-dark-green':          scenarioThemesBase,
    'st-themes-theme-dark-blue':           scenarioThemesBase,
    'st-themes-theme-light':               scenarioThemesBase,
    'st-themes-theme-high-contrast':       scenarioThemesBase,
    'st-themes-theme-fs25-native':         scenarioThemesBase,
    'st-themes-balance-kpi-boundary-low':  scenarioThemesBalanceDeltaDown,
    'st-themes-balance-kpi-boundary-ok':   scenarioThemesBalanceDeltaUp,
    'st-themes-balance-history-delta':     scenarioThemesBalanceHistoryDelta,
    'st-themes-progressbar-danger-boundary-low': scenarioThemesProgressbarDangerLow,
    'st-themes-progressbar-warn-boundaries':     scenarioThemesProgressbarWarnBoundaries,
    'st-themes-progressbar-full-boundary':       scenarioThemesProgressbarFullBoundary,
    'st-themes-silo-donut-boundaries':           scenarioThemesSiloDonutBoundaries,
    'st-themes-vehicle-condition-boundaries':    scenarioThemesVehicleConditionBoundaries,
    'st-themes-implement-fill-boundaries':       scenarioThemesImplementFillBoundaries,
    'st-themes-animal-alert-boundaries':         scenarioThemesAnimalAlertBoundaries,
    'st-themes-animal-milk-manure-alert':        scenarioThemesAnimalMilkManureAlert,
    'st-themes-field-weed-badge-boundaries':     scenarioThemesFieldWeedBadgeBoundaries,
    'st-themes-field-spray-level-all':           scenarioThemesFieldSprayLevelAll,
    'st-themes-field-need-chip-bad':             scenarioThemesFieldNeedChipBad,
    'st-themes-field-tag-all':                   scenarioThemesFieldTagAll,
    'st-themes-field-days-to-harvest-yellow':    scenarioThemesFieldDaysToHarvestYellow,
    'st-themes-production-status-all':           scenarioThemesProductionStatusAll,
    'st-themes-commodity-price-boundaries':      scenarioThemesCommodityPriceBoundaries,
    'st-themes-flash-row-down':                  scenarioThemesFlashRowDown,
    'st-themes-flash-row-up':                    scenarioThemesFlashRowUp,
    'st-themes-animal-repro-badge-all':          scenarioThemesAnimalReproBadgeAll,
    'st-themes-bell-has-alerts':                 scenarioThemesBellHasAlerts,
    'st-themes-section-hidden':                  scenarioThemesSectionHidden,
    'st-themes-expanded-sections':               scenarioThemesExpandedSections,
    'st-themes-adblue-bar':                      scenarioThemesAdblueBar,
    'st-themes-cond-badge-all':                  scenarioThemesCondBadgeAll,
    'st-themes-sec-cfg-btn-has-custom':          scenarioThemesSecCfgBtnHasCustom,
    'st-themes-notif-btn-on':                    scenarioThemesNotifBtnOn,
    'st-themes-flash-toggle-checked':            scenarioThemesFlashToggleChecked,
    'st-themes-ws-dot-states':                   scenarioThemesWsDotStates,
    'st-themes-mobile-nav':                      scenarioThemesMobileNav,
    'st-themes-replay-banner':                   scenarioThemesReplayBanner,
    'st-themes-mockup-mode':                     scenarioThemesMockupMode,
    'st-themes-settings-tab-active':             scenarioThemesSettingsTabActive,
    // Vehicles state-coverage tests
    'st-vehicles-fuel-bar-danger-vs-bell':     scenarioVehiclesFuelBarDangerVsBell,
    'st-vehicles-fuel-bar-boundary-danger-warn': scenarioVehiclesFuelBarBoundaryDangerWarn,
    'st-vehicles-fuel-bar-boundary-warn-ok':   scenarioVehiclesFuelBarBoundaryWarnOk,
    'st-vehicles-fuel-bar-full-boundary':      scenarioVehiclesFuelBarFullBoundary,
    'st-vehicles-bell-lowfuel-boundary':       scenarioVehiclesBellLowfuelBoundary,
    'st-vehicles-bell-fuelcap-zero-trap':      scenarioVehiclesBellFuelCapZeroTrap,
    'st-vehicles-condition-green-vs-yellow-boundary': scenarioVehiclesConditionGreenVsYellow,
    'st-vehicles-condition-yellow-vs-red-boundary':   scenarioVehiclesConditionYellowVsRed,
    'st-vehicles-speed-shown-vs-hidden':       scenarioVehiclesSpeedShownVsHidden,
    'st-vehicles-engine-hours-toggle':         scenarioVehiclesEngineHoursToggle,
    'st-vehicles-dot-active-vs-idle':          scenarioVehiclesDotActiveVsIdle,
    'st-vehicles-active-only-filter':          scenarioVehiclesActiveOnlyFilter,
    'st-vehicles-flash-up-down-impl':          scenarioVehiclesFlashUpDownImpl,
    'st-vehicles-ai-badge-shown-vs-hidden':    scenarioVehiclesAiBadgeShownVsHidden,
    'st-vehicles-adblue-indicator-expanded':   scenarioVehiclesAdblueExpanded,
    'st-vehicles-impl-summary-empty-vs-filled': scenarioVehiclesImplSummaryEmptyVsFilled,
    'st-vehicles-impl-virow-basic':            scenarioVehiclesImplVirowBasic,
    'st-vehicles-impl-chips-expanded':         scenarioVehiclesImplChipsExpanded,
    'st-vehicles-condition-null':              scenarioVehiclesConditionNull,
    // Prices aliases (prices.spec.js uses 'prices-*' names)
    'prices-neutral-boundary-low':    scenarioPricesNeutralBoundaryLow,
    'prices-medium-boundary-low':     scenarioPricesMediumBoundaryLow,
    'prices-medium-boundary-ok':      scenarioPricesMediumBoundaryOk,
    'prices-high-boundary-low':       scenarioPricesHighBoundaryLow,
    'prices-flash-up':                scenarioPricesFlashUp,
    'prices-flash-down':              scenarioPricesFlashDown,
    'prices-stock-visible':           scenarioPricesStockVisible,
    'prices-owned-only':              scenarioPricesOwnedOnly,
    'prices-sellpoint-hidden':        scenarioPricesSellpointHidden,
    'prices-all-hidden':              scenarioPricesAllHidden,
    'prices-group-collapsed':         scenarioPricesGroupCollapsed,
    'prices-item-hidden':             scenarioPricesItemHidden,
    'prices-forecast-empty':          scenarioPricesForecastEmpty,
    'prices-forecast-no-data':        scenarioPricesForecastNoDataForCommodity,
    'prices-forecast-current-month-bar': scenarioPricesForecastCurrentMonthBar,
    'prices-forecast-top3-months':    scenarioPricesForecastTop3Months,
    'prices-forecast-bottom3-months': scenarioPricesForecastBottom3Months,
    'prices-forecast-watch-marker':   scenarioPricesForecastWatchMarker,
    'prices-forecast-summary-visible':scenarioPricesForecastSummaryVisible,
    'prices-dropdown-owned-first':    scenarioPricesDropdownOwnedFirst,
    'prices-balance-trend-up':        scenarioPricesBalanceTrendUp,
    'prices-balance-trend-down':      scenarioPricesBalanceTrendDown,
    'prices-balance-trend-flat':      scenarioPricesBalanceTrendFlat,
    // Productions aliases (productions.spec.js uses 'productions-*' names)
    'productions-status-active':      scenarioProductionsActive,
    'productions-status-inactive':    scenarioProductionsInactive,
    'productions-status-noinput':     scenarioProductionsNoInput,
    'productions-status-outputfull':  scenarioProductionsOutputFull,
    'productions-status-unknown':     scenarioProductionsUnknown,
    'productions-bar-boundary-low':   scenarioProductionsBarBoundaryLow,
    'productions-bar-boundary-warn-low': scenarioProductionsBarBoundaryOk,
    'productions-bar-boundary-full-low':  scenarioProductionsBarBoundary94,
    'productions-bar-boundary-full-ok':   scenarioProductionsBarBoundary95,
    'productions-flash-amount-change':scenarioProductionsFlash,
    'productions-cycles-visible':     scenarioProductionsCycles,
    'productions-cycles-hidden':      scenarioProductionsCyclesHidden,
    'productions-cost-badge':         scenarioProductionsCost,
    'productions-recycled-input-output': scenarioProductionsRecycled,
    'productions-activeonly-hidden':  scenarioProductionsMultiFactory,
    'productions-inputs-outputs-visible': scenarioProductionsInputsVisible,
    // Storage aliases (storage.spec.js uses 'storage-*' names)
    'storage-empty':               scenarioStorageEmptyPayload,
    'storage-warn-boundary-low':   scenarioStorageBarWarnBoundaryLow,
    'storage-warn-boundary-ok':    scenarioStorageBarWarnBoundaryOk,
    'storage-full-boundary-low':   scenarioStorageBarFullBoundaryLow,
    'storage-full-boundary-ok':    scenarioStorageBarFullBoundaryOk,
    'storage-donut-absent':        scenarioStorageDonutAbsent,
    'storage-silo-empty-items':    scenarioStorageSiloEmptyItems,
    'storage-hide-empty':          scenarioStorageHideEmptyFilter,
    'storage-show-capacity-off':   scenarioStorageShowCapacityOff,
    'storage-show-bar-off':        scenarioStorageShowBarOff,
    'storage-show-percent-off':    scenarioStorageShowPercentOff,
    'storage-expanded-single':     scenarioStorageExpandedSingle,
    'storage-expanded-multi':      scenarioStorageExpandedMulti,
    'storage-collapsed-group':     scenarioStorageCollapsedGroup,
    'storage-hidden-by-user':      scenarioStorageHiddenByUser,
    'storage-flash-up-header':     scenarioStorageFlashUpHeader,
    'storage-flash-down-header':   scenarioStorageFlashDownHeader,
    'storage-flash-item-level':    scenarioStorageFlashItemLevel,
    'storage-bell-full-multi':     scenarioStorageBellFullMultiSilo,
    // Custom inline-payload scenario (for tests using request.post directly)
    'custom':                                  scenarioCustom,
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
    // Use hasOwnProperty to allow scenarios to explicitly set priceForecast:null.
    if (payload && typeof payload === 'object' && !Object.prototype.hasOwnProperty.call(payload, 'priceForecast')) {
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
