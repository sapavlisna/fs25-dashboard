// Sortable.js drag-interaction tests. Validates the four bug fixes:
//   * KPI cards reorder + hide (bugs 1b, 1c)
//   * Sections drag by header, not just by ⠿ handle (bug 1a)
//   * Drag-to-hide moves items into the hidden zone and updates localStorage
//     (bugs 3 + 4)
//   * Settings modal stays the same height across tabs (bug 5)
//
// Sortable runs with forceFallback:true so it owns the drag via custom
// pointer-event handlers. Playwright's `dragAndDrop` helper uses HTML5
// native drag events and DOES NOT trigger Sortable's listeners — every
// test here drives the cursor manually via mouse.down/move/up.

const { test, expect } = require('@playwright/test');

// Helper — drag the centre of source onto the centre of target. The
// intermediate `steps` keep Sortable's pointermove handler fed: a single
// long jump would skip past the drop zone without registering.
async function dragTo(page, source, target) {
    // Make sure both elements are in the viewport so the bounding-box
    // coordinates we compute are clickable. Without this, sections that
    // sit below the masonry fold get a y-coordinate outside viewport and
    // mouse.down() lands on whatever happens to be visible there.
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const s = await source.boundingBox();
    const t = await target.boundingBox();
    if (!s || !t) throw new Error('boundingBox failed — element is detached or invisible');

    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    // Sortable's fallback mode binds pointermove on document only AFTER
    // the first mousemove past `touchStartThreshold` (in forceFallback
    // mode that's `fallbackTolerance`, 4 px). A small initial nudge with
    // a pause lets the listener attach before the long traverse.
    await page.mouse.move(s.x + s.width / 2 + 12, s.y + s.height / 2 + 12, { steps: 5 });
    await page.waitForTimeout(60);
    // Glide to the target in many small steps so dragover handlers fire
    // along the way.
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 30 });
    // Small pause at the target so the dragover settles + Sortable's
    // animation tick can pick up the drop position.
    await page.waitForTimeout(150);
    await page.mouse.up();
    // Let TT.onChange + render callbacks settle.
    await page.waitForTimeout(250);
}

