// section-cfg.spec.js — per-section settings panel (⚙ in each section header).
// Covers: open/close lifecycle, basic + advanced toggles, persistence,
// expanded layout, reset-to-default (V-1), dirty indicator (V-2), note (V-3).

const { test, expect } = require('@playwright/test');

async function setMockScenario(request, name) {
    const resp = await request.post('http://localhost:3099/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario ${name}: ${resp.status()}`);
    await new Promise(r => setTimeout(r, 3000));
}

async function gotoDashboard(page, request, scenario = 'harvest-ready') {
    await setMockScenario(request, scenario);
    await page.goto('/');
    await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
    await page.waitForTimeout(1200);
}

// Flip a panel checkbox via JS (the <input> is sr-only behind .switch-knob).
async function flipCfg(page, cfgKey) {
    return page.evaluate(k => {
        const cb = document.querySelector(`#sec-cfg-panel input[data-cfg-key="${k}"]`);
        const before = cb.checked;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        return before;
    }, cfgKey);
}

function lsGet(page, key) {
    return page.evaluate(k => {
        try { return JSON.parse(localStorage.getItem('fs25.dash.v1.' + k) || 'null'); }
        catch { return null; }
    }, key);
}

const SECTIONS = [
    { key: 'fields',      title: 'Pole' },
    { key: 'vehicles',    title: 'Vozidla' },
    { key: 'animals',     title: 'Zvířata' },
    { key: 'storage',     title: 'Sklady' },
    { key: 'productions', title: 'Výrobny' },
    { key: 'prices',      title: 'Výkupní ceny' },
];

test.describe('Per-section settings — panel lifecycle', () => {
    test.use({ viewport: { width: 1440, height: 1600 } });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('every section has a ⚙ button that opens a panel with the right title', async ({ page, request }) => {
        await gotoDashboard(page, request);
        for (const s of SECTIONS) {
            const btn = page.locator(`.sec-cfg-btn[data-sec-cfg="${s.key}"]`);
            await expect(btn, `⚙ button for ${s.key} exists`).toHaveCount(1);
            await btn.click();
            const panel = page.locator('#sec-cfg-panel');
            await expect(panel).toBeVisible();
            await expect(panel.locator('.sec-cfg-header')).toContainText(s.title);
            // Close before next iteration
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();
        }
    });

    test('click outside closes the panel', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]').click();
        await expect(page.locator('#sec-cfg-panel')).toBeVisible();
        await page.locator('h1, .nav-brand').first().click();
        await expect(page.locator('#sec-cfg-panel')).toBeHidden();
    });

    test('second click on same ⚙ toggles the panel closed', async ({ page, request }) => {
        await gotoDashboard(page, request);
        const btn = page.locator('.sec-cfg-btn[data-sec-cfg="storage"]');
        await btn.click();
        await expect(page.locator('#sec-cfg-panel')).toBeVisible();
        await btn.click();
        await expect(page.locator('#sec-cfg-panel')).toBeHidden();
    });

    test('opening a different section swaps the single panel', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]').click();
        await expect(page.locator('#sec-cfg-panel .sec-cfg-header')).toContainText('Vozidla');
        await page.locator('.sec-cfg-btn[data-sec-cfg="animals"]').click();
        // Only ever one panel node, now showing the other section
        await expect(page.locator('#sec-cfg-panel')).toHaveCount(1);
        await expect(page.locator('#sec-cfg-panel .sec-cfg-header')).toContainText('Zvířata');
    });
});

