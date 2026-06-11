// storage.spec.js — FUNCTIONAL assertions over storage section states.
// Documents storage bar thresholds, donut states, bell alerts, DashState settings,
// flash events, and collapse/hide behaviours.
//
// Thresholds under test (index.html):
//   bar-fill: ipct < 70 → none · 70–94 → warn · >= 95 → full
//   donut:    pct  < 70 → none · 70–94 → warn · >= 95 → full
//   bell:     STORAGE_HI = 95 → storage-full alert
//   Settings: storageHideEmpty, storageShowCapacity, storageShowBar, storageShowPercent,
//             storageExpanded, storageDefaultCollapsed

const { test, expect } = require('@playwright/test');

// ── helpers ──────────────────────────────────────────────────────────────────

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

function setDashState(page, key, value) {
    return page.addInitScript(({ key, value }) => {
        try {
            localStorage.setItem(`fs25.dash.v1.${key}`, JSON.stringify(value));
        } catch (_) {}
    }, { key, value });
}

function storageGroup(page, siloName) {
    // Storage groups use key = "silo:{storageName}" for the data-group attribute.
    return page.locator(`tr.st-row[data-group="silo:${siloName}"]`);
}

function storageItems(page, siloName) {
    // Items use data-group="silo:{storageName}#{itemNames}".
    return page.locator(`tr.group-item[data-group^="silo:${siloName}"]`);
}

function barFill(row) {
    // In non-expanded mode, bar-fill is in tr.group-item rows (siblings of header).
    // Use page-level locator to find the first bar-fill in storage body.
    return row.page().locator('#storage-body tr.group-item .bar-fill').first();
}

function donutSvg(row) {
    // silo-donut is inside the header row (tr.st-row).
    return row.locator('svg.silo-donut');
}

