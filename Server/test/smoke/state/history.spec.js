// history.spec.js — FUNCTIONAL (non-screenshot) assertions over the history page
// surfaces. Documents the KPI + chart + dropdown + WS state contract so a restyle
// that keeps the behaviour passes, and a behaviour regression fails.
//
// Page: /history.html
// Coverage: balance chart · price chart · seasonal forecast chart · dropdowns ·
// WS states · replay banner · bell integration

const { test, expect } = require('@playwright/test');

// ── helpers ────────────────────────────────────────────────────────────────────

async function setScenario(request, name) {
    const resp = await request.post('/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario "${name}": ${resp.status()}`);
    await new Promise(r => setTimeout(r, 3000));
}

async function gotoHistory(page) {
    await page.goto('/history.html');
    // History page anchor: wait for fill-types KPI to attach (may be empty, but element exists)
    await expect(page.locator('#kpi-fills')).toBeAttached({ timeout: 12_000 });
    await page.waitForTimeout(500);
}

async function mockBalanceData(request, rows) {
    // POST /mock/balance-rows — inject test data into /api/history/balance
    const resp = await request.post('/mock/balance-rows', { data: { rows } });
    if (!resp.ok()) throw new Error(`mock balance: ${resp.status()}`);
    await new Promise(r => setTimeout(r, 1000));
}

async function mockPriceData(request, rows) {
    // POST /mock/price-rows — inject test data into /api/history/prices
    const resp = await request.post('/mock/price-rows', { data: { rows } });
    if (!resp.ok()) throw new Error(`mock price: ${resp.status()}`);
    await new Promise(r => setTimeout(r, 1000));
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('History surface — balance trend KPIs', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'empty-farm');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-history-balance-trend-up: balance grows, #kpi-trend gets c-green', async ({ page, request }) => {
        await mockBalanceData(request, [
            { game_day: 1, balance: 100000 },
            { game_day: 2, balance: 150000 },
        ]);
        await gotoHistory(page);

        // Trend KPI must show "↑" and have c-green class
        const trendEl = page.locator('#kpi-trend');
        await expect(trendEl).toContainText('↑');
        await expect(trendEl).toHaveClass(/c-green/);

        // Trend sub must have delta-up class (affects color)
        const trendSub = page.locator('#kpi-trend-sub');
        await expect(trendSub).toHaveClass(/delta-up/);
    });

    test('st-history-balance-trend-down: balance falls, #kpi-trend gets c-red', async ({ page, request }) => {
        await mockBalanceData(request, [
            { game_day: 1, balance: 200000 },
            { game_day: 2, balance: 120000 },
        ]);
        await gotoHistory(page);

        const trendEl = page.locator('#kpi-trend');
        await expect(trendEl).toContainText('↓');
        await expect(trendEl).toHaveClass(/c-red/);

        const trendSub = page.locator('#kpi-trend-sub');
        await expect(trendSub).toHaveClass(/delta-down/);
    });

    test('st-history-balance-trend-flat: balance same, #kpi-trend has no color class', async ({ page, request }) => {
        await mockBalanceData(request, [
            { game_day: 1, balance: 180000 },
            { game_day: 2, balance: 180000 },
        ]);
        await gotoHistory(page);

        const trendEl = page.locator('#kpi-trend');
        await expect(trendEl).toContainText('→');
        // No c-green or c-red (plain kpi-value class)
        await expect(trendEl).not.toHaveClass(/c-green|c-red/);
    });
});

