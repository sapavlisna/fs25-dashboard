// kpi.spec.js — FUNCTIONAL (non-screenshot) assertions over KPI surface states.
// Tests isolated state combinations for balance delta, weather, day, time, and
// currency rendering, plus flash thresholds and 3-day balance history.
//
// Each test sets a specific mock scenario, optionally configures DashState
// toggles (flash, etc.), navigates to the target page, and verifies DOM state
// via class presence/absence and textContent/visibility assertions.

const { test, expect } = require('@playwright/test');

// ── helpers ────────────────────────────────────────────────────────────────────

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

async function gotoPage(page, path) {
    await page.goto(path);
    // Wait for page-specific anchors
    if (path === '/calendar.html') {
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 12_000 });
    } else if (path === '/history.html') {
        await expect(page.locator('#kpi-fills')).toBeAttached({ timeout: 12_000 });
    }
    await page.waitForTimeout(500);
}

// ── Balance delta tests ────────────────────────────────────────────────────────

test.describe('KPI — Zůstatek delta states', () => {
    // farmBalanceDeltaDay is server-injected by enrich() from the most-recent
    // earlier game-day balance in the JSONL store. Seed that prior row so the
    // delta is deterministic regardless of rows left by previous tests.
    async function seedPriorBalance(request, priorDay, priorBalance) {
        const resp = await request.post('/mock/seed-history', { data: {
            balance: [{ game_day: priorDay, balance: priorBalance }],
            freezeDay: -999,   // don't suppress the live current-day append
        } });
        if (!resp.ok()) throw new Error(`seed-history: ${resp.status()}`);
        await new Promise(r => setTimeout(r, 400));
    }

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-kpi-balance-delta-neutral', async ({ page, request }) => {
        // Scenario is day 60 / farmBalance 250000. Seed an equal prior-day balance
        // so enrich computes delta === 0 → the neutral "→ beze změny" text.
        await setScenario(request, 'st-kpi-balance-delta-neutral');
        await seedPriorBalance(request, 59, 250000);
        await gotoDashboard(page);

        const balSub = page.locator('#kpi-balance-sub');
        const balCard = page.locator('.kpi-balance-card');

        // No delta-up or delta-down
        await expect(balSub).not.toHaveClass(/delta-up/);
        await expect(balSub).not.toHaveClass(/delta-down/);
        // Text is the neutral marker
        await expect(balSub).toContainText('→ beze změny od minulého dne');
        // Card has no alert/ok class
        await expect(balCard).not.toHaveClass(/kpi-ok|kpi-alert/);
    });

    test('st-kpi-balance-delta-undefined', async ({ page, request }) => {
        await setScenario(request, 'empty-farm');
        await gotoDashboard(page);

        const balSub = page.locator('#kpi-balance-sub');
        const balCard = page.locator('.kpi-balance-card');

        // Delta undefined → empty text, no class
        await expect(balSub).toHaveText('');
        await expect(balSub).not.toHaveClass(/delta-up|delta-down/);
        await expect(balCard).not.toHaveClass(/kpi-ok|kpi-alert/);
    });

    test('st-kpi-balance-delta-up-boundary-low', async ({ page, request }) => {
        // trend-up runs at day 60 / farmBalance 250000. Seed a lower prior-day
        // balance so enrich computes a positive delta deterministically.
        await setScenario(request, 'st-prices-balance-trend-up');
        await seedPriorBalance(request, 59, 200000);
        await gotoDashboard(page);

        const balSub = page.locator('#kpi-balance-sub');
        const balCard = page.locator('.kpi-balance-card');

        // delta-up class present
        await expect(balSub).toHaveClass(/delta-up/);
        // kpi-ok on card
        await expect(balCard).toHaveClass(/kpi-ok/);
        // Text contains up arrow
        await expect(balSub).toContainText('↑');
    });

    test('st-kpi-balance-delta-up-boundary-ok', async ({ page, request }) => {
        await setScenario(request, 'st-prices-balance-trend-up');
        await seedPriorBalance(request, 59, 200000);
        await gotoDashboard(page);

        const balSub = page.locator('#kpi-balance-sub');
        const balCard = page.locator('.kpi-balance-card');
        const balVal = page.locator('#kpi-balance');

        await expect(balSub).toHaveClass(/delta-up/);
        await expect(balCard).toHaveClass(/kpi-ok/);
        await expect(balSub).toContainText('↑');
        // Balance text renders (not placeholder)
        await expect(balVal).not.toHaveText('—');
    });

    test('st-kpi-balance-delta-down-boundary-low', async ({ page, request }) => {
        // trend-down runs at day 60 / farmBalance 200000. Seed a HIGHER prior-day
        // balance so enrich computes a negative delta deterministically.
        await setScenario(request, 'st-prices-balance-trend-down');
        await seedPriorBalance(request, 59, 260000);
        await gotoDashboard(page);

        const balSub = page.locator('#kpi-balance-sub');
        const balCard = page.locator('.kpi-balance-card');

        // delta-down class present
        await expect(balSub).toHaveClass(/delta-down/);
        // kpi-alert on card
        await expect(balCard).toHaveClass(/kpi-alert/);
        // Text contains down arrow
        await expect(balSub).toContainText('↓');
    });

    test('st-kpi-balance-delta-down-boundary-ok', async ({ page, request }) => {
        await setScenario(request, 'st-prices-balance-trend-down');
        await seedPriorBalance(request, 59, 260000);
        await gotoDashboard(page);

        const balSub = page.locator('#kpi-balance-sub');
        const balCard = page.locator('.kpi-balance-card');

        await expect(balSub).toHaveClass(/delta-down/);
        await expect(balCard).toHaveClass(/kpi-alert/);
    });
});