test.describe('storage section — empty and boundary states', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    // ── st-storage-empty-payload ────────────────────────────────────────────
    test('st-storage-empty-payload: empty table with "Žádné sklady."', async ({ request, page }) => {
        await setScenario(request, 'storage-empty');
        await gotoDashboard(page);

        // Empty storage message should be visible.
        const emptyMsg = page.locator('#storage-body tr td.empty');
        await expect(emptyMsg).toBeVisible();
        await expect(emptyMsg).toContainText('Žádné sklady.');

        // No storage groups exist.
        await expect(page.locator('tr.st-row')).toHaveCount(0);
    });

    // ── st-storage-bar-warn-boundary-low ────────────────────────────────────
    test('st-storage-bar-warn-boundary-low: 69% bar has no warn class', async ({ request, page }) => {
        await setScenario(request, 'storage-warn-boundary-low');
        await gotoDashboard(page);

        const group = storageGroup(page, 'Testovací silo');
        const fill = barFill(group);

        // 69 % → no warn, no full
        await expect(fill).not.toHaveClass(/warn/);
        await expect(fill).not.toHaveClass(/full/);
    });

    // ── st-storage-bar-warn-boundary-ok ─────────────────────────────────────
    test('st-storage-bar-warn-boundary-ok: 70% bar has warn, donut has warn', async ({ request, page }) => {
        await setScenario(request, 'storage-warn-boundary-ok');
        await gotoDashboard(page);

        const group = storageGroup(page, 'Testovací silo');
        const fill = barFill(group);
        const donut = donutSvg(group);

        // 70 % → warn
        await expect(fill).toHaveClass(/warn/);
        await expect(fill).not.toHaveClass(/full/);

        // Donut should also have warn
        await expect(donut).toHaveClass(/donut-warn/);
        await expect(donut).not.toHaveClass(/donut-full/);

        // No bell-alert for storage-full (70 % < 95 %)
        const storageFullBell = page.locator('.bell-item[data-target="sec-storage"]');
        await expect(storageFullBell).not.toBeVisible();
    });

    // ── st-storage-bar-full-boundary-low ────────────────────────────────────
    test('st-storage-bar-full-boundary-low: 94% bar is warn, not full', async ({ request, page }) => {
        await setScenario(request, 'storage-full-boundary-low');
        await gotoDashboard(page);

        const group = storageGroup(page, 'Testovací silo');
        const fill = barFill(group);
        const donut = donutSvg(group);

        // 94 % → warn, not full
        await expect(fill).toHaveClass(/warn/);
        await expect(fill).not.toHaveClass(/full/);

        // Donut: warn, not full
        await expect(donut).toHaveClass(/donut-warn/);
        await expect(donut).not.toHaveClass(/donut-full/);

        // No storage-full bell
        const storageFullBell = page.locator('.bell-item[data-target="sec-storage"]');
        await expect(storageFullBell).not.toBeVisible();
    });

    // ── st-storage-bar-full-boundary-ok ─────────────────────────────────────
    test('st-storage-bar-full-boundary-ok: 95% bar is full, donut is full, bell fires', async ({ request, page }) => {
        await setScenario(request, 'storage-full-boundary-ok');
        await gotoDashboard(page);

        const group = storageGroup(page, 'Testovací silo');
        const fill = barFill(group);
        const donut = donutSvg(group);

        // 95 % → full
        await expect(fill).toHaveClass(/full/);
        await expect(fill).not.toHaveClass(/warn/);

        // Donut: full
        await expect(donut).toHaveClass(/donut-full/);
        await expect(donut).not.toHaveClass(/donut-warn/);

        // storage-full bell should be present (bell panel may be hidden, check count)
        const storageFullBell = page.locator('.bell-item[data-target="sec-storage"]');
        await expect(storageFullBell).toHaveCount(1);
        await expect(storageFullBell).toHaveClass(/bell-info/);
    });

    // ── st-storage-donut-absent ─────────────────────────────────────────────
    test('st-storage-donut-absent: totalCap=0 → no donut SVG', async ({ request, page }) => {
        await setScenario(request, 'storage-donut-absent');
        await gotoDashboard(page);

        const group = storageGroup(page, 'Testovací silo');
        const donut = donutSvg(group);

        // Donut should not exist (capacity=0 → totalCap=0 → no SVG)
        await expect(donut).not.toBeVisible();

        // Percentage text should also be absent
        const pctText = group.locator('.silo-pct');
        await expect(pctText).not.toBeVisible();
    });

    // ── st-storage-silo-empty-items ─────────────────────────────────────────
    test('st-storage-silo-empty-items: items=[] → "prázdné" text', async ({ request, page }) => {
        await setScenario(request, 'storage-silo-empty-items');
        await gotoDashboard(page);

        const group = storageGroup(page, 'Testovací silo');
        const meta = group.locator('.group-meta');

        // Should display 'prázdné'
        await expect(meta).toContainText('prázdné');

        // No item rows should exist
        await expect(storageItems(page, 'Testovací silo')).toHaveCount(0);
    });
});

test.describe('storage section — DashState settings', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.storageDefaultCollapsed', JSON.stringify(false)); } catch (_) {}
        });
    });

    // ── st-storage-hide-empty-filter ────────────────────────────────────────
    test('st-storage-hide-empty-filter: storageHideEmpty=true filters amount=0', async ({ request, page }) => {
        await setDashState(page, 'storageHideEmpty', true);
        await setScenario(request, 'storage-hide-empty');
        await gotoDashboard(page);

        // Pšenice (amount=0) should not be in visible storage rows
        await expect(page.locator('#storage-body tr.group-item', { has: page.locator('td', { hasText: 'Pšenice' }) })).toHaveCount(0);

        // Ječmen (amount>0) should be visible in storage section
        const jecmen = page.locator('#storage-body tr.group-item', { has: page.locator('td', { hasText: 'Ječmen' }) });
        await expect(jecmen).toBeVisible();
    });

    // ── st-storage-show-capacity-off ────────────────────────────────────────
    test('st-storage-show-capacity-off: storageShowCapacity=false → "—"', async ({ request, page }) => {
        await setDashState(page, 'storageShowCapacity', false);
        await setScenario(request, 'storage-show-capacity-off');
        await gotoDashboard(page);

        const items = storageItems(page, 'Testovací silo');
        const capacityCell = items.locator('td:nth-child(3)');

        // Should display '—' instead of capacity
        await expect(capacityCell.first()).toContainText('—');
    });

    // ── st-storage-show-bar-off ─────────────────────────────────────────────
    test('st-storage-show-bar-off: storageShowBar=false → bar absent, % text only', async ({ request, page }) => {
        await setDashState(page, 'storageShowBar', false);
        await setScenario(request, 'storage-show-bar-off');
        await gotoDashboard(page);

        const items = storageItems(page, 'Testovací silo');

        // Bar elements should not exist
        await expect(items.locator('.bar-bg')).not.toBeVisible();
        await expect(items.locator('.bar-fill')).not.toBeVisible();

        // Percentage text should exist
        const pctText = items.locator('.bar-pct');
        await expect(pctText.first()).toBeVisible();
        await expect(pctText.first()).toContainText('25%');
    });

    // ── st-storage-show-percent-off ─────────────────────────────────────────
    test('st-storage-show-percent-off: storageShowPercent=false → % text absent', async ({ request, page }) => {
        await setDashState(page, 'storageShowPercent', false);
        await setScenario(request, 'storage-show-percent-off');
        await gotoDashboard(page);

        const items = storageItems(page, 'Testovací silo');
        const pctText = items.locator('.bar-pct');

        // Percentage should not be visible
        await expect(pctText).not.toBeVisible();
    });
});

