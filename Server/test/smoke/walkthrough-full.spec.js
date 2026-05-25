// walkthrough-full.spec.js — manual-style click-through of every interaction
// that isn't already covered by other specs. Each test makes one assertion
// or annotates a known gap. Goal: catch dead clicks that other tests miss.

const { test, expect } = require('@playwright/test');

async function setMockScenario(request, name) {
    const resp = await request.post('http://localhost:3099/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario ${name}: ${resp.status()}`);
    await new Promise(r => setTimeout(r, 3000));
}

test.describe('Walkthrough — Dashboard interactions', () => {
    test.use({ viewport: { width: 1440, height: 1600 } });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('hide-zero-prices button removes empty rows', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        // Count visible .price-row before
        const before = await page.locator('#prices-body tr:not(.hidden-row)').count();
        const btn = page.locator('#btn-hide-zero-prices');
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        await page.waitForTimeout(400);
        const after = await page.locator('#prices-body tr:not(.hidden-row)').count();

        // Either fewer rows OR same (if no zero-stock rows existed) — but the button must NOT throw
        expect(after, 'hide-zero-prices: row count should not exceed before').toBeLessThanOrEqual(before);
    });

    test('vehicles-expanded toggle adds .expanded-vehicles class', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const sec = page.locator('.section[data-tt-key="vehicles"]');
        const before = await sec.evaluate(el => el.classList.contains('expanded-vehicles'));

        // Open settings, switch to Vozidla tab. Checkboxes use the CSS-hidden
        // toggle-switch pattern (.switch-knob is the visible affordance, the
        // <input> itself is sr-only). Dispatch the change via JS to bypass
        // the visibility check — we're testing the handler wiring, not CSS.
        await page.locator('#notif-toggle').click();
        await page.locator('.settings-tabs button[data-tab="vehicles"]').click();
        await page.evaluate(() => {
            const cb = document.getElementById('vehicles-expanded');
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForTimeout(300);

        const after = await sec.evaluate(el => el.classList.contains('expanded-vehicles'));
        expect(after, 'expanded-vehicles class should toggle').toBe(!before);
    });

    test('vehicles-show-empty-impl toggle persists to DashState + rerenders vehicles', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        await page.locator('#notif-toggle').click();
        await page.locator('.settings-tabs button[data-tab="vehicles"]').click();
        const beforeChecked = await page.evaluate(() =>
            document.getElementById('vehicles-show-empty-impl').checked);
        await page.evaluate(() => {
            const cb = document.getElementById('vehicles-show-empty-impl');
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForTimeout(300);

        const stored = await page.evaluate(() => {
            try { return JSON.parse(localStorage.getItem('fs25.dash.v1.vehicleShowEmptyImplements') || 'null'); }
            catch { return null; }
        });
        expect(stored, 'toggle must persist to DashState').toBe(!beforeChecked);
    });

    test('sync-enabled toggle flips syncMode LS key', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        await page.locator('#notif-toggle').click();
        await page.locator('.settings-tabs button[data-tab="sync"]').click();
        const beforeChecked = await page.evaluate(() =>
            document.getElementById('sync-enabled').checked);
        await page.evaluate(() => {
            const cb = document.getElementById('sync-enabled');
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForTimeout(300);

        const stored = await page.evaluate(() => localStorage.getItem('fs25.dash.v1.syncMode'));
        const expected = beforeChecked ? 'local' : 'server';
        expect(stored, `syncMode should flip from ${beforeChecked} → ${!beforeChecked} (${expected})`).toBe(expected);
    });

    test('storage subgroup collapse — header click toggles items', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const collapsibleRows = page.locator('#storage-body tr.collapsible');
        const count = await collapsibleRows.count();
        if (count === 0) {
            test.info().annotations.push({ type: 'skip', description: 'no collapsible storage rows in scenario' });
            return;
        }

        const header = collapsibleRows.first();
        await header.scrollIntoViewIfNeeded();
        const groupKey = await header.getAttribute('data-group');

        // Item rows for this group; should be visible by default? Actually default is collapsed.
        const itemRowsBefore = await page.locator(`#storage-body tr[data-group="${groupKey}"]:not(.collapsible):not(.hidden-row)`).count();
        await header.click();
        await page.waitForTimeout(300);
        const itemRowsAfter = await page.locator(`#storage-body tr[data-group="${groupKey}"]:not(.collapsible):not(.hidden-row)`).count();

        expect(itemRowsAfter,
            `storage collapse should change visible item count for "${groupKey}" (was ${itemRowsBefore})`).not.toBe(itemRowsBefore);
    });

    test('production subgroup collapse — header click toggles items', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const collapsibleRows = page.locator('#productions-body tr.collapsible');
        const count = await collapsibleRows.count();
        if (count === 0) {
            test.info().annotations.push({ type: 'skip', description: 'no collapsible production rows in scenario' });
            return;
        }

        const header = collapsibleRows.first();
        await header.scrollIntoViewIfNeeded();
        const groupKey = await header.getAttribute('data-group');

        const itemRowsBefore = await page.locator(`#productions-body tr[data-group="${groupKey}"]:not(.collapsible):not(.hidden-row)`).count();
        await header.click();
        await page.waitForTimeout(300);
        const itemRowsAfter = await page.locator(`#productions-body tr[data-group="${groupKey}"]:not(.collapsible):not(.hidden-row)`).count();

        expect(itemRowsAfter,
            `production collapse should change visible item count for "${groupKey}" (was ${itemRowsBefore})`).not.toBe(itemRowsBefore);
    });

    test('sell-point subgroup collapse — header click toggles items', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const collapsibleRows = page.locator('#prices-body tr.sp-row.collapsible');
        const count = await collapsibleRows.count();
        if (count === 0) {
            test.info().annotations.push({ type: 'skip', description: 'no collapsible sell-point rows' });
            return;
        }

        const header = collapsibleRows.first();
        await header.scrollIntoViewIfNeeded();
        const groupKey = await header.getAttribute('data-group');

        const itemRowsBefore = await page.locator(`#prices-body tr[data-group="${groupKey}"]:not(.collapsible):not(.hidden-row)`).count();
        await header.click();
        await page.waitForTimeout(300);
        const itemRowsAfter = await page.locator(`#prices-body tr[data-group="${groupKey}"]:not(.collapsible):not(.hidden-row)`).count();

        expect(itemRowsAfter,
            `sell-point collapse should change visible item count for "${groupKey}" (was ${itemRowsBefore})`).not.toBe(itemRowsBefore);
    });
});