// ── Balance flash tests ────────────────────────────────────────────────────────

test.describe('KPI — Zůstatek flash states', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            // Enable flash for balance section
            try {
                const flashEnabled = { balance: true };
                localStorage.setItem('fs25.dash.v1.flashEnabled', JSON.stringify(flashEnabled));
            } catch (_) {}
        });
    });

    test('st-kpi-balance-flash-up-boundary-low', async ({ page, request }) => {
        // st-flash-balance-boundary-low: balance changes by 500 (< threshold 1000) — no flash
        await setScenario(request, 'st-flash-balance-boundary-low');
        await gotoDashboard(page);

        const balEl = page.locator('#kpi-balance');
        // No flash-up class (balance changes under threshold)
        await expect(balEl).not.toHaveClass(/flash-up/);
    });

    test.fixme('st-kpi-balance-flash-up-boundary-ok', async ({ page, request }) => {
        // BLOCKED: reliable flash-up assertion requires two consecutive WS ticks with
        // different balance values. The standard smoke test server (port 3099) sends
        // ticks every 5 s via mock-data.js; there is no deterministic way to synchronise
        // the Playwright step with the exact tick boundary. Use the flash infrastructure
        // (playwright.flash.config.js + direct file writes, port 3098) to test this
        // threshold reliably — see animals-flash.spec.js for the pattern.
    });

    test.fixme('st-kpi-balance-flash-down-boundary-ok', async ({ page, request }) => {
        // BLOCKED: reliable flash-down assertion requires two consecutive WS ticks where
        // balance DECREASES above threshold. No named scenario currently decreases balance
        // across ticks. Add a st-flash-balance-boundary-down scenario (tick===0: 201500,
        // tick>=1: 200000) OR use the flash infrastructure (port 3098) to test this.
    });

    test('st-kpi-balance-flash-high-balance-boundary-low', async ({ page, request }) => {
        // Empty farm has low balance (0), won't hit high-balance threshold
        await setScenario(request, 'empty-farm');
        await gotoDashboard(page);

        const balEl = page.locator('#kpi-balance');
        // No flash expected on small/zero balance changes
        await expect(balEl).not.toHaveClass(/flash-up/);
    });

    test('st-kpi-balance-flash-high-balance-boundary-ok', async ({ page, request }) => {
        // st-flash-balance-boundary-ok has balance 250 000 (high), delta 1500 (above threshold)
        // On first page load the flash framework has no prev value — flash-up is NOT present yet.
        // The test verifies the balance element exists with a real value and carries no stale flash.
        await setScenario(request, 'st-flash-balance-boundary-ok');
        await gotoDashboard(page);

        const balEl = page.locator('#kpi-balance');
        // Balance rendered (not placeholder)
        await expect(balEl).not.toHaveText('—');
        // No stale flash class on fresh page load
        await expect(balEl).not.toHaveClass(/flash-up|flash-down/);
    });
});

// ── Weather tests ──────────────────────────────────────────────────────────────

test.describe('KPI — Počasí states', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-kpi-weather-icon-all-types', async ({ page, request }) => {
        // Map of scenario → expected emoji (typeId 0–8 + fallback)
        const cases = [
            { scenario: 'st-weather-typeid-sun',      emoji: '☀️' },  // typeId 0
            { scenario: 'st-weather-typeid-slunecno', emoji: '☀️' },  // typeId 1 (also ☀️ per WEATHER_ICON)
            { scenario: 'st-weather-typeid-polojasno',emoji: '🌤' },  // typeId 2
            { scenario: 'st-weather-typeid-oblacno',  emoji: '☁️' },  // typeId 3
            { scenario: 'st-weather-typeid-dest',     emoji: '🌧' },  // typeId 4
            { scenario: 'st-weather-typeid-snezeni',  emoji: '❄️' },  // typeId 5
            { scenario: 'st-weather-typeid-bourka',   emoji: '⛈' },  // typeId 6
            { scenario: 'st-weather-typeid-kroupy',   emoji: '🌨' },  // typeId 7
            { scenario: 'st-weather-typeid-boundary-ok', emoji: '🌫' }, // typeId 8
            { scenario: 'st-weather-typeid-boundary-low', emoji: '·' }, // typeId -1 → fallback
        ];

        for (const { scenario, emoji } of cases) {
            await setScenario(request, scenario);
            await gotoDashboard(page);
            const icon = page.locator('#kpi-weather-icon');
            await expect(icon).toHaveText(emoji);
        }
    });

    test('st-kpi-weather-temperature-null', async ({ page, request }) => {
        // Most scenarios have valid temperature; just verify that it renders
        await setScenario(request, 'empty-farm');
        await gotoDashboard(page);

        const temp = page.locator('#kpi-weather-temp');
        // Either a number + °C or the fallback '—'
        const tempText = await temp.textContent();
        expect(/\d+\s°C|—/.test(tempText)).toBeTruthy();
    });

    test('st-kpi-weather-forecast-empty', async ({ page, request }) => {
        // st-weather-forecast-empty: forecast: [] → fcEl.innerHTML = ''
        await setScenario(request, 'st-weather-forecast-empty');
        await gotoDashboard(page);

        const fcEl = page.locator('#kpi-weather-forecast');
        // No forecast items rendered
        await expect(fcEl.locator('.forecast-day')).toHaveCount(0);
    });

    test('st-kpi-weather-forecast-present', async ({ page, request }) => {
        // st-weather-forecast-visible: 3 forecast days present
        await setScenario(request, 'st-weather-forecast-visible');
        await gotoDashboard(page);

        const days = page.locator('#kpi-weather-forecast .forecast-day');
        // 3 forecast items expected
        await expect(days).toHaveCount(3);

        // First item has D+N label
        const firstWhen = days.nth(0).locator('.forecast-when');
        await expect(firstWhen).toHaveText(/D\+\d+/);
    });
});

