// scenarios.spec.js — Visual screenshot regression tests for named mock scenarios.
//
// For each scenario × page combination:
//   1. Switch the mock to the named scenario via POST /mock/scenario.
//   2. Wait for mock-data.js to write the new payload (~5 s) plus chokidar to
//      pick it up and broadcast via WS (~0.5 s).
//   3. Navigate to the page and wait for the WS payload to render.
//   4. Take a screenshot masked over the clock and live-dot (dynamic elements).
//   5. Compare against the baseline in test/smoke/screenshots/.
//
// First run (no baselines): `npx playwright test --update-snapshots`
// Subsequent runs:           `npm run smoke`
//
// Threshold: 0.5 % pixel difference (configured in playwright.config.js).
//
// Pages covered: / · /calendar.html · /history.html · /help.html
// Pages excluded: /profit.html (user opt-out)

const { test, expect } = require('@playwright/test');
const path = require('path');

// ─── Helper: switch mock scenario ────────────────────────────────────────────
// Writes the scenario name via POST /mock/scenario, then waits long enough for
// mock-data.js to emit the new payload and for chokidar + WS to deliver it.

async function setMockScenario(request, name) {
    const resp = await request.post('/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) {
        throw new Error(`POST /mock/scenario "${name}" failed: ${resp.status()} ${await resp.text()}`);
    }
    // mock-data.js polls the scenario file every 1 s and writes immediately on
    // scenario change (immediate tick). Wait 3 s: 1 s for poll detection +
    // immediate write + chokidar stabilityThreshold (150 ms) + WS broadcast.
    // Extra headroom for Windows I/O latency.
    await new Promise(r => setTimeout(r, 3000));
}

// ─── Helper: common mask selectors ───────────────────────────────────────────
// These elements change every render (clock, live-status dot) and must be
// masked out before screenshot comparison to avoid spurious diffs.

function getMasks(page) {
    return [
        page.locator('.navbar-time'),            // HH:MM clock in navbar
        page.locator('.live-dot'),               // animated green/red status dot
        page.locator('#kpi-time'),               // game time KPI card
        page.locator('.kpi-card[data-tt-key="time"]'),  // same card, alternate selector
        // History charts render asynchronously (Chart.js) after the WS payload,
        // so their pixels aren't deterministic at screenshot time — mask the
        // canvases. The chart cards/headers/labels around them are still
        // compared, so layout regressions are still caught.
        page.locator('canvas'),
    ];
}

// ─── Helper: wait for WS payload ─────────────────────────────────────────────
// Waits until the page has received at least one WS payload.  Different pages
// expose different KPI elements; we pick a reliable per-page anchor.

async function waitForPayload(page, url) {
    const pathname = new URL(url, 'http://x').pathname;
    if (pathname === '/' || pathname === '/index.html') {
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
    } else if (pathname === '/calendar.html') {
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 12_000 });
    } else if (pathname === '/history.html') {
        // History page may show empty-state on a fresh sandbox — just wait for the KPI
        await expect(page.locator('#kpi-fills')).toBeAttached({ timeout: 12_000 });
    } else {
        // help.html — no WS needed, just wait for hero to paint
        await expect(page.locator('.help-hero h1')).toBeVisible({ timeout: 8_000 });
    }
    // Extra settle time for animation frames + any deferred renders
    await page.waitForTimeout(800);
}

// ─── Scenario × page matrix ───────────────────────────────────────────────────
// We run a 4-page sweep for each scenario below.
// Scenarios that are not relevant to a specific page still produce a screenshot
// (ensures no layout regressions on any page under any data shape).

const SCENARIOS = [
    'empty-farm',
    'harvest-ready',
    'low-fuel',
    'animal-needs',
    'plan-3-years',
    'withered-crops',
    'multi-fruit-types',
    'mixed-ai-tasks',
];

const PAGES = [
    { name: 'dashboard',  url: '/' },
    { name: 'calendar',   url: '/calendar.html' },
    { name: 'history',    url: '/history.html' },
    { name: 'help',       url: '/help.html' },
];

test.describe('Scenario screenshots', () => {
    // Clear accumulated history data before this suite so KOMODIT V DB counts
    // and commodity dropdown defaults are deterministic regardless of which
    // other spec files ran first in the same Playwright session.
    test.beforeAll(async () => {
        const fs   = require('fs');
        const path = require('path');
        const DATA_DIR = path.resolve(__dirname, '..', '..', '..', '..', '.tmp', 'smoke', 'data');
        try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
        fs.mkdirSync(DATA_DIR, { recursive: true });
    });

    // Disable server sync so state written by one test doesn't bleed into the next.
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    for (const scenario of SCENARIOS) {
        test.describe(`scenario: ${scenario}`, () => {
            for (const pg of PAGES) {
                test(`${pg.name}`, async ({ page, request }) => {
                    // Log console errors but don't fail on them here — bugs are
                    // collected separately in BUGS-2026-05.md.
                    const consoleErrors = [];
                    page.on('console', msg => {
                        if (msg.type() === 'error') consoleErrors.push(msg.text());
                    });
                    page.on('pageerror', err => consoleErrors.push(err.message));

                    await setMockScenario(request, scenario);
                    await page.goto(pg.url);
                    await waitForPayload(page, pg.url);

                    // Take screenshot, masking dynamic time elements
                    await expect(page).toHaveScreenshot(
                        `${scenario}-${pg.name}.png`,
                        {
                            mask:                getMasks(page),
                            maxDiffPixelRatio:   0.005,
                            animations:          'disabled',
                        },
                    );

                    // Attach console errors as test annotations (visible in the HTML report)
                    if (consoleErrors.length > 0) {
                        test.info().annotations.push({
                            type: 'console-errors',
                            description: consoleErrors.join('\n'),
                        });
                    }
                });
            }
        });
    }
});

// ─── Theme matrix ─────────────────────────────────────────────────────────────
// 3 representative scenarios × 5 themes × main dashboard only.
// Theme is set via ?theme=<id> URL param (pre-paint script reads it).

const THEME_SCENARIOS = ['empty-farm', 'harvest-ready', 'low-fuel'];
const THEMES = ['dark-green', 'dark-blue', 'light', 'high-contrast', 'fs25-native'];

test.describe('Theme matrix', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    for (const scenario of THEME_SCENARIOS) {
        for (const theme of THEMES) {
            test(`${scenario} / ${theme}`, async ({ page, request }) => {
                await setMockScenario(request, scenario);
                await page.goto(`/?theme=${theme}`);
                await expect(page.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 5_000 });
                await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
                await page.waitForTimeout(500);

                await expect(page).toHaveScreenshot(
                    `theme-${scenario}-${theme}.png`,
                    {
                        mask:              getMasks(page),
                        maxDiffPixelRatio: 0.005,
                        animations:        'disabled',
                    },
                );
            });
        }
    }
});