test.describe('Per-section settings — toggles persist + apply', () => {
    test.use({ viewport: { width: 1440, height: 1600 } });
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('basic toggle persists to DashState', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]').click();
        const before = await flipCfg(page, 'vehicleShowCondition');
        await page.waitForTimeout(300);
        const stored = await lsGet(page, 'vehicleShowCondition');
        expect(stored, 'vehicleShowCondition persisted').toBe(!before);
    });

    test('expanded toggle adds .expanded-vehicles class', async ({ page, request }) => {
        await gotoDashboard(page, request);
        const sec = page.locator('.section[data-tt-key="vehicles"]');
        const before = await sec.evaluate(el => el.classList.contains('expanded-vehicles'));
        await page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]').click();
        await flipCfg(page, 'vehiclesExpanded');
        await page.waitForTimeout(300);
        const after = await sec.evaluate(el => el.classList.contains('expanded-vehicles'));
        expect(after).toBe(!before);
    });

    test('animals expanded toggle adds .expanded-animals class', async ({ page, request }) => {
        await gotoDashboard(page, request);
        const sec = page.locator('.section[data-tt-key="animals"]');
        await page.locator('.sec-cfg-btn[data-sec-cfg="animals"]').click();
        await flipCfg(page, 'animalsExpanded');
        await page.waitForTimeout(300);
        const after = await sec.evaluate(el => el.classList.contains('expanded-animals'));
        expect(after).toBe(true);
    });

    test('advanced accordion expands and shows groups', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]').click();
        const adv = page.locator('#sec-cfg-panel .sec-cfg-adv');
        await expect(adv).toBeHidden();
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        await expect(adv).toBeVisible();
        // Vehicles advanced has 2 groups (Vozidlo + Nářadí)
        await expect(adv.locator('.sec-cfg-group')).toHaveCount(2);
    });

    test('hiding a fillType group filters vehicle implement rows', async ({ page, request }) => {
        await gotoDashboard(page, request);
        // Turn on expanded so implement sub-rows render
        await page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]').click();
        await flipCfg(page, 'vehiclesExpanded');
        await page.waitForTimeout(400);
        const beforeRows = await page.locator('#vehicles-body .vi-row').count();
        // Hide crops — should not increase row count (filter only removes)
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        await flipCfg(page, 'vehicleImplHideCrops');
        await page.waitForTimeout(400);
        const afterRows = await page.locator('#vehicles-body .vi-row').count();
        expect(afterRows, 'hiding crops should not add rows').toBeLessThanOrEqual(beforeRows);
    });

    test('fields owned-only toggle changes the fields table', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="fields"]').click();
        const before = await flipCfg(page, 'fieldsOwnedOnly');
        await page.waitForTimeout(400);
        const stored = await lsGet(page, 'fieldsOwnedOnly');
        expect(stored).toBe(!before);
        // The table still renders rows (no crash)
        await expect(page.locator('#fields-body tr').first()).toBeVisible();
    });

    test('fields extra column toggle adds a column header', async ({ page, request }) => {
        await gotoDashboard(page, request);
        const headCount = () => page.locator('table[data-sort-key="fields"] thead th').count();
        const before = await headCount();
        await page.locator('.sec-cfg-btn[data-sec-cfg="fields"]').click();
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        await flipCfg(page, 'fieldsColPlow');
        await page.waitForTimeout(400);
        const after = await headCount();
        expect(after, 'enabling a column adds a <th>').toBe(before + 1);
    });
});

test.describe('Per-section settings — reset (V-1) + dirty indicator (V-2) + note (V-3)', () => {
    test.use({ viewport: { width: 1440, height: 1600 } });
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('dirty indicator appears after a change and clears on reset', async ({ page, request }) => {
        await gotoDashboard(page, request);
        const btn = page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]');
        // Initially no custom settings
        await expect(btn).not.toHaveClass(/has-custom/);
        await btn.click();
        await flipCfg(page, 'vehicleShowCondition');   // default true → false (non-default)
        await page.waitForTimeout(300);
        await expect(btn, 'indicator shows after non-default change').toHaveClass(/has-custom/);

        // Reset
        await page.locator('#sec-cfg-panel .sec-cfg-reset').click();
        await page.waitForTimeout(300);
        await expect(btn, 'indicator clears after reset').not.toHaveClass(/has-custom/);
    });

    test('reset restores all section defaults in DashState', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="storage"]').click();
        // Flip two settings away from default
        await flipCfg(page, 'storageHideEmpty');        // default false → true
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        await flipCfg(page, 'storageShowCapacity');     // default true → false
        await page.waitForTimeout(300);
        expect(await lsGet(page, 'storageHideEmpty')).toBe(true);
        expect(await lsGet(page, 'storageShowCapacity')).toBe(false);

        await page.locator('#sec-cfg-panel .sec-cfg-reset').click();
        await page.waitForTimeout(300);
        expect(await lsGet(page, 'storageHideEmpty'), 'hideEmpty back to default').toBe(false);
        expect(await lsGet(page, 'storageShowCapacity'), 'showCapacity back to default').toBe(true);
    });

    test('reset re-renders panel so checkboxes reflect defaults', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]').click();
        await flipCfg(page, 'vehicleShowCondition');    // → false
        await page.waitForTimeout(200);
        await page.locator('#sec-cfg-panel .sec-cfg-reset').click();
        await page.waitForTimeout(300);
        // Panel still open, checkbox restored to default (checked)
        const checked = await page.evaluate(() =>
            document.querySelector('#sec-cfg-panel input[data-cfg-key="vehicleShowCondition"]').checked);
        expect(checked, 'checkbox reflects default after reset').toBe(true);
    });

    test('vehicles fillType group shows the always-visible note (V-3)', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]').click();
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        await expect(page.locator('#sec-cfg-panel .sec-cfg-group-note'))
            .toContainText('Ostatní');
    });
});