test.describe('Walkthrough — Calendar interactions', () => {
    test.use({ viewport: { width: 1440, height: 1600 } });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('filter-owned select toggles row visibility', async ({ page, request }) => {
        await setMockScenario(request, 'plan-3-years');
        await page.goto('/calendar.html');
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const select = page.locator('#filter-owned');
        const initialValue = await select.inputValue();
        const ownedCount = await page.locator('#gantt-rows-visible tr[data-field-id]').count();

        // Switch to "all fields"
        await select.selectOption('all');
        await page.waitForTimeout(500);
        const allCount = await page.locator('#gantt-rows-visible tr[data-field-id]').count();

        // Switch back
        await select.selectOption(initialValue);
        await page.waitForTimeout(500);
        const ownedCount2 = await page.locator('#gantt-rows-visible tr[data-field-id]').count();

        expect(allCount,
            `"all" view should show >= "owned" view rows (owned=${ownedCount}, all=${allCount})`).toBeGreaterThanOrEqual(ownedCount);
        expect(ownedCount2, 'switching back restores row count').toBe(ownedCount);
    });

    test('plan-field-select dropdown picks a field for editor', async ({ page, request }) => {
        await setMockScenario(request, 'plan-3-years');
        await page.goto('/calendar.html');
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        // The <select> is hidden in the UI (gantt row click is the primary
        // affordance) but the select.change handler still works — set the
        // value via JS and fire change, then assert the editor responded.
        const fid = await page.locator('#gantt-rows-visible tr[data-field-id]').first().getAttribute('data-field-id');
        expect(fid, 'gantt has at least one field row').toBeTruthy();

        await page.evaluate(id => {
            const sel = document.getElementById('plan-field-select');
            sel.value = String(id);
            sel.dispatchEvent(new Event('change'));
        }, fid);
        await page.waitForTimeout(500);

        await expect(page.locator('#plan-editor-body')).toBeVisible({ timeout: 5_000 });
        const placeholderHidden = await page.locator('#plan-editor-empty').isHidden().catch(() => true);
        expect(placeholderHidden, 'placeholder hides after select change').toBe(true);
    });

    test('plan editor — add year extends plan', async ({ page, request }) => {
        await setMockScenario(request, 'plan-3-years');
        await page.goto('/calendar.html');
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        // Pick a field via gantt row click — also triggers selectPlanField()
        await page.locator('#gantt-rows-visible tr[data-field-id]').first().click();
        await page.waitForTimeout(400);

        const addBtn = page.locator('#plan-add-year');
        const exists = await addBtn.count() > 0;
        if (!exists) {
            test.info().annotations.push({ type: 'skip', description: '#plan-add-year not present' });
            return;
        }

        await addBtn.scrollIntoViewIfNeeded();
        // First click persists the virtual "next year" row that was rendered
        // by default. Visible count stays the same (the displayed row just
        // becomes a real one). Second click actually adds a new year.
        await addBtn.click();
        await page.waitForTimeout(400);
        const yearsAfterFirst = await page.locator('#plan-years > *').count();
        await addBtn.click();
        await page.waitForTimeout(400);
        const yearsAfterSecond = await page.locator('#plan-years > *').count();

        expect(yearsAfterSecond,
            `add-year (2nd click) should add one row beyond persisted first (afterFirst=${yearsAfterFirst})`).toBe(yearsAfterFirst + 1);
    });
});

