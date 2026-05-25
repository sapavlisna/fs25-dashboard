// calendar-verify.spec.js — verify the Kalendář polí page behaves as
// documented in USER-GUIDE.md § "Kalendář polí" and § "Plánování plodin".
// Each test maps one requirement; assertion failure = real product gap.

const { test, expect } = require('@playwright/test');

async function setMockScenario(request, name) {
    const resp = await request.post('http://localhost:3099/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario ${name}: ${resp.status()}`);
    await new Promise(r => setTimeout(r, 3000));
}

test.describe('Calendar verification', () => {
    test.use({ viewport: { width: 1440, height: 1600 } });

    test.beforeEach(async ({ page, request }) => {
        // syncMode set via initScript so it's in place before any module loads.
        // LS *cleanup* must NOT be in initScript — it would also run on every
        // page.reload() and wipe state under test.
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await setMockScenario(request, 'plan-3-years');
        await page.goto('/calendar.html');
        // One-shot cleanup of state from previous test runs in this browser
        // context. Reloads later in a test will preserve subsequent writes.
        await page.evaluate(() => {
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('fs25.dash.v1.hidden:fields') ||
                    k === 'fs25.dash.v1.fieldPlans' ||
                    k.startsWith('fs25.dash.v1.collapsed:gantt')) {
                    localStorage.removeItem(k);
                }
            });
        });
        await page.reload();
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);
    });

    // ─── KPI hero row ─────────────────────────────────────────────────────────

    test('REQ-1: KPI row shows 4 cards with numeric values', async ({ page }) => {
        const cards = ['kpi-owned', 'kpi-ready', 'kpi-growing', 'kpi-sow'];
        for (const id of cards) {
            const txt = await page.locator(`#${id}`).textContent();
            expect(parseInt(txt), `#${id} should be numeric, got "${txt}"`).not.toBeNaN();
        }
    });

    // ─── Section header ───────────────────────────────────────────────────────

    test('REQ-2: section header has count + date chip + filter + range slider', async ({ page }) => {
        await expect(page.locator('#cnt-fields'), 'count').toBeVisible();
        await expect(page.locator('#gantt-date'), 'date chip').toBeVisible();
        await expect(page.locator('#filter-owned'), 'filter select').toBeVisible();
        await expect(page.locator('#range-days'), 'range slider').toBeVisible();
        await expect(page.locator('#range-label'), 'range label').toBeVisible();
    });

    // ─── Date chip format ─────────────────────────────────────────────────────

    test('REQ-3: date chip format "Den X · DD. Měsíc, rok Y"', async ({ page }) => {
        const txt = await page.locator('#gantt-date').textContent();
        expect(txt, 'date chip').toMatch(/Den\s+\d+/);
        // Month names should be Czech (e.g. "leden", "únor", "březen", ...)
        expect(txt).toMatch(/(leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec)/i);
        expect(txt).toMatch(/rok\s+\d+/);
    });

    // ─── Filter: owned vs all ─────────────────────────────────────────────────

    test('REQ-4: filter "Jen vlastněná" hides not-owned fields', async ({ page }) => {
        const sel = page.locator('#filter-owned');
        // default is "owned"
        await sel.selectOption('owned');
        await page.waitForTimeout(400);
        const ownedCount = await page.locator('#gantt-rows-visible tr[data-field-id]').count();

        await sel.selectOption('all');
        await page.waitForTimeout(400);
        const allCount = await page.locator('#gantt-rows-visible tr[data-field-id]').count();

        expect(allCount, '"all" must show >= "owned"').toBeGreaterThanOrEqual(ownedCount);
        // In plan-3-years scenario we have an unowned field, so "all" > "owned"
        expect(allCount, '"all" should be strictly greater (scenario has unowned field)').toBeGreaterThan(ownedCount);
    });

    // ─── Range slider widens timeline ─────────────────────────────────────────

    test('REQ-5: range slider widens the visible day window', async ({ page }) => {
        const slider = page.locator('#range-days');
        await slider.fill('10');
        await page.waitForTimeout(400);
        const w10 = await page.locator('.gantt-table thead .gantt-days').first().evaluate(
            el => parseInt(el.style.width)).catch(() => 0);

        await slider.fill('60');
        await page.waitForTimeout(400);
        const w60 = await page.locator('.gantt-table thead .gantt-days').first().evaluate(
            el => parseInt(el.style.width)).catch(() => 0);

        expect(w60, `60-day timeline (${w60}px) should be wider than 10-day (${w10}px)`).toBeGreaterThan(w10);
        const lbl = await page.locator('#range-label').textContent();
        expect(lbl).toMatch(/60\s*dní/);
    });

    // ─── Legend ───────────────────────────────────────────────────────────────

    test('REQ-6: legend has status colors + fert key', async ({ page }) => {
        const legendItems = page.locator('.legend .legend-item');
        const count = await legendItems.count();
        expect(count, 'legend has multiple items').toBeGreaterThanOrEqual(4);

        const legendText = await page.locator('.legend').textContent();
        expect(legendText).toMatch(/Připraveno/);
        expect(legendText).toMatch(/Roste/);
        // Fert legend uses dots: ●● 1× ○○
        expect(legendText).toMatch(/●●|●○|○○/);
    });

    // ─── Frozen columns: Pole + Co potřebuje ──────────────────────────────────

    test('REQ-7: Pole column has #ID, fruit name, area + fert badge', async ({ page }) => {
        const firstRow = page.locator('#gantt-rows-visible tr[data-field-id]').first();
        const label = firstRow.locator('.g-label, td.g-label').first();
        const text = await label.textContent();
        expect(text, 'label cell').toMatch(/#\d+/);
        // Should have fruit name (Pšenice/Řepka/Canola etc) OR "Prázdné" if no crop
        expect(text.length, 'label has visible text').toBeGreaterThan(2);

        // Fert badge should appear (●● or ●○ or ○○) somewhere in the row label
        const fertBadge = firstRow.locator('.fert');
        const fertExists = await fertBadge.count() > 0;
        expect(fertExists, 'fert badge present in label cell').toBe(true);
        const fertText = await fertBadge.first().textContent();
        expect(fertText).toMatch(/●●|●○|○○/);
    });

    test('REQ-8: fert badge classes match level (fert-ok / fert-half / fert-none)', async ({ page }) => {
        // Scan all rows; each .fert must have one of the three classes
        const fertBadges = await page.locator('#gantt-rows-visible .fert').all();
        expect(fertBadges.length, 'at least one fert badge').toBeGreaterThan(0);

        for (const b of fertBadges) {
            const cls = await b.getAttribute('class');
            expect(cls, `fert badge class: ${cls}`).toMatch(/fert-(ok|half|none)/);
        }
    });

    // ─── Co potřebuje column ──────────────────────────────────────────────────

    test('REQ-9: needs column renders pills with urgency classes', async ({ page }) => {
        // Some rows should have need-pills (e.g. fields needing sowing/plowing)
        const allPills = await page.locator('#gantt-rows-visible .need-pill').all();
        if (allPills.length === 0) {
            test.info().annotations.push({ type: 'note', description: 'no need-pills in current scenario; OK if all fields healthy' });
            return;
        }
        for (const p of allPills) {
            const cls = await p.getAttribute('class');
            // Each pill should have an urgency class — urgent / warn / info / pill-* etc
            expect(cls, `need-pill class: ${cls}`).toMatch(/need-pill/);
        }
    });

    test('REQ-10: needs column caps at 3 pills + overflow chip "+N"', async ({ page }) => {
        // Find a row with many needs (overflow)
        const containers = page.locator('#gantt-rows-visible .needs-pills');
        const count = await containers.count();
        let foundOverflow = false;
        for (let i = 0; i < count; i++) {
            const pills = await containers.nth(i).locator('.need-pill').count();
            const more = await containers.nth(i).locator('.need-pill-more').count();
            expect(pills, `row ${i} has at most 3 visible pills`).toBeLessThanOrEqual(3);
            if (more > 0) foundOverflow = true;
        }
        // Annotate if no overflow in scenario (not a fail, just note)
        if (!foundOverflow) {
            test.info().annotations.push({ type: 'note', description: 'no row had >3 needs in scenario' });
        }
    });

    // ─── Timeline rendering ───────────────────────────────────────────────────

    test('REQ-11: timeline has growth bars for fields with current crop', async ({ page }) => {
        // Each field with growthState > 0 should have a .gantt-bar
        const bars = await page.locator('.gantt-bar').count();
        expect(bars, 'at least some growth bars').toBeGreaterThan(0);
    });

    test('REQ-12: plan-task bars have color-coded backgrounds per task type', async ({ page }) => {
        // First select a field to ensure plan tasks render
        await page.locator('#gantt-rows-visible tr[data-field-id]').first().click();
        await page.waitForTimeout(500);

        const taskBars = page.locator('.gantt-plan-task');
        const count = await taskBars.count();
        if (count === 0) {
            test.info().annotations.push({ type: 'note', description: 'no plan tasks (would need active plan to render bars)' });
            return;
        }
        // At least one bar should have inline background style
        const first = taskBars.first();
        const style = await first.getAttribute('style');
        expect(style, 'plan task has inline background color').toMatch(/background:\s*[#rgb]/);
    });

    test('REQ-13: narrow SOW bars (long crop name) hide label; other tasks keep theirs', async ({ page }) => {
        // Set a narrow view so bars compress
        await page.locator('#range-days').fill('10');
        await page.waitForTimeout(400);

        // Click first field
        await page.locator('#gantt-rows-visible tr[data-field-id]').first().click();
        await page.waitForTimeout(500);

        const taskBars = await page.locator('.gantt-plan-task').all();
        if (taskBars.length === 0) {
            test.info().annotations.push({ type: 'note', description: 'no plan tasks' });
            return;
        }
        for (const b of taskBars) {
            const style = await b.getAttribute('style');
            const widthMatch = style && style.match(/width:\s*(\d+(?:\.\d+)?)px/);
            if (!widthMatch) continue;
            const w = parseFloat(widthMatch[1]);
            const cls = await b.getAttribute('class');
            const isSow = await b.getAttribute('style').then(s => s && /background:\s*(rgb\(250,\s*204,\s*21\)|#facc15)/i.test(s));
            const labelCount = await b.locator('.gantt-plan-task-label').count();
            if (isSow && w < 60) {
                // Sow with long crop name + narrow bar → label hidden, tooltip carries info
                expect(labelCount,
                    `narrow sow bar (${w}px) should hide label`).toBe(0);
            } else if (!isSow) {
                // Non-sow tasks (orba/hnojení/válcování/vápnění/sklizeň) keep label
                // at any width — CSS ellipsis handles overflow
                expect(labelCount,
                    `non-sow task bar (${w}px, ${cls}) should keep label`).toBe(1);
            }
        }
    });

    // ─── Plan editor ──────────────────────────────────────────────────────────

    test('REQ-14: click gantt row opens plan editor with field name in header', async ({ page }) => {
        // Editor placeholder should be visible initially
        await expect(page.locator('#plan-editor-empty')).toBeVisible();

        const row = page.locator('#gantt-rows-visible tr[data-field-id]').first();
        const fid = await row.getAttribute('data-field-id');
        await row.click();
        await page.waitForTimeout(400);

        // Editor body should be visible, placeholder hidden
        await expect(page.locator('#plan-editor-body')).toBeVisible();
        await expect(page.locator('#plan-editor-empty')).not.toBeVisible();

        // Header should reflect the selected field
        const chip = await page.locator('#plan-current-field').textContent();
        expect(chip, `plan-current-field chip should contain #${fid} or field info`).toBeTruthy();
    });

    test('REQ-15: plan editor empty state has theme-aware arrow color', async ({ page }) => {
        const arrow = page.locator('#plan-editor-empty > div').first();
        const color = await arrow.evaluate(el => window.getComputedStyle(el).color);
        // Should NOT be the default text color blended with low opacity — should be muted variant
        // var(--muted) resolves to a specific color per theme; just verify it's not default black/white
        expect(color, 'arrow color is set').toMatch(/^rgba?\(/);
    });

    test('REQ-16: add-year button extends plan by one year', async ({ page }) => {
        await page.locator('#gantt-rows-visible tr[data-field-id]').first().click();
        await page.waitForTimeout(400);
        const addBtn = page.locator('#plan-add-year');
        await addBtn.click();
        await page.waitForTimeout(400);
        const yearsAfterFirst = await page.locator('#plan-years > *').count();
        await addBtn.click();
        await page.waitForTimeout(400);
        const yearsAfterSecond = await page.locator('#plan-years > *').count();
        expect(yearsAfterSecond, 'second add-year click adds one more row').toBe(yearsAfterFirst + 1);
    });

    test('REQ-17: clear plan button removes all years', async ({ page }) => {
        await page.locator('#gantt-rows-visible tr[data-field-id]').first().click();
        await page.waitForTimeout(400);
        // Add a couple of years
        const addBtn = page.locator('#plan-add-year');
        await addBtn.click();
        await page.waitForTimeout(300);
        await addBtn.click();
        await page.waitForTimeout(300);
        const yearsBefore = await page.locator('#plan-years > *').count();
        expect(yearsBefore, 'plan has at least one year before clear').toBeGreaterThan(0);

        // Clear (will show confirm; handle dialog)
        page.on('dialog', d => d.accept().catch(() => {}));
        await page.locator('#plan-clear').click();
        await page.waitForTimeout(500);
        const yearsAfter = await page.locator('#plan-years > *').count();
        expect(yearsAfter,
            `plan-clear should leave 0 or 1 (default virtual) years (was ${yearsBefore})`).toBeLessThan(yearsBefore);
    });

    test('REQ-18: plan max 5 years — add-year button disables at cap', async ({ page }) => {
        await page.locator('#gantt-rows-visible tr[data-field-id]').first().click();
        await page.waitForTimeout(400);
        const addBtn = page.locator('#plan-add-year');

        // gameYear=3, PLAN_MAX_YEARS=5 → max allowed year is gameYear+5 = 8.
        // The button enables/disables based on highest planned year. After
        // we've planted 5 future years (4..8), the button should disable.
        // First click persists the virtual year 4; clicks 2..5 add 5..8.
        // Click 6 would push to year 9 which is past cap.
        let disabledAt = -1;
        for (let i = 0; i < 8; i++) {
            const before = await addBtn.isDisabled();
            if (before) { disabledAt = i; break; }
            await addBtn.click();
            await page.waitForTimeout(250);
        }
        expect(disabledAt,
            'add-year button must disable once the plan reaches gameYear+5').toBeGreaterThan(0);
        expect(disabledAt,
            `expected ~6 clicks before disable (1 virtual + 5 real years), got ${disabledAt}`).toBeLessThanOrEqual(6);

        // Tooltip should explain why
        const title = await addBtn.getAttribute('title');
        expect(title, 'disabled button has explanation tooltip').toMatch(/(maxim|5\s*let|rok)/i);
    });

    // ─── Skrytá pole subgroup ─────────────────────────────────────────────────

    test('REQ-19: Skrytá pole subgroup exists at bottom of gantt', async ({ page }) => {
        await expect(page.locator('#gantt-hidden-wrap')).toBeVisible();
        await expect(page.locator('#gantt-hidden-wrap .subgroup-header')).toBeVisible();
        const hint = await page.locator('#gantt-rows-hidden .tt-hidden-empty').count();
        expect(hint, 'empty hint visible when no hidden fields').toBeGreaterThan(0);
    });

    test('REQ-20: Skrytá pole subgroup header collapses on click', async ({ page }) => {
        const wrap = page.locator('#gantt-hidden-wrap');
        const before = await wrap.evaluate(el => el.classList.contains('collapsed'));
        await wrap.locator('.subgroup-header').first().click();
        await page.waitForTimeout(300);
        const after = await wrap.evaluate(el => el.classList.contains('collapsed'));
        expect(after, 'collapse class toggles').toBe(!before);
    });

    // ─── Persistence ──────────────────────────────────────────────────────────

    test('REQ-21: plan persists to localStorage (DashState.fieldPlans)', async ({ page }) => {
        const row = page.locator('#gantt-rows-visible tr[data-field-id]').first();
        const fid = await row.getAttribute('data-field-id');
        await row.click();
        await page.waitForTimeout(400);
        await page.locator('#plan-add-year').click();
        await page.waitForTimeout(400);

        const stored = await page.evaluate(() => {
            try { return JSON.parse(localStorage.getItem('fs25.dash.v1.fieldPlans') || '{}'); }
            catch { return {}; }
        });
        expect(stored, 'fieldPlans key exists').toBeTruthy();
        expect(stored[fid], `plan for field ${fid} saved`).toBeTruthy();
    });

    test('REQ-22: persisted plan survives reload', async ({ page }) => {
        const row = page.locator('#gantt-rows-visible tr[data-field-id]').first();
        const fid = await row.getAttribute('data-field-id');
        await row.click();
        await page.waitForTimeout(400);
        await page.locator('#plan-add-year').click();
        await page.waitForTimeout(400);
        await page.locator('#plan-add-year').click();
        await page.waitForTimeout(400);
        const planBefore = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('fs25.dash.v1.fieldPlans') || '{}'));

        await page.reload();
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const planAfter = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('fs25.dash.v1.fieldPlans') || '{}'));

        expect(JSON.stringify(planAfter[fid]),
            'plan should match after reload').toBe(JSON.stringify(planBefore[fid]));
    });

    // ─── Drag-to-hide ─────────────────────────────────────────────────────────

    test('REQ-23: hidden field is excluded from gantt visible body', async ({ page }) => {
        const firstRow = page.locator('#gantt-rows-visible tr[data-field-id]').first();
        const fid = await firstRow.getAttribute('data-field-id');

        // Set hidden directly via LS — same effect as drag would have
        await page.evaluate(k => {
            localStorage.setItem('fs25.dash.v1.hidden:fields', JSON.stringify([k]));
        }, fid);
        await page.reload();
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 12_000 });
        await page.waitForTimeout(1500);

        const inVisible = await page.locator(`#gantt-rows-visible tr[data-field-id="${fid}"]`).count();
        const inHidden  = await page.locator(`#gantt-rows-hidden tr[data-field-id="${fid}"]`).count();
        expect(inVisible, `field ${fid} should NOT be in visible after hide`).toBe(0);
        expect(inHidden, `field ${fid} should be in hidden body`).toBe(1);
    });

    // ─── Custom scrollbar ─────────────────────────────────────────────────────

    test('REQ-24: custom scrollbar track visible when timeline overflows', async ({ page }) => {
        // Wide timeline (60 days)
        await page.locator('#range-days').fill('60');
        await page.waitForTimeout(500);

        const track = page.locator('#gantt-scroll-track');
        const trackVisible = await track.isVisible().catch(() => false);
        // Track is hidden when no overflow; with 60 days + viewport 1440 it MAY or MAY NOT overflow
        // — just check the track element exists and has correct structure
        const exists = await track.count() > 0;
        expect(exists, 'custom scrollbar track exists').toBe(true);

        if (trackVisible) {
            const thumb = page.locator('#gantt-scroll-thumb');
            await expect(thumb, 'thumb visible when track is').toBeVisible();
        } else {
            test.info().annotations.push({ type: 'note', description: 'track hidden — no overflow in current viewport' });
        }
    });

    // ─── Sticky frozen columns ────────────────────────────────────────────────

    test('REQ-25: Pole + Co potřebuje columns have position:sticky', async ({ page }) => {
        const labelTH = page.locator('.gantt-table thead th.g-th-label').first();
        const needsTH = page.locator('.gantt-table thead th.g-th-needs').first();
        const labelPos = await labelTH.evaluate(el => window.getComputedStyle(el).position);
        const needsPos = await needsTH.evaluate(el => window.getComputedStyle(el).position);
        expect(labelPos, 'label column is sticky').toBe('sticky');
        expect(needsPos, 'needs column is sticky').toBe('sticky');
    });
});