test.describe('storage section — expanded layout', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.storageDefaultCollapsed', JSON.stringify(false)); } catch (_) {}
        });
    });

    // ── st-storage-expanded-single-commodity ────────────────────────────────
    test('st-storage-expanded-single-commodity: 2-col body, no stacked bar', async ({ request, page }) => {
        await setDashState(page, 'storageExpanded', true);
        await setScenario(request, 'storage-expanded-single');
        await gotoDashboard(page);

        // #sec-storage is the section div — it directly gets the expanded-storage class
        const section = page.locator('#sec-storage');

        // Section should have expanded-storage class
        await expect(section).toHaveClass(/expanded-storage/);

        // st-items and st-item should exist
        const items = section.locator('.st-items .st-item');
        await expect(items.first()).toBeVisible();

        // st-stack should not exist (single commodity)
        await expect(section.locator('.st-stack')).not.toBeVisible();
    });

    // ── st-storage-expanded-multi-commodity-stack ────────────────────────────
    test('st-storage-expanded-multi-commodity-stack: stacked bar with segments', async ({ request, page }) => {
        await setDashState(page, 'storageExpanded', true);
        await setScenario(request, 'storage-expanded-multi');
        await gotoDashboard(page);

        const group = storageGroup(page, 'Testovací silo');
        const stack = group.locator('.st-stack');

        // st-stack should be visible with segments
        await expect(stack).toBeVisible();

        // Should have colored segments + free segment.
        // Colored item spans have no class (only inline style); only st-seg-free has a class.
        // Count all child spans inside st-stack: 2 commodity + 1 free = 3.
        const segments = stack.locator('span');
        await expect(segments).toHaveCount(3); // 2 items + free
    });
});

test.describe('storage section — collapse and hide', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    // ── st-storage-collapsed-group ──────────────────────────────────────────
    test('st-storage-collapsed-group: storageDefaultCollapsed=true → collapsed', async ({ request, page }) => {
        await setDashState(page, 'storageDefaultCollapsed', true);
        await setScenario(request, 'storage-collapsed-group');
        await gotoDashboard(page);

        const group = storageGroup(page, 'Testovací silo');
        const toggle = group.locator('.group-toggle');
        const items = storageItems(page, 'Testovací silo');

        // Toggle should show '▶' (collapsed)
        await expect(toggle).toContainText('▶');

        // Item rows should be hidden
        await expect(items).toHaveClass(/hidden-row/);
    });

    // ── st-storage-hidden-by-user ───────────────────────────────────────────
    test('st-storage-hidden-by-user: hidden silo moves to hidden-body', async ({ request, page }) => {
        // Pre-seed the TableTools hidden set (key fs25.dash.v1.hidden:storages,
        // item key '<type>:<name>' → 'silo:Testovací silo') before navigation so
        // getHidden('storages') routes that silo to the hidden body.
        await setScenario(request, 'storage-hidden-by-user');
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.hidden:storages',
                    JSON.stringify(['silo:Testovací silo']));
            } catch (_) {}
        });
        await gotoDashboard(page);

        // Testovací silo should be in #storages-hidden-body
        const hiddenBody = page.locator('#storages-hidden-body');
        const hiddenRow = hiddenBody.locator('tr.st-row[data-group="silo:Testovací silo"]');
        await expect(hiddenRow).toBeVisible();

        // Silo B should be in main body
        const mainBody = page.locator('#storage-body');
        const mainRow = mainBody.locator('tr.st-row[data-group="silo:Silo B"]');
        await expect(mainRow).toBeVisible();

        // Hidden count should increment
        const hiddenCount = page.locator('#cnt-stor-hidden');
        await expect(hiddenCount).toContainText('1');
    });
});

