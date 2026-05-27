// Verifies the "click a seasonal-forecast bar to watch it for a price
// notification" feature on /history.html:
//   1. forecast chart renders (mock now sends priceForecast)
//   2. clicking a bar adds a DashState.forecastWatches entry + paints the
//      bar's border gold
//   3. clicking the same bar again clears the watch + reverts the border
//
// Run: npx playwright test --config=test/smoke/playwright.config.js forecast-watch

const { test, expect } = require('@playwright/test');

const WATCH_GOLD = '#fde047';

// Pixel centre (just below the top edge) of bar `idx` in the forecast chart,
// in viewport coordinates, computed from Chart.js metadata.
async function barPoint(page, idx) {
    return page.evaluate((i) => {
        const c = window.Chart.getChart('chart-forecast');
        const bar = c.getDatasetMeta(0).data[i];
        const rect = c.canvas.getBoundingClientRect();
        return { x: rect.left + bar.x, y: rect.top + bar.y + 8 };
    }, idx);
}

// Read the border colour Chart.js applied to bar `idx`.
async function barBorder(page, idx) {
    return page.evaluate((i) => {
        const c = window.Chart.getChart('chart-forecast');
        return String(c.data.datasets[0].borderColor[i]).toLowerCase();
    }, idx);
}

test.describe('Forecast watch toggle', () => {
    test.beforeEach(async ({ page, request }) => {
        // Pin 'default' so we don't inherit a prior test's scenario; its
        // priceForecast covers all fruits. The dropdown now seeds itself from
        // the forecast catalog (not just saved price history), so the chart
        // renders from the first WS payload without waiting on the history
        // pipeline.
        await request.post('/mock/scenario', { data: { scenario: 'default' } });
        await new Promise(r => setTimeout(r, 1500));
        await page.goto('/history.html');
        // Forecast chart renders once a commodity is auto-selected (12 bars).
        await page.waitForFunction(() => {
            const c = window.Chart && window.Chart.getChart('chart-forecast');
            return c && c.data.datasets[0].data.length === 12;
        }, { timeout: 15_000 });
    });

    // Delta-based + border-toggle: robust to any pre-existing watch (the
    // forecastWatches key is server-synced and may survive across tests).
    test('click toggles the gold watch border on a bar', async ({ page }) => {
        const idx = 3;
        const initial = await barBorder(page, idx);
        const wasWatched = initial === WATCH_GOLD;

        // First click flips the watch state → border flips.
        await page.mouse.click(...Object.values(await barPoint(page, idx)));
        await expect(async () => {
            const b = await barBorder(page, idx);
            if (wasWatched) expect(b).not.toBe(WATCH_GOLD);
            else            expect(b).toBe(WATCH_GOLD);
        }).toPass({ timeout: 5_000 });

        // Second click flips it back to the original state.
        await page.mouse.click(...Object.values(await barPoint(page, idx)));
        await expect(async () => {
            const b = await barBorder(page, idx);
            if (wasWatched) expect(b).toBe(WATCH_GOLD);
            else            expect(b).not.toBe(WATCH_GOLD);
        }).toPass({ timeout: 5_000 });
    });

    // The persisted watch records the selected commodity + 1-based period.
    test('watch entry records commodity + period', async ({ page }) => {
        const idx = 5;
        const selected = await page.evaluate(
            () => document.getElementById('sel-filltype').value);

        // Ensure bar idx starts unwatched for this commodity (clear if needed).
        const pre = await barBorder(page, idx);
        if (pre === WATCH_GOLD) {
            await page.mouse.click(...Object.values(await barPoint(page, idx)));
            await page.waitForTimeout(500);
        }

        await page.mouse.click(...Object.values(await barPoint(page, idx)));
        await expect(async () => {
            const watch = await page.evaluate((args) =>
                (window.DashState.get('forecastWatches', []) || [])
                    .find(w => w.fillType === args.sel && w.period === args.period),
                { sel: selected, period: idx + 1 });
            expect(watch, 'watch persisted for commodity+period').toBeTruthy();
        }).toPass({ timeout: 5_000 });

        // Cleanup: click again to remove the watch we added.
        await page.mouse.click(...Object.values(await barPoint(page, idx)));
    });
});
