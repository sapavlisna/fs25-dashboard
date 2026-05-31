// layout-masonry.spec.js — guards the JS column-balancer (applyMasonrySpans).
// The balancer must spread sections across all columns and seat span-2 sections
// (Pole + expanded Vozidla) side-by-side on the top band, regardless of the
// user's section order — so no whole column/right-half is left empty.

const { test, expect } = require('@playwright/test');

async function setScenario(request, name) {
    const r = await request.post('http://localhost:3099/mock/scenario', { data: { scenario: name } });
    if (!r.ok()) throw new Error(`scenario ${name}: ${r.status()}`);
    await new Promise(res => setTimeout(res, 2500));
}
function boxes(page) {
    return page.evaluate(() => [...document.querySelectorAll('#masonry > .section')]
        .filter(s => s.style.display !== 'none')
        .map(s => { const r = s.getBoundingClientRect(); return { key: s.dataset.ttKey, left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom) }; }));
}

test.describe('Masonry column balancer', () => {
    test.use({ viewport: { width: 1920, height: 1400 } });

    test('default order spreads sections across all 4 columns', async ({ page, request }) => {
        await setScenario(request, 'layout-stress');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12000 });
        await page.waitForTimeout(1200);
        const b = await boxes(page);
        const lefts = new Set(b.map(x => x.left));
        expect(lefts.size, 'sections occupy all 4 columns (4 distinct left edges)').toBeGreaterThanOrEqual(4);
    });

    test('two span-2 sections sit side-by-side on the top band, not stacked', async ({ page, request }) => {
        // Reorder so the two span-2 sections are separated by singles — the case
        // that used to stack them in the left columns and empty the right half.
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.syncMode', 'local');
                localStorage.setItem('fs25.dash.v1.order:sections',
                    JSON.stringify(['fields', 'animals', 'prices', 'vehicles', 'storage', 'productions']));
            } catch (_) {}
        });
        await setScenario(request, 'layout-stress');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12000 });
        await page.waitForTimeout(1200);
        // Enable Vozidla expanded → fields + vehicles are both span-2.
        await page.locator('.sec-cfg-btn[data-sec-cfg="vehicles"]').click();
        await page.evaluate(() => {
            const cb = document.querySelector('#sec-cfg-panel input[data-cfg-key="vehiclesExpanded"]');
            if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);

        const b = await boxes(page);
        const fields = b.find(x => x.key === 'fields');
        const vehicles = b.find(x => x.key === 'vehicles');
        expect(fields && vehicles).toBeTruthy();
        // Both wide sections on the same top band (tops within 8 px)…
        expect(Math.abs(fields.top - vehicles.top), 'fields + vehicles share the top band').toBeLessThan(8);
        // …in different columns (vehicles to the right of fields).
        expect(vehicles.left, 'vehicles sits beside fields, not under it').toBeGreaterThan(fields.left + 100);
        // All 4 columns populated.
        const lefts = new Set(b.map(x => x.left));
        expect(lefts.size, 'all 4 columns used').toBeGreaterThanOrEqual(4);
    });
});