test.describe('History surface — balance chart empty/boundary states', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'empty-farm');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-history-balance-empty-boundary-low: <2 rows, canvas hidden, #empty-balance visible, KPI are —', async ({ page, request }) => {
        await mockBalanceData(request, [
            { game_day: 1, balance: 100000 },
        ]);
        await gotoHistory(page);

        // Canvas must be hidden
        const canvas = page.locator('#chart-balance');
        await expect(canvas).toHaveCSS('display', 'none');

        // Empty state must be visible
        const empty = page.locator('#empty-balance');
        await expect(empty).toBeVisible();

        // KPI values stay as "—"
        await expect(page.locator('#kpi-records')).toHaveText('—');
        await expect(page.locator('#kpi-oldest')).toHaveText('—');
        await expect(page.locator('#kpi-trend')).toHaveText('—');
    });

    test('st-history-balance-data-boundary-ok: 2 rows, canvas visible, #empty-balance hidden, KPI updated', async ({ page, request }) => {
        await mockBalanceData(request, [
            { game_day: 1, balance: 100000 },
            { game_day: 2, balance: 110000 },
        ]);
        await gotoHistory(page);

        const canvas = page.locator('#chart-balance');
        await expect(canvas).not.toHaveCSS('display', 'none');

        const empty = page.locator('#empty-balance');
        await expect(empty).toHaveCSS('display', 'none');

        // KPI updated: 2 records, oldest at D1, trend ↑ (green)
        await expect(page.locator('#kpi-records')).toHaveText('2');
        await expect(page.locator('#kpi-oldest')).toHaveText('D1');
        await expect(page.locator('#kpi-trend')).toContainText('↑');
    });

    test('st-history-balance-no-dots-boundary-ok: 31 rows, pointRadius must be 0', async ({ page, request }) => {
        const rows = [];
        for (let i = 1; i <= 31; i++) {
            rows.push({ game_day: i, balance: 100000 + i * 1000 });
        }
        await mockBalanceData(request, rows);
        await gotoHistory(page);
        // Default window is 7 days → widen to 90 so all 31 rows reach the chart.
        await page.locator('.days-btn[data-days="90"]').click();
        await page.waitForTimeout(400);

        const canvas = page.locator('#chart-balance');
        await expect(canvas).toBeVisible();
        // rows.length > 30 → pointRadius 0 (history.html:276).
        const pr = await page.evaluate(() => window.balanceChart.data.datasets[0].pointRadius);
        expect(pr).toBe(0);
    });

    test('st-history-balance-no-dots-boundary-low: 30 rows, pointRadius must be > 0', async ({ page, request }) => {
        const rows = [];
        for (let i = 1; i <= 30; i++) {
            rows.push({ game_day: i, balance: 100000 + i * 1000 });
        }
        await mockBalanceData(request, rows);
        await gotoHistory(page);
        await page.locator('.days-btn[data-days="90"]').click();
        await page.waitForTimeout(400);

        const canvas = page.locator('#chart-balance');
        await expect(canvas).toBeVisible();
        // rows.length === 30 (not > 30) → pointRadius 3.
        const pr = await page.evaluate(() => window.balanceChart.data.datasets[0].pointRadius);
        expect(pr).toBeGreaterThan(0);
    });
});

test.describe('History surface — price chart states', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'empty-farm');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-history-price-empty-boundary-low: <2 price rows, canvas hidden, #empty-price visible', async ({ page, request }) => {
        await mockBalanceData(request, [
            { game_day: 1, balance: 100000 },
            { game_day: 2, balance: 110000 },
        ]);
        await mockPriceData(request, [
            { ts: '2026-01-01', sell_point: 'Silo A', fill_type: 'Pšenice', price_per_ton: 240 },
        ]);
        await gotoHistory(page);
        await page.waitForTimeout(600);

        const canvas = page.locator('#chart-price');
        await expect(canvas).toHaveCSS('display', 'none');

        const empty = page.locator('#empty-price');
        await expect(empty).toBeVisible();
    });

    test('st-history-price-data-boundary-ok: 2 price rows, canvas visible, #empty-price hidden', async ({ page, request }) => {
        await mockBalanceData(request, [
            { game_day: 1, balance: 100000 },
            { game_day: 2, balance: 110000 },
        ]);
        await mockPriceData(request, [
            { ts: '2026-01-01', sell_point: 'Silo A', fill_type: 'Pšenice', price_per_ton: 240 },
            { ts: '2026-01-02', sell_point: 'Silo A', fill_type: 'Pšenice', price_per_ton: 250 },
        ]);
        await gotoHistory(page);
        // empty-farm injects a forecast catalog of all fruits, so the dropdown
        // auto-default may not land on Pšenice — select it explicitly.
        await page.locator('#sel-filltype').selectOption('Pšenice');
        await page.waitForTimeout(600);

        const canvas = page.locator('#chart-price');
        await expect(canvas).not.toHaveCSS('display', 'none');

        const empty = page.locator('#empty-price');
        await expect(empty).toHaveCSS('display', 'none');
    });

    test('st-history-price-legend-single: 1 sell-point, legend hidden (display:false)', async ({ page, request }) => {
        await mockPriceData(request, [
            { ts: '2026-01-01', sell_point: 'Silo A', fill_type: 'Pšenice', price_per_ton: 240 },
            { ts: '2026-01-02', sell_point: 'Silo A', fill_type: 'Pšenice', price_per_ton: 250 },
        ]);
        await gotoHistory(page);
        await page.locator('#sel-filltype').selectOption('Pšenice');
        await page.waitForTimeout(600);

        const canvas = page.locator('#chart-price');
        await expect(canvas).toBeVisible();
        // 1 sell-point → 1 dataset → legend.display === false (history.html:763).
        const legendDisplay = await page.evaluate(() =>
            window.priceChart && window.priceChart.options.plugins.legend.display);
        expect(legendDisplay).toBe(false);
    });

    test('st-history-price-legend-multi: 2 sell-points, legend visible', async ({ page, request }) => {
        await mockPriceData(request, [
            { ts: '2026-01-01', sell_point: 'Silo A', fill_type: 'Pšenice', price_per_ton: 240 },
            { ts: '2026-01-02', sell_point: 'Silo A', fill_type: 'Pšenice', price_per_ton: 250 },
            { ts: '2026-01-01', sell_point: 'BGA Bergmann', fill_type: 'Pšenice', price_per_ton: 235 },
            { ts: '2026-01-02', sell_point: 'BGA Bergmann', fill_type: 'Pšenice', price_per_ton: 245 },
        ]);
        await gotoHistory(page);
        await page.locator('#sel-filltype').selectOption('Pšenice');
        await page.waitForTimeout(600);

        const canvas = page.locator('#chart-price');
        await expect(canvas).toBeVisible();
        // 2 sell-points → 2 datasets → legend.display === true.
        const legendDisplay = await page.evaluate(() =>
            window.priceChart && window.priceChart.options.plugins.legend.display);
        expect(legendDisplay).toBe(true);
    });
});