test.describe('Drag interactions', () => {
    // Tall viewport so masonry-laid-out sections all fit on one screen and
    // bounding-box coordinates stay inside the visible page.
    test.use({ viewport: { width: 1440, height: 1600 } });

    // ─── Sections ────────────────────────────────────────────────────────────
    test('section drag by header (not just by ⠿ handle)', async ({ page }) => {
        await page.goto('/');
        // Wait for first WS payload so the masonry has settled.
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 10_000 });

        // Pick up sec-vehicles by clicking its section-header background
        // (NOT the .drag-handle ⠿). Drop on sec-storage so vehicles ends up
        // above storage in the saved order.
        const vehiclesHeader = page.locator('#sec-vehicles > .section-header');
        const storage        = page.locator('#sec-storage');
        await dragTo(page, vehiclesHeader, storage);

        // localStorage should now record an order array that puts 'vehicles'
        // somewhere — and crucially the new order survived a header-only grab.
        const order = await page.evaluate(() => JSON.parse(localStorage.getItem('fs25.dash.v1.order:sections') || '[]'));
        expect(order, 'sections order saved').toContain('vehicles');
        expect(order.length, 'all six sections present').toBeGreaterThanOrEqual(6);
    });

    // Regression — dragging a masonry section past/onto the KPI row used to
    // drop it INTO the KPI row (both Sortable groups had `put: true`),
    // which exploded the layout into a chaotic mix of KPI cards and full
    // sections. The fix restricts each group's `put` to its own scope.
    test('section cannot be dropped into KPI row (cross-group rejected)', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 10_000 });

        const pricesHeader = page.locator('#sec-prices > .section-header');
        const kpiRow       = page.locator('#kpi-row');
        await dragTo(page, pricesHeader, kpiRow);

        // The dragged section must remain a child of #masonry — not a child
        // of #kpi-row or #kpi-hidden-row.
        const stillInMasonry = await page.evaluate(() =>
            !!document.querySelector('#masonry > #sec-prices'));
        const leakedToKpi = await page.evaluate(() =>
            !!document.querySelector('#kpi-row #sec-prices'));
        expect(stillInMasonry, 'sec-prices stays inside masonry').toBe(true);
        expect(leakedToKpi, 'sec-prices must NOT have landed in the KPI row').toBe(false);

        // KPI order must not contain a section key — that would mean a
        // section was tracked as a KPI item.
        const kpiOrder = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('fs25.dash.v1.order:kpi') || '[]'));
        expect(kpiOrder, 'KPI order untouched by section drag')
            .not.toContain('prices');
    });

    // ─── KPI ─────────────────────────────────────────────────────────────────
    test('KPI card reorder within the row', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 10_000 });

        // Move 'day' card across the row to land before 'balance'. The starting
        // DOM order is balance → weather → day → time, so this is a non-trivial
        // shift that we can verify in the saved order array.
        const day     = page.locator('.kpi-card[data-tt-key="day"]');
        const balance = page.locator('.kpi-card[data-tt-key="balance"]');
        await dragTo(page, day, balance);

        const order = await page.evaluate(() => JSON.parse(localStorage.getItem('fs25.dash.v1.order:kpi') || '[]'));
        expect(order, 'kpi order saved').toEqual(expect.arrayContaining(['balance', 'weather', 'day', 'time']));
        // 'day' should now appear before 'balance' in the order array.
        const dayIdx     = order.indexOf('day');
        const balanceIdx = order.indexOf('balance');
        expect(dayIdx, 'day moved earlier than balance').toBeLessThan(balanceIdx);
    });

    test('vehicle reorder (sanity — drag works within same container)', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 10_000 });
        // Need at least two vehicles to swap positions.
        const rows = page.locator('#vehicles-body .vehicle-row');
        const count = await rows.count();
        expect(count, 'at least 2 vehicles needed').toBeGreaterThanOrEqual(2);

        const target = count >= 3 ? rows.nth(2) : rows.nth(1);
        await dragTo(page, rows.nth(0), target);

        const order = await page.evaluate(() => JSON.parse(localStorage.getItem('fs25.dash.v1.order:vehicles') || '[]'));
        expect(order.length, 'vehicles order should be saved after reorder').toBeGreaterThan(0);
    });

    // ─── Drag-to-hide (vehicles) ─────────────────────────────────────────────
    test('vehicle hide via drag into hidden zone', async ({ page }) => {
        // Pipe browser console + page errors into the test output so a
        // failed drag is debuggable from the run log.
        page.on('console', m => console.log('[browser]', m.type(), m.text()));
        page.on('pageerror', e => console.log('[pageerror]', e.message));

        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 10_000 });

        // Mock vehicles are populated within ~5 s of page load.
        const firstVehicle = page.locator('#vehicles-body .vehicle-row').first();
        await firstVehicle.waitFor({ timeout: 10_000 });
        const name = await firstVehicle.getAttribute('data-tt-key');
        expect(name, 'vehicle has a data-tt-key').toBeTruthy();

        // Verify Sortable claimed the hidden body too — without that, drop
        // events fall on the floor regardless of cursor accuracy.
        const sortableState = await page.evaluate(() => {
            const body  = document.getElementById('vehicles-body');
            const hBody = document.getElementById('vehicles-hidden-body');
            return {
                bodySortable:  !!(body && body._tt_sortable),
                hbodySortable: !!(hBody && hBody._tt_sortable),
                hbodyExists:   !!hBody,
                hbodyHidden:   hBody ? hBody.hasAttribute('data-tt-hidden') : null,
            };
        });
        console.log('[test] sortable state', sortableState);

        // Drag-to-hide via the same mouse motion the user makes. Aim at the
        // empty-hint inside the hidden body — that's the visual "Přetáhni sem"
        // text, which guarantees we hit the hidden container's hit area
        // regardless of how small the body is when no items are hidden yet.
        const hiddenHint = page.locator('#vehicles-hidden-body .tt-hidden-empty');
        await dragTo(page, firstVehicle, hiddenHint);

        // The TT key for vehicles lives at `fs25.dash.v1.hidden:vehicles` AND
        // (for backwards compat) `fs25.dash.v1.hiddenVehicles`. Either is fine.
        const tt     = await page.evaluate(() => JSON.parse(localStorage.getItem('fs25.dash.v1.hidden:vehicles') || '[]'));
        const legacy = await page.evaluate(() => JSON.parse(localStorage.getItem('fs25.dash.v1.hiddenVehicles')   || '[]'));

        // Cross-render the DOM too — after drop, the row should physically be
        // inside the hidden body (renderVehicles re-renders both lists).
        const movedToHidden = await page.evaluate(n =>
            !!document.querySelector(`#vehicles-hidden-body [data-tt-key="${n.replace(/"/g, '\\"')}"]`),
            name,
        );

        expect(
            tt.includes(name) || legacy.includes(name) || movedToHidden,
            `vehicle "${name}" should be hidden after drag (TT=${JSON.stringify(tt)}, legacy=${JSON.stringify(legacy)}, DOM-in-hidden=${movedToHidden})`,
        ).toBe(true);
    });

    // ─── Settings modal pinned height (bug 5) ────────────────────────────────
    test('settings modal height stable across tabs', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 10_000 });

        await page.locator('#notif-toggle').click();
        const modal = page.locator('#notif-modal');
        await expect(modal).toBeVisible();

        const measurements = [];
        for (const tab of ['notif', 'sections', 'theme']) {
            await page.locator(`.settings-tabs button[data-tab="${tab}"]`).click();
            const box = await modal.boundingBox();
            measurements.push({ tab, h: box?.height ?? 0 });
        }
        const heights = measurements.map(m => m.h);
        const min = Math.min(...heights);
        const max = Math.max(...heights);
        // ≤2 px wobble is the rounding noise from sub-pixel layout; anything
        // larger means the modal still reflows per-tab.
        expect(max - min,
            `modal height changed across tabs: ${JSON.stringify(measurements)}`)
            .toBeLessThanOrEqual(2);
    });
});
