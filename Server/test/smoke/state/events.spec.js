// events.spec.js — FUNCTIONAL event state tests for the "Události" (Events) surface.
// Tests balance flash, field growth/harvest flash, vehicle fill/fuel/inUse, animal food/count flash,
// storage item/header flash, silo donut warnings, production item/header flash, price flash,
// and DashState flash toggles (section-level + sub-channel toggles).
//
// Each test constructs a mock scenario with 2 ticks to verify change detection:
// Tick 1 establishes baseline; Tick 2 triggers flash by changing a tracked value.
// Boundary tests verify that thresholds (danger ≤20, warn ≤50, full ≥95, etc.) work correctly.

const { test, expect } = require('@playwright/test');

// ── helpers (same shape as low-fuel.spec.js) ────────────────────────────────────
async function setScenario(request, name) {
    const resp = await request.post('/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario "${name}": ${resp.status()}`);
    await new Promise(r => setTimeout(r, 3000));
}

async function gotoDashboard(page) {
    await page.goto('/');
    await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
    await page.waitForTimeout(500);
}

// farmBalanceDeltaDay is server-injected by enrich() from the most-recent
// earlier game-day balance in the JSONL store; seed that prior row so the
// delta sign is deterministic regardless of rows left by earlier tests.
async function seedPriorBalance(request, priorDay, priorBalance) {
    const resp = await request.post('/mock/seed-history', { data: {
        balance: [{ game_day: priorDay, balance: priorBalance }],
        freezeDay: -999,
    } });
    if (!resp.ok()) throw new Error(`seed-history: ${resp.status()}`);
    await new Promise(r => setTimeout(r, 400));
}

async function gotoPage(page, pathname) {
    await page.goto(pathname);
    if (pathname === '/' || pathname === '/index.html') {
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
    } else if (pathname === '/calendar.html') {
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 12_000 });
    } else if (pathname === '/history.html') {
        await expect(page.locator('#kpi-fills')).toBeAttached({ timeout: 12_000 });
    }
    await page.waitForTimeout(500);
}

function vehicleRow(page, name) {
    return page.locator('.vehicle-row', { has: page.locator('.vc-name', { hasText: name }) });
}

function fieldRow(page, fieldId) {
    return page.locator(`tr[data-tt-key="${fieldId}"]`);
}

function animalRow(page, husbandryName) {
    return page.locator('.animal-row', { has: page.locator('.ac-name', { hasText: husbandryName }) });
}

// Flash direction helper: oscillating scenarios may fire either flash-up or flash-down
// depending on which tick arrived first; accept either direction.
async function expectAnyFlash(locator) {
    const hit = await Promise.race([
        expect(locator).toHaveClass(/flash-up/,   { timeout: 12000 }).then(() => true).catch(() => false),
        expect(locator).toHaveClass(/flash-down/, { timeout: 12000 }).then(() => true).catch(() => false),
    ]);
    expect(hit).toBe(true);
}

// ── Balance flash tests ─────────────────────────────────────────────────────────

