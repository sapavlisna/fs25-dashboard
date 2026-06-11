// flash.spec.js — FUNCTIONAL (non-screenshot) assertions over the Flash system.
// Documents flash-state contracts: when flash class is added/removed per trigger field,
// per gate (isFlashEnabled), per anti-pin logic, per boundary thresholds.
//
// Surface key: flash
// 16 test.describe scenarios covering: no-flash static, balance boundary (low/ok),
// impl boundary (low/ok), impl AIR skip, animal count/input-bars/output-bars/
// health-repro, storage header, production header, price up/down, field grow/harvest
// (owned vs unowned), anti-pin monotonic, toggle suppression.

const { test, expect } = require('@playwright/test');

// ── helpers ─────────────────────────────────────────────────────────────────

async function setScenario(request, name) {
    const resp = await request.post('/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario "${name}": ${resp.status()}`);
    // mock-data.js polls scenario file every 1s; allow for I/O + chokidar + WS broadcast.
    await new Promise(r => setTimeout(r, 3000));
}

async function gotoDashboard(page) {
    await page.goto('/');
    await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
    await page.waitForTimeout(500);
}

function balanceEl(page) {
    return page.locator('#kpi-balance');
}

function vehicleRow(page, name) {
    return page.locator('.vehicle-row', { has: page.locator('.vc-name', { hasText: name }) });
}

function animalRow(page, husbandryName) {
    return page.locator('.animal-row', { has: page.locator('.ac-name', { hasText: husbandryName }) });
}

function storageHeaderRow(page, storageName) {
    return page.locator('tr.st-row.collapsible', { hasText: storageName });
}

function storageItem(page, storageName, itemName) {
    return page.locator('.st-item', { has: page.locator('text=' + itemName) });
}

function productionHeaderRow(page, productionName) {
    return page.locator('tr.st-row.collapsible', { has: page.locator('text=' + productionName) });
}

function productionItem(page, productionName, itemName) {
    return page.locator('.ps-stock-row', { has: page.locator('text=' + itemName) });
}

function priceRow(page, sellPoint, itemName) {
    return page.locator('tr.group-item', { has: page.locator('text=' + itemName) });
}

function fieldRow(page, fieldId) {
    return page.locator(`#fields-body tr[data-tt-key="${fieldId}"]`);
}

function animalBarLabel(page, husbandryName, barLabel) {
    return animalRow(page, husbandryName).locator('.ac-bar-lbl[title="' + barLabel + '"]');
}

function animalSubVal(page, husbandryName) {
    return animalRow(page, husbandryName).locator('.ac-sub-val');
}

function animalRepoBadge(page, husbandryName) {
    return animalRow(page, husbandryName).locator('.ac-repro-badge');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

test.describe('flash — state: st-flash-noflash-static', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-noflash-static');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('no flash on static payload (first tick, no change)', async ({ page }) => {
        await gotoDashboard(page);

        // No flash class on balance (never changes)
        await expect(balanceEl(page)).not.toHaveClass(/flash-up|flash-down/);

        // No flash on vehicle row (fuel, impl percent static)
        await expect(vehicleRow(page, 'Fendt 942 Vario')).not.toHaveClass(/flash-up|flash-down/);

        // No flash on animal row (count, food, water, milk, etc. all static)
        await expect(animalRow(page, 'Kravín')).not.toHaveClass(/flash-up|flash-down/);

        // No flash on storage (amount static)
        await expect(storageHeaderRow(page, 'Hlavní silo')).not.toHaveClass(/flash-up|flash-down/);
    });
});

test.describe('flash — state: st-flash-balance-boundary-low', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-balance-boundary-low');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('balance delta below threshold → no flash', async ({ page }) => {
        await gotoDashboard(page);

        // Delta is <1000 → no flash-up or flash-down
        await expect(balanceEl(page)).not.toHaveClass(/flash-up|flash-down/);
    });
});

test.describe('flash — state: st-flash-balance-boundary-ok', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-balance-boundary-ok');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('balance delta above threshold → flash-up or flash-down', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const bal = balanceEl(page);

        const hasFlash = await Promise.race([
            expect(bal).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(bal).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);
    });
});

