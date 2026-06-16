// wool-pallets.spec.js — regression for the combined sheep+goat barn.
// The default mock scenario's "Ovčín" now exposes TWO pallet outputs
// (Vlna + Kozí mléko). Verifies both render as separate bars + modal rows,
// i.e. goat milk no longer hides the wool. Run via playwright.config.js.

const { test, expect } = require('@playwright/test');

// Force the base 'default' scenario (mock-data.js generateData) — other specs
// leave a named scenario in mock-scenario.txt, which would otherwise carry over.
async function useDefaultScenario(request) {
    const resp = await request.post('http://localhost:3099/mock/scenario', { data: { scenario: 'default' } });
    if (!resp.ok()) throw new Error(`scenario default: ${resp.status()}`);
    await new Promise(r => setTimeout(r, 3000));
}

async function gotoDashboard(page) {
    await page.goto('/');
    await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
    await page.waitForTimeout(500);
}

function animalRow(page, name) {
    return page.locator('.animal-row', { has: page.locator('.ac-name', { hasText: name }) });
}

test('Ovčín shows both wool and goat-milk pallet outputs', async ({ page, request }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await useDefaultScenario(request);
    await gotoDashboard(page);
    const row = animalRow(page, 'Ovčín');
    await expect(row).toBeVisible();

    // Both pallet outputs render as separate bars (title = fill-type name).
    await expect(row.locator('.ac-bar-lbl[title="Vlna"]')).toHaveCount(1);
    await expect(row.locator('.ac-bar-lbl[title="Kozí mléko"]')).toHaveCount(1);

    // Detail modal lists both as their own rows.
    await row.click();
    const modal = page.locator('#amodal-body, .amodal-fills').first();
    await expect(page.locator('.amodal-fills')).toContainText('Vlna');
    await expect(page.locator('.amodal-fills')).toContainText('Kozí mléko');

    expect(errors, errors.join('\n')).toEqual([]);
});