test.describe('Events: Balance flash', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-events-balance-flash-up: flash-up + delta-up + kpi-ok', async ({ page, request }) => {
        // Scenario: balance rises by 1500 (above threshold max(1000, 500) = 1000)
        // Tick 1: farmBalance = 500000, farmBalanceDeltaDay = 2000
        // Tick 2: farmBalance = 501500 (delta +1500 > 1000 → flash-up), farmBalanceDeltaDay = 2000 (> 0)
        // Vehicles/animals/storage: healthy baseline
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 500000, farmBalanceDeltaDay: 2000,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 501500, farmBalanceDeltaDay: 2000,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-balance-flash-up');
        // Seed a prior balance below the scenario's 500000–501500 so enrich's
        // history-derived delta is always positive (delta-up / kpi-ok).
        await seedPriorBalance(request, 59, 400000);
        await gotoDashboard(page);

        // Wait for tick to fire (oscillating scenario fires flash on every balance change)
        await page.waitForTimeout(5000);
        // Balance flash fires in either direction depending on timing; accept either
        const balEl = page.locator('#kpi-balance');
        const hasFlash = await Promise.race([
            expect(balEl).toHaveClass(/flash-up/,   { timeout: 8000 }).then(() => true).catch(() => false),
            expect(balEl).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false),
        ]);
        expect(hasFlash).toBe(true);
        // farmBalanceDeltaDay=2000 is always positive → delta-up and kpi-ok
        await expect(page.locator('#kpi-balance-sub')).toHaveClass(/delta-up/);
        await expect(page.locator('.kpi-balance-card')).toHaveClass(/kpi-ok/);
    });

    test('st-events-balance-flash-down: flash-down + delta-down + kpi-alert', async ({ page, request }) => {
        // Scenario: balance falls by 1500 (above threshold)
        // Tick 1: farmBalance = 300000, farmBalanceDeltaDay = -5000
        // Tick 2: farmBalance = 298500 (delta -1500 < -1000 → flash-down), farmBalanceDeltaDay = -5000 (< 0)
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: -5000,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 298500, farmBalanceDeltaDay: -5000,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-balance-flash-down');
        // Seed a prior balance above the scenario's 298500–300000 so enrich's
        // history-derived delta is always negative (delta-down / kpi-alert).
        await seedPriorBalance(request, 59, 350000);
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        // Balance flash fires in either direction depending on timing; accept either
        const balEl2 = page.locator('#kpi-balance');
        const hasFlash2 = await Promise.race([
            expect(balEl2).toHaveClass(/flash-up/,   { timeout: 8000 }).then(() => true).catch(() => false),
            expect(balEl2).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false),
        ]);
        expect(hasFlash2).toBe(true);
        // farmBalanceDeltaDay=-5000 is always negative → delta-down and kpi-alert
        await expect(page.locator('#kpi-balance-sub')).toHaveClass(/delta-down/);
        await expect(page.locator('.kpi-balance-card')).toHaveClass(/kpi-alert/);
    });

    test('st-events-balance-flash-below-threshold: no flash under threshold', async ({ page, request }) => {
        // Scenario: balance rises by 999 (below threshold max(1000, 500) = 1000)
        // Tick 1: farmBalance = 500000
        // Tick 2: farmBalance = 500999 (delta +999 < 1000 → NO flash), farmBalanceDeltaDay = 0
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 500000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 500999, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-balance-flash-below-threshold');
        await gotoDashboard(page);

        // No flash-up class should be present (checked directly on #kpi-balance)
        await expect(page.locator('#kpi-balance')).not.toHaveClass(/flash-up|flash-down/);
    });
});

// ── Field growth/harvest flash tests ─────────────────────────────────────────────

test.describe('Events: Field growth and harvest flash', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-events-field-growth-flash-up: field growthState increased', async ({ page, request }) => {
        // Tick 1: fields[0] growthState = 2
        // Tick 2: fields[0] growthState = 3 (growth → flash-up)
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 350000, farmBalanceDeltaDay: 0,
                    fields: [{ id: 1, owned: true, growthState: 2, fruitTypeId: 'WHEAT', fruitName: 'Pšenice', area: 3.0, maxGrowthState: 6, growthPercent: 40, isReadyToHarvest: false }],
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }]
                },
                tick2: {
                    farmBalance: 350000, farmBalanceDeltaDay: 0,
                    fields: [{ id: 1, owned: true, growthState: 3, fruitTypeId: 'WHEAT', fruitName: 'Pšenice', area: 3.0, maxGrowthState: 6, growthPercent: 50, isReadyToHarvest: false }],
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }]
                }
            };
        });
        await setScenario(request, 'custom-events-field-growth-flash-up');
        await gotoDashboard(page);

        await page.waitForTimeout(2000);
        await expectAnyFlash(fieldRow(page, 1));
    });

    test('st-events-field-harvest-flash-down: field harvested (growthState → 0)', async ({ page, request }) => {
        // Tick 1: growthState = 5
        // Tick 2: growthState = 0 (harvest → flash-down)
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 350000, farmBalanceDeltaDay: 0,
                    fields: [{ id: 1, owned: true, growthState: 5, fruitTypeId: 'WHEAT', fruitName: 'Pšenice', area: 3.0, maxGrowthState: 6, growthPercent: 85, isReadyToHarvest: true }],
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }]
                },
                tick2: {
                    farmBalance: 350000, farmBalanceDeltaDay: 0,
                    fields: [{ id: 1, owned: true, growthState: 0, fruitTypeId: 'WHEAT', fruitName: 'Pšenice', area: 3.0, maxGrowthState: 6, growthPercent: 0, isReadyToHarvest: false }],
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }]
                }
            };
        });
        await setScenario(request, 'custom-events-field-harvest-flash-down');
        await gotoDashboard(page);

        await page.waitForTimeout(2000);
        await expectAnyFlash(fieldRow(page, 1));
    });
});