test.describe('flash — state: st-flash-impl-boundary-low', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-impl-boundary-low');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('impl percent: Math.round same → no flash despite sub-1% oscillation', async ({ page }) => {
        await gotoDashboard(page);

        // scenarioFlashImplBoundaryLow now oscillates the RAW percent inside one
        // integer (50.2 ↔ 50.7) across ticks. Math.round(percent) stays 50, so the
        // impl flash (which rounds before diffing, index.html:620) must NOT fire —
        // this genuinely exercises the rounding path, not a no-op constant value.
        // Wait across several ticks so the oscillation has actually happened.
        await page.waitForTimeout(7000);
        const vRow = vehicleRow(page, 'Fendt 942 Vario');
        await expect(vRow).not.toHaveClass(/flash-up|flash-down/);
    });
});

test.describe('flash — state: st-flash-impl-boundary-ok', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-impl-boundary-ok');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('impl percent: Math.round changes → flash-up or flash-down', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const vRow = vehicleRow(page, 'Fendt 942 Vario');

        const hasFlash = await Promise.race([
            expect(vRow).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(vRow).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);
    });
});

test.describe('flash — state: st-flash-impl-air-skip', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-impl-air-skip');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('impl fillType=AIR → no flash even though percent oscillates', async ({ page }) => {
        await gotoDashboard(page);

        // AIR fillType triggers skip (ř.619), no tracking
        const vRow = vehicleRow(page, 'Vzduchový vůz');
        await expect(vRow).not.toHaveClass(/flash-up|flash-down/);
    });
});

test.describe('flash — state: st-flash-animals-count-boundary', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-animals-count-boundary');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.removeItem('fs25.dash.v1.hidden:animals'); } catch (_) {}
        });
    });

    test('animal count changes → flash-up (increase) or flash-down (decrease)', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        // scenarioFlashAnimalsCountBoundary: count 10 → 11 (whole-row flash-up).
        const aRow = animalRow(page, 'Kravín');

        const hasFlash = await Promise.race([
            expect(aRow).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(aRow).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);
    });
});

test.describe('flash — state: st-flash-animals-input-bars', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-animals-input-bars');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.removeItem('fs25.dash.v1.hidden:animals'); } catch (_) {}
        });
    });

    test('animal input bars (food/water/straw) change → flash on .ac-bar-lbl', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const foodBar = animalBarLabel(page, 'Kravín', 'Krmivo');

        const hasFlash = await Promise.race([
            expect(foodBar).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(foodBar).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);

        // water and straw should also flash (same oscillation)
        const waterBar = animalBarLabel(page, 'Kravín', 'Voda');
        await expect(waterBar).toHaveClass(/flash-up|flash-down/, { timeout: 8000 });

        const strawBar = animalBarLabel(page, 'Kravín', 'Podestýlka');
        await expect(strawBar).toHaveClass(/flash-up|flash-down/, { timeout: 8000 });
    });
});

test.describe('flash — state: st-flash-animals-output-bars', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-animals-output-bars');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.removeItem('fs25.dash.v1.hidden:animals'); } catch (_) {}
        });
    });

    test('animal output bars (milk/manure/slurry) change → flash on .ac-bar-lbl', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const milkBar = animalBarLabel(page, 'Kravín', 'Mléko');

        const hasFlash = await Promise.race([
            expect(milkBar).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(milkBar).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);
    });
});

test.describe('flash — state: st-flash-animals-health-repro', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-animals-health-repro');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.removeItem('fs25.dash.v1.hidden:animals'); } catch (_) {}
        });
    });

    test('animal health (productivity) changes → flash on .ac-sub-val', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        // scenarioFlashAnimalsHealthRepro: productivity 80 → 82 (.ac-sub-val flash).
        const subVal = animalSubVal(page, 'Kravín');

        const hasFlash = await Promise.race([
            expect(subVal).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(subVal).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);
    });

    test('animal repro (reproductionPercent) changes → flash on .ac-repro-badge', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        // scenarioFlashAnimalsHealthRepro: reproductionPercent 70 → 73 (.ac-repro-badge flash).
        const badge = animalRepoBadge(page, 'Kravín');

        const hasFlash = await Promise.race([
            expect(badge).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(badge).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);
    });
});