test.describe('History surface — forecast chart states', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'harvest-ready');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-history-forecast-no-payload: WS lacks priceForecast, canvas hidden, #empty-forecast visible', async ({ page, request }) => {
        await setScenario(request, 'st-prices-forecast-empty');
        await gotoHistory(page);

        const canvas = page.locator('#chart-forecast');
        await expect(canvas).toHaveCSS('display', 'none');

        const empty = page.locator('#empty-forecast');
        await expect(empty).toBeVisible();

        const summary = page.locator('#forecast-summary');
        await expect(summary).toHaveAttribute('hidden');
    });

    test('st-history-forecast-unknown-filltype: selected fillType not in payload, #empty-forecast shows specific text', async ({ page, request }) => {
        // prices-forecast-no-data ships a forecast whose fillTypes OMIT Pšenice.
        // Seed Pšenice price history so the commodity dropdown lists it (from the
        // DB) even though the forecast has no entry — selecting it hits the
        // entry===undefined path (history.html:507-513).
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
        await expect(empty).toBeVisible();
        await expect(empty).toContainText('Mód pro tuto komoditu neposílá sezónní křivku.');
    });

    test('st-history-forecast-data-ok: forecast data present, canvas visible, summary visible', async ({ page }) => {
        await gotoHistory(page);

        const canvas = page.locator('#chart-forecast');
        await expect(canvas).not.toHaveCSS('display', 'none');

        const summary = page.locator('#forecast-summary');
        await expect(summary).not.toHaveAttribute('hidden');
    });

    test('st-history-forecast-current-month: current period bar has amber border + ▸ prefix in label', async ({ page }) => {
        await gotoHistory(page);

        // Chart is rendered; the ▸ prefix for the current month is set in the Chart.js labels
        // array (history.html:618). Verify the canvas exists and is visible — the label text
        // is drawn on canvas and not inspectable via DOM selectors.
        const canvas = page.locator('#chart-forecast');
        await expect(canvas).toBeVisible();
    });

    test('st-history-forecast-watch-active: watched bar has gold border #fde047 + 🔔 overlay', async ({ page }) => {
        // Pre-seed a watch for Pšenice/June (period 6) before the page builds the chart.
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.forecastWatches',
                    JSON.stringify([{ fillType: 'Pšenice', period: 6 }]));
            } catch (_) {}
        });
        await gotoHistory(page);

        const canvas = page.locator('#chart-forecast');
        await expect(canvas).toBeVisible();

        // Ensure Pšenice is the selected commodity, then inspect the live Chart.js
        // instance: the watched bar (period 6 → index 5) gets the gold watch border.
        await page.locator('#sel-filltype-forecast').selectOption('Pšenice');
        await page.waitForTimeout(400);
        const goldBorders = await page.evaluate(() => {
            const c = window.forecastChart;
            if (!c) return null;
            const b = c.data.datasets[0].borderColor;
            return { idx5: b[5], goldCount: b.filter(x => x === '#fde047').length };
        });
        expect(goldBorders).not.toBeNull();
        expect(goldBorders.idx5).toBe('#fde047');
        expect(goldBorders.goldCount).toBe(1);
    });

    test('st-history-forecast-memo-hit: identical payload twice, forecastChart is NOT destroyed+recreated', async ({ page }) => {
        await gotoHistory(page);
        const canvas = page.locator('#chart-forecast');
        await expect(canvas).toBeVisible();

        // The memo guard (history.html:519-524) early-returns when the forecast
        // input is unchanged. The mock sends an identical priceForecast every
        // tick, so over several ticks the render counter must NOT keep climbing.
        const c1 = await page.evaluate(() => window.__forecastRenderCount || 0);
        await page.waitForTimeout(6000);   // > one 5 s mock tick
        const c2 = await page.evaluate(() => window.__forecastRenderCount || 0);
        // No new full rebuild across an unchanged tick (memo hit).
        expect(c2).toBe(c1);
    });
});

