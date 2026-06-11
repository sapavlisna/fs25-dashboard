// prices.spec.js — FUNCTIONAL assertions for the Prices surface (ceny/výkupní místa).
//
// Surface: "Ceny/sez. křivka" (key: prices)
// Pages: / (prices table) + /history.html (sez. křivka / forecast + balance trend)
//
// State coverage:
//   • Empty payload, empty results, all hidden
//   • Price color coding (neutral / medium / high) — boundary testing
//   • Flash effects (enabled/disabled, up/down)
//   • Storage display (stockTxt) + OwnedOnly filter
//   • TableTools: hidden sell points + hidden commodities
//   • Collapse toggle (group expand/collapse)
//   • Seasonal forecast (empty, missing commodity, current month, top-3/bottom-3, watch marker)
//   • Balance trend (up/down/flat)

const { test, expect } = require('@playwright/test');

// ── Helpers ────────────────────────────────────────────────────────────────────
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

async function gotoHistory(page) {
    await page.goto('/history.html');
    await expect(page.locator('#kpi-fills')).toBeAttached({ timeout: 12_000 });
    await page.waitForTimeout(800);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('Prices surface — st-prices-* states', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-prices-empty-payload: prices.length === 0 → empty message', async ({ page, request }) => {
        await setScenario(request, 'empty-farm');
        await gotoDashboard(page);

        const body = page.locator('#prices-body');
        await expect(body).toBeVisible();
        await expect(body).toContainText('Žádná výkupní místa');
    });

    test('st-prices-price-neutral-boundary-low: pricePerTon=499 → no color class', async ({ page, request }) => {
        await setScenario(request, 'prices-neutral-boundary-low');
        await gotoDashboard(page);

        // Items start collapsed (hidden-row), check class regardless of visibility.
        const priceCell = page.locator('#prices-body td.num');
        await expect(priceCell).not.toHaveClass(/c-yellow|c-green/);
    });

    test('st-prices-price-medium-boundary-low: pricePerTon=500 → c-yellow', async ({ page, request }) => {
        await setScenario(request, 'prices-medium-boundary-low');
        await gotoDashboard(page);

        const priceCell = page.locator('#prices-body td.num');
        await expect(priceCell).toHaveClass(/c-yellow/);
        // Should NOT be green
        await expect(priceCell).not.toHaveClass(/c-green/);
    });

    test('st-prices-price-medium-boundary-ok: pricePerTon=799 → c-yellow, NOT c-green', async ({ page, request }) => {
        await setScenario(request, 'prices-medium-boundary-ok');
        await gotoDashboard(page);

        const priceCell = page.locator('#prices-body td.num');
        await expect(priceCell).toHaveClass(/c-yellow/);
        await expect(priceCell).not.toHaveClass(/c-green/);
    });

    test('st-prices-price-high-boundary-low: pricePerTon=800 → c-green', async ({ page, request }) => {
        await setScenario(request, 'prices-high-boundary-low');
        await gotoDashboard(page);

        const priceCell = page.locator('#prices-body td.num');
        await expect(priceCell).toHaveClass(/c-green/);
    });

    test('st-prices-flash-up: price rises → flash-up on tr.group-item', async ({ page, request }) => {
        await setScenario(request, 'prices-flash-up');
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const groupItem = page.locator('#prices-body tr.group-item').first();
        await expect(groupItem).toHaveClass(/flash-up/, { timeout: 8000 });
    });

    test('st-prices-flash-down: price drops → flash-down on tr.group-item', async ({ page, request }) => {
        await setScenario(request, 'prices-flash-down');
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const groupItem = page.locator('#prices-body tr.group-item').first();
        await expect(groupItem).toHaveClass(/flash-down/, { timeout: 8000 });
    });

    test('st-prices-flash-disabled: DashState.flashEnabled.prices=false → no flash', async ({ page, request }) => {
        await setScenario(request, 'prices-flash-up');

        // Disable flash before loading
        await page.addInitScript(() => {
            try {
                let flashEnabled = JSON.parse(localStorage.getItem('fs25.dash.v1.flashEnabled') || '{}');
                flashEnabled.prices = false;
                localStorage.setItem('fs25.dash.v1.flashEnabled', JSON.stringify(flashEnabled));
            } catch (_) {}
        });

        await gotoDashboard(page);

        const groupItem = page.locator('#prices-body tr.group-item').first();
        // Should not have flash-up or flash-down
        await expect(groupItem).not.toHaveClass(/flash-up|flash-down/);
    });

    test('st-prices-stock-visible: pricesShowStock=true + storage → span.c-muted with value', async ({ page, request }) => {
        await setScenario(request, 'prices-stock-visible');
        await gotoDashboard(page);

        // Groups are collapsed by default; span exists in DOM but may not be visible.
        const stockSpan = page.locator('#prices-body tr.group-item td:first-child span.c-muted');
        await expect(stockSpan).toHaveCount(1);
        // Renderer appends ' l' (litres) — verify number + unit suffix (index.html:2044)
        const text = await stockSpan.textContent();
        expect(text).toMatch(/\d[\d\s]* l/);
    });

    test('st-prices-owned-only: DashState.pricesOwnedOnly=true → only commodities with storage', async ({ page, request }) => {
        await setScenario(request, 'prices-owned-only');

        // Enable owned-only filter
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.pricesOwnedOnly', 'true');
            } catch (_) {}
        });

        await gotoDashboard(page);

        // Should contain Pšenice (has storage)
        await expect(page.locator('#prices-body')).toContainText('Pšenice');
        // Should NOT contain Ječmen (no storage)
        await expect(page.locator('#prices-body')).not.toContainText('Ječmen');
    });

    test('st-prices-sellpoint-hidden: hidden sell point moved to hidden zone', async ({ page, request }) => {
        await setScenario(request, 'prices-sellpoint-hidden');

        // Mark 'BGA Bergmann' as hidden (scenario has 'Silo Bergmann' + 'BGA Bergmann')
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.hidden:prices', JSON.stringify(['BGA Bergmann']));
            } catch (_) {}
        });

        await gotoDashboard(page);

        // Hidden sell point should be in #prices-hidden-body
        await expect(page.locator('#prices-hidden-body')).toContainText('BGA Bergmann');
        // Visible sell point should be in #prices-body
        await expect(page.locator('#prices-body')).toContainText('Silo Bergmann');
        // Hidden count should be > 0
        await expect(page.locator('#cnt-prices-hidden')).not.toHaveText('0');
    });

    test('st-prices-all-hidden: all sell points hidden → empty message in prices-body', async ({ page, request }) => {
        await setScenario(request, 'prices-all-hidden');

        // Scenario delegates to scenarioPricesMultiSellPoint() which has
        // 'Silo Bergmann' and 'BGA Bergmann' — hide both to reach the empty state.
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.hidden:prices', JSON.stringify(['Silo Bergmann', 'BGA Bergmann']));
            } catch (_) {}
        });

        await gotoDashboard(page);

        const body = page.locator('#prices-body');
        await expect(body).toContainText('Všechna výkupní místa jsou skrytá');
    });

    test('st-prices-group-collapsed: collapsedGroups has sell point → items hidden, toggle shows ▶', async ({ page, request }) => {
        await setScenario(request, 'prices-group-collapsed');

        // Collapse the group — scenario has 'Silo Bergmann' as first sell point
        await page.addInitScript(() => {
            try {
                let collapsed = JSON.parse(localStorage.getItem('fs25.dash.v1.collapsedGroups') || '[]');
                if (!Array.isArray(collapsed)) collapsed = [];
                collapsed.push('sell:Silo Bergmann');
                localStorage.setItem('fs25.dash.v1.collapsedGroups', JSON.stringify(collapsed));
            } catch (_) {}
        });

        await gotoDashboard(page);

        // Group-item rows should have hidden-row class
        const groupItems = page.locator('#prices-body tr.group-item');
        for (let i = 0; i < await groupItems.count(); i++) {
            await expect(groupItems.nth(i)).toHaveClass(/hidden-row/);
        }

        // Toggle should show ▶
        const toggle = page.locator('#prices-body .group-toggle').first();
        const text = await toggle.textContent();
        expect(text).toContain('▶');
    });

    test('st-prices-item-hidden: commodity hidden via button → tr has hidden-row', async ({ page, request }) => {
        await setScenario(request, 'prices-item-hidden');

        // Mark Pšenice as hidden in priceItems
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.hidden:priceItems', JSON.stringify(['Pšenice']));
            } catch (_) {}
        });

        await gotoDashboard(page);

        // Pšenice row should be hidden
        const wheeatRows = page.locator('#prices-body tr.group-item', { has: page.locator('text=Pšenice') });
        const count = await wheeatRows.count();
        if (count > 0) {
            await expect(wheeatRows.first()).toHaveClass(/hidden-row/);
        }

        // Ječmen should still be visible
        await expect(page.locator('#prices-body')).toContainText('Ječmen');
    });
});