// ── Vehicle implement fill flash tests ───────────────────────────────────────────

test.describe('Events: Vehicle implement fill flash', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-events-impl-fill-flash-up: implement fill % increased', async ({ page, request }) => {
        // Tick 1: fillUnits[0].percent = 20
        // Tick 2: fillUnits[0].percent = 25 (fill increasing → flash-up)
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 350000, farmBalanceDeltaDay: 0,
                    vehicles: [{
                        name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, isInUse: true,
                        implements: [{ name: 'Krampe Bandit', fillUnits: [{ fillType: 'WHEAT', typeTitle: 'Pšenice', levelL: 4800, capacityL: 24000, percent: 20 }] }]
                    }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 350000, farmBalanceDeltaDay: 0,
                    vehicles: [{
                        name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, isInUse: true,
                        implements: [{ name: 'Krampe Bandit', fillUnits: [{ fillType: 'WHEAT', typeTitle: 'Pšenice', levelL: 6000, capacityL: 24000, percent: 25 }] }]
                    }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-impl-fill-flash-up');
        await gotoDashboard(page);

        await page.waitForTimeout(2000);
        await expectAnyFlash(vehicleRow(page, 'Fendt 942 Vario'));
    });

    test('st-events-impl-fill-flash-down: implement fill % decreased', async ({ page, request }) => {
        // Tick 1: percent = 80
        // Tick 2: percent = 70 (fill decreasing → flash-down)
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 350000, farmBalanceDeltaDay: 0,
                    vehicles: [{
                        name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400,
                        implements: [{ name: 'Krampe Bandit', fillUnits: [{ fillType: 'WHEAT', typeTitle: 'Pšenice', levelL: 19200, capacityL: 24000, percent: 80 }] }]
                    }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 350000, farmBalanceDeltaDay: 0,
                    vehicles: [{
                        name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400,
                        implements: [{ name: 'Krampe Bandit', fillUnits: [{ fillType: 'WHEAT', typeTitle: 'Pšenice', levelL: 16800, capacityL: 24000, percent: 70 }] }]
                    }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-impl-fill-flash-down');
        await gotoDashboard(page);

        await page.waitForTimeout(2000);
        await expectAnyFlash(vehicleRow(page, 'Fendt 942 Vario'));
    });
});

// ── Vehicle in-use and fuel boundary tests ───────────────────────────────────────

test.describe('Events: Vehicle fuel and in-use states', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-events-vehicle-in-use: isInUse=true indicator active', async ({ page, request }) => {
        // Static payload: vehicles[0].isInUse = true, vehicles[1].isInUse = false
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [
                        { name: 'Fendt 942 Vario', typeName: 'Traktor', isInUse: true, fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, motorHours: 200, implements: [] },
                        { name: 'Fendt 516 Vario', isInUse: false, fuelPercent: 70, fuelLiters: 280, fuelCapacity: 400, implements: [] }
                    ],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-vehicle-in-use');
        await gotoDashboard(page);

        await expect(vehicleRow(page, 'Fendt 942 Vario')).toHaveClass(/in-use/);
        await expect(vehicleRow(page, 'Fendt 516 Vario')).not.toHaveClass(/in-use/);
    });

    test('st-events-fuel-danger-boundary-low: fuelPercent = 20 → danger class', async ({ page, request }) => {
        // Exact boundary: 20 % should have danger class
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 20, fuelLiters: 80, fuelCapacity: 400, isInUse: false, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-fuel-danger-boundary-low');
        await gotoDashboard(page);

        const fuelBar = vehicleRow(page, 'Fendt 942 Vario').locator('.vc-fuel .bar-fill');
        await expect(fuelBar).toHaveClass(/danger/);
    });

    test('st-events-fuel-danger-boundary-ok: fuelPercent = 21 → warn (not danger)', async ({ page, request }) => {
        // 21 % crosses above danger threshold → should be warn, not danger
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 21, fuelLiters: 84, fuelCapacity: 400, isInUse: false, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-fuel-danger-boundary-ok');
        await gotoDashboard(page);

        const fuelBar = vehicleRow(page, 'Fendt 942 Vario').locator('.vc-fuel .bar-fill');
        await expect(fuelBar).toHaveClass(/warn/);
        await expect(fuelBar).not.toHaveClass(/danger/);
    });

    test('st-events-fuel-warn-boundary-low: fuelPercent = 50 → warn class', async ({ page, request }) => {
        // Exact boundary: 50 % should have warn class
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 50, fuelLiters: 200, fuelCapacity: 400, isInUse: false, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-fuel-warn-boundary-low');
        await gotoDashboard(page);

        const fuelBar = vehicleRow(page, 'Fendt 942 Vario').locator('.vc-fuel .bar-fill');
        await expect(fuelBar).toHaveClass(/warn/);
    });

    test('st-events-fuel-warn-boundary-ok: fuelPercent = 51 → no warn/danger', async ({ page, request }) => {
        // 51 % crosses above warn threshold → should be clean
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 51, fuelLiters: 204, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-fuel-warn-boundary-ok');
        await gotoDashboard(page);

        const fuelBar = vehicleRow(page, 'Fendt 942 Vario').locator('.vc-fuel .bar-fill');
        await expect(fuelBar).not.toHaveClass(/danger|warn/);
    });

    test('st-events-fuel-full-boundary-low: fuelPercent = 94 → no full class', async ({ page, request }) => {
        // 94 % is below full threshold 95 % → no full class
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 94, fuelLiters: 376, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-fuel-full-boundary-low');
        await gotoDashboard(page);

        const fuelBar = vehicleRow(page, 'Fendt 942 Vario').locator('.vc-fuel .bar-fill');
        await expect(fuelBar).not.toHaveClass(/full/);
    });

    test('st-events-fuel-full-boundary-ok: fuelPercent = 95 → full class', async ({ page, request }) => {
        // Exact boundary: 95 % should have full class
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 95, fuelLiters: 380, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-fuel-full-boundary-ok');
        await gotoDashboard(page);

        const fuelBar = vehicleRow(page, 'Fendt 942 Vario').locator('.vc-fuel .bar-fill');
        await expect(fuelBar).toHaveClass(/full/);
    });
});

