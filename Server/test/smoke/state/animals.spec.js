// animals.spec.js — Functional assertions for the animals surface ("Zvířata").
//
// Tests all bar classes (danger/warn/none/full), alert badges, repro badges,
// bar visibility toggles, alarm thresholds (loThr/hiThr), expanded states,
// flash animations, modals, and empty states.
//
// Each test sets a specific mock scenario and verifies one or more DOM states
// without taking screenshots. State list (selectors/classes) from state plan.

const { test, expect } = require('@playwright/test');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function setScenario(request, name) {
    const resp = await request.post('/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario "${name}": ${resp.status()}`);
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

function barFill(page, animalName, barTitle) {
    // bar-fill is inside ac-barpair alongside ac-bar-lbl[title].
    // Use CSS :has() to find the right barpair, then the bar-fill within it.
    const row = animalRow(page, animalName);
    return row.locator(`.ac-barpair:has(.ac-bar-lbl[title="${barTitle}"]) .bar-fill`);
}

function barLabel(page, animalName, barTitle) {
    const row = animalRow(page, animalName);
    return row.locator(`.ac-bar-lbl[title="${barTitle}"]`);
}

// ────────────────────────────────────────────────────────────────────────────
// Bar classes: danger / warn / none / full
// ────────────────────────────────────────────────────────────────────────────

test.describe('animals surface — bar classes', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-animals-bar-danger');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-animals-bar-danger: foodPercent=18 → bar danger class', async ({ page }) => {
        await gotoDashboard(page);
        const fill = barFill(page, 'Kravín', 'Krmivo');
        await expect(fill).toHaveClass(/danger/);
        await expect(fill).not.toHaveClass(/warn|full/);
    });
});

test.describe('animals surface — bar warn class', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-animals-bar-warn');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-animals-bar-warn: foodPercent=40 → bar warn class, no danger', async ({ page }) => {
        await gotoDashboard(page);
        const fill = barFill(page, 'Kravín', 'Krmivo');
        await expect(fill).toHaveClass(/warn/);
        await expect(fill).not.toHaveClass(/danger|full/);
    });
});

test.describe('animals surface — bar ok (no class)', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-animals-bar-ok');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-animals-bar-ok: foodPercent=70 → bar no class, no alert on row', async ({ page }) => {
        await gotoDashboard(page);
        const fill = barFill(page, 'Kravín', 'Krmivo');
        await expect(fill).not.toHaveClass(/danger|warn|full/);
        const row = animalRow(page, 'Kravín');
        await expect(row).not.toHaveClass(/alert/);
    });
});

