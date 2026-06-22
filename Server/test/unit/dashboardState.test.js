'use strict';
// A7 — dashboardState.js
// DashboardState je class s vlastním souborem. Izolace: temp adresář pro state file.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

process.env.NO_COLOR = '1';

const { DashboardState, NS, LOCAL_ONLY } = require('../../dashboardState');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fs25-dashstate-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function makeState(name = 'state.json') {
    return new DashboardState(path.join(TMP, name));
}

// ─── A7-1: merge/patch respektuje ALLOWED_KEYS whitelist ─────────────────────
test('A7-1: patch zahodí neznámý klíč', () => {
    const ds = makeState('a7-1.json');
    ds.patch({ theme: 'dark-green', unknownHackerKey: 'malicious' });
    const all = ds.getAll();
    assert.equal(all.theme, 'dark-green', 'theme musí být uloženo');
    assert.ok(!('unknownHackerKey' in all), 'neznámý klíč nesmí být uložen');
});

// ─── A7-2: null hodnota maže klíč ────────────────────────────────────────────
test('A7-2: patch(null) maže klíč', () => {
    const ds = makeState('a7-2.json');
    ds.patch({ theme: 'dark-blue' });
    assert.equal(ds.getAll().theme, 'dark-blue', 'theme musí být nastaven');

    ds.patch({ theme: null });
    assert.ok(!('theme' in ds.getAll()), 'theme musí být smazán po null patch');
});

// ─── A7-3: LOCAL_ONLY klíče projdou patch, ale ne persist ────────────────────
test('A7-3: LOCAL_ONLY klíče jsou filtrovány', () => {
    const ds = makeState('a7-3.json');
    // 'bell-dismissed' a 'syncMode' jsou LOCAL_ONLY
    ds.patch({ theme: 'light', 'bell-dismissed': 'session-123', syncMode: true });
    const all = ds.getAll();
    assert.equal(all.theme, 'light', 'theme musí projít');
    assert.ok(!('bell-dismissed' in all), 'bell-dismissed musí být odfiltrován');
    assert.ok(!('syncMode' in all), 'syncMode musí být odfiltrován');
});

// ─── A7-4: allowed prefix klíče jsou přijaty ─────────────────────────────────
test('A7-4: klíče s allowed prefixem (hidden:, order:, sort.) projdou', () => {
    const ds = makeState('a7-4.json');
    ds.patch({
        'hidden:vehicles':    ['Fendt 942'],
        'order:sections':     ['fields', 'vehicles'],
        'sort.fields':        'asc',
        'collapsed:animals':  true,
    });
    const all = ds.getAll();
    assert.deepEqual(all['hidden:vehicles'], ['Fendt 942'], 'hidden: prefix projde');
    assert.deepEqual(all['order:sections'], ['fields', 'vehicles'], 'order: prefix projde');
    assert.equal(all['sort.fields'], 'asc', 'sort. prefix projde');
    assert.equal(all['collapsed:animals'], true, 'collapsed: prefix projde');
});

// ─── A7-5: replaceAll nahradí celý stav ──────────────────────────────────────
test('A7-5: replaceAll kompletně nahradí stav', () => {
    const ds = makeState('a7-5.json');
    ds.patch({ theme: 'dark-green', lang: 'cs' });
    assert.equal(Object.keys(ds.getAll()).length, 2, 'po patch jsou 2 klíče');

    ds.replaceAll({ theme: 'high-contrast' });
    const all = ds.getAll();
    assert.equal(all.theme, 'high-contrast', 'nový theme musí být nastaven');
    assert.ok(!('lang' in all), 'lang musí být odstraněn po replaceAll');
    assert.equal(Object.keys(all).length, 1, 'musí existovat přesně 1 klíč');
});

// ─── A7-6: persist — stav se načte po restartu (re-create instance) ──────────
test('A7-6: stav přežije re-load instance (disk persistence)', () => {
    const filePath = path.join(TMP, 'a7-6.json');
    const ds1 = new DashboardState(filePath);
    ds1.patch({ theme: 'dark-blue', flashEnabled: { vehicles: true } });

    // Vytvoříme novou instanci ze stejného souboru → simulace restartu serveru
    const ds2 = new DashboardState(filePath);
    const all = ds2.getAll();
    assert.equal(all.theme, 'dark-blue', 'theme musí přežít re-load');
    assert.deepEqual(all.flashEnabled, { vehicles: true }, 'flashEnabled musí přežít re-load');
});

// ─── A7-7: patch vrátí diff (jen změněné klíče) ──────────────────────────────
test('A7-7: patch vrátí jen změněné klíče', () => {
    const ds = makeState('a7-7.json');
    ds.patch({ theme: 'dark-green', lang: 'en' });

    // Patch se stejnou hodnotou theme (nezměněno) + nová lang
    const changed = ds.patch({ theme: 'dark-green', lang: 'cs' });
    assert.ok(!('theme' in changed), 'theme se nezměnil → nesmí být v diff');
    assert.equal(changed.lang, 'cs', 'lang se změnil → musí být v diff');
});

// ─── A7-8: neznámé hodnoty (funkce) jsou odmítnuty ───────────────────────────
test('A7-8: isSaneValue odmítne funkci jako hodnotu', () => {
    const ds = makeState('a7-8.json');
    // Funkce jako hodnota musí být odfiltrována (isSaneValue → false)
    ds.patch({ theme: () => 'evil', lang: 'cs' });
    const all = ds.getAll();
    // Funkce je typeof 'function' → isSaneValue vrátí false → zahozen
    assert.ok(!('theme' in all), 'funkce jako hodnota musí být odmítnuta');
    assert.equal(all.lang, 'cs', 'validní hodnota musí projít');
});
