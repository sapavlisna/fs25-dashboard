// vehicles.spec.js — FUNCTIONAL (non-screenshot) assertions over vehicle surface states.
// Documents the visual contract for fuel bar, condition badge, speed, engine hours,
// AI badge, AdBlue, implement summary/chips, and alert bell across multiple scenarios.
//
// Thresholds under test:
//   fuel bar:    pct <= 20 → danger · pct <= 50 → warn · pct >= 95 → full   (else none)
//   condition:   c >= 80 → c-green · c >= 50 → c-yellow · c < 50 → c-red
//   bell:        FUEL_LOW = 15 → vehicle joins 'veh-fuel' urgent alert (requires fuelCapacity>0)
//   isInUse:     true → dot-active + .in-use on row; false → dot-idle
//   speedKmh:    > 0 → .vc-speed element; <= 0 → hidden
//   engineHours: vehicleShowEngineHours!==false → .vc-mh element
//   AI badge:    aiTask truthy + vehicleShowWorkerBadge!==false → .vc-ai element
//   AdBlue:      adBlueCapacity truthy → .vc-fuel.has-adblue + ::after in expanded
//   impl summary: levelL<=0 || pct<=0 → '—' + c-muted; else pct>=90 → c-green · >=50 → none · <50 → c-muted
//   impl chips:   expanded mode, max 2 units + '+N'; active=(isInUse||aiTask) → tonáž/litry else %
//   active-only filter: vehiclesActiveOnly=true → !isInUse rows omitted from DOM; #cnt-vehicles still counts all

const { test, expect } = require('@playwright/test');

// ── helpers ───────────────────────────────────────────────────────────────────
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

function vehicleRow(page, name) {
    return page.locator('.vehicle-row', { has: page.locator('.vc-name', { hasText: name }) });
}

function fuelFill(page, name) {
    return vehicleRow(page, name).locator('.vc-fuel .bar-fill');
}

// ── scenario creators ─────────────────────────────────────────────────────────
async function setDashState(page, key, value) {
    await page.addInitScript(({ k, v }) => {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
    }, { k: `fs25.dash.v1.${key}`, v: value });
}

async function scenario(request, name) {
    await setScenario(request, name);
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('st-vehicles-fuel-bar-danger-vs-bell', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-fuel-bar-danger-vs-bell');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('fuel bar danger + bell not triggered in 15-20% band', async ({ page }) => {
        await gotoDashboard(page);

        // Fuel bar is danger (red) at 18%
        await expect(fuelFill(page, 'Fendt 942 Vario')).toHaveClass(/danger/);

        // But bell (FUEL_LOW=15) does NOT trigger because 18 >= 15
        const fuelAlert = page.locator('.bell-item.bell-urgent[data-target="sec-vehicles"]');
        await expect(fuelAlert).toHaveCount(0);

        // Healthy vehicle is fine
        await expect(fuelFill(page, 'CLAAS LEXION 8900')).not.toHaveClass(/danger|warn/);
    });
});

test.describe('st-vehicles-fuel-bar-boundary-danger-warn', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-fuel-bar-boundary-danger-warn');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('fuel bar danger at 20%, warn at 21%', async ({ page }) => {
        await gotoDashboard(page);

        await expect(fuelFill(page, 'Fendt 20%')).toHaveClass(/danger/);
        await expect(fuelFill(page, 'Fendt 20%')).not.toHaveClass(/warn/);

        await expect(fuelFill(page, 'Fendt 21%')).toHaveClass(/warn/);
        await expect(fuelFill(page, 'Fendt 21%')).not.toHaveClass(/danger/);
    });
});

test.describe('st-vehicles-fuel-bar-boundary-warn-ok', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-fuel-bar-boundary-warn-ok');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('fuel bar warn at 50%, ok at 51%', async ({ page }) => {
        await gotoDashboard(page);

        await expect(fuelFill(page, 'Fendt 50%')).toHaveClass(/warn/);
        await expect(fuelFill(page, 'Fendt 51%')).not.toHaveClass(/warn|danger/);
    });
});