test.describe('Per-section settings — deferred features (O-1/O-2/O-3) + flash granularity', () => {
    test.use({ viewport: { width: 1440, height: 1600 } });
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('O-2: "jen pracující vozidla" does not increase the row count', async ({ page, request }) => {
        await gotoDashboard(page, request);
        const before = await page.locator('#vehicles-body .vehicle-row').count();
        await page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]').click();
        await flipCfg(page, 'vehiclesActiveOnly');
        await page.waitForTimeout(400);
        const after = await page.locator('#vehicles-body .vehicle-row').count();
        expect(after, 'active-only filter only removes rows').toBeLessThanOrEqual(before);
        expect(await lsGet(page, 'vehiclesActiveOnly')).toBe(true);
    });

    test('O-1: "skrýt prázdná pole" persists and keeps the table valid', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="fields"]').click();
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        const before = await page.locator('#fields-body tr').count();
        await flipCfg(page, 'fieldsHideEmpty');
        await page.waitForTimeout(400);
        expect(await lsGet(page, 'fieldsHideEmpty')).toBe(true);
        const after = await page.locator('#fields-body tr').count();
        expect(after, 'hiding empty fields only removes rows').toBeLessThanOrEqual(before);
    });

    test('O-3: alarm threshold select persists a numeric value', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="animals"]').click();
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        const sel = page.locator('#sec-cfg-panel select[data-cfg-key="animalsAlarmInput"]');
        await expect(sel).toBeVisible();
        await sel.selectOption('50');
        await page.waitForTimeout(300);
        expect(await lsGet(page, 'animalsAlarmInput'), 'threshold stored as number').toBe(50);
    });

    test('O-3: alarm threshold counts as dirty + resets', async ({ page, request }) => {
        await gotoDashboard(page, request);
        const btn = page.locator('.sec-cfg-btn[data-sec-cfg="animals"]');
        await btn.click();
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        await page.locator('#sec-cfg-panel select[data-cfg-key="animalsAlarmOutput"]').selectOption('75');
        await page.waitForTimeout(300);
        await expect(btn, 'non-default select marks section dirty').toHaveClass(/has-custom/);
        await page.locator('#sec-cfg-panel .sec-cfg-reset').click();
        await page.waitForTimeout(300);
        expect(await lsGet(page, 'animalsAlarmOutput'), 'reset restores default 90').toBe(90);
        await expect(btn).not.toHaveClass(/has-custom/);
    });

    test('flash channel: storage "item" toggle persists to flashEnabled map', async ({ page, request }) => {
        await gotoDashboard(page, request);
        await page.locator('.sec-cfg-btn[data-sec-cfg="storage"]').click();
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        const cb = page.locator('#sec-cfg-panel input[data-cfg-key="flash:storage:item"]');
        await expect(cb).toHaveCount(1);
        await flipCfg(page, 'flash:storage:item');     // default true → false
        await page.waitForTimeout(300);
        const map = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('fs25.dash.v1.flashEnabled') || '{}'));
        expect(map['storage::item'], 'item flash channel disabled').toBe(false);
        // Master section flash remains untouched
        expect(map['storage'] === false, 'master not disabled by channel toggle').toBe(false);
    });

    test('flash channel toggle marks storage section dirty and reset clears it', async ({ page, request }) => {
        await gotoDashboard(page, request);
        const btn = page.locator('.sec-cfg-btn[data-sec-cfg="storage"]');
        await btn.click();
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        await flipCfg(page, 'flash:storage:header');
        await page.waitForTimeout(300);
        await expect(btn).toHaveClass(/has-custom/);
        await page.locator('#sec-cfg-panel .sec-cfg-reset').click();
        await page.waitForTimeout(300);
        const map = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('fs25.dash.v1.flashEnabled') || '{}'));
        expect(map['storage::header'], 'channel back to default (true)').toBe(true);
        await expect(btn).not.toHaveClass(/has-custom/);
    });
});

