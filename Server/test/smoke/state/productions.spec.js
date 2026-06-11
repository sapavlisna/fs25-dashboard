// productions.spec.js — FUNCTIONAL (non-screenshot) assertions over the
// `productions` surface states. Documents status tags, fill bars, flash effects,
// cycles/cost badges, and filters (activeOnly, showInputs, showCycles, drag-drop,
// collapse) so restyle/behaviour changes preserve the contract.
//
// Test data sources: mock scenarios in scripts/mock-scenarios.js

const { test, expect } = require('@playwright/test');

// ── helpers ──────────────────────────────────────────────────────────────────
async function setScenario(request, name) {
    const resp = await request.post('/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario "${name}": ${resp.status()}`);
    // mock-data.js polls scenario file every 1 s and writes immediately on
    // change; allow for that + chokidar + WS broadcast.
    await new Promise(r => setTimeout(r, 3000));
}

async function gotoDashboard(page) {
    await page.goto('/');
    // Payload arrived once the balance KPI is no longer the placeholder dash.
    await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
    await page.waitForTimeout(500);
}

function productionSection(page) {
    return page.locator('#productions-body');
}

function productionRow(page, name) {
    // Find the factory header row by data-group attribute.
    return page.locator(`#productions-body tr.st-row[data-group="prod:${name}"]`);
}

function recipeTag(page, factoryName, recipeStatus) {
    // In compact mode, recipe rows are tr.group-item[data-group="prod:{name}"]
    // with the tag in td:last-child. In expanded mode, tags are in .ps-recipe-row.
    // Use a selector that works for both.
    const key = `prod:${factoryName}`;
    return page.locator(`#productions-body [data-group="${key}"] .tag`).first();
}

function barFill(page, factoryName) {
    // bar-fill is in group-item stock rows or the header (for totals)
    const key = `prod:${factoryName}`;
    return page.locator(`#productions-body [data-group="${key}"] .bar-fill`).first();
}

function donutHeader(page, factoryName) {
    // silo-donut is in the st-row (factory header)
    const key = `prod:${factoryName}`;
    return page.locator(`#productions-body tr.st-row[data-group="${key}"] svg.silo-donut`).first();
}

// ── st-productions-status-active ──────────────────────────────────────────────
test.describe('productions status: active (compact tag-ready + expanded is-running)', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-status-active');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('compact tag gets tag-ready class for active recipe', async ({ page }) => {
        await gotoDashboard(page);
        const tag = recipeTag(page, 'Pekárna');
        await expect(tag).toHaveClass(/tag-ready/);
    });

    test('expanded recipe row gets is-running class', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.productionsExpanded', 'true'); } catch (_) {}
        });
        await gotoDashboard(page);
        const recipeRow = page.locator('#productions-body .ps-recipe-row');
        await expect(recipeRow).toHaveClass(/is-running/);
    });

    test('no vehicle/animal/silo/field alerts', async ({ page }) => {
        await gotoDashboard(page);
        const bell = page.locator('#bell-count');
        // Should be 0 or not visible (no alerts).
        const visible = await bell.isVisible();
        if (visible) {
            await expect(bell).toHaveText('0');
        }
    });
});

// ── st-productions-status-inactive ──────────────────────────────────────────
test.describe('productions status: inactive (compact tag-empty)', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-status-inactive');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('compact tag gets tag-empty class for inactive recipe', async ({ page }) => {
        await gotoDashboard(page);
        const tag = recipeTag(page, 'Pekárna');
        await expect(tag).toHaveClass(/tag-empty/);
    });
});

// ── st-productions-status-noinput ────────────────────────────────────────────
test.describe('productions status: noInput (compact tag-sow + expanded is-missing red)', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-status-noinput');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('compact tag gets tag-sow class for noInput recipe', async ({ page }) => {
        await gotoDashboard(page);
        const tag = recipeTag(page, 'Pekárna');
        await expect(tag).toHaveClass(/tag-sow/);
    });

    test('expanded recipe row gets is-missing class (red left edge)', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.productionsExpanded', 'true'); } catch (_) {}
        });
        await gotoDashboard(page);
        const recipeRow = page.locator('#productions-body .ps-recipe-row');
        await expect(recipeRow).toHaveClass(/is-missing/);
    });
});

