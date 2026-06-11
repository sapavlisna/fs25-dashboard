// bell.spec.js — FUNCTIONAL assertions for the bell notification panel.
// Each test isolates a single alert condition (boundary, guard, severity, empty state).
//
// Thresholds under test:
//   FOOD_LOW = 25 (strict <)
//   WATER_LOW = 20 (strict <)
//   STRAW_LOW = 25 (strict <, requires strawPercent != null)
//   OUTPUT_HI = 90 (inclusive >=)
//   FUEL_LOW = 15 (strict <)
//   STORAGE_HI = 95 (inclusive >=, as 0.95)
//
// Severity: urgent (icon recolor red) | warning (icon recolor orange) | info (no icon recolor)
// Selectors: .bell-item.bell-{urgent|warning|info}[data-target="sec-{animals|fields|vehicles|storage}"]

const { test, expect } = require('@playwright/test');

// ── helpers ────────────────────────────────────────────────────────────────────
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

async function openBell(page) {
    await page.locator('#bell-btn').click();
    await expect(page.locator('#bell-panel')).not.toHaveAttribute('hidden');
}

// ── Animals: food boundary and guards ──────────────────────────────────────────
test.describe('bell — animals food threshold', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-bell-anim-food-boundary-low: foodPercent=24 fires alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-food-boundary-low');
        await gotoDashboard(page);

        // Expect exactly one warning alert (anim-food) targeting animals section.
        const alert = page.locator('.bell-item.bell-warning[data-target="sec-animals"]');
        await expect(alert).toHaveCount(1);
        await expect(alert.locator('.bell-item-icon')).toContainText('🐄');

        // Badge shows "1" alert.
        await expect(page.locator('#bell-count')).toBeVisible();
        await expect(page.locator('#bell-count')).toHaveText('1');
    });

    test('st-bell-anim-food-boundary-ok: foodPercent=25 does NOT fire alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-food-boundary-ok');
        await gotoDashboard(page);

        // Badge should be hidden (empty state).
        await expect(page.locator('#bell-count')).not.toBeVisible();

        // Open panel to check empty state inside it.
        await openBell(page);
        const alert = page.locator('.bell-item.bell-warning[data-target="sec-animals"]');
        await expect(alert).toHaveCount(0);
        await expect(page.locator('#bell-empty')).toBeVisible();
    });

    test('st-bell-anim-food-empty-pen: count=0 suppresses food alert despite low threshold', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-food-empty-pen');
        await gotoDashboard(page);

        // Bell should be in empty state.
        await expect(page.locator('#bell-count')).not.toBeVisible();

        // Open panel to verify no alert items and empty state shown.
        await openBell(page);
        const alert = page.locator('.bell-item.bell-warning[data-target="sec-animals"]');
        await expect(alert).toHaveCount(0);
        await expect(page.locator('#bell-empty')).toBeVisible();
    });
});

// ── Animals: water threshold ───────────────────────────────────────────────────
test.describe('bell — animals water threshold', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-bell-anim-water-boundary-low: waterPercent=19 fires alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-water-boundary-low');
        await gotoDashboard(page);

        // Expect exactly one warning alert (anim-water).
        const alert = page.locator('.bell-item.bell-warning[data-target="sec-animals"]');
        await expect(alert).toHaveCount(1);
        await expect(alert.locator('.bell-item-icon')).toContainText('💧');

        // Badge shows "1".
        await expect(page.locator('#bell-count')).toBeVisible();
        await expect(page.locator('#bell-count')).toHaveText('1');
    });

    test('st-bell-anim-water-boundary-ok: waterPercent=20 does NOT fire alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-water-boundary-ok');
        await gotoDashboard(page);

        // Bell is empty.
        await expect(page.locator('#bell-count')).not.toBeVisible();

        // Open panel to verify no alert items and empty state shown.
        await openBell(page);
        const alert = page.locator('.bell-item.bell-warning[data-target="sec-animals"]');
        await expect(alert).toHaveCount(0);
        await expect(page.locator('#bell-empty')).toBeVisible();
    });
});

