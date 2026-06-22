'use strict';
// A1 — validate-json.js
// Skript je CLI (process.exit). Spouštíme ho jako child process s dočasným JSON.
// Každý test = konkrétní assert na exit kódu a/nebo stdout.

const { test, after } = require('node:test');
const assert  = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const TMP   = fs.mkdtempSync(path.join(os.tmpdir(), 'fs25-val-'));
const SCRIPT = path.resolve(__dirname, '../../scripts/validate-json.js');
const SERVER_DIR = path.resolve(__dirname, '../..');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Pomocník: zapíše payload do dočasného souboru a spustí validátor.
// Vrací { exitCode, stdout }. Deterministický monotonní čítač místo Date.now()/Math.random().
let _seq = 0;
function run(payload) {
    const f = path.join(TMP, `p-${++_seq}.json`);
    fs.writeFileSync(f, JSON.stringify(payload));
    const r = spawnSync(
        process.execPath,
        [SCRIPT, f],
        {
            cwd: SERVER_DIR,
            env: {
                ...process.env,
                NO_COLOR: '1',
                // Izolujeme od reálného DATA_DIR a FS25_DOCS_DIR
                DASHBOARD_DATA_DIR: TMP,
                FS25_DOCS_DIR: TMP,
            },
            encoding: 'utf8',
        },
    );
    return { exitCode: r.status, stdout: r.stdout || '' };
}

// Minimální validní payload (základ pro ostatní testy)
function validPayload(overrides = {}) {
    return {
        exportedAt:  '2025-01-01T00:00:00Z',
        gameDay:     10,
        gameTime:    600,
        farmBalance: 500000,
        fields:      [],
        storage:     [],
        prices:      [],
        animals:     [],
        vehicles:    [],
        ...overrides,
    };
}

// ─── A1-1: validní payload → exit 0 ─────────────────────────────────────────
test('A1-1: validní payload projde bez chyb', () => {
    const { exitCode } = run(validPayload());
    assert.equal(exitCode, 0);
});

// ─── A1-2: growthPercent mimo rozsah ────────────────────────────────────────
test('A1-2: growthPercent=101 → error (max 100)', () => {
    const p = validPayload({
        fields: [{ id: 1, owned: true, growthPercent: 101, growthState: 0 }],
    });
    const { exitCode, stdout } = run(p);
    assert.equal(exitCode, 1);
    assert.ok(stdout.includes('growthPercent'), `očekáváme zmínku growthPercent ve výstupu, got: ${stdout}`);
});

test('A1-2b: growthPercent=-1 → error', () => {
    const p = validPayload({
        fields: [{ id: 1, owned: true, growthPercent: -1, growthState: 0 }],
    });
    const { exitCode } = run(p);
    assert.equal(exitCode, 1);
});

test('A1-2c: growthPercent=0 a 100 → OK (hraniční hodnoty)', () => {
    const p = validPayload({
        fields: [
            { id: 1, owned: true, growthPercent: 0,   growthState: 0 },
            { id: 2, owned: true, growthPercent: 100,  growthState: 0 },
        ],
    });
    const { exitCode } = run(p);
    assert.equal(exitCode, 0);
});

// ─── A1-3: fuelPercent hranice ───────────────────────────────────────────────
test('A1-3: fuelPercent=100 → OK', () => {
    const p = validPayload({
        vehicles: [{ name: 'Fendt', fuelCapacity: 200, fuelPercent: 100 }],
    });
    const { exitCode } = run(p);
    assert.equal(exitCode, 0);
});

test('A1-3b: fuelPercent=101 → error', () => {
    const p = validPayload({
        vehicles: [{ name: 'Fendt', fuelCapacity: 200, fuelPercent: 101 }],
    });
    const { exitCode } = run(p);
    assert.equal(exitCode, 1);
});

// ─── C-b: chybějící exportedAt → error ──────────────────────────────────────
// Lua mód exportedAt nezapisuje (DashboardExport.lua). Ověřujeme řádek :38.
test('C-b: chybějící exportedAt → validátor hlásí error (validate-json.js:38)', () => {
    const p = validPayload();
    delete p.exportedAt;    // bez exportedAt — jako reálná Lua payload
    const { exitCode, stdout } = run(p);
    assert.equal(exitCode, 1, 'validátor musí odmítnout payload bez exportedAt');
    assert.ok(stdout.includes('exportedAt'), `výstup musí jmenovat exportedAt, got: ${stdout}`);
});

// ─── C-d (BUG-04 OPRAVENO): vozidlo s fuelCapacity:0 (vozík bez motoru) ──────
// DashboardExport.lua:1239 posílá fuelCapacity:0 pro vozíky/přívěsy bez motoru.
// Oprava: validate-json.js přijímá fuelCapacity >= 0 (0 = bez nádrže), ale guard
// musí dál chytat záporné/nečíselné hodnoty.
test('C-d (BUG-04): fuelCapacity=0 je přijato; záporné stále chyba', () => {
    const ok = run(validPayload({
        vehicles: [{ name: 'Přepravní vozík', fuelCapacity: 0, fuelPercent: 0 }],
    }));
    assert.equal(ok.exitCode, 0, `fuelCapacity=0 (vozík bez motoru) musí projít, výstup: ${ok.stdout}`);

    const bad = run(validPayload({
        vehicles: [{ name: 'Rozbitý', fuelCapacity: -5, fuelPercent: 0 }],
    }));
    assert.equal(bad.exitCode, 1, 'záporná fuelCapacity musí stále selhat (guard nesmí být vypnutý)');
    assert.ok(bad.stdout.includes('fuelCapacity'), `výstup musí jmenovat fuelCapacity, got: ${bad.stdout}`);
});

// ─── C-c (BUG-03 OPRAVENO): zvíře bez waterPercent (auto-water stáj) ─────────
// DashboardExport.lua waterPercent pro auto-water stáje (prasata/slepice) nezapisuje.
// Oprava: inRangeOpt toleruje chybějící hodnotu, ale přítomná mimo rozsah dál chybuje.
test('C-c (BUG-03): chybějící waterPercent je přijato; mimo rozsah stále chyba', () => {
    const ok = run(validPayload({
        animals: [{ foodPercent: 85, productivity: 90, count: 10 }],   // waterPercent chybí
    }));
    assert.equal(ok.exitCode, 0, `chybějící waterPercent (auto-water stáj) musí být tolerováno, výstup: ${ok.stdout}`);

    const bad = run(validPayload({
        animals: [{ foodPercent: 85, waterPercent: 150, productivity: 90, count: 10 }],
    }));
    assert.equal(bad.exitCode, 1, 'waterPercent=150 musí stále selhat');
    assert.ok(bad.stdout.includes('waterPercent'), `výstup musí jmenovat waterPercent, got: ${bad.stdout}`);
});
