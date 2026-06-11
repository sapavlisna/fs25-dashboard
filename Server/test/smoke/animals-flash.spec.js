// Isolation tests for animal parameter flash.
//
// Each parameter (food, straw, milk, manure, slurry, health, repro, count)
// is tested independently — only that one value changes between ticks so a
// flash triggered by a different parameter cannot mask a missing flash on the
// tested one.
//
// Sequence per parameter:
//   1. Write base data → load page → wait for first WS tick (sets flashPrev)
//   2. Write data with ONLY the target param changed upward
//      → assert flash-up appears on the correct element
//      → assert no flash on ANY other element in the row
//   3. Reload page (WS connect delivers current value, flashPrev resets)
//   4. Write data with ONLY the target param changed downward
//      → assert flash-down appears on the correct element
//      → assert no flash on ANY other element in the row
//
// Config: playwright.flash.config.js   (port 3098, no mock-data.js)
// Run:    npx playwright test --config=test/smoke/playwright.flash.config.js

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Loaded from global-setup env
const MOCK_FILE = process.env.__FLASH_MOCK_FILE;

const { buildBaseData, buildKravin } = require('./flash-global-setup');

const ANIMAL = 'Kravín (farma)';
const ROW    = `[data-animal-name="${ANIMAL}"]`;
const BASE   = 50;   // baseline % for all params
const DELTA  = 15;   // how much to move each tick

// ─── Parameter definitions ────────────────────────────────────────────────────
//  field:    key in the animal object to mutate
//  litField: companion liters field (recalculated from %)
//  capField: capacity field (determines liter scale)
//  target:   Playwright selector of the element expected to carry flash class
//  others:   selectors of elements that must NOT flash when this param changes

const INPUT_LABELS = ['Krmivo', 'Podestýlka'];
const OUTPUT_LABELS = ['Mléko', 'Hnůj', 'Kejda'];
const ALL_LABELS = [...INPUT_LABELS, ...OUTPUT_LABELS];

function barSel(title) {
    return `${ROW} .ac-bar-lbl[title="${title}"]`;
}
function otherBars(excluded) {
    return ALL_LABELS.filter(l => l !== excluded).map(barSel);
}