test.describe('Walkthrough — History interactions', () => {
    test.use({ viewport: { width: 1440, height: 1600 } });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('days-btn group — clicking 30 / 90 changes .active', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/history.html');
        await page.waitForTimeout(2000);

        const btn30 = page.locator('.days-btn').filter({ hasText: '30 dní' });
        await btn30.scrollIntoViewIfNeeded();
        await btn30.click();
        await page.waitForTimeout(400);

        await expect(btn30, '30-day button should become active').toHaveClass(/active/);

        const btn90 = page.locator('.days-btn').filter({ hasText: '90 dní' });
        await btn90.click();
        await page.waitForTimeout(400);
        await expect(btn90, '90-day button should become active').toHaveClass(/active/);
        // The previously-active 30 should no longer be active
        await expect(btn30, '30-day button no longer active').not.toHaveClass(/active/);
    });

    test('sel-filltype dropdown changes selection', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/history.html');
        await page.waitForTimeout(2000);

        const sel = page.locator('#sel-filltype');
        const options = await sel.locator('option').all();
        if (options.length < 2) {
            test.info().annotations.push({ type: 'skip', description: 'sel-filltype has only one option' });
            return;
        }
        const targetValue = await options[1].getAttribute('value');
        await sel.selectOption(targetValue);
        await page.waitForTimeout(400);
        const after = await sel.inputValue();
        expect(after, `sel-filltype should accept value "${targetValue}"`).toBe(targetValue);
    });

    test('sel-sellpoint dropdown changes selection', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/history.html');
        await page.waitForTimeout(2000);

        const sel = page.locator('#sel-sellpoint');
        const options = await sel.locator('option').all();
        if (options.length < 2) {
            test.info().annotations.push({ type: 'skip', description: 'sel-sellpoint has only one option' });
            return;
        }
        const targetValue = await options[1].getAttribute('value');
        await sel.selectOption(targetValue);
        await page.waitForTimeout(400);
        const after = await sel.inputValue();
        expect(after).toBe(targetValue);
    });
});

test.describe('Walkthrough — Help anchor navigation', () => {
    test('help.html anchor links scroll to sections', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/help.html');
        await page.waitForTimeout(1000);

        // Pick a known anchor that exists on the page
        const link = page.locator('a[href="#zvonecek"]').first();
        await link.click();
        await page.waitForTimeout(400);

        const target = page.locator('#zvonecek');
        const inView = await target.evaluate(el => {
            const r = el.getBoundingClientRect();
            return r.top >= -10 && r.top <= window.innerHeight;
        });
        expect(inView, '#zvonecek section should scroll into view').toBe(true);
    });
});
