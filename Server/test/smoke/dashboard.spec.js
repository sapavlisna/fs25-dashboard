// Smoke tests for the 4 dashboard pages. Each test:
//   1. Navigates to the page
//   2. Captures console errors + unhandled rejections
//   3. Waits for the first WebSocket payload to render
//   4. Asserts a page-specific "this section actually loaded" anchor
//   5. Screenshot for visual diff (only on failure by default)
//
// Lifecycle is handled by playwright.config.js webServer block: it boots the
// mock generator + a sandboxed dashboard server on port 3099 before tests run.

const { test, expect } = require('@playwright/test');

// Helper — attach console + page-error listeners that fail the test if they fire.
function watchForErrors(page) {
    const errors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
    });
    page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));
    return errors;
}

test.describe('Dashboard pages', () => {
    // Disable cross-device server sync inside the smoke run — tests share a
    // single server process and would otherwise pick up state written by an
    // earlier test (a previous theme switch overwriting this one's URL
    // override, etc.). Local mode keeps every test isolated to its own
    // localStorage.
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('index (main dashboard)', async ({ page }) => {
        const errors = watchForErrors(page);
        await page.goto('/');

        // WS connects fast; KPI Zůstatek populated when first payload arrives.
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 10_000 });
        await expect(page.locator('#sec-fields')).toBeVisible();
        await expect(page.locator('#sec-vehicles')).toBeVisible();
        await expect(page.locator('#sec-storage')).toBeVisible();

        // Bell mounts after first FS25App.connect callback.
        await expect(page.locator('#bell-btn')).toBeVisible();

        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('calendar (field gantt)', async ({ page }) => {
        const errors = watchForErrors(page);
        await page.goto('/calendar.html');

        // KPI Vlastněná pole gets populated from WS payload.
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 10_000 });
        await expect(page.locator('#gantt-container')).toBeVisible();
        // Table layout: 3 header columns (Pole / Co potřebuje / timeline)
        await expect(page.locator('.gantt-table thead th')).toHaveCount(3);

        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('history (charts)', async ({ page }) => {
        const errors = watchForErrors(page);
        await page.goto('/history.html');

        // /api/history/* endpoints fire on load; KPI Komodit v DB gets count.
        await expect(page.locator('#kpi-fills')).not.toHaveText('—', { timeout: 10_000 });

        // Balance chart card either shows the canvas (≥ 2 records) or an
        // "not enough data" empty state on a fresh sandbox. Either is valid.
        const balanceVisible = await page.locator('#chart-balance').isVisible().catch(() => false);
        const emptyVisible   = await page.locator('#empty-balance').isVisible().catch(() => false);
        expect(balanceVisible || emptyVisible,
               'expected either #chart-balance canvas or #empty-balance state to be visible')
            .toBe(true);

        // Forecast chart needs a commodity selected. Mock emits availableFruits
        // so the dropdown should populate; if not, just check the wrapper exists.
        await expect(page.locator('#chart-forecast')).toBeAttached();

        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('help (documentation)', async ({ page }) => {
        const errors = watchForErrors(page);
        await page.goto('/help.html');

        // TOC + hero are static — no WS needed.
        await expect(page.locator('.help-hero h1')).toBeVisible();
        await expect(page.locator('#help-toc')).toBeVisible();

        // All section anchors should be present.
        for (const id of ['uvod', 'dashboard', 'kalendar', 'historie',
                          'nastaveni', 'zvonecek', 'flash', 'motivy', 'faq']) {
            await expect(page.locator(`#${id}`)).toBeAttached();
        }

        expect(errors, errors.join('\n')).toEqual([]);
    });

    // Pre-paint script reads ?theme=<id> from the URL and writes it to both
    // localStorage and the <html data-theme="..."> attribute before stylesheet
    // parsing. We verify each registered theme applies cleanly with no console
    // errors on the main dashboard.
    for (const theme of ['dark-green', 'dark-blue', 'light', 'high-contrast', 'fs25-native']) {
        test(`theme switch — ${theme}`, async ({ page }) => {
            const errors = watchForErrors(page);
            await page.goto(`/?theme=${theme}`);

            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 10_000 });

            expect(errors, errors.join('\n')).toEqual([]);
        });
    }
});