test.describe('st-vehicles-fuel-bar-full-boundary', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-fuel-bar-full-boundary');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('fuel bar full at 95%, none at 94%', async ({ page }) => {
        await gotoDashboard(page);

        await expect(fuelFill(page, 'Fendt 95%')).toHaveClass(/full/);
        await expect(fuelFill(page, 'Fendt 94%')).not.toHaveClass(/full|warn|danger/);
    });
});

test.describe('st-vehicles-bell-lowfuel-boundary', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-bell-lowfuel-boundary');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('bell triggers at <15%, not at 15%', async ({ page }) => {
        await gotoDashboard(page);

        // Both have danger bar (pct<=20 → danger)
        await expect(fuelFill(page, 'Fendt 14%')).toHaveClass(/danger/);
        await expect(fuelFill(page, 'Fendt 15%')).toHaveClass(/danger/);

        // Only Fendt 14% (< FUEL_LOW=15) joins the bell; 15% is excluded (not < 15)
        const fuelAlert = page.locator('.bell-item.bell-urgent[data-target="sec-vehicles"]');
        await expect(fuelAlert).toHaveCount(1);
        // bell.js detail format: "Fendt 14% (14%)" — name + fuel pct
        await expect(fuelAlert.locator('.bell-item-detail')).toContainText('Fendt 14%');
        await expect(fuelAlert.locator('.bell-item-detail')).not.toContainText('Fendt 15%');

        await expect(page.locator('#bell-count')).toHaveText('1');
    });
});

test.describe('st-vehicles-bell-fuelcap-zero-trap', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-bell-fuelcap-zero-trap');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('zero-capacity vehicle bars danger but no bell', async ({ page }) => {
        await gotoDashboard(page);

        // Bar pinned to danger (0% → pct<=20)
        await expect(fuelFill(page, 'Fendt 0%')).toHaveClass(/danger/);

        // But no bell (fuelCapacity=0 excluded by bell.js:116)
        await expect(page.locator('.bell-item.bell-urgent[data-target="sec-vehicles"]')).toHaveCount(0);
        // Badge element always exists in DOM; with no alerts it is hidden, not removed.
        await expect(page.locator('#bell-count')).toBeHidden();
    });
});

test.describe('st-vehicles-condition-green-vs-yellow-boundary', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-condition-green-vs-yellow-boundary');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowCondition', v: true });
    });

    test('condition green at 80%, yellow at 79%', async ({ page }) => {
        await gotoDashboard(page);

        const cond80 = vehicleRow(page, 'Fendt 80%').locator('.vc-cond');
        const cond79 = vehicleRow(page, 'Fendt 79%').locator('.vc-cond');

        await expect(cond80).toHaveClass(/c-green/);
        await expect(cond79).toHaveClass(/c-yellow/);
    });
});

test.describe('st-vehicles-condition-yellow-vs-red-boundary', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-condition-yellow-vs-red-boundary');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowCondition', v: true });
    });

    test('condition yellow at 50%, red at 49%', async ({ page }) => {
        await gotoDashboard(page);

        const cond50 = vehicleRow(page, 'Fendt 50%').locator('.vc-cond');
        const cond49 = vehicleRow(page, 'Fendt 49%').locator('.vc-cond');

        await expect(cond50).toHaveClass(/c-yellow/);
        await expect(cond49).toHaveClass(/c-red/);
    });
});