// ── st-productions-status-outputfull ─────────────────────────────────────────
test.describe('productions status: outputFull (compact tag-growing + expanded is-full orange)', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-status-outputfull');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('compact tag gets tag-growing class for outputFull recipe', async ({ page }) => {
        await gotoDashboard(page);
        const tag = recipeTag(page, 'Pekárna');
        await expect(tag).toHaveClass(/tag-growing/);
    });

    test('expanded recipe row gets is-full class (orange left edge)', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.productionsExpanded', 'true'); } catch (_) {}
        });
        await gotoDashboard(page);
        const recipeRow = page.locator('#productions-body .ps-recipe-row');
        await expect(recipeRow).toHaveClass(/is-full/);
    });
});

// ── st-productions-status-unknown ────────────────────────────────────────────
test.describe('productions status: unknown (fallback tag no extra class)', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-status-unknown');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('tag renders without tag-ready/empty/sow/growing classes for unknown status', async ({ page }) => {
        await gotoDashboard(page);
        const tag = recipeTag(page, 'Pekárna');
        await expect(tag).toHaveClass(/^tag$/);
        await expect(tag).not.toHaveClass(/tag-ready|tag-empty|tag-sow|tag-growing/);
    });
});

// ── st-productions-bar-boundary-low ──────────────────────────────────────────
test.describe('productions bar boundary: 69% → no warn class', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-bar-boundary-low');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('bar-fill has no warn class at 69% (below threshold)', async ({ page }) => {
        await gotoDashboard(page);
        const fill = barFill(page, 'Pekárna');
        await expect(fill).not.toHaveClass(/warn|full/);
    });

    test('donut header has no warn/full class at 69%', async ({ page }) => {
        await gotoDashboard(page);
        const donut = donutHeader(page, 'Pekárna');
        await expect(donut).not.toHaveClass(/donut-warn|donut-full/);
    });
});

// ── st-productions-bar-boundary-warn-low ─────────────────────────────────────
test.describe('productions bar boundary: 70% → warn class', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-bar-boundary-warn-low');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('bar-fill gets warn class at exactly 70% (warn threshold)', async ({ page }) => {
        await gotoDashboard(page);
        const fill = barFill(page, 'Pekárna').first();
        await expect(fill).toHaveClass(/warn/);
        await expect(fill).not.toHaveClass(/full/);
    });

    test('donut header gets donut-warn class at 70%+ average', async ({ page }) => {
        await gotoDashboard(page);
        const donut = donutHeader(page, 'Pekárna');
        await expect(donut).toHaveClass(/donut-warn/);
        await expect(donut).not.toHaveClass(/donut-full/);
    });
});

// ── st-productions-bar-boundary-full-low ─────────────────────────────────────
test.describe('productions bar boundary: 94% → warn (not full)', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-bar-boundary-full-low');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('bar-fill has warn (not full) class at 94%', async ({ page }) => {
        await gotoDashboard(page);
        const fill = barFill(page, 'Pekárna');
        await expect(fill).toHaveClass(/warn/);
        await expect(fill).not.toHaveClass(/full/);
    });

    test('donut header has donut-warn (not full) at 94%', async ({ page }) => {
        await gotoDashboard(page);
        const donut = donutHeader(page, 'Pekárna');
        await expect(donut).toHaveClass(/donut-warn/);
        await expect(donut).not.toHaveClass(/donut-full/);
    });
});

// ── st-productions-bar-boundary-full-ok ──────────────────────────────────────
test.describe('productions bar boundary: 95% → full class', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-bar-boundary-full-ok');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('bar-fill gets full class at 95% (full threshold)', async ({ page }) => {
        await gotoDashboard(page);
        const fill = barFill(page, 'Pekárna');
        await expect(fill).toHaveClass(/full/);
    });

    test('donut header gets donut-full class at 95%+', async ({ page }) => {
        await gotoDashboard(page);
        const donut = donutHeader(page, 'Pekárna');
        await expect(donut).toHaveClass(/donut-full/);
    });
});