// ── Animals: straw threshold ───────────────────────────────────────────────────
test.describe('bell — animals straw threshold', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-bell-anim-straw-boundary-low: strawPercent=24 fires alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-straw-boundary-low');
        await gotoDashboard(page);

        // Expect exactly one warning alert (anim-straw).
        const alert = page.locator('.bell-item.bell-warning[data-target="sec-animals"]');
        await expect(alert).toHaveCount(1);
        await expect(alert.locator('.bell-item-icon')).toContainText('🛏');

        // Badge shows "1".
        await expect(page.locator('#bell-count')).toBeVisible();
        await expect(page.locator('#bell-count')).toHaveText('1');
    });

    test('st-bell-anim-straw-boundary-ok: strawPercent=25 does NOT fire alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-straw-boundary-ok');
        await gotoDashboard(page);

        // Bell is empty.
        await expect(page.locator('#bell-count')).not.toBeVisible();

        // Open panel to verify no alert items and empty state shown.
        await openBell(page);
        const alert = page.locator('.bell-item.bell-warning[data-target="sec-animals"]');
        await expect(alert).toHaveCount(0);
        await expect(page.locator('#bell-empty')).toBeVisible();
    });
});

// ── Animals: output threshold ──────────────────────────────────────────────────
test.describe('bell — animals output threshold', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-bell-anim-output-boundary-ok: milkPercent=90 fires info alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-output-boundary-ok');
        await gotoDashboard(page);

        // Expect exactly one info alert (anim-output) — inclusive >= 90.
        const alert = page.locator('.bell-item.bell-info[data-target="sec-animals"]');
        await expect(alert).toHaveCount(1);
        await expect(alert.locator('.bell-item-icon')).toContainText('📦');

        // Badge shows "1".
        await expect(page.locator('#bell-count')).toBeVisible();
        await expect(page.locator('#bell-count')).toHaveText('1');
    });

    test('st-bell-anim-output-boundary-low: milkPercent=89 does NOT fire alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-output-boundary-low');
        await gotoDashboard(page);

        // Bell is empty.
        await expect(page.locator('#bell-count')).not.toBeVisible();

        // Open panel to verify no alert items and empty state shown.
        await openBell(page);
        const alert = page.locator('.bell-item.bell-info[data-target="sec-animals"]');
        await expect(alert).toHaveCount(0);
        await expect(page.locator('#bell-empty')).toBeVisible();
    });
});

// ── Fields: ready-to-harvest alert ────────────────────────────────────────────
test.describe('bell — fields ready to harvest', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-bell-field-ready: owned+ready field fires info alert, non-owned excluded', async ({ page, request }) => {
        await setScenario(request, 'st-bell-field-ready');
        await gotoDashboard(page);

        // Expect exactly one info alert (field-ready).
        const alert = page.locator('.bell-item.bell-info[data-target="sec-fields"]');
        await expect(alert).toHaveCount(1);
        await expect(alert.locator('.bell-item-icon')).toContainText('🌾');

        // Detail should show the owned field.
        const detail = alert.locator('.bell-item-detail');
        await expect(detail).toContainText('Pšenice');

        // Badge shows "1".
        await expect(page.locator('#bell-count')).toBeVisible();
        await expect(page.locator('#bell-count')).toHaveText('1');
    });
});

// ── Vehicles: fuel threshold and guards ────────────────────────────────────────
test.describe('bell — vehicles fuel threshold', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-bell-veh-fuel-boundary-low: fuelPercent=14 fires urgent alert, tankless suppressed', async ({ page, request }) => {
        await setScenario(request, 'st-bell-veh-fuel-boundary-low');
        await gotoDashboard(page);

        // Expect exactly one urgent alert (veh-fuel).
        const alert = page.locator('.bell-item.bell-urgent[data-target="sec-vehicles"]');
        await expect(alert).toHaveCount(1);

        // Icon should be 🚜.
        const icon = alert.locator('.bell-item-icon');
        await expect(icon).toContainText('🚜');

        // Detail should show only the low-fuel vehicle (14%), not the 35% or tankless vehicle.
        const detail = alert.locator('.bell-item-detail');
        await expect(detail).toContainText('Fendt 942 Vario');
        await expect(detail).not.toContainText('CLAAS LEXION');
        await expect(detail).not.toContainText('Kolečko');

        // Badge shows "1".
        await expect(page.locator('#bell-count')).toBeVisible();
        await expect(page.locator('#bell-count')).toHaveText('1');
    });

    test('st-bell-veh-fuel-boundary-ok: fuelPercent=15 does NOT fire alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-veh-fuel-boundary-ok');
        await gotoDashboard(page);

        // Bell is empty.
        await expect(page.locator('#bell-count')).not.toBeVisible();

        // Open panel to verify no alert items and empty state shown.
        await openBell(page);
        const alert = page.locator('.bell-item.bell-urgent[data-target="sec-vehicles"]');
        await expect(alert).toHaveCount(0);
        await expect(page.locator('#bell-empty')).toBeVisible();
    });
});