test.describe('st-vehicles-condition-hidden', () => {
    test('condition hidden when toggle off', async ({ page, request }) => {
        // Real vehicles with a non-null condition; the toggle must suppress the badge.
        await setScenario(request, 'st-vehicles-condition-green-vs-yellow-boundary');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowCondition', v: false });

        await gotoDashboard(page);
        // Guard: the row really exists (avoids a vacuous toHaveCount(0)).
        await expect(vehicleRow(page, 'Fendt 80%')).toHaveCount(1);
        // vehicleShowCondition=false → .vc-cond not rendered (index.html:937).
        await expect(vehicleRow(page, 'Fendt 80%').locator('.vc-cond')).toHaveCount(0);
    });

    test('condition hidden when percent is null', async ({ page, request }) => {
        // scenarioVehiclesConditionNull emits one vehicle (Fendt NullCond) with
        // conditionPercent=null → the conditionPercent!=null guard (index.html:938)
        // suppresses .vc-cond even though vehicleShowCondition is on.
        await setScenario(request, 'st-vehicles-condition-null');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowCondition', v: true });

        await gotoDashboard(page);
        await expect(vehicleRow(page, 'Fendt NullCond')).toHaveCount(1);
        await expect(vehicleRow(page, 'Fendt NullCond').locator('.vc-cond')).toHaveCount(0);
    });
});

test.describe('st-vehicles-speed-shown-vs-hidden', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-speed-shown-vs-hidden');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehiclesActiveOnly', v: false });
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowCondition', v: true });
    });

    test('speed shown when moving, hidden when parked', async ({ page }) => {
        await gotoDashboard(page);

        // Speed visible (speedKmh=12 > 0)
        await expect(vehicleRow(page, 'Fendt Moving').locator('.vc-speed')).toHaveCount(1);
        await expect(vehicleRow(page, 'Fendt Moving').locator('.vc-speed')).toContainText('12 km/h');

        // Speed hidden (speedKmh=0)
        await expect(vehicleRow(page, 'Fendt Parked').locator('.vc-speed')).toHaveCount(0);
    });
});

test.describe('st-vehicles-engine-hours-toggle', () => {
    test('engine hours shown when toggle on', async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-engine-hours-toggle');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowEngineHours', v: true });

        await gotoDashboard(page);
        // Scenario Fendt 942 Vario has motorHours=315.5 → "315.5 mh"
        await expect(vehicleRow(page, 'Fendt 942 Vario').locator('.vc-mh')).toContainText('315.5 mh');
    });

    test('engine hours hidden when toggle off', async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-engine-hours-toggle');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowEngineHours', v: false });

        await gotoDashboard(page);
        await expect(vehicleRow(page, 'Fendt 942 Vario').locator('.vc-mh')).toHaveCount(0);
    });
});

test.describe('st-vehicles-dot-active-vs-idle', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-dot-active-vs-idle');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehiclesActiveOnly', v: false });
    });

    test('active dot and row highlight for in-use, idle for parked', async ({ page }) => {
        await gotoDashboard(page);

        const activeRow = vehicleRow(page, 'Fendt Active');
        const idleRow = vehicleRow(page, 'Fendt Idle');

        // Active has dot-active and .in-use class
        await expect(activeRow).toHaveClass(/in-use/);
        await expect(activeRow.locator('> span').first()).toHaveClass(/dot-active/);

        // Idle has dot-idle, no .in-use
        await expect(idleRow).not.toHaveClass(/in-use/);
        await expect(idleRow.locator('> span').first()).toHaveClass(/dot-idle/);
    });
});

test.describe('st-vehicles-active-only-filter', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-active-only-filter');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehiclesActiveOnly', v: true });
    });

    test('active-only filter hides idle rows but count shows all', async ({ page }) => {
        await gotoDashboard(page);

        // Only the in-use vehicle is rendered in the body
        await expect(page.locator('#vehicles-body .vehicle-row')).toHaveCount(1);
        await expect(vehicleRow(page, 'Fendt Active')).toBeVisible();

        // But count badge counts ALL vehicles (index.html:1130 → vehicles.length = 3)
        await expect(page.locator('#cnt-vehicles')).toHaveText('3');

        // Idle rows are filtered out entirely — not rendered into the DOM
        await expect(vehicleRow(page, 'Fendt Idle1')).toHaveCount(0);
        await expect(vehicleRow(page, 'Fendt Idle2')).toHaveCount(0);
    });
});