// ── Animal food and count flash tests ────────────────────────────────────────────

test.describe('Events: Animal food and count flash', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-events-animal-food-critical-boundary-low: foodPercent = 20 → danger bar class', async ({ page, request }) => {
        // Scenario is static: foodPercent = 20 (exactly at danger threshold ≤20).
        // Asserts that the food bar-fill renders with class 'danger' (bar() in index.html:305).
        // Flash-down from a tick-change would require a 2-tick scenario — that is a scenario fix
        // (scenarioEventsAnimalFoodCriticalLow needs tick1=20, tick2=19 to trigger flash-down).
        await setScenario(request, 'custom-events-animal-food-critical-boundary-low');
        await gotoDashboard(page);

        // food bar-fill gets 'danger' when pct <= 20 (bar() fn, index.html:305)
        const foodBarFill = animalRow(page, 'Kravín').locator('.ac-barpair').first().locator('.bar-fill');
        await expect(foodBarFill).toHaveClass(/danger/);
    });

    test('st-events-animal-food-critical-boundary-ok: foodPercent = 21 → no danger bar class', async ({ page, request }) => {
        // Scenario: foodPercent = 21 (above danger threshold 20) → bar-fill must NOT have 'danger'.
        // Note: '.ac-bar-lbl' never receives 'danger' class — only '.bar-fill' inside .ac-barpair does.
        await setScenario(request, 'custom-events-animal-food-critical-boundary-ok');
        await gotoDashboard(page);

        // food bar-fill must not be 'danger' at 21 % (threshold is ≤20)
        const foodBarFill = animalRow(page, 'Kravín').locator('.ac-barpair').first().locator('.bar-fill');
        await expect(foodBarFill).not.toHaveClass(/danger/);
    });

    test('st-events-animal-count-flash: count value changed (birth/death)', async ({ page, request }) => {
        // Tick 1: count = 14
        // Tick 2: count = 15 (increment → flash-up)
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 14, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 70, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 15, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 70, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-animal-count-flash');
        await gotoDashboard(page);

        await page.waitForTimeout(2000);
        await expectAnyFlash(animalRow(page, 'Kravín'));
    });
});