test.describe('flash — state: st-flash-storage-header-item', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-storage-header-item');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('storage amount changes → flash on tr.st-row.collapsible header', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const headerRow = storageHeaderRow(page, 'Hlavní silo');

        const hasFlash = await Promise.race([
            expect(headerRow).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(headerRow).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);
    });
});

test.describe('flash — state: st-flash-productions-header-item', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-productions-header-item');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('production amount changes → flash on production header row', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        // production 'Pekárna' item amount changes between ticks →
        // header (tr.st-row.collapsible) flashes.
        const headerRow = productionHeaderRow(page, 'Pekárna');

        const hasFlash = await Promise.race([
            expect(headerRow).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(headerRow).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);
    });
});

test.describe('flash — state: st-flash-price-up-down', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-price-up-down');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('price changes → flash on price row', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const pRow = priceRow(page, 'Silo Bergmann', 'Pšenice');

        const hasFlash = await Promise.race([
            expect(pRow).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(pRow).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);
    });
});

test.describe('flash — state: st-flash-field-grow-harvest', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-field-grow-harvest');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('field growthState changes on owned field → flash', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const fRow = fieldRow(page, '1');

        const hasFlash = await Promise.race([
            expect(fRow).toHaveClass(/flash-up/, { timeout: 8000 }).then(() => true).catch(() => false),
            expect(fRow).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false)
        ]);

        expect(hasFlash).toBe(true);
    });

    test('field growthState changes on unowned field → no flash', async ({ page }) => {
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        // unowned field id=2 must NOT flash — fieldsOwnedOnly=true filters it out of DOM,
        // or if visible, flash suppression for unowned fields applies.
        const fRow = fieldRow(page, '2');
        const count = await fRow.count();
        if (count > 0) {
            // If somehow visible, must not have flash class
            await expect(fRow).not.toHaveClass(/flash-up|flash-down/);
        }
        // count===0 means field is not rendered (ownedOnly filter) → trivially no flash
    });
});

test.describe('flash — state: st-flash-antipin-continuous', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-antipin-continuous');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('impl fill increases every tick → only flash-up, never flash-down (anti-pin monotonic)', async ({ page }) => {
        await gotoDashboard(page);

        // scenarioFlashAntipinContinuous: percent = min(99, tick*5 + 10),
        // i.e. it ONLY ever increases (10, 15, 20, …). The anti-pin logic keeps
        // a single 10s flash alive and re-fires on the NEXT detected change after
        // expiry — but because the value is strictly monotonic, every flash that
        // ever fires must be flash-UP. A flash-down would mean the diff direction
        // (v > prev ? 'up' : 'down') was computed wrong, which is the real
        // contract this state guards.
        const vRow = vehicleRow(page, 'Fendt 942 Vario');

        // Wait for tick 1 to fire (antipin value increases monotonically → flash-up always)
        await page.waitForTimeout(2000);
        await expect(vRow).toHaveClass(/flash-up/, { timeout: 8000 });

        // The row must NEVER carry flash-down — value only ever rises.
        await expect(vRow).not.toHaveClass(/flash-down/);
    });
});

test.describe('flash — state: st-flash-toggle-suppressed', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-flash-toggle-suppressed');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('storage flash is suppressed when toggle is off (no class despite amount change)', async ({ page }) => {
        // Disable the 'storage' master flash toggle BEFORE the first render.
        // setFlashEnabled() persists the map under DashState.KEYS.flashEnabled,
        // i.e. localStorage key 'fs25.dash.v1.flashEnabled' = {"storage":false}
        // (NOT a nested 'dashState' object — that key is never read).
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.flashEnabled', JSON.stringify({ storage: false }));
            } catch (_) {}
        });
        await gotoDashboard(page);

        // scenarioFlashToggleSuppressed: Pšenice amount 50000 → 55000.
        // isFlashEnabled('storage') === false → getFlashCls returns '' → no class.
        const headerRow = storageHeaderRow(page, 'Hlavní silo');
        await expect(headerRow).not.toHaveClass(/flash-up|flash-down/);
    });
});