test.describe('st-vehicles-flash-up-down-impl', () => {
    test.beforeEach(async ({ page }) => {
        // flashEnabled is an object map keyed by section — NOT a string.
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.flashEnabled', v: { vehicles: true } });
    });

    test('row flashes up when implement fill % increases between ticks', async ({ page, request }) => {
        // Deterministic events scenario: tick0 trailer=50%, tick1 trailer=60% → impl
        // fill increase → getImplFlashCls returns ' flash-up' (index.html:647). The
        // class is applied on the *next* render after the increase arrives over WS,
        // so we keep the page connected (no reload) and poll until it appears.
        await setScenario(request, 'st-vehicles-flash-up-down-impl');
        await gotoDashboard(page);

        await page.waitForTimeout(5000);
        const row = vehicleRow(page, 'Fendt 942 Vario');
        await expect(row).toHaveClass(/flash-up/, { timeout: 8000 });
    });
});

test.describe('st-vehicles-ai-badge-shown-vs-hidden', () => {
    test('AI badge shown for vanilla/courseplay/autodrive', async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-ai-badge-shown-vs-hidden');
        await gotoDashboard(page);

        // All three AI-driven vehicles render the badge element (aiTask truthy +
        // vehicleShowWorkerBadge default on). Names per scenario: Fendt VM/CP/AD.
        await expect(vehicleRow(page, 'Fendt VM').locator('.vc-ai')).toHaveCount(1);
        await expect(vehicleRow(page, 'Fendt CP').locator('.vc-ai')).toHaveCount(1);
        await expect(vehicleRow(page, 'Fendt AD').locator('.vc-ai')).toHaveCount(1);

        // Badge always carries the robot glyph (aiTaskBadge prefixes '🤖 ').
        await expect(vehicleRow(page, 'Fendt VM').locator('.vc-ai')).toContainText('🤖');

        // Intended decoded content for the vanilla helper: aiTaskBadge reads
        // aiTask.source + aiTask.jobClass (mapped via AI_JOB_CS). With the
        // intended shape { source:'vanilla', jobClass:'FIELDWORK' } the badge
        // reads "🤖 Pole". (See scenarioFix — current scenario uses {type,label}.)
        await expect(vehicleRow(page, 'Fendt VM').locator('.vc-ai')).toContainText('Pole');
    });

    test('AI badge hidden when toggle off', async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-ai-badge-shown-vs-hidden');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowWorkerBadge', v: false });

        await gotoDashboard(page);
        // vehicleShowWorkerBadge=false suppresses the badge even though aiTask is truthy.
        await expect(vehicleRow(page, 'Fendt VM').locator('.vc-ai')).toHaveCount(0);
    });

    test('AI badge hidden when no aiTask', async ({ page, request }) => {
        // Idle vehicle without an aiTask — scenario Fendt Idle (no aiTask field).
        await setScenario(request, 'st-vehicles-dot-active-vs-idle');

        await gotoDashboard(page);
        await expect(vehicleRow(page, 'Fendt Idle').locator('.vc-ai')).toHaveCount(0);
    });
});

test.describe('st-vehicles-adblue-indicator-expanded', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-adblue-indicator-expanded');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehiclesExpanded', v: true });
    });

    test('adblue class on fuel bar in expanded mode, no bell for low adblue', async ({ page }) => {
        await gotoDashboard(page);

        // adBlueCapacity truthy → fuelCls 'vc-fuel has-adblue' (index.html:914).
        const fuelElem = vehicleRow(page, 'CLAAS Adblue').locator('.vc-fuel');
        await expect(fuelElem).toHaveClass(/has-adblue/);
        // AdBlue % is surfaced in the fuel cell title (index.html:919 → "· AdBlue 65 %").
        await expect(fuelElem).toHaveAttribute('title', /AdBlue 65 %/);

        // No bell — the bell watches fuelPercent only (fuelPercent=70 is fine,
        // adBluePercent is never monitored, bell.js:115-118).
        await expect(page.locator('.bell-item.bell-urgent')).toHaveCount(0);
    });
});