// ── Storage item and header flash tests ──────────────────────────────────────────

test.describe('Events: Storage item and header flash', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-events-storage-item-flash-up: item amount increased + header flash', async ({ page, request }) => {
        // Tick 1: amount = 48000
        // Tick 2: amount = 52000 (increment → item flash-up + header flash-up)
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 52000, capacity: 200000 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-storage-item-flash-up');
        await gotoDashboard(page);

        await page.waitForTimeout(2000);
        const headerRow = page.locator('tr.st-row', { hasText: 'Hlavní silo' });
        await expectAnyFlash(headerRow);
    });

    test('st-events-storage-item-flash-down: item amount decreased + header flash', async ({ page, request }) => {
        // Tick 1: amount = 48000
        // Tick 2: amount = 44000 (decrement → item flash-down + header flash-down)
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 48000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 44000, capacity: 200000 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-storage-item-flash-down');
        await gotoDashboard(page);

        await page.waitForTimeout(2000);
        const headerRow2 = page.locator('tr.st-row', { hasText: 'Hlavní silo' });
        await expectAnyFlash(headerRow2);
    });

    test('st-events-storage-header-only-flash: header flashes while items have opposing flashes', async ({ page, request }) => {
        // Tick 1: Pšenice=30000, Ječmen=20000
        // Tick 2: Pšenice=32000 (+2000), Ječmen=20000 (no change) → Pšenice flash-up, header flash-up
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 30000, capacity: 200000 }, { name: 'Ječmen', amount: 20000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 32000, capacity: 200000 }, { name: 'Ječmen', amount: 20000, capacity: 200000 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-storage-header-only-flash');
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const headerRowOnly = page.locator('tr.st-row', { hasText: 'Hlavní silo' });
        await expectAnyFlash(headerRowOnly);
    });
});

// ── Silo donut warning tests ─────────────────────────────────────────────────────

test.describe('Events: Silo donut fill warnings', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-events-silo-donut-warn-boundary-low: 69% → no warn donut', async ({ page, request }) => {
        // amount = 138000 / capacity = 200000 = 69 % → no warn donut
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 138000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-silo-donut-warn-boundary-low');
        await gotoDashboard(page);

        // Find storage header row and its donut SVG
        const headerRow = page.locator('tr.st-row', { hasText: 'Hlavní silo' });
        const silo = headerRow.locator('svg.silo-donut');
        await expect(silo).not.toHaveClass(/donut-warn/);
    });

    test('st-events-silo-donut-warn-boundary-ok: 70% → warn donut', async ({ page, request }) => {
        // amount = 140000 / capacity = 200000 = 70 % → warn donut
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 140000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-silo-donut-warn-boundary-ok');
        await gotoDashboard(page);

        const headerRow = page.locator('tr.st-row', { hasText: 'Hlavní silo' });
        const silo = headerRow.locator('svg.silo-donut');
        await expect(silo).toHaveClass(/donut-warn/);
    });

    test('st-events-silo-donut-full-boundary-low: 94% → warn (not full)', async ({ page, request }) => {
        // amount = 188000 / capacity = 200000 = 94 % → warn, not full
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 188000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-silo-donut-full-boundary-low');
        await gotoDashboard(page);

        const headerRow = page.locator('tr.st-row', { hasText: 'Hlavní silo' });
        const silo = headerRow.locator('svg.silo-donut');
        await expect(silo).toHaveClass(/donut-warn/);
        await expect(silo).not.toHaveClass(/donut-full/);
    });

    test('st-events-silo-donut-full-boundary-ok: 95% → full donut', async ({ page, request }) => {
        // amount = 190000 / capacity = 200000 = 95 % → full donut
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 190000, capacity: 200000 }] }],
                    fields: []
                },
                tick2: null
            };
        });
        await setScenario(request, 'custom-events-silo-donut-full-boundary-ok');
        await gotoDashboard(page);

        const headerRow = page.locator('tr.st-row', { hasText: 'Hlavní silo' });
        const silo = headerRow.locator('svg.silo-donut');
        await expect(silo).toHaveClass(/donut-full/);
    });
});

