// fields.spec.js — FUNCTIONAL (non-screenshot) assertions over field-state
// scenarios covering tag priority, growth bar thresholds, days-to-harvest,
// condition badge weedState, action chips, optional columns, crop cell,
// farmland cell, bell-ready alert, and empty state.
//
// Each scenario uses POST /mock/scenario to switch the dataset, then navigates
// to the dashboard (or other pages for special cases) and asserts the presence
// or absence of DOM classes, text, and attributes per the state definitions.

const { test, expect } = require('@playwright/test');

// ── helpers (same shape as low-fuel.spec.js) ────────────────────────────────
async function setScenario(request, name) {
    const resp = await request.post('/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario "${name}": ${resp.status()}`);
    // mock-data.js polls every 1 s, chokidar + WS broadcast takes ~500 ms.
    // Allow 3 s for Windows I/O headroom.
    await new Promise(r => setTimeout(r, 3000));
}

async function gotoDashboard(page) {
    await page.goto('/');
    // Payload arrived once balance KPI is not placeholder dash.
    await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
    await page.waitForTimeout(500);
}

async function openBell(page) {
    await page.locator('#bell-btn').click();
    await expect(page.locator('#bell-panel')).not.toHaveAttribute('hidden');
}

function fieldRow(page, fieldId) {
    // Field rows use data-tt-key (from TableTools.dndAttrs), not data-id.
    return page.locator(`#fields-body tr[data-tt-key="${fieldId}"]`);
}

function fieldTag(page, fieldId) {
    return fieldRow(page, fieldId).locator('td:nth-child(5) .tag');
}

function fieldGrowthBar(page, fieldId) {
    return fieldRow(page, fieldId).locator('td.field-growth .bar-fill');
}

function fieldGrowthCell(page, fieldId) {
    return fieldRow(page, fieldId).locator('td.field-growth');
}

function fieldCropCell(page, fieldId) {
    return fieldRow(page, fieldId).locator('td:nth-child(3)');
}

function fieldDaysCell(page, fieldId) {
    return fieldRow(page, fieldId).locator('td:last-child');
}

function fieldAreaCell(page, fieldId) {
    return fieldRow(page, fieldId).locator('td:nth-child(4)');
}

function fieldFarmlandCell(page, fieldId) {
    return fieldRow(page, fieldId).locator('td:nth-child(2)');
}

function fieldChips(page, fieldId) {
    return fieldRow(page, fieldId).locator('.field-needs-inline .need-chip');
}

// Optional columns (Hnoj/Orat/Vápno/Plevel/Kameny) render as the TRAILING
// td.num cells, after the always-num leading cells (#, ZP, Rozloha, Dní).
// extraColCount = how many of the optional columns are enabled; col = 0-based
// index within that trailing block. We address them from the end so the
// leading num columns can never be matched by accident.
function fieldExtraCol(page, fieldId, col, extraColCount) {
    const fromEnd = extraColCount - 1 - col; // 0 = last cell
    return fieldRow(page, fieldId).locator('td.num').nth(-1 - fromEnd);
}

function fieldEmptyBody(page) {
    return page.locator('#fields-body td.empty');
}

// ──────────────────────────────────────────────────────────────────────────────
test.describe('fields surface state — tag priority, growth, chips, columns', () => {

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-TAG-PRIORITY: Izoluje prioritní řetězec stav-tagu.
    // Owned pole s saveGroundType má tag groundType, přebíjí ready/withered/cut.
    // Jedna sada: F1(SOWN přebíjí ready), F2(ready), F3(withered), F4(cut),
    // F5(roste), F6(sít), F7(prázdné).
    test.describe('st-fields-tag-priority', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-tag-priority');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            });
        });

        test('saveGroundType=SOWN tag text = "Zaseto" (priority 1)', async ({ page }) => {
            await gotoDashboard(page);
            const tag = fieldTag(page, 1);
            await expect(tag).toHaveClass(/tag-growing/);
            await expect(tag).toContainText('Zaseto');
        });

        test('isReadyToHarvest=true tag text = "Připraveno"', async ({ page }) => {
            await gotoDashboard(page);
            const tag = fieldTag(page, 2);
            await expect(tag).toHaveClass(/tag-ready/);
            await expect(tag).toContainText('Připraveno');
        });

        test('isWithered=true tag text = "Zvadlé"', async ({ page }) => {
            await gotoDashboard(page);
            const tag = fieldTag(page, 3);
            await expect(tag).toHaveClass(/tag-empty/);
            await expect(tag).toContainText('Zvadlé');
        });

        test('isCut=true tag text = "Strniště"', async ({ page }) => {
            await gotoDashboard(page);
            const tag = fieldTag(page, 4);
            await expect(tag).toHaveClass(/tag-sow/);
            await expect(tag).toContainText('Strniště');
        });

        test('fruitTypeId truthy tag text = "Roste"', async ({ page }) => {
            await gotoDashboard(page);
            const tag = fieldTag(page, 5);
            await expect(tag).toHaveClass(/tag-growing/);
            await expect(tag).toContainText('Roste');
        });

        test('needsSowing=true tag text = "Sít"', async ({ page }) => {
            await gotoDashboard(page);
            const tag = fieldTag(page, 6);
            await expect(tag).toHaveClass(/tag-sow/);
            await expect(tag).toContainText('Sít');
        });

        test('fallback (empty, no needsSowing) tag text = "Prázdné"', async ({ page }) => {
            await gotoDashboard(page);
            const tag = fieldTag(page, 7);
            await expect(tag).toHaveClass(/tag-empty/);
            await expect(tag).toContainText('Prázdné');
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-GROWTH-BAR-THRESHOLDS: Bar prahy 20/50/95 + ready 100% + '—'.
    // 7 rostoucích polí (F1-F6) + ready (F-ready) + empty (F-empty).
    test.describe('st-fields-growth-bar-thresholds', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-growth-bar-thresholds');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            });
        });

        test('bar danger at growthPercent≤20 (boundary-low 20)', async ({ page }) => {
            await gotoDashboard(page);
            const bar = fieldGrowthBar(page, 1);
            await expect(bar).toHaveClass(/danger/);
        });

        test('bar warn at 20%<growthPercent≤50 (boundary-low 21)', async ({ page }) => {
            await gotoDashboard(page);
            const bar = fieldGrowthBar(page, 2);
            await expect(bar).toHaveClass(/warn/);
            await expect(bar).not.toHaveClass(/danger/);
        });

        test('bar warn at 50% boundary (field id=3, growthPercent=50)', async ({ page }) => {
            await gotoDashboard(page);
            const bar = fieldGrowthBar(page, 3);
            await expect(bar).toHaveClass(/warn/);
        });

        test('bar neutral (no class) at 50%<growthPercent<95 (boundary-low 51)', async ({ page }) => {
            await gotoDashboard(page);
            const bar = fieldGrowthBar(page, 4);
            await expect(bar).not.toHaveClass(/danger|warn|full/);
        });

        test('bar neutral at high growth near full (growthPercent=94)', async ({ page }) => {
            await gotoDashboard(page);
            const bar = fieldGrowthBar(page, 5);
            await expect(bar).not.toHaveClass(/danger|warn|full/);
        });

        test('bar full at growthPercent≥95 (boundary-ok 95)', async ({ page }) => {
            await gotoDashboard(page);
            const bar = fieldGrowthBar(page, 6);
            await expect(bar).toHaveClass(/full/);
        });

        test('isReadyToHarvest=true growth cell = "100%" c-green, no bar', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldGrowthCell(page, 7);
            await expect(cell).toContainText('100%');
            await expect(cell.locator('span.c-green')).toBeVisible();
            // Bar should not be rendered.
            await expect(cell.locator('.bar-wrap')).not.toBeVisible();
        });

        test('fruitTypeId empty growth cell = "—"', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldGrowthCell(page, 8);
            await expect(cell).toContainText('—');
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-DAYS-TO-HARVEST: Varianty >0 (žluté), ✓ (ready), '—'.
    // 3 pole: F1(daysToHarvest=1), F2(ready, daysToHarvest=0), F3(daysToHarvest=0, not ready).
    test.describe('st-fields-days-to-harvest', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-days-to-harvest');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            });
        });

        test('daysToHarvest>0 cell text = yellow number (boundary-low 1)', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldDaysCell(page, 1);
            await expect(cell.locator('span.c-yellow')).toBeVisible();
            await expect(cell.locator('span.c-yellow')).toContainText('1');
        });

        test('isReadyToHarvest=true daysToHarvest=0 cell text = "✓" c-green', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldDaysCell(page, 2);
            await expect(cell.locator('span.c-green')).toBeVisible();
            await expect(cell.locator('span.c-green')).toContainText('✓');
        });

        test('daysToHarvest≤0 && !ready cell text = "—"', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldDaysCell(page, 3);
            await expect(cell).toContainText('—');
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-CONDITION-BADGE-WEEDSTATE: Badge za td:nth-child(3), weedState.
    // 4 pole rostoucí pšenice: weedState 2 (žádný), 3 (yellow), 4 (yellow), 5 (red).
    test.describe('st-fields-condition-badge-weedstate', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-condition-badge-weedstate');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            });
        });

        test('weedState<3 badge absent (field id=1, weedState=2)', async ({ page }) => {
            await gotoDashboard(page);
            const cropCell = fieldCropCell(page, 1);
            // Badge should not be present.
            await expect(cropCell.locator('span.c-yellow, span.c-red')).not.toBeVisible();
        });

        test('weedState≥3 && <5 badge = yellow "🌿N" (boundary-low 3)', async ({ page }) => {
            await gotoDashboard(page);
            const badge = fieldCropCell(page, 2).locator('span.c-yellow');
            await expect(badge).toBeVisible();
            await expect(badge).toContainText(/🌿3/);
        });

        test('weedState 4 badge = yellow "🌿4"', async ({ page }) => {
            await gotoDashboard(page);
            const badge = fieldCropCell(page, 3).locator('span.c-yellow');
            await expect(badge).toBeVisible();
            await expect(badge).toContainText(/🌿4/);
        });

        test('weedState≥5 badge = red "🌿N" (boundary-ok 5)', async ({ page }) => {
            await gotoDashboard(page);
            const badge = fieldCropCell(page, 4).locator('span.c-red');
            await expect(badge).toBeVisible();
            await expect(badge).toContainText(/🌿5/);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-ACTION-CHIPS: Chipy v td:nth-child(5) — Orat, Kultivovat, Sít,
    // Vápno, Plevel warn/bad, Kameny warn/bad (6 polí, gameSettings enabled).
    test.describe('st-fields-action-chips', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-action-chips');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
                try { localStorage.removeItem('fs25.dash.v1.hidden:fields'); } catch (_) {}
                try { localStorage.removeItem('fs25.dash.v1.order:fields'); } catch (_) {}
            });
        });

        test('needsPlowing=true chip = "Orat" warn', async ({ page }) => {
            await gotoDashboard(page);
            const chips = fieldChips(page, 1);
            await expect(chips).toContainText('Orat');
            await expect(chips.filter({ hasText: 'Orat' })).toHaveClass(/warn/);
        });

        test('needsLime=true chip = "Vápno" warn', async ({ page }) => {
            await gotoDashboard(page);
            const chips = fieldChips(page, 2);
            await expect(chips).toContainText('Vápno');
            await expect(chips.filter({ hasText: 'Vápno' })).toHaveClass(/warn/);
        });

        test('isWithered=true chips = "Kultivovat" + "Sít" warn', async ({ page }) => {
            await gotoDashboard(page);
            const chips = fieldChips(page, 3);
            // Use filter() instead of toContainText() — multiple chips in the locator
            // would trigger strict-mode violation with toContainText on the set.
            await expect(chips.filter({ hasText: 'Kultivovat' })).toHaveCount(1);
            await expect(chips.filter({ hasText: 'Sít' })).toHaveCount(1);
        });

        test('weedLevel=1 chip = "Plevel 1" warn (boundary-low)', async ({ page }) => {
            await gotoDashboard(page);
            const chips = fieldChips(page, 4);
            await expect(chips.filter({ hasText: /Plevel/ })).toHaveCount(1);
            const pChip = chips.filter({ hasText: 'Plevel 1' });
            await expect(pChip).toHaveClass(/warn/);
            await expect(pChip).not.toHaveClass(/bad/);
        });

        test('weedLevel≥2 && stoneLevel=1 chips = "Plevel 2" bad + "Kameny 1" warn', async ({ page }) => {
            await gotoDashboard(page);
            const chips = fieldChips(page, 5);
            const pChip = chips.filter({ hasText: 'Plevel 2' });
            await expect(pChip).toHaveClass(/bad/);
            const sChip = chips.filter({ hasText: 'Kameny 1' });
            await expect(sChip).toHaveClass(/warn/);
        });

        test('stoneLevel≥2 chip = "Kameny 2" bad (boundary-ok)', async ({ page }) => {
            await gotoDashboard(page);
            const chips = fieldChips(page, 6);
            const sChip = chips.filter({ hasText: 'Kameny 2' });
            await expect(sChip).toHaveClass(/bad/);
        });

        // BLOCKED — no scenario can light the "Válet" chip. It requires
        // f.fruitTypeId && f.rollerLevel === 0 && fruitMeta[id].needsRolling
        // (index.html:1487-1488), but `needsRolling` is set on NO entry in
        // AVAIL_FRUITS (mock-scenarios.js:38) and no field scenario sets
        // rollerLevel. Until a fruit catalog carries needsRolling:true this
        // chip is untriggerable in tests.
        test.fixme('rollerLevel=0 + fruitMeta.needsRolling chip = "Válet" warn', async ({ page }) => {
            await gotoDashboard(page);
            const chips = fieldChips(page, 1);
            await expect(chips.filter({ hasText: 'Válet' })).toHaveClass(/warn/);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-SPRAY-COLUMN: Volitelný sloupec Hnoj (sprayLevel), gated na
    // fieldsColSpray===true. 3 pole: sprayLevel 0 (red), 1 (yellow), 2 (green).
    test.describe('st-fields-spray-column', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-spray-column');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
                // Enable fieldsColSpray (correct DashState key)
                try { localStorage.setItem('fs25.dash.v1.fieldsColSpray', JSON.stringify(true)); } catch (_) {}
                try { localStorage.removeItem('fs25.dash.v1.hidden:fields'); } catch (_) {}
                try { localStorage.removeItem('fs25.dash.v1.order:fields'); } catch (_) {}
            });
        });

        // Only colSpray is enabled → spray is the single trailing extra td.num.
        // Target it directly so the c-yellow days cell can't collide with the
        // c-yellow spray cell (strict-mode ambiguity).
        test('sprayLevel=0 cell = "0/2" c-red (boundary-low)', async ({ page }) => {
            await gotoDashboard(page);
            const sprayCell = fieldExtraCol(page, 1, 0, 1);
            await expect(sprayCell.locator('span.c-red')).toBeVisible();
            await expect(sprayCell).toContainText('0/2');
        });

        test('sprayLevel=1 cell = "1/2" c-yellow', async ({ page }) => {
            await gotoDashboard(page);
            const sprayCell = fieldExtraCol(page, 2, 0, 1);
            await expect(sprayCell.locator('span.c-yellow')).toBeVisible();
            await expect(sprayCell).toContainText('1/2');
        });

        test('sprayLevel=2 cell = "2/2" c-green (boundary-ok)', async ({ page }) => {
            await gotoDashboard(page);
            const sprayCell = fieldExtraCol(page, 3, 0, 1);
            await expect(sprayCell.locator('span.c-green')).toBeVisible();
            await expect(sprayCell).toContainText('2/2');
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-EXTRA-COLUMNS-TOGGLE: Volitelné sloupce Orat/Vápno (✓/—) a
    // Plevel/Kameny (číslo/—), gated na fieldsColPlow/Lime/Weed/Stone===true.
    // 2 pole: F1 (vše needs), F2 (nic nepotřebuje).
    test.describe('st-fields-extra-columns-toggle', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-extra-columns-toggle');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
                // Enable extra columns via correct DashState keys
                try { localStorage.setItem('fs25.dash.v1.fieldsColPlow',  JSON.stringify(true));  } catch (_) {}
                try { localStorage.setItem('fs25.dash.v1.fieldsColLime',  JSON.stringify(true));  } catch (_) {}
                try { localStorage.setItem('fs25.dash.v1.fieldsColWeed',  JSON.stringify(true));  } catch (_) {}
                try { localStorage.setItem('fs25.dash.v1.fieldsColStone', JSON.stringify(true));  } catch (_) {}
                try { localStorage.setItem('fs25.dash.v1.fieldsColSpray', JSON.stringify(false)); } catch (_) {}
                try { localStorage.removeItem('fs25.dash.v1.hidden:fields'); } catch (_) {}
                try { localStorage.removeItem('fs25.dash.v1.order:fields'); } catch (_) {}
            });
        });

        // Enabled extra columns (order from index.html:1609): Plow, Lime, Weed,
        // Stone — Spray is disabled here. So extraColCount=4, col 0..3.
        const EXTRA = 4;

        test('needsPlowing=true colPlow cell = "✓", false = "—"', async ({ page }) => {
            await gotoDashboard(page);
            await expect(fieldExtraCol(page, 1, 0, EXTRA)).toContainText('✓');
            await expect(fieldExtraCol(page, 2, 0, EXTRA)).toContainText('—');
        });

        test('needsLime=true colLime cell = "✓", false = "—"', async ({ page }) => {
            await gotoDashboard(page);
            await expect(fieldExtraCol(page, 1, 1, EXTRA)).toContainText('✓');
            await expect(fieldExtraCol(page, 2, 1, EXTRA)).toContainText('—');
        });

        test('weedLevel>0 colWeed cell = number, =0 = "—"', async ({ page }) => {
            await gotoDashboard(page);
            await expect(fieldExtraCol(page, 1, 2, EXTRA)).toContainText('1');
            await expect(fieldExtraCol(page, 2, 2, EXTRA)).toContainText('—');
        });

        test('stoneLevel>0 colStone cell = number, =0 = "—"', async ({ page }) => {
            await gotoDashboard(page);
            await expect(fieldExtraCol(page, 1, 3, EXTRA)).toContainText('1');
            await expect(fieldExtraCol(page, 2, 3, EXTRA)).toContainText('—');
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-CROP-CELL: Buňka plodiny (td:nth-child(3)) — ikona+jméno vs '—'.
    // 3 pole: F1 (katalogová WHEAT), F2 (mimo katalog SUGARBEET fallback), F3 (prázdné).
    test.describe('st-fields-crop-cell', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-crop-cell');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
                try { localStorage.removeItem('fs25.dash.v1.hidden:fields'); } catch (_) {}
            });
        });

        test('fruitTypeId katalogová plodina = SVG ikona + jméno', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldCropCell(page, 1);
            await expect(cell.locator('.crop-ic')).toBeVisible();
            await expect(cell).toContainText('Pšenice');
        });

        test('fruitTypeId mimo katalog = fallback 🌱 + jméno', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldCropCell(page, 2);
            // Out-of-catalog crop → CropIcons.icon() finds no ICON_MAP entry,
            // renders the tinted 🌱 leaf as span.crop-ic.crop-ic-fallback
            // (crop-icons.js:112) followed by the name.
            const fallback = cell.locator('.crop-ic-fallback');
            await expect(fallback).toBeVisible();
            await expect(fallback).toContainText('🌱');
            await expect(cell).toContainText('Exotická plodina');
        });

        test('fruitTypeId empty cell = "—" c-muted', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldCropCell(page, 3);
            await expect(cell.locator('span.c-muted')).toBeVisible();
            await expect(cell.locator('span.c-muted')).toContainText('—');
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-FARMLAND-CELL: Buňka ZP (td:nth-child(2)) a title rozlohy
    // (td:nth-child(4)). 3 pole: F1 (known farmland + title), F2 (known, same area),
    // F3 (unknown farmland).
    test.describe('st-fields-farmland-cell', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-farmland-cell');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
                try { localStorage.removeItem('fs25.dash.v1.hidden:fields'); } catch (_) {}
            });
        });

        test('farmlandId known cell = farmland ID number', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldFarmlandCell(page, 1);
            await expect(cell.locator('span')).toBeVisible();
            await expect(cell).toContainText('12');
        });

        test('farmlandId known cell title = "Zemědělská půda <id>"', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldFarmlandCell(page, 1);
            const span = cell.locator('span');
            const title = await span.getAttribute('title');
            expect(title).toContain('Zemědělská půda 12');
        });

        test('farmlandAreaHa !== area → areaCell has title with difference', async ({ page }) => {
            await gotoDashboard(page);
            const areaCell = fieldAreaCell(page, 1);
            const title = await areaCell.getAttribute('title');
            // Actual title (index.html:1620): "Pole: 3.2 ha · Parcela (Zemědělská půda): 4 ha"
            // (toFixed(1) strips the trailing zero only when the integer part has no decimal)
            expect(title).toContain('Pole: 3.2 ha');
            expect(title).toMatch(/Parcela \(Zemědělská půda\): 4(\.0)? ha/);
        });

        test('farmlandAreaHa === area → no title (boundary-ok)', async ({ page }) => {
            await gotoDashboard(page);
            const areaCell = fieldAreaCell(page, 2);
            const title = await areaCell.getAttribute('title');
            expect(title).toBeNull();
        });

        test('farmlandId null cell = "—" c-muted with title "Mod nezná"', async ({ page }) => {
            await gotoDashboard(page);
            const cell = fieldFarmlandCell(page, 3);
            await expect(cell.locator('span.c-muted')).toBeVisible();
            await expect(cell).toContainText('—');
            const title = await cell.locator('span').getAttribute('title');
            expect(title).toContain('Mod nezná farmland');
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-BELL-READY-BOUNDARY: Zvonek "pole připravené ke sklizni".
    // Condition: fields.filter(f => f.owned && f.isReadyToHarvest).length > 0
    // 3 pole: F-ready (owned+ready), F-owned-notready, F-notowned-ready.
    // Očekáváno: 1 bell-item s počtem a detailem, bez ostatních alertů.
    test.describe('st-fields-bell-ready-boundary', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-bell-ready-boundary');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            });
        });

        test('bell item "pole připravené" visible when owned+isReadyToHarvest>0', async ({ page }) => {
            await gotoDashboard(page);
            await openBell(page);
            const bellItem = page.locator('.bell-item.bell-info[data-target="sec-fields"]');
            await expect(bellItem).toBeVisible();
            await expect(bellItem.locator('.bell-item-title')).toContainText(/pole.*připravené|připraveno/i);
        });

        test('bell count badge = 1 (only F-ready)', async ({ page }) => {
            await gotoDashboard(page);
            const badge = page.locator('#bell-count');
            await expect(badge).toBeVisible();
            await expect(badge).toContainText('1');
        });

        test('bell item detail contains F-ready field name', async ({ page }) => {
            await gotoDashboard(page);
            await openBell(page);
            const detail = page.locator('.bell-item.bell-info[data-target="sec-fields"] .bell-item-detail');
            await expect(detail).toContainText('Pšenice');
        });

        test('F-notowned-ready (owned=false) does NOT trigger bell', async ({ page }) => {
            await gotoDashboard(page);
            await openBell(page);
            // The detail should NOT mention Řepka (F-notowned-ready).
            const detail = page.locator('.bell-item.bell-info[data-target="sec-fields"] .bell-item-detail');
            await expect(detail).not.toContainText('Řepka');
        });

        test('no other alerts (only field-ready bell item)', async ({ page }) => {
            await gotoDashboard(page);
            await openBell(page);
            // Bell list has exactly 1 item.
            const items = page.locator('#bell-list .bell-item');
            await expect(items).toHaveCount(1);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ST-FIELDS-EMPTY-STATE: Prázdný stav tabulky — "Žádná vlastněná pole" nebo
    // "Všechna pole jsou skrytá" (pokud existují ale filtry je skryly).
    // Varianta A: fields:[] → text "Žádná vlastněná pole."
    // Varianta B: 1 empty pole + DashState fieldsHideEmpty=true → hidden.
    test.describe('st-fields-empty-state', () => {
        test.beforeEach(async ({ page, request }) => {
            await setScenario(request, 'st-fields-empty-state');
            await page.addInitScript(() => {
                try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            });
        });

        test('fields=[] empty body = "Žádná vlastněná pole"', async ({ page }) => {
            await gotoDashboard(page);
            const empty = fieldEmptyBody(page);
            await expect(empty).toBeVisible();
            await expect(empty).toContainText('Žádná vlastněná pole');
        });

        // "Všechna pole jsou skrytá" (index.html:1630) renders when
        // displayed.length > 0 but visible.length === 0 — i.e. every owned field
        // was hidden via the drag-to-hide zone. Use a scenario WITH owned fields
        // (harvest-ready: ids 1..5) and pre-seed the TableTools hidden set
        // (fs25.dash.v1.hidden:fields, item key = field id) with all five.
        test('all owned fields hidden via DnD → "Všechna pole jsou skrytá"', async ({ page, request }) => {
            await setScenario(request, 'harvest-ready');
            await page.addInitScript(() => {
                try {
                    localStorage.setItem('fs25.dash.v1.hidden:fields',
                        JSON.stringify([1, 2, 3, 4, 5]));
                } catch (_) {}
            });
            await gotoDashboard(page);
            await expect(fieldEmptyBody(page)).toContainText('Všechna pole jsou skrytá');
        });
    });

});