const PARAMS = [
    {
        id: 'food',
        field: 'foodPercent', litField: 'foodLiters', capField: 'foodCapacity',
        target: barSel('Krmivo'),
        noFlashOn: [...otherBars('Krmivo'), `${ROW} .ac-sub-val`, `${ROW} .ac-repro-badge`],
    },
    {
        id: 'straw',
        field: 'strawPercent', litField: 'strawLiters', capField: 'strawCapacity',
        target: barSel('Podestýlka'),
        noFlashOn: [...otherBars('Podestýlka'), `${ROW} .ac-sub-val`, `${ROW} .ac-repro-badge`],
    },
    {
        id: 'milk',
        field: 'milkPercent', litField: 'milkLiters', capField: 'milkCapacity',
        target: barSel('Mléko'),
        noFlashOn: [...otherBars('Mléko'), `${ROW} .ac-sub-val`, `${ROW} .ac-repro-badge`],
    },
    {
        id: 'manure',
        field: 'manurePercent', litField: 'manureLiters', capField: 'manureCapacity',
        target: barSel('Hnůj'),
        noFlashOn: [...otherBars('Hnůj'), `${ROW} .ac-sub-val`, `${ROW} .ac-repro-badge`],
    },
    {
        id: 'slurry',
        field: 'liquidManurePercent', litField: 'liquidManureLiters', capField: 'liquidManureCapacity',
        target: barSel('Kejda'),
        noFlashOn: [...otherBars('Kejda'), `${ROW} .ac-sub-val`, `${ROW} .ac-repro-badge`],
    },
    {
        id: 'health',
        field: 'productivity',
        target: `${ROW} .ac-sub-val`,
        // bars must not flash when only health changes
        noFlashOn: [...ALL_LABELS.map(barSel), `${ROW} .ac-repro-badge`],
    },
    {
        id: 'repro',
        field: 'reproductionPercent',
        target: `${ROW} .ac-repro-badge`,
        noFlashOn: [...ALL_LABELS.map(barSel), `${ROW} .ac-sub-val`],
    },
    {
        id: 'count',
        // count flash → whole row background, not an inner element
        field: 'count',
        intField: true,
        baseVal: 5, upVal: 8, downVal: 2,
        target: ROW,
        // when whole row flashes, bar labels and sub-vals must not independently flash
        noFlashOn: [...ALL_LABELS.map(barSel), `${ROW} .ac-sub-val`, `${ROW} .ac-repro-badge`],
        rowFlash: true,
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeData(overrides) {
    const animal = buildKravin(BASE, overrides);
    fs.writeFileSync(MOCK_FILE, JSON.stringify(buildBaseData(BASE, animal)), 'utf8');
}

// Waits for the animal row to be visible (confirms at least one WS tick arrived).
async function waitForRow(page) {
    await page.waitForSelector(ROW, { timeout: 8000 });
}

// Waits up to `ms` for `selector` to have `cls` class.
async function waitForFlashClass(page, selector, cls, ms = 5000) {
    await page.waitForFunction(
        ({ sel, c }) => {
            const el = document.querySelector(sel);
            return el && el.classList.contains(c);
        },
        { sel: selector, c: cls },
        { timeout: ms },
    );
}

// Returns true if any element matching `selector` currently has `cls`.
async function hasFlash(page, selector, cls) {
    return page.evaluate(
        ({ sel, c }) => {
            const el = document.querySelector(sel);
            return !!(el && el.classList.contains(c));
        },
        { sel: selector, c: cls },
    );
}

// ─── Override buildBaseData to accept a pre-built animal ─────────────────────

// (flash-global-setup exports buildBaseData(pct) but we need to swap the animal)
function buildData(animal) {
    return {
        modVersion: '0.0.0', schemaVersion: 1,
        farmBalance: 100000, gameSettings: {},
        availableFruits: [], fields: [], vehicles: [], storage: [], productions: [], prices: [],
        animals: [animal],
    };
}

function write(overrides) {
    const animal = buildKravin(BASE, overrides);
    fs.writeFileSync(MOCK_FILE, JSON.stringify(buildData(animal)), 'utf8');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Animal parameter flash isolation', () => {
    for (const param of PARAMS) {
        test(`${param.id}: flash-up on increase, flash-down on decrease`, async ({ page }) => {

            const baseVal  = param.baseVal  ?? BASE;
            const upVal    = param.upVal    ?? (BASE + DELTA);
            const downVal  = param.downVal  ?? (BASE - DELTA);

            // ── Phase 1: increase → flash-up ─────────────────────────────────
            // Write base data, load page, wait for first WS tick (sets flashPrev).
            write({});
            await page.goto('/');
            await waitForRow(page);

            // Change ONLY this param upward.
            const upOverride = param.litField
                ? {
                    [param.field]:    upVal,
                    [param.litField]: Math.round(upVal * (buildKravin(BASE)[param.capField] / 100)),
                  }
                : { [param.field]: upVal };
            write(upOverride);

            // The flash class should appear on the target element.
            const flashUpClass = param.rowFlash ? 'flash-up' : 'flash-up';
            await waitForFlashClass(page, param.target, 'flash-up');

            // Verify flash is on the CORRECT element.
            await expect(page.locator(param.target)).toHaveClass(/flash-up/);

            // Verify no other animal-parameter elements in the row are flashing.
            for (const sel of (param.noFlashOn || [])) {
                const el = page.locator(sel).first();
                if (await el.count() > 0) {
                    await expect(el).not.toHaveClass(/flash-up/,   { timeout: 500 });
                    await expect(el).not.toHaveClass(/flash-down/, { timeout: 500 });
                }
            }

            // ── Phase 2: decrease → flash-down ───────────────────────────────
            // Reload so WS connect delivers the current (up) value → flashPrev = upVal.
            // Then write downVal → change detected → flash-down fires.
            await page.reload();
            await waitForRow(page);

            const downOverride = param.litField
                ? {
                    [param.field]:    downVal,
                    [param.litField]: Math.round(downVal * (buildKravin(BASE)[param.capField] / 100)),
                  }
                : { [param.field]: downVal };
            write(downOverride);

            await waitForFlashClass(page, param.target, 'flash-down');

            await expect(page.locator(param.target)).toHaveClass(/flash-down/);

            for (const sel of (param.noFlashOn || [])) {
                const el = page.locator(sel).first();
                if (await el.count() > 0) {
                    await expect(el).not.toHaveClass(/flash-up/,   { timeout: 500 });
                    await expect(el).not.toHaveClass(/flash-down/, { timeout: 500 });
                }
            }
        });
    }
});