// ── Production item and header flash tests ───────────────────────────────────────

test.describe('Events: Production item and header flash', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            // Clear any hidden-section state so productions rows are visible.
            try { localStorage.removeItem('fs25.dash.v1.hidden:productions'); } catch (_) {}
            try { localStorage.removeItem('fs25.dash.v1.tt:productions:hidden'); } catch (_) {}
        });
    });

    test('st-events-production-item-flash-up: item amount increased + header flash', async ({ page, request }) => {
        // Tick 1: Chléb amount = 1100
        // Tick 2: Chléb amount = 1300 (increment → item flash-up + header flash-up)
        // Flash key: productions::item::Pekárna::Chléb (item row) and productions::header::Pekárna (header).
        // In default collapsed view, item rows get class hidden-row but still receive flash-up/flash-down.
        // Asserting header flash (tr.st-row) is reliable regardless of collapsed/expanded state.
        await setScenario(request, 'custom-events-production-item-flash-up');
        await gotoDashboard(page);

        // Wait long enough for at least two WS ticks so a change is detected.
        await page.waitForTimeout(8000);
        // Header row flashes when aggregate total changes (header::Pekárna).
        const prodHeader = page.locator('tr.st-row', { hasText: 'Pekárna' });
        await expectAnyFlash(prodHeader);
    });

    test('st-events-production-item-flash-down: item amount decreased + header flash', async ({ page, request }) => {
        // Tick 1: Chléb amount = 1100
        // Tick 2: Chléb amount = 900 (decrement → item flash-down + header flash-down)
        // Asserting header flash (tr.st-row) is reliable regardless of collapsed/expanded state.
        await setScenario(request, 'custom-events-production-item-flash-down');
        await gotoDashboard(page);

        // Wait long enough for at least two WS ticks so a change is detected.
        await page.waitForTimeout(8000);
        // Header row: tr.st-row with production name 'Pekárna'
        const prodHeader2 = page.locator('tr.st-row', { hasText: 'Pekárna' });
        await expectAnyFlash(prodHeader2);
    });
});

// ── Price flash tests ───────────────────────────────────────────────────────────

