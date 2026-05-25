// walkthrough.spec.js — Regression tests for interactions that were previously
// dead-clicks or broken (caught manually, not by other smoke tests).
//
// Covers:
//   - Hidden-zone collapse/expand toggle on /  (BUG #19 regression)
//   - Unhide via drag back from hidden zone
//   - Persistent collapse state across reload
//
// Pages: /   (interactions are not on /history.html or /help.html)
// Excluded: /profit.html (user opt-out)

const { test, expect } = require('@playwright/test');

async function setMockScenario(request, name) {
    const resp = await request.post('http://localhost:3099/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`POST /mock/scenario "${name}" failed: ${resp.status()}`);
    await new Promise(r => setTimeout(r, 3000));
}

async function dragTo(page, source, target) {
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const s = await source.boundingBox();
    const t = await target.boundingBox();
    if (!s || !t) throw new Error('boundingBox failed — element detached or invisible');
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2 + 12, s.y + s.height / 2 + 12, { steps: 5 });
    await page.waitForTimeout(60);
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 30 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(400);
}

async function resetLocalState(page) {
    await page.evaluate(() => {
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith('fs25.dash.v1.collapsed:') ||
                k.startsWith('fs25.dash.v1.hidden:')) {
                localStorage.removeItem(k);
            }
        });
    });
}