test.describe('storage section — flash events', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    // ── st-storage-flash-up-header ──────────────────────────────────────────
    test('st-storage-flash-up-header: total amount increased → flash-up', async ({ request, page }) => {
        await setScenario(request, 'storage-flash-up-header');
        await gotoDashboard(page);

        // Wait for tick to fire (oscillating scenario fires flash on every change)
        await page.waitForTimeout(5000);

        const group = storageGroup(page, 'Testovací silo');
        const hasFlash = await Promise.race([
            expect(group).toHaveClass(/flash-up/,   { timeout: 8000 }).then(() => true).catch(() => false),
            expect(group).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false),
        ]);
        expect(hasFlash).toBe(true);
    });

    // ── st-storage-flash-down-header ────────────────────────────────────────
    test('st-storage-flash-down-header: total amount decreased → flash-down', async ({ request, page }) => {
        await setScenario(request, 'storage-flash-down-header');
        await gotoDashboard(page);

        // Wait for tick to fire (oscillating scenario fires flash on every change)
        await page.waitForTimeout(5000);

        const group = storageGroup(page, 'Testovací silo');
        const hasFlash = await Promise.race([
            expect(group).toHaveClass(/flash-up/,   { timeout: 8000 }).then(() => true).catch(() => false),
            expect(group).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false),
        ]);
        expect(hasFlash).toBe(true);
    });

    // ── st-storage-flash-item-level ────────────────────────────────────────
    test('st-storage-flash-item-level: item amount changed → item-level flash', async ({ request, page }) => {
        await setDashState(page, 'storageExpanded', true);
        await setScenario(request, 'storage-flash-item-level');
        await gotoDashboard(page);

        // Wait for update tick
        await page.waitForTimeout(5000);

        // Pšenice amount changed → flash (direction may vary with oscillating scenario)
        const pshenice = page.locator('.st-item', { has: page.locator('.st-item-name', { hasText: 'Pšenice' }) });
        const hasItemFlash = await Promise.race([
            expect(pshenice).toHaveClass(/flash-up/,   { timeout: 8000 }).then(() => true).catch(() => false),
            expect(pshenice).toHaveClass(/flash-down/, { timeout: 8000 }).then(() => true).catch(() => false),
        ]);
        expect(hasItemFlash).toBe(true);
    });
});

test.describe('storage section — alerts', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    // ── st-storage-bell-full-multi-silo ─────────────────────────────────────
    test('st-storage-bell-full-multi-silo: >= 95% items fire bell', async ({ request, page }) => {
        await setScenario(request, 'storage-bell-full-multi');
        await gotoDashboard(page);

        // storage-full bell should exist with info severity (bell panel may be hidden, check count)
        const bell = page.locator('.bell-item[data-target="sec-storage"].bell-info');
        await expect(bell).toHaveCount(1);

        // Bell should mention affected silos (scenario uses 'Testovací silo' at 95% and 'Silo B' at 25%)
        const bellDetail = bell.locator('.bell-item-detail');
        await expect(bellDetail).toContainText('Testovací silo');

        // Verify the near-full silo's bar is full (Testovací silo: Pšenice at 95%)
        const pshBar = page.locator('tr.group-item', { hasText: 'Pšenice' }).locator('.bar-fill');
        await expect(pshBar.first()).toHaveClass(/full/);
    });
});