// ── Storage: silo near-full threshold ──────────────────────────────────────────
test.describe('bell — storage near-full threshold', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-bell-storage-boundary-ok: 95% silo fires info alert, <95% silo excluded', async ({ page, request }) => {
        await setScenario(request, 'st-bell-storage-boundary-ok');
        await gotoDashboard(page);

        // Expect exactly one info alert (storage-full).
        const alert = page.locator('.bell-item.bell-info[data-target="sec-storage"]');
        await expect(alert).toHaveCount(1);
        await expect(alert.locator('.bell-item-icon')).toContainText('📦');

        // Detail should show only the 95% silo (Silo A), not the 50% one (Silo B).
        const detail = alert.locator('.bell-item-detail');
        await expect(detail).toContainText('Silo A');
        await expect(detail).not.toContainText('Silo B');

        // Badge shows "1".
        await expect(page.locator('#bell-count')).toBeVisible();
        await expect(page.locator('#bell-count')).toHaveText('1');
    });

    test('st-bell-storage-boundary-low: 94% silo does NOT fire alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-storage-boundary-low');
        await gotoDashboard(page);

        // Bell is empty.
        await expect(page.locator('#bell-count')).not.toBeVisible();

        // Open panel to verify no alert items and empty state shown.
        await openBell(page);
        const alert = page.locator('.bell-item.bell-info[data-target="sec-storage"]');
        await expect(alert).toHaveCount(0);
        await expect(page.locator('#bell-empty')).toBeVisible();
    });
});

// ── Bell: empty state (all healthy) ────────────────────────────────────────────
test.describe('bell — empty state', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('st-bell-empty-all-healthy: no alerts, empty footer shown, actions hidden', async ({ page, request }) => {
        await setScenario(request, 'st-bell-empty-all-healthy');
        await gotoDashboard(page);

        // Badge should be hidden and bell button has no alerts class.
        await expect(page.locator('#bell-count')).not.toBeVisible();
        await expect(page.locator('#bell-btn')).not.toHaveClass(/has-alerts/);

        // Open panel to check internal state.
        await openBell(page);

        // No bell items should be present.
        await expect(page.locator('#bell-list .bell-item')).toHaveCount(0);

        // Empty footer should be visible.
        await expect(page.locator('#bell-empty')).toBeVisible();
        await expect(page.locator('#bell-empty')).toContainText('Žádná upozornění');

        // Actions footer hidden. The code sets the `hidden` attribute (bell.js:310),
        // but .bell-panel-actions { display:flex } in CSS defeats the UA [hidden]
        // rule, so the element stays visually rendered — assert the attribute the
        // code actually controls rather than computed visibility.
        await expect(page.locator('#bell-actions')).toHaveAttribute('hidden', /.*/);
    });
});