test.describe('Expanded layout redesign — rich 2-column rendering', () => {
    test.use({ viewport: { width: 1600, height: 1700 } });   // 4-col masonry → expanded spans 2
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    async function enableExpanded(page, sectionKey, cfgKey) {
        await page.locator(`.sec-cfg-btn[data-sec-cfg="${sectionKey}"]`).click();
        await flipCfg(page, cfgKey);
        await page.waitForTimeout(400);
        await page.keyboard.press('Escape');
    }

    test('animals expanded adds .expanded-animals + inline-litres cells', async ({ page, request }) => {
        await gotoDashboard(page, request, 'animal-needs');
        await enableExpanded(page, 'animals', 'animalsExpanded');
        await expect(page.locator('.section[data-tt-key="animals"]')).toHaveClass(/expanded-animals/);
        // Each rendered bar gets an inline litres cell (may be empty when capacity unknown).
        expect(await page.locator('#animals-body .ac-bar-liters').count()).toBeGreaterThan(0);
    });

    test('vehicles expanded shows implement chips (vehicles-rich)', async ({ page, request }) => {
        await gotoDashboard(page, request, 'vehicles-rich');
        await enableExpanded(page, 'vehicles', 'vehiclesExpanded');
        await expect(page.locator('.section[data-tt-key="vehicles"]')).toHaveClass(/expanded-vehicles/);
        // At least one vehicle in this scenario carries an implement → chips render.
        expect(await page.locator('#vehicles-body .vc-impl-chips').count()).toBeGreaterThan(0);
        await expect(page.locator('#vehicles-body .vc-chip').first()).toBeVisible();
    });

    test('storage expanded renders the 2-column item body', async ({ page, request }) => {
        await gotoDashboard(page, request, 'harvest-ready');
        await enableExpanded(page, 'storage', 'storageExpanded');
        await expect(page.locator('.section[data-tt-key="storage"]')).toHaveClass(/expanded-storage/);
        // The flat 2-col body wrapper renders for every visible silo when expanded.
        expect(await page.locator('#storage-body .st-items').count()).toBeGreaterThan(0);
    });

    test('productions expanded renders side-by-side stocks/recipes grid', async ({ page, request }) => {
        await gotoDashboard(page, request, 'productions-many');
        await enableExpanded(page, 'productions', 'productionsExpanded');
        await expect(page.locator('.section[data-tt-key="productions"]')).toHaveClass(/expanded-productions/);
        expect(await page.locator('#productions-body .ps-grid').count()).toBeGreaterThan(0);
        await expect(page.locator('#productions-body .ps-col-recipes').first()).toBeAttached();
        // Throughput l/h appears for a running recipe.
        await expect(page.locator('#productions-body .ps-throughput').first()).toBeAttached();
    });

    test('fields growth bar uses the zoned gradient by default', async ({ page, request }) => {
        // multi-fruit-types has many growing fields → at least one zoned bar.
        await gotoDashboard(page, request, 'multi-fruit-types');
        expect(await page.locator('#fields-body .bar-zoned').count()).toBeGreaterThan(0);
    });

    test('fields spray column toggles a new <th>', async ({ page, request }) => {
        await gotoDashboard(page, request, 'harvest-ready');
        const headCount = () => page.locator('table[data-sort-key="fields"] thead th').count();
        const before = await headCount();
        await page.locator('.sec-cfg-btn[data-sec-cfg="fields"]').click();
        await page.locator('#sec-cfg-panel .sec-cfg-adv-toggle').click();
        await flipCfg(page, 'fieldsColSpray');
        await page.waitForTimeout(400);
        expect(await headCount()).toBe(before + 1);
    });
});
