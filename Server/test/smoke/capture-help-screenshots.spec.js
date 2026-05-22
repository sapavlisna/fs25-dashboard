// Capture screenshots for the help page. Saved into public/help/ so the
// help.html <img> tags resolve them directly.
//
// Run manually:
//   npx playwright test capture-help-screenshots --config=test/smoke/playwright.config.js
//
// Not part of the default smoke run — file is excluded via test.skip in CI
// when CI=1, but locally it always captures fresh shots.

const path = require('path');
const { test } = require('@playwright/test');

const OUT_DIR = path.resolve(__dirname, '..', '..', 'public', 'help');

test.describe('help screenshots', () => {
    // Skip when running headless smoke under CI — only meant for local refresh.
    test.skip(({}, testInfo) => !!process.env.CI, 'Manual capture only');

    test.beforeEach(async ({ page }) => {
        // Force dark-green theme + a wide viewport so screenshots look like
        // the README hero image.
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.theme', 'dark-green'); } catch (_) {}
        });
    });

    test('dashboard hero', async ({ page }) => {
        await page.goto('/');
        // Wait until first WS payload populates KPI Zůstatek (proves data is live).
        await page.waitForFunction(
            () => {
                const el = document.querySelector('#kpi-balance');
                return el && el.textContent.trim() !== '—';
            },
            { timeout: 10_000 }
        );
        // Give the masonry layout a tick to settle after sections render.
        await page.waitForTimeout(800);
        await page.screenshot({
            path: path.join(OUT_DIR, 'screenshot-dashboard.png'),
            fullPage: true,
        });
    });

    test('calendar gantt', async ({ page }) => {
        await page.goto('/calendar.html');
        await page.waitForFunction(
            () => {
                const el = document.querySelector('#kpi-owned');
                return el && el.textContent.trim() !== '—';
            },
            { timeout: 10_000 }
        );
        await page.waitForTimeout(800);
        await page.screenshot({
            path: path.join(OUT_DIR, 'screenshot-calendar.png'),
            fullPage: true,
        });
    });

    test('history charts', async ({ page }) => {
        await page.goto('/history.html');
        await page.waitForFunction(
            () => {
                const el = document.querySelector('#kpi-fills');
                return el && el.textContent.trim() !== '—';
            },
            { timeout: 10_000 }
        );
        // Charts need a frame or two to draw.
        await page.waitForTimeout(1500);
        await page.screenshot({
            path: path.join(OUT_DIR, 'screenshot-history.png'),
            fullPage: true,
        });
    });
});