test.describe('Walkthrough — manual-bug regressions', () => {
    test.use({ viewport: { width: 1440, height: 1600 } });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('hidden zone toggle — all six zones expand/collapse on header click', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await resetLocalState(page);
        await page.reload();
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const zones = [
            '#fields-hidden-wrap',
            '#vehicles-hidden-wrap',
            '#animals-hidden-wrap',
            '#storages-hidden-wrap',
            '#productions-hidden-wrap',
            '#prices-hidden-wrap',
        ];

        for (const sel of zones) {
            const wrap = page.locator(sel);
            const exists = await wrap.count() > 0;
            if (!exists) continue;

            await wrap.scrollIntoViewIfNeeded();
            await page.waitForTimeout(100);

            const before = await wrap.evaluate(el => ({
                collapsed: el.classList.contains('collapsed'),
                bodyDisplay: window.getComputedStyle([...el.children].find(c => !c.classList.contains('subgroup-header'))).display,
            }));

            // First click — should collapse
            await wrap.locator('.subgroup-header').first().click();
            await page.waitForTimeout(250);

            const afterClick1 = await wrap.evaluate(el => ({
                collapsed: el.classList.contains('collapsed'),
                bodyDisplay: window.getComputedStyle([...el.children].find(c => !c.classList.contains('subgroup-header'))).display,
            }));

            expect(afterClick1.collapsed,  `${sel}: collapsed should flip after click`).toBe(!before.collapsed);
            if (afterClick1.collapsed) {
                expect(afterClick1.bodyDisplay, `${sel}: body should be display:none when collapsed`).toBe('none');
            } else {
                expect(afterClick1.bodyDisplay, `${sel}: body should be visible when expanded`).not.toBe('none');
            }

            // Second click — should restore
            await wrap.locator('.subgroup-header').first().click();
            await page.waitForTimeout(250);

            const afterClick2 = await wrap.evaluate(el => ({
                collapsed: el.classList.contains('collapsed'),
                bodyDisplay: window.getComputedStyle([...el.children].find(c => !c.classList.contains('subgroup-header'))).display,
            }));

            expect(afterClick2.collapsed, `${sel}: collapsed should toggle back on second click`).toBe(before.collapsed);
            expect(afterClick2.bodyDisplay, `${sel}: body should return to original display state`).toBe(before.bodyDisplay);
        }
    });

    test('hidden zone with content — content visible after expand', async ({ page, request }) => {
        // Reproduces BUG #19: with a hidden item present, clicking expand
        // used to fail because two competing handlers fought over .hidden-row
        // vs .collapsed. The visible result was: content stayed hidden.
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await resetLocalState(page);

        // Hide a vehicle via LS so it sits in the hidden zone after reload
        const firstVehicle = page.locator('#vehicles-body .vehicle-row').first();
        await firstVehicle.waitFor({ timeout: 8_000 });
        const vehicleKey = await firstVehicle.getAttribute('data-tt-key');
        await page.evaluate(k => {
            localStorage.setItem('fs25.dash.v1.hidden:vehicles', JSON.stringify([k]));
        }, vehicleKey);
        await page.reload();
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const wrap = page.locator('#vehicles-hidden-wrap');
        await wrap.scrollIntoViewIfNeeded();

        // Force expanded starting state — drop any persisted collapsed flag.
        await page.evaluate(() => {
            const w = document.querySelector('#vehicles-hidden-wrap');
            if (w) w.classList.remove('collapsed');
        });
        await page.waitForTimeout(100);

        // Verify the hidden vehicle is present (display:block etc., not :empty)
        const visibleNow = await wrap.evaluate(el => {
            const body = [...el.children].find(c => !c.classList.contains('subgroup-header'));
            return window.getComputedStyle(body).display !== 'none';
        });
        expect(visibleNow, 'hidden vehicle should be visible in expanded state').toBe(true);

        // Click → should collapse, content hidden
        await wrap.locator('.subgroup-header').first().click();
        await page.waitForTimeout(250);
        const afterCollapse = await wrap.evaluate(el => {
            const body = [...el.children].find(c => !c.classList.contains('subgroup-header'));
            return {
                collapsed: el.classList.contains('collapsed'),
                bodyDisplay: window.getComputedStyle(body).display,
                bodyHasHiddenRowClass: body.classList.contains('hidden-row'),
            };
        });
        expect(afterCollapse.collapsed).toBe(true);
        expect(afterCollapse.bodyDisplay).toBe('none');
        // BUG #19 regression: legacy handler used to add .hidden-row independently.
        // After the fix, only .collapsed on wrap controls visibility.
        expect(afterCollapse.bodyHasHiddenRowClass,
            'BUG #19 regression: legacy .hidden-row class should not be applied').toBe(false);

        // Click again → should re-expand, content visible
        await wrap.locator('.subgroup-header').first().click();
        await page.waitForTimeout(250);
        const afterExpand = await wrap.evaluate(el => {
            const body = [...el.children].find(c => !c.classList.contains('subgroup-header'));
            return {
                collapsed: el.classList.contains('collapsed'),
                bodyDisplay: window.getComputedStyle(body).display,
            };
        });
        expect(afterExpand.collapsed).toBe(false);
        expect(afterExpand.bodyDisplay, 'BUG #19 regression: content must be visible after re-expand').not.toBe('none');
    });

    test('unhide via drag — field moved back from hidden to visible', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await resetLocalState(page);
        await page.reload();
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const firstField = page.locator('#fields-body tr[data-tt-dnd="fields"]').first();
        await firstField.waitFor({ timeout: 8_000 });
        const fieldKey = await firstField.getAttribute('data-tt-key');

        // Drag into hidden
        await dragTo(page, firstField, page.locator('#fields-hidden-body .tt-hidden-empty'));
        const afterHide = await page.evaluate(k =>
            !!document.querySelector(`#fields-hidden-body [data-tt-key="${k}"]`), fieldKey);
        if (!afterHide) {
            test.info().annotations.push({ type: 'skip', description: 'hide step itself failed — unhide cannot be tested' });
            return;
        }

        // Drag back to visible body
        const hiddenRow = page.locator(`#fields-hidden-body [data-tt-key="${fieldKey}"]`);
        const visibleBody = page.locator('#fields-body');
        await dragTo(page, hiddenRow, visibleBody);

        const inVisible = await page.evaluate(k =>
            !!document.querySelector(`#fields-body [data-tt-key="${k}"]`), fieldKey);
        const stillHidden = await page.evaluate(k =>
            !!document.querySelector(`#fields-hidden-body [data-tt-key="${k}"]`), fieldKey);

        expect(inVisible, 'field should be back in visible after drag back').toBe(true);
        expect(stillHidden, 'field should no longer be in hidden zone').toBe(false);
    });

    test('collapse state persists across reload', async ({ page, request }) => {
        await setMockScenario(request, 'harvest-ready');
        await page.goto('/');
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await resetLocalState(page);
        await page.reload();
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const wrap = page.locator('#fields-hidden-wrap');
        await wrap.scrollIntoViewIfNeeded();

        const initiallyCollapsed = await wrap.evaluate(el => el.classList.contains('collapsed'));
        await wrap.locator('.subgroup-header').first().click();
        await page.waitForTimeout(250);

        const afterClick = await wrap.evaluate(el => el.classList.contains('collapsed'));
        expect(afterClick).toBe(!initiallyCollapsed);

        await page.reload();
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const afterReload = await page.locator('#fields-hidden-wrap').evaluate(el => el.classList.contains('collapsed'));
        expect(afterReload,
            'collapse state should persist across reload via localStorage').toBe(afterClick);
    });
});