// ── st-productions-flash-amount-change ───────────────────────────────────────
test.describe('productions flash: amount increase triggers flash-up', () => {
    test.beforeEach(async ({ page, request }) => {
        // Flash is enabled by default in mock. Set up scenario.
        await setScenario(request, 'productions-flash-amount-change');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            // flashEnabled is an object map stored under 'flashEnabled' key.
            try {
                localStorage.setItem('fs25.dash.v1.flashEnabled',
                    JSON.stringify({ productions: true }));
            } catch (_) {}
            // Expanded + uncollapsed so the per-item .ps-stock-row is rendered.
            try {
                localStorage.setItem('fs25.dash.v1.productionsExpanded', 'true');
                localStorage.setItem('fs25.dash.v1.productionsDefaultCollapsed', 'false');
            } catch (_) {}
        });
    });

    // scenarioProductionsFlash is now monotonic-increasing (Mouka amount rises
    // every tick), so the header total + the Mouka item flash UP deterministically
    // once a 2nd tick arrives (no oscillation).
    test('flash-up class appears on factory header row + ps-stock-row after amount increase', async ({ page }) => {
        await gotoDashboard(page);
        // The header st-row carries the flash class; wait for the 2nd tick.
        const factoryRow = productionRow(page, 'Pekárna');
        await expect(factoryRow).toHaveClass(/flash-up/, { timeout: 12000 });

        // The per-item stock row (Mouka) flashes up too.
        const mouka = page.locator('#productions-body .ps-stock-row', { hasText: 'Mouka' }).first();
        await expect(mouka).toHaveClass(/flash-up/, { timeout: 12000 });
    });
});

// ── st-productions-cycles-visible ────────────────────────────────────────────
test.describe('productions cycles: cyclesPerHour > 0 and productionShowCycles=true → visible', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-cycles-visible');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            // Renderer reads DashState.get('productionShowCycles') — key has no 's' at end.
            try { localStorage.setItem('fs25.dash.v1.productionShowCycles', 'true'); } catch (_) {}
        });
    });

    test('compact row shows cyclesPerHour as "N /h"', async ({ page }) => {
        await gotoDashboard(page);
        // Cycles appear in group-item recipe row td.num, not in the st-row header
        const cyclesCell = page.locator('#productions-body tr.group-item[data-group="prod:Pekárna"] td.num').first();
        await expect(cyclesCell).toContainText(/\d+\s*\/h/);
    });

    test('expanded throughput badge visible when productionShowCycles=true', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.productionsExpanded', 'true'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionShowCycles', 'true'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionsDefaultCollapsed', 'false'); } catch (_) {}
        });
        await gotoDashboard(page);
        const throughput = page.locator('#productions-body .ps-throughput');
        await expect(throughput).toBeVisible();
    });
});

// ── st-productions-cycles-hidden ─────────────────────────────────────────────
test.describe('productions cycles: cyclesPerHour=0 or productionShowCycles=false → hidden (dash)', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-cycles-hidden');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            // cyclesPerHour=0 in this scenario; productionShowCycles=true just to isolate the data case.
            try { localStorage.setItem('fs25.dash.v1.productionShowCycles', 'true'); } catch (_) {}
        });
    });

    test('compact row shows — when cyclesPerHour=0', async ({ page }) => {
        await gotoDashboard(page);
        // Cycles appear in group-item recipe row td.num, not in the st-row header
        const cyclesCell = page.locator('#productions-body tr.group-item[data-group="prod:Pekárna"] td.num').first();
        await expect(cyclesCell).toContainText('—');
    });
});

// ── st-productions-cycles-toggle-off ─────────────────────────────────────────
test.describe('productions cycles: productionShowCycles=false → dash even when cyclesPerHour > 0', () => {
    test.beforeEach(async ({ page, request }) => {
        // Use cycles-visible scenario (cyclesPerHour=3) so data is non-zero.
        await setScenario(request, 'productions-cycles-visible');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionShowCycles', 'false'); } catch (_) {}
        });
    });

    test('compact row shows — when productionShowCycles=false (toggle off)', async ({ page }) => {
        await gotoDashboard(page);
        // Cycles appear in group-item recipe row td.num, not in the st-row header
        const cyclesCell = page.locator('#productions-body tr.group-item[data-group="prod:Pekárna"] td.num').first();
        await expect(cyclesCell).toContainText('—');
    });
});