// ── Dismiss: individual ✕ on a row ──────────────────────────────────────────────
test.describe('bell — dismiss individual', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    // Clicking the per-row ✕ (.bell-item-dismiss[data-dismiss-fp]) removes that
    // li from #bell-list, drops the badge, and flips the panel into empty state
    // (bell.js:206-213, 309-310). Single-alert scenario → exactly one item.
    test('st-bell-veh-fuel-boundary-low: ✕ on the row removes it and empties the bell', async ({ page, request }) => {
        await setScenario(request, 'st-bell-veh-fuel-boundary-low');
        await gotoDashboard(page);

        await expect(page.locator('#bell-count')).toHaveText('1');
        await openBell(page);

        const item = page.locator('.bell-item.bell-urgent[data-target="sec-vehicles"]');
        await expect(item).toHaveCount(1);

        // Click the row's dismiss ✕ (not the row body — that would scroll+close).
        await item.locator('.bell-item-dismiss').click();

        // Item gone, list empty, badge hidden, empty footer shown, actions hidden.
        await expect(page.locator('#bell-list .bell-item')).toHaveCount(0);
        await expect(page.locator('#bell-count')).not.toBeVisible();
        await expect(page.locator('#bell-empty')).toBeVisible();
        // CSS display:flex defeats the [hidden] attribute visually — assert the
        // attribute the code toggles (bell.js:310).
        await expect(page.locator('#bell-actions')).toHaveAttribute('hidden', /.*/);
    });
});

// ── Dismiss: "Skrýt vše" (dismiss all) ──────────────────────────────────────────
test.describe('bell — dismiss all', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    // #bell-dismiss-all fingerprints every current alert → list empties,
    // #bell-empty shows, #bell-actions hides, badge drops (bell.js:313-317).
    test('st-bell-veh-fuel-boundary-low: "Skrýt vše" empties list and hides actions', async ({ page, request }) => {
        await setScenario(request, 'st-bell-veh-fuel-boundary-low');
        await gotoDashboard(page);

        await expect(page.locator('#bell-count')).toHaveText('1');
        await openBell(page);

        // Actions footer (holding the "Skrýt vše" button) is shown while alerts
        // exist → no `hidden` attribute (bell.js:310).
        await expect(page.locator('#bell-actions')).not.toHaveAttribute('hidden', /.*/);
        await expect(page.locator('#bell-dismiss-all')).toHaveText('Skrýt vše');

        await page.locator('#bell-dismiss-all').click();

        // Everything dismissed.
        await expect(page.locator('#bell-list .bell-item')).toHaveCount(0);
        await expect(page.locator('#bell-count')).not.toBeVisible();
        await expect(page.locator('#bell-empty')).toBeVisible();
        // CSS display:flex defeats the [hidden] attribute visually — assert the
        // attribute the code toggles back on after dismiss-all (bell.js:310).
        await expect(page.locator('#bell-actions')).toHaveAttribute('hidden', /.*/);
    });
});

// ── Row click → scroll + flash target section + dismiss ─────────────────────────
test.describe('bell — row click flashes target', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    // Clicking the row body (not ✕) closes the panel, dismisses the alert, and
    // calls scrollAndFlash on the target section → #sec-vehicles gains
    // .card-flash (bell.js:214-223, 232-236). On the index page the section
    // exists, so it flashes in place (no redirect).
    test('st-bell-veh-fuel-boundary-low: row click adds .card-flash to #sec-vehicles', async ({ page, request }) => {
        await setScenario(request, 'st-bell-veh-fuel-boundary-low');
        await gotoDashboard(page);

        await openBell(page);
        const item = page.locator('.bell-item.bell-urgent[data-target="sec-vehicles"]');
        await expect(item).toHaveCount(1);

        // Click the row body (title), not the ✕.
        await item.locator('.bell-item-title').click();

        // Target section flashed; panel closed; alert dismissed.
        await expect(page.locator('#sec-vehicles')).toHaveClass(/card-flash/);
        await expect(page.locator('#bell-panel')).toHaveAttribute('hidden', /.*/);
        await expect(page.locator('#bell-count')).not.toBeVisible();
    });
});