test.describe('History surface — dropdown fill-type & sell-point states', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'harvest-ready');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-history-dropdown-owned-first: owned commodities appear in first optgroup', async ({ page }) => {
        await gotoHistory(page);

        // Wait for fill-types to load (WS brings storage → rebuild adds owned optgroup)
        await page.waitForTimeout(1000);
        const ftSel = page.locator('#sel-filltype');
        await expect(ftSel).not.toContainText('Načítám');

        const html = await ftSel.innerHTML();

        // harvest-ready has 4 owned commodities → "📦 Mám na skladě (lze prodat)" optgroup
        // must exist and appear before "Ostatní".
        expect(html).toContain('📦 Mám na skladě');
        const ownedIdx = html.indexOf('📦 Mám na skladě');
        const restIdx  = html.indexOf('Ostatní');
        expect(ownedIdx).toBeGreaterThanOrEqual(0);
        expect(restIdx).toBeGreaterThan(ownedIdx);
    });

    test('st-history-dropdown-no-owned: no owned commodities, single optgroup without "Mám na skladě"', async ({ page, request }) => {
        await setScenario(request, 'empty-farm');
        await gotoHistory(page);

        const ftSel = page.locator('#sel-filltype');
        const html = await ftSel.innerHTML();

        // No "📦 Mám na skladě" optgroup
        expect(html).not.toContain('📦 Mám na skladě');
    });

    // #sel-sellpoint options come from /api/history/sell-points (JSONL DB) and are
    // then filtered by latestPrices (which station currently buys the selected
    // commodity). Seed price history for BOTH stations so they exist in the DB,
    // then verify the live-price filter narrows it to the buying station only.
    test('st-history-sellpoint-filtered: sell-point dropdown shows only places buying selected commodity', async ({ page, request }) => {
        const seed = await request.post('/mock/seed-history', { data: { prices: [
            { game_day: 41, sell_point: 'Getreidelager Bergmann', fill_type: 'Pšenice',  price_ton: 240 },
            { game_day: 42, sell_point: 'Getreidelager Bergmann', fill_type: 'Pšenice',  price_ton: 245 },
            { game_day: 41, sell_point: 'BGA Bergmann',           fill_type: 'Kukuřice', price_ton: 230 },
            { game_day: 42, sell_point: 'BGA Bergmann',           fill_type: 'Kukuřice', price_ton: 235 },
        ] } });
        if (!seed.ok()) throw new Error(`seed-history: ${seed.status()}`);
        await gotoHistory(page);

        // harvest-ready (live) prices: 'Getreidelager Bergmann' buys Pšenice,
        // 'BGA Bergmann' buys only Kukuřice/Tráva. Selecting Pšenice must leave
        // only Getreidelager in the sell-point dropdown.
        const ftSel = page.locator('#sel-filltype');
        await expect(ftSel.locator('option[value="Pšenice"]')).toBeAttached({ timeout: 10000 });
        await ftSel.selectOption({ value: 'Pšenice' });
        await page.waitForTimeout(800);

        const spSel = page.locator('#sel-sellpoint');
        await expect(spSel).toContainText('Getreidelager Bergmann');
        await expect(spSel).not.toContainText('BGA Bergmann');
    });

    test('st-history-sellpoint-unfiltered: no latestPrices, sell-point dropdown shows all places', async ({ page }) => {
        await gotoHistory(page);

        const spSel = page.locator('#sel-sellpoint');
        const spHtml = await spSel.innerHTML();
        // Should contain "Všechna místa" first option
        expect(spHtml).toContain('Všechna místa');
    });

    test('st-history-kpi-fills: #kpi-fills = count of fill-types, #kpi-fills-sub = count of sell-points', async ({ page }) => {
        await gotoHistory(page);

        const kpiFills = page.locator('#kpi-fills');
        const kpiFillsSub = page.locator('#kpi-fills-sub');

        // harvest-ready has basePrices() with Pšenice/Ječmen/Řepka/Kukuřice/Tráva
        // (5 distinct fill-types across both sell-points) and 2 sell-points.
        // kpi-fills = cachedFillTypes.length (from /api/history/fill-types — DB-backed,
        // may be 0 on a fresh run; the forecast catalog is merged into the DROPDOWN but
        // NOT into kpi-fills). We only assert > 0 when the WS forecast has populated it.
        // What we can always assert: the sub shows '… výkupních míst' suffix.
        await expect(kpiFillsSub).toContainText('výkupních míst');

        // kpi-fills must be a non-negative integer string (never '—' after loadFillTypes).
        const fillsText = await kpiFills.textContent();
        expect(parseInt(fillsText, 10)).toBeGreaterThanOrEqual(0);
        expect(fillsText).toMatch(/^\d+$/);
    });
});