test.describe('st-vehicles-impl-summary-empty-vs-filled', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-impl-summary-empty-vs-filled');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehiclesExpanded', v: false });
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowEmptyImplements', v: true });
    });

    // Asserts against the INTENDED scenario (4 implements: 0% empty / 95% / 60% / 30%
    // on a single tractor). The registered scenario is currently aliased to a
    // no-implements scenario — see scenarioFix.
    test('impl summary shows empty as —, colors by percent', async ({ page }) => {
        await gotoDashboard(page);

        const summaryLines = vehicleRow(page, 'Traktor-impl').locator('.vc-impl-summary .vc-impl-line');
        await expect(summaryLines).toHaveCount(4);

        // Empty (0%)
        const line1 = summaryLines.nth(0);
        await expect(line1).toHaveClass(/c-muted/);
        await expect(line1).toHaveClass(/vc-impl-empty/);
        await expect(line1).toContainText('—');

        // 95% → green
        const line2 = summaryLines.nth(1);
        await expect(line2).toHaveClass(/c-green/);

        // 60% → no color
        const line3 = summaryLines.nth(2);
        await expect(line3).not.toHaveClass(/c-green|c-yellow|c-red|c-muted/);

        // 30% → muted
        const line4 = summaryLines.nth(3);
        await expect(line4).toHaveClass(/c-muted/);
    });
});

test.describe('st-vehicles-impl-virow-basic', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-impl-virow-basic');
        // Expanded view is where the full .v-implements stack renders on desktop
        // (BUG-03 fixed: .expanded-vehicles .v-implements is now display:flex).
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehiclesExpanded', v: true });
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowEmptyImplements', v: true });
    });

    test('vi-row colors and units per percent and capacity', async ({ page }) => {
        await gotoDashboard(page);

        const viRows = vehicleRow(page, 'Traktor-vi').locator('.v-implements .vi-row');
        await expect(viRows).toHaveCount(4);

        // 90% (tunáž) → green
        const row1num = viRows.nth(0).locator('.vi-num');
        await expect(row1num).toHaveClass(/c-green/);

        // 50% (litry, cap<1000) → no color
        const row2num = viRows.nth(1).locator('.vi-num');
        await expect(row2num).not.toHaveClass(/c-green|c-red|c-muted/);

        // 20% → muted
        const row3num = viRows.nth(2).locator('.vi-num');
        await expect(row3num).toHaveClass(/c-muted/);

        // Empty (0%, cap 5000) → label shows '—', num is muted and reads "0.0t / 5.0t".
        const row4 = viRows.nth(3);
        await expect(row4.locator('.vi-label')).toContainText('—');
        await expect(row4.locator('.vi-num')).toHaveClass(/c-muted/);
        await expect(row4.locator('.vi-num')).toContainText('0.0t / 5.0t');
    });
});

test.describe('st-vehicles-impl-chips-expanded', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'st-vehicles-impl-chips-expanded');
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehiclesExpanded', v: true });
        await page.addInitScript(({ k, v }) => {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
        }, { k: 'fs25.dash.v1.vehicleShowEmptyImplements', v: true });
    });

    // Asserts against the INTENDED scenario (in-use Fendt 942 Vario with one
    // implement carrying 3 fillUnits 50/25/12% → 2 chips + '+1'). Registered
    // scenario is currently aliased to a no-implements scenario — see scenarioFix.
    test('chips show max 2 units + overflow badge, active shows tons', async ({ page }) => {
        await gotoDashboard(page);

        // The '+N' overflow pill also carries the .vc-chip class (markup
        // 'vc-chip vc-chip-more'), so exclude it to count the real unit chips.
        const chips = vehicleRow(page, 'Fendt 942 Vario').locator('.vc-impl-chips .vc-chip:not(.vc-chip-more)');
        const moreChip = vehicleRow(page, 'Fendt 942 Vario').locator('.vc-impl-chips .vc-chip-more');

        await expect(chips).toHaveCount(2);
        await expect(moreChip).toHaveCount(1);
        await expect(moreChip).toContainText('+1');

        // Active mode (isInUse=true) → fmtLT shows tonnage (cap 24000 > 1000 → 't').
        await expect(chips.nth(0)).toContainText('t');
    });
});
