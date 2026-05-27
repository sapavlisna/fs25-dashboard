// vehicles-extra.spec.js — backlog 2026-05 body 1/2/4 on the main dashboard
// vehicles section, against the `vehicles-rich` mock scenario:
//   body 1 — row flashes (up/down) when an attached trailer's fill % changes
//   body 2 — an empty (0 %) attached trailer is still shown
//   body 4 — condition % badge (colour-coded) + speed km/h (only when moving)
//
// Runs each assertion at desktop (1440) and mobile (375) width.

const { test, expect } = require('@playwright/test');

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

// Locate a vehicle row by its visible short name.
function vehicleRow(page, name) {
    return page.locator('.vehicle-row', { has: page.locator('.vc-name', { hasText: name }) });
}

test.describe('Vehicles extras (vehicles-rich scenario)', () => {
    test.beforeEach(async ({ request }) => {
        await setScenario(request, 'vehicles-rich');
    });

    // ── body 4: condition badge + speed ──────────────────────────────────────
    test('condition % badge colour + speed only when moving — desktop', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoDashboard(page);

        // Fendt 516: conditionPercent 45 → red badge, parked → no speed.
        const row516 = vehicleRow(page, 'Fendt 516 Vario');
        await expect(row516.locator('.vc-cond')).toContainText('45 %');
        await expect(row516.locator('.vc-cond')).toHaveClass(/c-red/);
        await expect(row516.locator('.vc-speed')).toHaveCount(0);   // parked → hidden

        // Fendt 942: condition 92 → green, moving 14 km/h → speed shown.
        const row942 = vehicleRow(page, 'Fendt 942 Vario');
        await expect(row942.locator('.vc-cond')).toHaveClass(/c-green/);
        await expect(row942.locator('.vc-speed')).toContainText('14 km/h');
    });

    test('condition badge survives mobile width', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await gotoDashboard(page);
        const row516 = vehicleRow(page, 'Fendt 516 Vario');
        await expect(row516.locator('.vc-cond')).toContainText('45 %');
        // No body-wide horizontal overflow from the added badge.
        const overflow = await page.evaluate(() =>
            document.body.scrollWidth > document.body.clientWidth + 1);
        expect(overflow, 'no horizontal overflow on mobile').toBe(false);
    });

    // ── body 2: empty trailer still visible ──────────────────────────────────
    test('empty (0%) attached trailer is shown — desktop + mobile', async ({ page }) => {
        for (const w of [1440, 375]) {
            await page.setViewportSize({ width: w, height: 800 });
            await gotoDashboard(page);
            const row516 = vehicleRow(page, 'Fendt 516 Vario');
            // Empty trailer renders a "— 0%" entry in the implement summary
            // (visible because empty implements now show by default).
            await expect(row516.locator('.vc-impl-summary')).toBeVisible();
            await expect(row516.locator('.vc-impl-summary')).toContainText('0%');
        }
    });

    // ── body 1: flash on fill change ─────────────────────────────────────────
    test('row flashes when trailer fill % changes', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoDashboard(page);
        // The scenario's trailer fill steps every mock tick (~5 s). Within a
        // couple ticks the Fendt 942 row should pick up a flash-up/down class.
        await expect(async () => {
            const cls = await vehicleRow(page, 'Fendt 942 Vario').getAttribute('class');
            expect(cls).toMatch(/flash-(up|down)/);
        }).toPass({ timeout: 20_000 });
    });
});