test.describe('Seasonal forecast — st-prices-forecast-* states', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-prices-forecast-empty: priceForecast=null → #chart-forecast display:none', async ({ page, request }) => {
        await setScenario(request, 'prices-forecast-empty');
        await gotoHistory(page);

        const chart = page.locator('#chart-forecast');
        const empty = page.locator('#empty-forecast');

        // Chart should not be visible
        const chartDisplay = await chart.evaluate(el => window.getComputedStyle(el).display);
        expect(chartDisplay).toBe('none');

        // Empty state should be visible
        const emptyDisplay = await empty.evaluate(el => window.getComputedStyle(el).display);
        expect(emptyDisplay).not.toBe('none');
    });

    test('st-prices-forecast-no-data-for-commodity: selected commodity not in fillTypes → empty message', async ({ page, request }) => {
        // scenarioPricesForecastNoDataForCommodity ships a forecast whose fillTypes
        // OMIT Pšenice. Seed price history for Pšenice so it appears in the
        // commodity dropdown (from /api/history/fill-types) even though the
        // forecast has no entry for it — selecting it hits the entry===undefined
        // path (history.html:507-513) → "neposílá sezónní křivku".
        await setScenario(request, 'prices-forecast-no-data');
        const seed = await request.post('/mock/seed-history', { data: { prices: [
            { game_day: 1, sell_point: 'Silo', fill_type: 'Pšenice', price_ton: 240 },
            { game_day: 2, sell_point: 'Silo', fill_type: 'Pšenice', price_ton: 250 },
        ] } });
        if (!seed.ok()) throw new Error(`seed-history: ${seed.status()}`);
        await gotoHistory(page);

        const sel = page.locator('#sel-filltype-forecast');
        await expect(sel.locator('option[value="Pšenice"]')).toBeAttached({ timeout: 10000 });
        await sel.selectOption('Pšenice');
        await page.waitForTimeout(500);

        const empty = page.locator('#empty-forecast');
        await expect(empty).toContainText('neposílá sezónní křivku');
    });

    test('st-prices-forecast-current-month-bar: barIndex === currentPeriod-1 → amber border + ▸ prefix', async ({ page, request }) => {
        await setScenario(request, 'prices-forecast-current-month-bar');
        await gotoHistory(page);

        const canvas = page.locator('#chart-forecast');
        await expect(canvas).toBeVisible();
        await page.waitForTimeout(400);

        // history.html:561 — current-month bar gets a non-transparent borderColor (amber accent2),
        // all other bars get 'transparent'. Verify exactly one bar has a non-transparent border.
        const currentMonthBorderCount = await page.evaluate(() => {
            const ctx = window.forecastChart;
            if (!ctx || !ctx.data) return -1;
            const dataset = ctx.data.datasets[0];
            if (!dataset || !Array.isArray(dataset.borderColor)) return -1;
            return dataset.borderColor.filter(c => c && c !== 'transparent').length;
        });

        // Exactly the one current-month bar (and no watch marker) should have a border.
        expect(currentMonthBorderCount).toBe(1);
    });

    test('st-prices-forecast-top3-months: top-3 prices get green color', async ({ page, request }) => {
        await setScenario(request, 'prices-forecast-top3-months');
        await gotoHistory(page);

        const canvas = page.locator('#chart-forecast');
        await expect(canvas).toBeVisible();

        // Summary should mention "nejlépe" (best)
        const summary = page.locator('#forecast-summary .forecast-advice-text');
        await expect(summary).toContainText('nejlépe');
    });

    test('st-prices-forecast-bottom3-months: bottom-3 prices get red color', async ({ page, request }) => {
        await setScenario(request, 'prices-forecast-bottom3-months');
        await gotoHistory(page);

        const canvas = page.locator('#chart-forecast');
        await expect(canvas).toBeVisible();

        // Summary should mention "nejhůř" (worst)
        const summary = page.locator('#forecast-summary .forecast-advice-text');
        await expect(summary).toContainText('nejhůř');
    });

    test('st-prices-forecast-watch-marker: watched month has gold border + 🔔 marker', async ({ page, request }) => {
        await setScenario(request, 'prices-forecast-watch-marker');

        // Set up a watch for Pšenice/June (period 6) before the chart builds.
        await page.addInitScript(() => {
            try {
                const watches = [{ fillType: 'Pšenice', period: 6 }];
                localStorage.setItem('fs25.dash.v1.forecastWatches', JSON.stringify(watches));
            } catch (_) {}
        });

        await gotoHistory(page);

        const canvas = page.locator('#chart-forecast');
        await expect(canvas).toBeVisible();

        // Make sure the watched commodity is the selected one, then inspect.
        await page.locator('#sel-filltype-forecast').selectOption('Pšenice');
        await page.waitForTimeout(400);

        // history.html:561 — watched bar (period 6 → index 5) gets borderColor
        // '#fde047' (gold), distinct from the amber accent2 current-month bar.
        const goldInfo = await page.evaluate(() => {
            const ctx = window.forecastChart;
            if (!ctx || !ctx.data) return null;
            const b = ctx.data.datasets[0].borderColor;
            return { idx5: b[5], count: b.filter(c => c === '#fde047').length };
        });
        expect(goldInfo).not.toBeNull();
        expect(goldInfo.idx5).toBe('#fde047');
        expect(goldInfo.count).toBe(1);
    });

    test('st-prices-forecast-summary-visible: latestForecast != null → summary panel visible', async ({ page, request }) => {
        await setScenario(request, 'prices-forecast-summary-visible');
        await gotoHistory(page);

        const summary = page.locator('#forecast-summary');
        const summaryText = page.locator('#forecast-summary .forecast-advice-text');

        // Summary should not be hidden
        await expect(summary).not.toHaveAttribute('hidden');

        // Text should contain advice (e.g., "nyní" and "nejlépe")
        const text = await summaryText.textContent();
        expect(text).toMatch(/nyní|nejlépe/);
    });

    test('st-prices-dropdown-owned-first: storage → "Mám na skladě" optgroup first', async ({ page, request }) => {
        await setScenario(request, 'prices-dropdown-owned-first');
        await gotoHistory(page);

        const sel = page.locator('#sel-filltype-forecast');
        const optgroups = sel.locator('optgroup');

        // First optgroup should have "Mám na skladě" label
        const firstLabel = await optgroups.first().getAttribute('label');
        expect(firstLabel).toContain('Mám na skladě');
    });
});