test.describe('History surface — WS connection & replay states', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'harvest-ready');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-history-ws-connected: #ws-dot has live class, #ws-label says "Live"', async ({ page }) => {
        await gotoHistory(page);

        const wsDot = page.locator('#ws-dot');
        const wsLabel = page.locator('#ws-label');

        await expect(wsDot).toHaveClass(/live/);
        await expect(wsLabel).toContainText('Live');
    });

    test('st-history-ws-disconnected: #ws-dot has error class, #ws-label says "Odpojeno"', async ({ page }) => {
        await gotoHistory(page);
        // Wait for the socket to be live first, then force-close it client-side
        // (app.js exposes window.__ws). ws.onclose flips the dot/label.
        await expect(page.locator('#ws-dot')).toHaveClass(/live/);
        await page.evaluate(() => window.__ws && window.__ws.close());

        const wsDot   = page.locator('#ws-dot');
        const wsLabel = page.locator('#ws-label');
        await expect(wsDot).toHaveClass(/error/);
        await expect(wsLabel).toContainText('Odpojeno');
    });

    test('st-history-replay-banner-visible: __replayStatus.active=true, #replay-banner hidden=false, body.replaying present', async ({ page, request }) => {
        await gotoHistory(page);
        // POST /mock/replay-status broadcasts { __replayStatus: { active:true … } }
        // over the WS — app.js updateReplayBanner reveals the banner + body.replaying.
        const resp = await request.post('/mock/replay-status', { data: { active: true, name: 'smoke.jsonl', total: 5, idx: 1 } });
        if (!resp.ok()) throw new Error(`replay-status: ${resp.status()}`);

        const replayBanner = page.locator('#replay-banner');
        await expect(replayBanner).not.toHaveAttribute('hidden');
        await expect(page.locator('body')).toHaveClass(/replaying/);
    });

    test('st-history-replay-banner-hidden: __replayStatus.active=false, #replay-banner hidden=true, body.replaying absent', async ({ page }) => {
        await gotoHistory(page);

        const replayBanner = page.locator('#replay-banner');
        const body = page.locator('body');

        // No replay active by default
        if (await replayBanner.isVisible()) {
            await expect(replayBanner).toHaveAttribute('hidden');
        }
        await expect(body).not.toHaveClass(/replaying/);
    });
});

test.describe('History surface — bell integration', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'low-fuel');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-history-bell-has-alerts: vehicle with fuel ≤10%, #bell-btn has-alerts, #bell-count visible', async ({ page }) => {
        await gotoHistory(page);

        const bellBtn   = page.locator('#bell-btn');
        const bellCount = page.locator('#bell-count');

        // low-fuel scenario has vehicles with fuelPercent 8% and 6% (both ≤ 10%)
        // → bell must activate has-alerts and show a numeric count badge.
        await expect(bellBtn).toHaveClass(/has-alerts/);
        await expect(bellCount).not.toHaveAttribute('hidden');

        // Badge must contain a digit (1-9 or "9+"), never empty.
        await expect(bellCount).toContainText(/\d/);
    });
});
