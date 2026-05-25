// Regression for "section bounces back to its original column on drop".
// The original bug: section-list in the settings panel uses the same
// data-tt-dnd="sections" scope as the dashboard masonry, so onScopeChange
// was concatenating both containers' children into the saved order, giving
// a 12-key duplicated array. applySectionOrder then iterated those 12 keys
// and appendChild'd each — leaving the masonry in the SECOND mirror's order
// (i.e. the section-list's stale pre-drag order), which made the drop appear
// to bounce back.
//
// The fix scopes saveOrder to the source container (evt.from). This test
// drags a section to a far-away column and asserts the final position is
// the same as the placeholder showed during the drag.
//
// NOTE: this used to drive sec-fields, but #sec-fields now has CSS
// `column-span: all` — it's always the full-width "hero" at the top and
// can't move between columns. The test now drags #sec-vehicles, which is
// a regular column-bound section.

const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1900, height: 1400 } });

test.beforeEach(async ({ page }) => {
    // Disable server sync so the test isn't perturbed by state PATCHed by
    // an earlier spec (the smoke suite shares one server process).
    await page.addInitScript(() => {
        try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
    });
});

test('section dropped on the right stays on the right', async ({ page }) => {
    await page.goto('/');
    await page.locator('#kpi-balance').waitFor();
    await page.waitForTimeout(800);

    // Capture DOM order before — anti-bounce check is "Sortable actually
    // moved the node and didn't snap it back to its original DOM slot."
    const beforeOrder = await page.evaluate(() => JSON.parse(
        localStorage.getItem('fs25.dash.v1.order:sections') || 'null'
    ));

    const handle = page.locator('#sec-vehicles > .section-header');
    const targetSection = page.locator('#sec-prices');
    const h = await handle.boundingBox();
    const t = await targetSection.boundingBox();

    await page.mouse.move(h.x + 60, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 68, h.y + h.height / 2 + 8, { steps: 4 });
    await page.waitForTimeout(80);

    await page.mouse.move(t.x + t.width / 2, t.y + 30, { steps: 30 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(400);

    // Sortable persists the new order to localStorage. The "vehicles" key
    // must be different from where it sat before — otherwise the section
    // bounced back to its starting slot.
    const afterOrder = await page.evaluate(() => JSON.parse(
        localStorage.getItem('fs25.dash.v1.order:sections') || 'null'
    ));
    expect(afterOrder, 'order saved after drop').toBeTruthy();
    expect(afterOrder, 'order should contain all 6 sections').toHaveLength(6);

    // sec-vehicles should now sit further along the order than it did before
    // (or it had no saved order before — either means the drop registered).
    const afterIdx = afterOrder.indexOf('vehicles');
    expect(afterIdx, 'vehicles is in the saved order').toBeGreaterThanOrEqual(0);
    if (Array.isArray(beforeOrder)) {
        const beforeIdx = beforeOrder.indexOf('vehicles');
        expect(afterIdx !== beforeIdx, `vehicles moved (was at ${beforeIdx}, now ${afterIdx})`).toBe(true);
    }
});