test.describe('animals surface — bar full class', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-animals-bar-full-output');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-animals-bar-full-output: milkPercent=96 → bar full class, alert badge "Odvézt!"', async ({ page }) => {
        await gotoDashboard(page);
        const fill = barFill(page, 'Kravín', 'Mléko');
        await expect(fill).toHaveClass(/full/);
        const row = animalRow(page, 'Kravín');
        await expect(row).toHaveClass(/alert/);
        await expect(row.locator('.alert-badge')).toContainText('Odvézt!');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Bar class boundaries: 20/21, 50/51, 94/95
// ────────────────────────────────────────────────────────────────────────────

test.describe('animals surface — bar boundary 20/21', () => {
    test('st-animals-bar-boundary-20-low: pct=20 → danger class', async ({ page, request }) => {
        await setScenario(request, 'st-animals-bar-boundary-20-low');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const fill = barFill(page, 'Kravín', 'Krmivo');
        await expect(fill).toHaveClass(/danger/);
        await expect(fill).not.toHaveClass(/warn/);
    });

    test('st-animals-bar-boundary-21-ok: pct=21 → warn, not danger', async ({ page, request }) => {
        await setScenario(request, 'st-animals-bar-boundary-21-ok');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const fill = barFill(page, 'Kravín', 'Krmivo');
        await expect(fill).toHaveClass(/warn/);
        await expect(fill).not.toHaveClass(/danger/);
    });
});

test.describe('animals surface — bar boundary 50/51', () => {
    test('st-animals-bar-boundary-50-warn: pct=50 → warn, loThr=25 so no row alert', async ({ page, request }) => {
        await setScenario(request, 'st-animals-bar-boundary-50-warn');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const fill = barFill(page, 'Kravín', 'Krmivo');
        await expect(fill).toHaveClass(/warn/);
        const row = animalRow(page, 'Kravín');
        await expect(row).not.toHaveClass(/alert/);
    });

    test('st-animals-bar-boundary-51-ok: pct=51 → no class', async ({ page, request }) => {
        await setScenario(request, 'st-animals-bar-boundary-51-ok');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const fill = barFill(page, 'Kravín', 'Krmivo');
        await expect(fill).not.toHaveClass(/danger|warn|full/);
    });
});

test.describe('animals surface — bar boundary 94/95 (output full)', () => {
    test('st-animals-bar-boundary-94-ok: milkPercent=94 → no class (bar none, but alert fires on hiThr 90)', async ({ page, request }) => {
        await setScenario(request, 'st-animals-bar-boundary-94-ok');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const fill = barFill(page, 'Kravín', 'Mléko');
        await expect(fill).not.toHaveClass(/danger|warn|full/);
        // Note: alert fires when mp >= hiThr (90), so even at 94 the badge appears
        // but test documents that bar has no 'full' class yet at 94
    });

    test('st-animals-bar-boundary-95-full: milkPercent=95 → full class', async ({ page, request }) => {
        await setScenario(request, 'st-animals-bar-boundary-95-full');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const fill = barFill(page, 'Kravín', 'Mléko');
        await expect(fill).toHaveClass(/full/);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Alarm thresholds: loThr (low input) and hiThr (high output)
// ────────────────────────────────────────────────────────────────────────────

test.describe('animals surface — alarm loThr boundary (25)', () => {
    test('st-animals-alarm-loThr-boundary-24: foodPercent=24 < 25 → alert badge "Doplnit!"', async ({ page, request }) => {
        await setScenario(request, 'st-animals-alarm-loThr-boundary-24');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        await expect(row).toHaveClass(/alert/);
        await expect(row.locator('.alert-badge')).toContainText('Doplnit!');
    });

    test('st-animals-alarm-loThr-boundary-25: foodPercent=25 not < 25 → no alert badge', async ({ page, request }) => {
        await setScenario(request, 'st-animals-alarm-loThr-boundary-25');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        await expect(row).not.toHaveClass(/alert/);
        await expect(row.locator('.alert-badge')).toHaveCount(0);
    });
});

test.describe('animals surface — alarm hiThr boundary (90)', () => {
    test('st-animals-alarm-hiThr-boundary-89: milkPercent=89 < 90 → no alert', async ({ page, request }) => {
        await setScenario(request, 'st-animals-alarm-hiThr-boundary-89');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        await expect(row).not.toHaveClass(/alert/);
    });

    test('st-animals-alarm-hiThr-boundary-90: milkPercent=90 >= 90 → alert badge "Odvézt!"', async ({ page, request }) => {
        await setScenario(request, 'st-animals-alarm-hiThr-boundary-90');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        await expect(row).toHaveClass(/alert/);
        await expect(row.locator('.alert-badge')).toContainText('Odvézt!');
    });
});

test.describe('animals surface — alarm DashState toggle', () => {
    test('st-animals-alarm-off: animalsShowAlarm=false → no alert badge even with low food', async ({ page, request }) => {
        await setScenario(request, 'st-animals-alarm-off');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            // Disable alarm to test that no alert shows despite low food
            try { localStorage.setItem('fs25.dash.v1.animalsShowAlarm', 'false'); } catch (_) {}
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        await expect(row).not.toHaveClass(/alert/);
        await expect(row.locator('.alert-badge')).toHaveCount(0);
    });
});

test.describe('animals surface — alert guard count > 0', () => {
    test('st-animals-alert-empty-pen-no-alert: count==0 → no alert even with extreme values', async ({ page, request }) => {
        await setScenario(request, 'st-animals-alert-empty-pen-no-alert');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Prázdný kravín');
        await expect(row).not.toHaveClass(/alert/);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Reproduction badges: ready / cycling / paused / blocked / young / unsupported
// ────────────────────────────────────────────────────────────────────────────

test.describe('animals surface — repro badges', () => {
    test('st-animals-repro-ready: reproStatus=ready → 🟢 c-green', async ({ page, request }) => {
        await setScenario(request, 'st-animals-repro-ready');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const badge = animalRow(page, 'Kravín').locator('.ac-repro-badge');
        await expect(badge).toHaveClass(/c-green/);
        await expect(badge).toContainText('🟢');
    });

    test('st-animals-repro-cycling: reproStatus=cycling → 🟡 c-green', async ({ page, request }) => {
        await setScenario(request, 'st-animals-repro-cycling');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const badge = animalRow(page, 'Kravín').locator('.ac-repro-badge');
        await expect(badge).toHaveClass(/c-green/);
        await expect(badge).toContainText('🟡');
    });

    test('st-animals-repro-paused: reproStatus=paused → ⏸ c-green', async ({ page, request }) => {
        await setScenario(request, 'st-animals-repro-paused');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const badge = animalRow(page, 'Kravín').locator('.ac-repro-badge');
        await expect(badge).toHaveClass(/c-green/);
        await expect(badge).toContainText('⏸');
    });

    test('st-animals-repro-blocked: reproStatus=blocked → 🔴 c-red', async ({ page, request }) => {
        await setScenario(request, 'st-animals-repro-blocked');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const badge = animalRow(page, 'Kravín').locator('.ac-repro-badge');
        await expect(badge).toHaveClass(/c-red/);
        await expect(badge).toContainText('🔴');
    });

    test('st-animals-repro-young: reproStatus=young → 🟠 c-orange', async ({ page, request }) => {
        await setScenario(request, 'st-animals-repro-young');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const badge = animalRow(page, 'Kravín').locator('.ac-repro-badge');
        await expect(badge).toHaveClass(/c-orange/);
        await expect(badge).toContainText('🟠');
    });

    test('st-animals-repro-unsupported: reproStatus=unsupported → ⚪ c-muted', async ({ page, request }) => {
        await setScenario(request, 'st-animals-repro-unsupported');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const badge = animalRow(page, 'Kurník').locator('.ac-repro-badge');
        await expect(badge).toHaveClass(/c-muted/);
        await expect(badge).toContainText('⚪');
    });

    test('st-animals-repro-fallback-high: reproStatus=undefined, reproPct>=90 → 🐣 c-green', async ({ page, request }) => {
        await setScenario(request, 'st-animals-repro-fallback-high');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const badge = animalRow(page, 'Kravín').locator('.ac-repro-badge');
        await expect(badge).toHaveClass(/c-green/);
        await expect(badge).toContainText('🐣');
    });

    test('st-animals-repro-fallback-low: reproStatus=undefined, reproPct<90 → 🐣 no color', async ({ page, request }) => {
        await setScenario(request, 'st-animals-repro-fallback-low');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const badge = animalRow(page, 'Kravín').locator('.ac-repro-badge');
        await expect(badge).not.toHaveClass(/c-green|c-red|c-orange/);
        await expect(badge).toContainText('🐣');
    });

    test('st-animals-repro-hidden: reproPct==null → badge missing', async ({ page, request }) => {
        await setScenario(request, 'st-animals-repro-hidden');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        await expect(row.locator('.ac-repro-badge')).toHaveCount(0);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Bar visibility toggles: water, bedding, food, milk, manure, slurry
// ────────────────────────────────────────────────────────────────────────────

test.describe('animals surface — bar visibility (null or toggle)', () => {
    test('st-animals-bars-visibility-water-null: waterPercent=null (pig) → water bar missing', async ({ page, request }) => {
        await setScenario(request, 'st-animals-bars-visibility-water-null');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Vepřín');
        await expect(row.locator('.ac-bar-lbl[title="Voda"]')).toHaveCount(0);
    });

    test('st-animals-bars-visibility-toggles-off: all bar toggles off → bars missing', async ({ page, request }) => {
        await setScenario(request, 'st-animals-bars-visibility-toggles-off');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            // Toggle each bar visibility off
            localStorage.setItem('fs25.dash.v1.animalsShowFood', false);
            localStorage.setItem('fs25.dash.v1.animalsShowWater', false);
            localStorage.setItem('fs25.dash.v1.animalsShowBedding', false);
            localStorage.setItem('fs25.dash.v1.animalsShowMilk', false);
            localStorage.setItem('fs25.dash.v1.animalsShowManure', false);
            localStorage.setItem('fs25.dash.v1.animalsShowSlurry', false);
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        await expect(row.locator('.ac-bar-lbl')).toHaveCount(0);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Expanded mode: atCap, herdValue, liters/tonnes formatting
// ────────────────────────────────────────────────────────────────────────────

test.describe('animals surface — expanded mode', () => {
    test('st-animals-expanded-atcap: count>=maxCount → count span has c-orange', async ({ page, request }) => {
        await setScenario(request, 'st-animals-expanded-atcap');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            localStorage.setItem('fs25.dash.v1.animalsExpanded', true);
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        await expect(row.locator('.ac-sub span.c-orange')).toBeVisible();
    });

    test('st-animals-expanded-herdvalue: herdValue>0 → herd value badge visible', async ({ page, request }) => {
        await setScenario(request, 'st-animals-expanded-herdvalue');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            localStorage.setItem('fs25.dash.v1.animalsExpanded', true);
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        await expect(row.locator('.ac-herd-value')).toBeVisible();
        await expect(row.locator('.ac-herd-value')).toContainText('💰');
    });

    test('st-animals-expanded-liters-tonnes: capacity>1000 → tonnes; <=1000 → litres', async ({ page, request }) => {
        await setScenario(request, 'st-animals-expanded-liters-tonnes');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            localStorage.setItem('fs25.dash.v1.animalsExpanded', true);
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        // Food bar cap 12000 > 1000 → should show 't'
        const foodLiters = row.locator('.ac-bars-inputs .ac-bar-liters').first();
        await expect(foodLiters).toContainText(/[0-9.]+\s*\/\s*[0-9.]+\s*t/);
        // Water bar cap 1000 <= 1000 → should show 'l'
        const waterLiters = row.locator('.ac-bars-inputs .ac-bar-liters').nth(1);
        await expect(waterLiters).toContainText(/[0-9,\s]*\/\s*[0-9,\s]*\s*l/);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Empty states: no animals, all hidden
// ────────────────────────────────────────────────────────────────────────────

test.describe('animals surface — empty states', () => {
    test('st-animals-empty-section: animals.length==0 → "Žádná zvířata."', async ({ page, request }) => {
        await setScenario(request, 'empty-farm');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const body = page.locator('#animals-body');
        await expect(body.locator('.empty')).toContainText('Žádná zvířata.');
    });

    test('st-animals-all-hidden: visible.length==0 → "Všechny chovy jsou skryté."', async ({ page, request }) => {
        // This test would require TableTools interaction to hide an animal
        // Simplified: we check that the message exists in the DOM structure
        // In a real scenario, you'd drag the animal to the hidden zone
        await setScenario(request, 'st-animals-bar-ok');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            // Simulate hiding all animals via TableTools internal state (key: fs25.dash.v1.hidden:animals)
            localStorage.setItem('fs25.dash.v1.hidden:animals', JSON.stringify(['Kravín']));
        });
        await gotoDashboard(page);
        const body = page.locator('#animals-body');
        await expect(body.locator('.empty')).toContainText('Všechny chovy jsou skryté.');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Flash animations: count, bar label, health, repro (multi-tick scenarios)
// ────────────────────────────────────────────────────────────────────────────

// Each scenario emits tick 0 then a single changed tick (e.g. count 10→12).
// The flash class fires on the change and persists 10s (index.html:567), so a
// Promise.race over a 10s toHaveClass window reliably catches flash-up or
// flash-down — the same pattern flash.spec.js uses for single-step scenarios.
async function expectFlash(locator, page) {
    // Wait for the second WS tick (scenario changes values ~5 s after switch).
    if (page) await page.waitForTimeout(5000);
    const hit = await Promise.race([
        expect(locator).toHaveClass(/flash-up/,   { timeout: 8_000 }).then(() => true).catch(() => false),
        expect(locator).toHaveClass(/flash-down/, { timeout: 8_000 }).then(() => true).catch(() => false),
    ]);
    expect(hit).toBe(true);
}

test.describe('animals surface — flash animations', () => {
    test('st-animals-flash-count: count change → flash-up/down on row', async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            localStorage.setItem('fs25.dash.v1.flashEnabled', JSON.stringify({ animals: true }));
            try { localStorage.removeItem('fs25.dash.v1.hidden:animals'); } catch (_) {}
        });
        await setScenario(request, 'st-animals-flash-count');
        await gotoDashboard(page);
        // count 10 → 12 → whole row carries flash-up
        await expectFlash(animalRow(page, 'Kravín'), page);
    });

    test('st-animals-flash-barlabel: water percent change → flash on bar label', async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            localStorage.setItem('fs25.dash.v1.flashEnabled', JSON.stringify({ animals: true }));
            try { localStorage.removeItem('fs25.dash.v1.hidden:animals'); } catch (_) {}
        });
        await setScenario(request, 'st-animals-flash-barlabel');
        await gotoDashboard(page);
        // waterPercent 60 → 65 → the Voda bar label (.ac-bar-lbl[title="Voda"]) flashes
        await expectFlash(barLabel(page, 'Kravín', 'Voda'), page);
    });

    test('st-animals-flash-health: productivity change → flash on sub-val', async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            localStorage.setItem('fs25.dash.v1.flashEnabled', JSON.stringify({ animals: true }));
            try { localStorage.removeItem('fs25.dash.v1.hidden:animals'); } catch (_) {}
        });
        await setScenario(request, 'st-animals-flash-health');
        await gotoDashboard(page);
        // productivity 70 → 75 → the productivity sub-val (.ac-sub-val) flashes
        await expectFlash(animalRow(page, 'Kravín').locator('.ac-sub-val'), page);
    });

    test('st-animals-flash-repro: reproductionPercent change → flash on repro badge', async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            localStorage.setItem('fs25.dash.v1.animalsShowReproduction', 'true');
            localStorage.setItem('fs25.dash.v1.flashEnabled', JSON.stringify({ animals: true }));
            try { localStorage.removeItem('fs25.dash.v1.hidden:animals'); } catch (_) {}
        });
        await setScenario(request, 'st-animals-flash-repro');
        await gotoDashboard(page);
        // reproductionPercent 70 → 75 → the repro badge (.ac-repro-badge) flashes
        await expectFlash(animalRow(page, 'Kravín').locator('.ac-repro-badge'), page);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Modal: cluster repro cells, fill row visibility
// ────────────────────────────────────────────────────────────────────────────

test.describe('animals surface — modal', () => {
    test('st-animals-modal-repro-cells: click row → modal shows cluster repro states (ready/cycling/paused/blocked/young/unsupported/fallback)', async ({ page, request }) => {
        await setScenario(request, 'st-animals-modal-repro-cells');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Kravín');
        await row.click();
        // Modal should be visible
        const modal = page.locator('#animal-modal');
        await expect(modal).not.toHaveAttribute('hidden');
        // Scenario has 7 clusters: ready/cycling/paused→c-green, blocked→c-red,
        // young→c-orange, unsupported→c-muted, and one with no reproStatus whose
        // reproduction=93 >= 90 → fallback c-green (index.html:1340,1350). Every
        // repro cell therefore carries a colour class → exactly 7 coloured cells.
        const colored = modal.locator('.amodal-clusters td.c-green, .amodal-clusters td.c-red, .amodal-clusters td.c-orange, .amodal-clusters td.c-muted');
        await expect(colored).toHaveCount(7);
        // Specific buckets present (blocked → red, young → orange, unsupported → muted)
        await expect(modal.locator('.amodal-clusters td.c-red')).toHaveCount(1);
        await expect(modal.locator('.amodal-clusters td.c-orange')).toHaveCount(1);
        await expect(modal.locator('.amodal-clusters td.c-muted')).toHaveCount(1);
        // The blocked cluster cell shows its 🔴 icon
        await expect(modal.locator('.amodal-clusters td.c-red')).toContainText('🔴');
        // Close
        await page.keyboard.press('Escape');
        await expect(modal).toHaveAttribute('hidden');
    });

    test('st-animals-modal-fillrows-visibility: pig modal → straw/milk/slurry rows missing, food/water/manure present', async ({ page, request }) => {
        await setScenario(request, 'st-animals-modal-fillrows-visibility');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
            try { localStorage.removeItem('fs25.dash.v1.hidden:animals'); } catch (_) {}
            try { localStorage.removeItem('fs25.dash.v1.order:animals'); } catch (_) {}
        });
        await gotoDashboard(page);
        const row = animalRow(page, 'Vepřín');
        await row.click();
        const modal = page.locator('#animal-modal');
        await expect(modal).not.toHaveAttribute('hidden');
        const fillsTable = modal.locator('.amodal-fills tbody tr');
        // Pig scenario exposes only foodPercent/waterPercent/manurePercent → the
        // fillRow guards (index.html:1316-1321) emit exactly Krmivo + Voda + Hnůj
        // (food/water always render; straw/milk/slurry omitted because their
        // *Percent is null) → exactly 3 rows.
        await expect(fillsTable).toHaveCount(3);
        // Present: Krmivo (🌾), Voda (💧), Hnůj (💩)
        await expect(fillsTable.filter({ hasText: 'Krmivo' })).toHaveCount(1);
        await expect(fillsTable.filter({ hasText: 'Voda' })).toHaveCount(1);
        await expect(fillsTable.filter({ hasText: 'Hnůj' })).toHaveCount(1);
        // Absent: straw/milk/slurry rows
        await expect(fillsTable.filter({ hasText: 'Podestýlka' })).toHaveCount(0);
        await expect(fillsTable.filter({ hasText: 'Mléko' })).toHaveCount(0);
        await expect(fillsTable.filter({ hasText: 'Kejda' })).toHaveCount(0);
        await page.keyboard.press('Escape');
    });
});