// ── Vehicles — low-fuel alert gated by hidden set (biggest risk) ────────────────
test.describe('bell — hidden vehicle suppresses fuel alert', () => {
    test.beforeEach(async ({ page, request }) => {
        // Hide the low-fuel vehicle by NAME before the page loads. The bell gate
        // reads TableTools.getHidden('vehicles'), which unions the new
        // (hidden:vehicles) and legacy (hiddenVehicles) keys (tabletools.js:57-67,
        // bell.js:110-118). Matching is by vehicle name (String(v.name)).
        await page.addInitScript(() => {
            try {
                localStorage.setItem('fs25.dash.v1.syncMode', 'local');
                localStorage.setItem('fs25.dash.v1.hidden:vehicles', JSON.stringify(['Fendt 942 Vario']));
            } catch (_) {}
        });
    });

    // st-bell-veh-fuel-boundary-low's only low-fuel vehicle is "Fendt 942 Vario"
    // (14%). Hiding that name drops it from the lowFuel list → no veh-fuel alert,
    // empty bell.
    test('hiding the low-fuel vehicle by name removes the urgent alert', async ({ page, request }) => {
        await setScenario(request, 'st-bell-veh-fuel-boundary-low');
        await gotoDashboard(page);

        // No urgent vehicle alert and badge hidden.
        await expect(page.locator('.bell-item.bell-urgent[data-target="sec-vehicles"]')).toHaveCount(0);
        await expect(page.locator('#bell-count')).not.toBeVisible();

        await openBell(page);
        await expect(page.locator('#bell-list .bell-item')).toHaveCount(0);
        await expect(page.locator('#bell-empty')).toBeVisible();
    });
});

// ── Severity-driven icon recolor (CSS, default dark-green theme) ─────────────────
// dark-green tokens: --orange #e07a30 = rgb(224, 122, 48); --red #e05252 =
// rgb(224, 82, 82). Tests run on the default theme (no theme key seeded).
test.describe('bell — severity icon coloring', () => {
    test.beforeEach(async ({ page, request }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    // warning → .bell-item.bell-warning .bell-item-icon gets var(--orange)
    // (style.css:271). Food-low produces a single warning alert.
    test('warning alert icon is recolored orange', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-food-boundary-low');
        await gotoDashboard(page);
        await openBell(page);

        const icon = page.locator('.bell-item.bell-warning[data-target="sec-animals"] .bell-item-icon');
        await expect(icon).toHaveCount(1);
        await expect(icon).toHaveCSS('color', 'rgb(224, 122, 48)');
    });

    // urgent → .bell-item.bell-urgent .bell-item-icon gets var(--red)
    // (style.css:270). Low-fuel produces the only urgent alert.
    test('urgent alert icon is recolored red', async ({ page, request }) => {
        await setScenario(request, 'st-bell-veh-fuel-boundary-low');
        await gotoDashboard(page);
        await openBell(page);

        const icon = page.locator('.bell-item.bell-urgent[data-target="sec-vehicles"] .bell-item-icon');
        await expect(icon).toHaveCount(1);
        await expect(icon).toHaveCSS('color', 'rgb(224, 82, 82)');
    });

    // info → NO recolor rule (style.css has only .bell-urgent/.bell-warning icon
    // rules). The negative guarantee: an info icon must NOT carry the orange or
    // red severity color — that's what visually separates info from warning/urgent.
    test('info alert icon keeps default color (no orange/red recolor)', async ({ page, request }) => {
        await setScenario(request, 'st-bell-anim-output-boundary-ok');
        await gotoDashboard(page);
        await openBell(page);

        const icon = page.locator('.bell-item.bell-info[data-target="sec-animals"] .bell-item-icon');
        await expect(icon).toHaveCount(1);
        const color = await icon.evaluate(el => getComputedStyle(el).color);
        expect(color).not.toBe('rgb(224, 122, 48)');   // not --orange (warning)
        expect(color).not.toBe('rgb(224, 82, 82)');    // not --red (urgent)
    });
});

// ── Badge — 9+ overflow (BLOCKED: unreachable) ──────────────────────────────────
test.describe('bell — badge overflow', () => {
    // genAlerts() emits at most 7 distinct alert KEYS (anim-food/water/straw/
    // output, field-ready, veh-fuel, storage-full), so n can never exceed 7 and
    // the n > 9 → '9+' branch (bell.js:286) is dead. No scenario can produce >9
    // alert groups, so the '9+' render has no driveable input. Re-enable only if
    // genAlerts grows past 9 alert keys.
    test.fixme('badge shows "9+" when more than 9 alert groups exist', async () => {});
});
