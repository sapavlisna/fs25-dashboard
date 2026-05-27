// productions.spec.js — backlog 2026-05 body 3 (frontend half).
// Against the `productions-many` scenario the dashboard must render ALL
// production points, not just one. The Lua-side enumeration fix
// (productionChainManager) is verified live in-game; this guards the frontend
// rendering of a multi-production payload at desktop + mobile.

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

test.describe('Productions render all (productions-many scenario)', () => {
    test.beforeEach(async ({ request }) => {
        await setScenario(request, 'productions-many');
    });

    for (const w of [1440, 375]) {
        test(`all 4 production groups visible @ ${w}px`, async ({ page }) => {
            await page.setViewportSize({ width: w, height: 900 });
            await gotoDashboard(page);

            const body = page.locator('#productions-body');
            await expect(body).toBeVisible();

            // The scenario has 4 productions — each becomes a group header row.
            for (const name of ['Mlékárna', 'Pekárna', 'Pila', 'BGA Bergmann']) {
                await expect(body).toContainText(name);
            }
            // Count chip in the section header shows 4.
            await expect(page.locator('#cnt-productions')).toHaveText('4');
        });
    }
});