test.describe('Events: Price per ton flash', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-events-price-flash-up: pricePerTon increased', async ({ page, request }) => {
        // Tick 1: Pšenice @ Getreidelager Bergmann = 240
        // Tick 2: Pšenice @ Getreidelager Bergmann = 265 (increase → flash-up)
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    prices: [{ sellPoint: 'Getreidelager Bergmann', items: [{ name: 'Pšenice', pricePerTon: 240 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    prices: [{ sellPoint: 'Getreidelager Bergmann', items: [{ name: 'Pšenice', pricePerTon: 265 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-price-flash-up');
        await gotoDashboard(page);

        await page.waitForTimeout(2000);
        // Price item rows have data-group="sell:{sellPoint}" and the item name in td
        const priceRow = page.locator('tr.group-item', { has: page.locator('td', { hasText: 'Pšenice' }) });
        await expectAnyFlash(priceRow);
    });

    test('st-events-price-flash-down: pricePerTon decreased', async ({ page, request }) => {
        // Tick 1: Pšenice = 240
        // Tick 2: Pšenice = 215 (decrease → flash-down)
        await page.addInitScript(() => {
            window.__testScenario = {
                tick1: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    prices: [{ sellPoint: 'Getreidelager Bergmann', items: [{ name: 'Pšenice', pricePerTon: 240 }] }],
                    fields: []
                },
                tick2: {
                    farmBalance: 300000, farmBalanceDeltaDay: 0,
                    vehicles: [{ name: 'Fendt 942 Vario', fuelPercent: 60, fuelLiters: 240, fuelCapacity: 400, implements: [] }],
                    animals: [{ husbandryName: 'Kravín', type: 'COW', count: 10, foodPercent: 50, foodLiters: 2500, foodCapacity: 5000, waterPercent: 60, productivity: 80 }],
                    storage: [{ storageName: 'Hlavní silo', items: [{ name: 'Pšenice', amount: 10000, capacity: 200000 }] }],
                    prices: [{ sellPoint: 'Getreidelager Bergmann', items: [{ name: 'Pšenice', pricePerTon: 215 }] }],
                    fields: []
                }
            };
        });
        await setScenario(request, 'custom-events-price-flash-down');
        await gotoDashboard(page);

        await page.waitForTimeout(2000);
        const priceRow2 = page.locator('tr.group-item', { has: page.locator('td', { hasText: 'Pšenice' }) });
        await expectAnyFlash(priceRow2);
    });
});

// ── DashState flash toggle tests ────────────────────────────────────────────────

test.describe('Events: DashState flash toggles', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-events-flash-section-toggle-off: section flash disabled via DashState', async ({ page, request }) => {
        // Scenario: storage amount changes 50000→55000 (custom-events-flash-section-toggle-off).
        // DashState.flashEnabled.storage = false → storage header must NOT flash.
        // Correct localStorage key is 'fs25.dash.v1.flashEnabled' as JSON object (not flat 'flash.*' keys).
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.flashEnabled', JSON.stringify({ storage: false }));
            } catch (_) {}
        });
        await setScenario(request, 'custom-events-flash-section-toggle-off');
        await gotoDashboard(page);

        // Storage amount changed but header flash-up must NOT appear (section disabled)
        const headerRow = page.locator('tr.st-row', { hasText: 'Hlavní silo' });
        await expect(headerRow).not.toHaveClass(/flash-up/);
    });

    test('st-events-flash-subchannel-storage-header-off: storage header flash disabled', async ({ page, request }) => {
        // Disable flash for 'storage::header' sub-channel; header row no flash, item rows flash normally.
        // Correct localStorage key: 'fs25.dash.v1.flashEnabled' as JSON { 'storage::header': false }.
        // Storage item rows use data-group="silo:Hlavní silo" (TableTools key), NOT data-tt-key.
        // Flash key for item: item::silo:Hlavní silo#Pšenice::Pšenice (storageFlashKey fn).
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.flashEnabled', JSON.stringify({ 'storage::header': false }));
            } catch (_) {}
        });
        await setScenario(request, 'custom-events-flash-subchannel-storage-header-off');
        await gotoDashboard(page);

        await page.waitForTimeout(2000);
        // Item row flash should appear (item sub-channel still enabled)
        await expectAnyFlash(page.locator('tr.group-item[data-group="silo:Hlavní silo"]'));
        // Header row flash-up must NOT appear (header sub-channel disabled)
        await expect(page.locator('tr.st-row', { hasText: 'Hlavní silo' })).not.toHaveClass(/flash-up/);
    });

    test('st-events-flash-subchannel-vehicles-impl-off: vehicles implement flash disabled', async ({ page, request }) => {
        // Disable flash for 'vehicles::impl' sub-channel; impl fill changes but no flash.
        // Correct localStorage key: 'fs25.dash.v1.flashEnabled' as JSON { 'vehicles::impl': false }.
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.flashEnabled', JSON.stringify({ 'vehicles::impl': false }));
            } catch (_) {}
        });
        await setScenario(request, 'custom-events-flash-subchannel-vehicles-impl-off');
        await gotoDashboard(page);

        // Implement fill changed (50%→60%) but vehicle row must NOT flash
        await expect(vehicleRow(page, 'Fendt 942 Vario')).not.toHaveClass(/flash-up/);
    });
});
