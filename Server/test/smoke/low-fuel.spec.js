// low-fuel.spec.js — FUNCTIONAL (non-screenshot) assertions over the `low-fuel`
// mock scenario. Documents the warn-state contract so a restyle that keeps the
// behaviour passes, and a behaviour regression fails with a readable message
// (unlike a screenshot diff, which only says "pixels changed").
//
// Scenario data (scripts/mock-scenarios.js → scenarioLowFuel):
//   Fendt 942 Vario   fuel  8 %  → bar 'danger', bell <15 %  (urgent)
//   Fendt 1100 MT     fuel  6 %  → bar 'danger', bell <15 %  (urgent)
//   CLAAS LEXION 8900 fuel 35 %  → bar 'warn',   not in bell
//   Fendt 516 Vario   fuel 62 %  → bar (none),   not in bell
//   animals/silo/fields are all healthy → no other alert fires.
//
// Thresholds under test:
//   bar()  (index.html): pct <= 20 → danger · pct <= 50 → warn   (else none)
//   bell   (bell.js):    FUEL_LOW = 15 → vehicle joins 'veh-fuel' urgent alert

const { test, expect } = require('@playwright/test');

// ── helpers (same shape as vehicles-extra.spec.js, kept local per-file) ───────
async function setScenario(request, name) {
    const resp = await request.post('/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario "${name}": ${resp.status()}`);
    // mock-data.js polls the scenario file every 1 s and writes immediately on
    // change; allow for that + chokidar + WS broadcast (Windows I/O headroom).
    await new Promise(r => setTimeout(r, 3000));
}

async function gotoDashboard(page) {
    await page.goto('/');
    // Payload arrived once the balance KPI is no longer the placeholder dash.
    await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
    await page.waitForTimeout(500);
}

function vehicleRow(page, name) {
    return page.locator('.vehicle-row', { has: page.locator('.vc-name', { hasText: name }) });
}

function fuelFill(page, name) {
    return vehicleRow(page, name).locator('.vc-fuel .bar-fill');
}

test.describe('low-fuel scenario — warn states', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'low-fuel');
        // Local sync so nothing bleeds between tests on the shared server.
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    // ── fuel bar colour reflects the per-vehicle threshold ────────────────────
    test('fuel bar gets danger / warn / none per fuel %', async ({ page }) => {
        await gotoDashboard(page);

        // 8 % and 6 % → danger (critical red)
        await expect(fuelFill(page, 'Fendt 942 Vario')).toHaveClass(/danger/);
        await expect(fuelFill(page, 'Fendt 1100 MT')).toHaveClass(/danger/);

        // 35 % → warn (not danger)
        const lexion = fuelFill(page, 'CLAAS LEXION 8900');
        await expect(lexion).toHaveClass(/warn/);
        await expect(lexion).not.toHaveClass(/danger/);

        // 62 % → neither warn nor danger
        await expect(fuelFill(page, 'Fendt 516 Vario')).not.toHaveClass(/danger|warn/);

        // The visible % label matches the data (sanity that we read the right row).
        await expect(vehicleRow(page, 'Fendt 942 Vario').locator('.bar-pct')).toHaveText('8%');
    });

    // ── the bell surfaces ONLY the <15 % vehicles, as one urgent alert ────────
    test('bell lists both critical vehicles, omits the healthy ones', async ({ page }) => {
        await gotoDashboard(page);

        const badge = page.locator('#bell-count');
        await expect(badge).toBeVisible();

        // The one urgent vehicle alert, targeting the vehicles section.
        const fuelAlert = page.locator('.bell-item.bell-urgent[data-target="sec-vehicles"]');
        await expect(fuelAlert).toHaveCount(1);
        await expect(fuelAlert.locator('.bell-item-title')).toContainText('2 vozidla s nízkým palivem');

        const detail = fuelAlert.locator('.bell-item-detail');
        await expect(detail).toContainText('Fendt 942 Vario');
        await expect(detail).toContainText('Fendt 1100 MT');
        // 35 % / 62 % are below-threshold-on-the-bar but ABOVE the bell's 15 % cutoff.
        await expect(detail).not.toContainText('LEXION');
        await expect(detail).not.toContainText('Fendt 516');
    });

    // ── no spurious alerts: this scenario is clean apart from fuel ────────────
    test('only the fuel alert fires (no false animal/silo/field alerts)', async ({ page }) => {
        await gotoDashboard(page);
        // Exactly one alert group → badge shows "1" and the list has one item.
        await expect(page.locator('#bell-count')).toHaveText('1');
        await expect(page.locator('#bell-list .bell-item')).toHaveCount(1);
    });
});