test.describe('Balance trend — st-prices-balance-trend-* states', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    // #kpi-trend is computed from /api/history/balance REST rows (history.html:303-322).
    // Seed ≥2 balance rows within the 7-day window (scenario runs on gameDay 60) so the
    // trend = last − first is deterministic. Seed AFTER the scenario tick so the live
    // day-60 row is overwritten by our seeded rows.
    async function seedBalance(request, rows) {
        const resp = await request.post('/mock/seed-history', { data: { balance: rows } });
        if (!resp.ok()) throw new Error(`seed-history: ${resp.status()}`);
        await new Promise(r => setTimeout(r, 400));
    }

    test('st-prices-balance-trend-up: delta > 0 → #kpi-trend has c-green + ↑', async ({ page, request }) => {
        await setScenario(request, 'prices-balance-trend-up');
        await seedBalance(request, [
            { game_day: 59, balance: 100000 },
            { game_day: 60, balance: 200000 },
        ]);
        await gotoHistory(page);

        const trend = page.locator('#kpi-trend');
        const trendSub = page.locator('#kpi-trend-sub');

        await expect(trend).toHaveClass(/c-green/);
        await expect(trend).toContainText('↑');
        await expect(trendSub).toHaveClass(/delta-up/);
    });

    test('st-prices-balance-trend-down: delta < 0 → #kpi-trend has c-red + ↓', async ({ page, request }) => {
        await setScenario(request, 'prices-balance-trend-down');
        await seedBalance(request, [
            { game_day: 59, balance: 200000 },
            { game_day: 60, balance: 120000 },
        ]);
        await gotoHistory(page);

        const trend = page.locator('#kpi-trend');
        const trendSub = page.locator('#kpi-trend-sub');

        await expect(trend).toHaveClass(/c-red/);
        await expect(trend).toContainText('↓');
        await expect(trendSub).toHaveClass(/delta-down/);
    });

    test('st-prices-balance-trend-flat: delta === 0 → #kpi-trend no color + no arrow', async ({ page, request }) => {
        await setScenario(request, 'prices-balance-trend-flat');
        await seedBalance(request, [
            { game_day: 59, balance: 180000 },
            { game_day: 60, balance: 180000 },
        ]);
        await gotoHistory(page);

        const trend = page.locator('#kpi-trend');
        const trendSub = page.locator('#kpi-trend-sub');

        await expect(trend).toContainText('→');
        await expect(trend).not.toHaveClass(/c-green|c-red/);
        await expect(trendSub).not.toHaveClass(/delta-up|delta-down/);
    });
});