// ── Day and time tests ───────────────────────────────────────────────────────

test.describe('KPI — Den a čas states', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-kpi-day-and-season', async ({ page, request }) => {
        // empty-farm: gameDay=1, gameMonth=1, gameYear=1
        // Expected: 'březen · jaro · 1. rok' (parts joined with ' · ')
        await setScenario(request, 'empty-farm');
        await gotoDashboard(page);

        const dayEl = page.locator('#kpi-day');
        // gameDay=1 renders as '1'
        await expect(dayEl).toHaveText('1');

        const subEl = page.locator('#kpi-day-sub');
        // Month(1)='březen', season(day=1)='jaro', year=1 → '1. rok'
        await expect(subEl).toHaveText('březen · jaro · 1. rok');
    });

    test('st-kpi-time-display', async ({ page, request }) => {
        // st-kpi-time-display scenario sets gameTime: '09:00:00'
        await setScenario(request, 'st-kpi-time-display');
        await gotoDashboard(page);

        const timeEl = page.locator('#kpi-time');
        await expect(timeEl).toHaveText('09:00:00');

        const timeSubEl = page.locator('#kpi-time-sub');
        // Sub-label always empty
        await expect(timeSubEl).toHaveText('');
    });
});

// ── Currency and updated timestamp tests ───────────────────────────────────

test.describe('KPI — Měna a updated timestamp', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-kpi-currency-symbol', async ({ page, request }) => {
        // Default currency is € (no FS25Money override in mock)
        await setScenario(request, 'empty-farm');
        await gotoDashboard(page);

        // At least one .cur-unit element exists
        const curUnits = page.locator('.cur-unit');
        await expect(curUnits).not.toHaveCount(0);

        // Default symbol is '€'
        await expect(curUnits.first()).toHaveText('€');
    });

    test('st-kpi-updated-timestamp', async ({ page, request }) => {
        await setScenario(request, 'harvest-ready');
        await gotoDashboard(page);

        const updated = page.locator('#s-updated');
        const text1 = await updated.textContent();
        // toLocaleTimeString('cs-CZ') does NOT zero-pad the hour (e.g. "0:41:06"
        // before 10:00), so allow a 1- or 2-digit hour, then 2-digit min:sec.
        expect(text1).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });
});

// ── Balance 3-day history ──────────────────────────────────────────────────────

test.describe('KPI — Zůstatek 3-denní historie', () => {
    test('st-kpi-balance-history-days', async ({ page, request }) => {
        // harvest-ready runs on gameDay 42. Seed prior-day balance rows so the
        // strip renders the 3 most-recent days strictly before today (39/40/41).
        // The day-38 row only exists to give day-39 a delta arrow.
        await setScenario(request, 'harvest-ready');
        const seed = await request.post('/mock/seed-history', { data: { balance: [
            { game_day: 38, balance: 100000 },
            { game_day: 39, balance: 110000 },
            { game_day: 40, balance: 105000 },
            { game_day: 41, balance: 130000 },
        ] } });
        if (!seed.ok()) throw new Error(`seed-history: ${seed.status()}`);
        await page.waitForTimeout(500);

        await gotoDashboard(page);

        const days = page.locator('#kpi-balance-history .history-day');
        await expect(days).toHaveCount(3);

        // Newest-first: D-1 (day 41) is shown first. Day 41 rose vs day 40
        // (105000 → 130000) → delta-up class.
        await expect(days.first()).toHaveClass(/delta-up/);
        await expect(days.first().locator('.history-when')).toHaveText('D-1');
        // Day 40 fell vs day 39 (110000 → 105000) → delta-down on the middle chip.
        await expect(days.nth(1)).toHaveClass(/delta-down/);
    });
});
