'use strict';
// A5 — config.js
// Testujeme funkci pick() přes exportované hodnoty.
// config.js čte env při require(), proto každý test vyčistí require cache
// a nastaví env před re-require.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_PATH = path.resolve(__dirname, '../../config.js');

// Pomocník: vyčistí require cache pro config a logger, nastaví env, načte config.
function loadConfig(envPatch = {}) {
    // Uložíme a dočasně přepíšeme env proměnné
    const saved = {};
    for (const [k, v] of Object.entries(envPatch)) {
        saved[k] = process.env[k];
        if (v === undefined) {
            delete process.env[k];
        } else {
            process.env[k] = v;
        }
    }

    // Vymažeme require cache
    for (const k of Object.keys(require.cache)) {
        if (k.includes('config.js') || k.includes('logger.js')) {
            delete require.cache[k];
        }
    }

    const cfg = require(CONFIG_PATH);

    // Obnovíme env
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) {
            delete process.env[k];
        } else {
            process.env[k] = v;
        }
    }

    return cfg;
}

// ─── A5-1: env var přebije default ───────────────────────────────────────────
test('A5-1: env DASHBOARD_PORT přebije default (3000)', () => {
    const cfg = loadConfig({ DASHBOARD_PORT: '4567' });
    assert.equal(cfg.PORT, 4567, `PORT musí být 4567, got ${cfg.PORT}`);
});

// ─── A5-2: prázdná env var → fallback na default ─────────────────────────────
test('A5-2: prázdná env var (DASHBOARD_PORT="") → default 3000', () => {
    const cfg = loadConfig({ DASHBOARD_PORT: '' });
    assert.equal(cfg.PORT, 3000, `prázdná env musí fallbackovat na 3000, got ${cfg.PORT}`);
});

// ─── A5-3: RELAY_ENABLED=false přes env → relay disabled ────────────────────
// Poznámka: prázdný env string '' nesplní pick() podmínku != '' → propadne do local JSON.
// Proto testujeme explicitní 'false' hodnotu, která přebije local JSON.
test('A5-3: RELAY_ENABLED=false přes env → relay_enabled false', () => {
    const cfg = loadConfig({ RELAY_ENABLED: 'false' });
    assert.equal(cfg.RELAY_ENABLED, false, 'RELAY_ENABLED=false musí vypnout relay');
});

// ─── A5-4: RELAY_URL nastavena → RELAY_ENABLED default true ──────────────────
test('A5-4: RELAY_URL nastavena → RELAY_ENABLED defaultně true', () => {
    const cfg = loadConfig({
        RELAY_URL: 'wss://example.com',
        RELAY_PUBLISH_KEY: 'testkey',
        RELAY_ENABLED: undefined,   // explicitně nevyplněno → default z konfigurace
    });
    assert.equal(cfg.RELAY_URL, 'wss://example.com');
    assert.equal(cfg.RELAY_ENABLED, true, 'relay_enabled musí být true když URL nastavena');
});

// ─── A5-5: probeDir na neexistující adresář → exists: false ──────────────────
test('A5-5: probeDir na neexistující dir → exists false, vše false/0', () => {
    const cfg = loadConfig({});
    const result = cfg.probeDir('/this/path/definitely/does/not/exist');
    assert.equal(result.exists, false, 'exists musí být false');
    assert.equal(result.dataFileExists, false);
    assert.equal(result.logFileExists, false);
    assert.equal(result.savegamesFound, 0);
});

// ─── A5-6: probeDir na existující prázdný adresář ────────────────────────────
test('A5-6: probeDir na prázdný existující dir → exists true, soubory false', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs25-cfg-probe-'));
    try {
        const cfg = loadConfig({});
        const result = cfg.probeDir(tmpDir);
        assert.equal(result.exists, true, 'exists musí být true');
        assert.equal(result.dataFileExists, false, 'dataFile neexistuje');
        assert.equal(result.logFileExists, false, 'logFile neexistuje');
        assert.equal(result.savegamesFound, 0, 'žádné savegame složky');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// ─── A5-7: probeDir detekuje savegame složky ─────────────────────────────────
test('A5-7: probeDir počítá savegameN složky', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs25-cfg-probe2-'));
    try {
        fs.mkdirSync(path.join(tmpDir, 'savegame1'));
        fs.mkdirSync(path.join(tmpDir, 'savegame2'));
        fs.mkdirSync(path.join(tmpDir, 'savegame10'));
        fs.writeFileSync(path.join(tmpDir, 'log.txt'), '');

        const cfg = loadConfig({});
        const result = cfg.probeDir(tmpDir);
        assert.equal(result.exists, true);
        assert.equal(result.savegamesFound, 3, 'musí najít 3 savegame složky');
        assert.equal(result.logFileExists, true, 'log.txt musí být detekován');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