// ── st-productions-cost-badge ────────────────────────────────────────────────
test.describe('productions cost: active recipe with costsPerHour > 0 → badge visible', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-cost-badge');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionsExpanded', 'true'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionsDefaultCollapsed', 'false'); } catch (_) {}
        });
    });

    test('expanded cost badge visible for active recipe', async ({ page }) => {
        await gotoDashboard(page);
        const costBadge = page.locator('#productions-body .ps-cost');
        // Mouka is active with costsPerHour=120, badge must contain "€/h".
        await expect(costBadge.first()).toBeVisible();
        await expect(costBadge.first()).toContainText(/\d+\s*€\/h/);
    });

    test('expanded cost badge hidden for inactive recipe in same factory', async ({ page }) => {
        await gotoDashboard(page);
        // Celozrnné is inactive — only Mouka (active) should have a .ps-cost badge.
        // Renderer emits .ps-cost only when r.status === 'active' (index.html:1870).
        const allCosts = page.locator('#productions-body .ps-recipe-row .ps-cost');
        await expect(allCosts).toHaveCount(1);
    });

    test('factory header shows Σ €/h sum for active recipes when expanded', async ({ page }) => {
        await gotoDashboard(page);
        const factoryRow = productionRow(page, 'Pekárna');
        const meta = factoryRow.locator('.group-meta');
        // Expanded mode: costTxt = ' · Σ N €/h' (index.html:1835).
        // scenarioProductionsCost: Mouka active costsPerHour=120 → "· Σ 120 €/h".
        await expect(meta).toContainText(/Σ\s*\d+\s*€\/h/);
    });
});

// ── st-productions-recycled-input-output ─────────────────────────────────────
test.describe('productions recycled: item in both inputs and outputs → 🔁 prefix', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-recycled-input-output');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionsExpanded', 'true'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionsDefaultCollapsed', 'false'); } catch (_) {}
        });
    });

    test('expanded stock name has 🔁 prefix for recycled items', async ({ page }) => {
        await gotoDashboard(page);
        // Biopalivo is both input and output — its ps-stock-name starts with 🔁
        const recycledName = page.locator('#productions-body .ps-stock-name').filter({ hasText: /🔁/ });
        await expect(recycledName).toHaveCount(1);
    });
});

// ── st-productions-activeonly-hidden ─────────────────────────────────────────
test.describe('productions activeOnly filter: no active recipes → factory hidden', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-activeonly-hidden');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionsActiveOnly', 'true'); } catch (_) {}
        });
    });

    // scenarioProductionsMultiFactory ships Pekárna (active recipe) + Oleárna
    // (only an inactive recipe), both with correct name/productions keys.
    test('inactive factory (no active recipe) is hidden when activeOnly=true', async ({ page }) => {
        await gotoDashboard(page);
        // Pekárna (active) is present, proving the section rendered…
        await expect(productionRow(page, 'Pekárna')).toHaveCount(1);
        // …but Oleárna (only an inactive recipe) is filtered out by activeOnly.
        const inactiveRow = page.locator('#productions-body tr.st-row', { hasText: 'Oleárna' });
        await expect(inactiveRow).toHaveCount(0);
    });

    test('active factory is still visible when activeOnly=true', async ({ page }) => {
        await gotoDashboard(page);
        // Pekárna has an active recipe; must remain visible after activeOnly filter.
        const activeRow = productionRow(page, 'Pekárna');
        await expect(activeRow).toBeVisible();
    });
});

// ── st-productions-inputs-outputs-visible ────────────────────────────────────
test.describe('productions I/O: productionsShowInputs=true → inputs+outputs row visible', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-inputs-outputs-visible');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionsShowInputs', 'true'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionsDefaultCollapsed', 'false'); } catch (_) {}
        });
    });

    test('compact recipe row shows I/O line (c-muted) when productionsShowInputs=true', async ({ page }) => {
        await gotoDashboard(page);
        // I/O line is in group-item recipe row span.c-muted, not in the st-row header
        const ioLine = page.locator('#productions-body tr.group-item[data-group="prod:Pekárna"] span.c-muted').first();
        await expect(ioLine).toBeVisible();
        // scenarioProductionsInputsVisible: input=Pšenice, output=Mouka (index.html:1894-1898).
        await expect(ioLine).toContainText('Pšenice');
        await expect(ioLine).toContainText('Mouka');
    });
});

// ── st-productions-inputs-outputs-hidden ─────────────────────────────────────
test.describe('productions I/O: productionsShowInputs=false → inputs+outputs row hidden', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'productions-inputs-outputs-visible');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.setItem('fs25.dash.v1.productionsShowInputs', 'false'); } catch (_) {}
        });
    });

    test('compact recipe row hides I/O span.c-muted when productionsShowInputs=false', async ({ page }) => {
        await gotoDashboard(page);
        const factoryRow = productionRow(page, 'Pekárna');
        // When showInputsOutputs=false the ioStr is empty, so the <br><span.c-muted> block
        // is not rendered at all (index.html:1898: sub rendered only when ioStr||cycleStr).
        const ioLine = factoryRow.locator('span.c-muted');
        await expect(ioLine).not.toBeVisible();
    });
});
