'use strict';
// A2 — db.js
// Izolace: přes env DASHBOARD_DATA_DIR → dočasný temp adresář.
// Každý test pracuje se svým vlastním DATA_DIR, aby cache db.js neinterferovala.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Nastavení temp adresáře před načtením db.js ─────────────────────────────
// db.js si při require() inicializuje cache z FILES na základě DATA_DIR,
// proto musíme env nastavit dříve než ho prvně require().
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fs25-db-'));
process.env.DASHBOARD_DATA_DIR = TMP;
process.env.NO_COLOR = '1';

// Clearujeme require cache pro čistý load s naším DATA_DIR
Object.keys(require.cache).forEach(k => {
    if (k.includes('db.js') || k.includes('config.js')) delete require.cache[k];
});

const db = require('../../db');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Minimální snapshot s jedním polem a balance
function makeSnapshot(overrides = {}) {
    return {
        gameDay:     1,
        farmBalance: 100000,
        fields:      [{ id: 1, owned: true, fruitName: 'WHEAT', growthPercent: 50, isReadyToHarvest: false }],
        prices:      [],
        events:      [],
        saveMeta:    { name: 'Test Save', mapTitle: 'Hof Erlengrat' },
        ...overrides,
    };
}

// ─── A2-1: in-memory cache — appendJsonl + getRows bez re-čtení disku ────────
test('A2-1: appendJsonl přidá řádek, getRows ho vrátí z RAM', () => {
    // db.js neexportuje appendJsonl ani getRows přímo,
    // ale saveSnapshot ho volá — ověříme přes getBalanceHistory.
    const snap1 = makeSnapshot({ gameDay: 100, farmBalance: 200000 });
    db.saveSnapshot(snap1);
    const hist = db.getBalanceHistory(5);
    assert.ok(hist.length >= 1, 'po saveSnapshot musí být alespoň 1 řádek v historii');
    const row = hist.find(r => r.game_day === 100);
    assert.ok(row, 'musí existovat řádek pro game_day=100');
    assert.equal(row.balance, 200000, 'balance musí odpovídat snapshotu');
});

// ─── A2-2: dedup eventů — stejný klíč timestamp|fieldId|type → jen 1 zápis ──
test('A2-2: dedup — stejný event 2× → uloží se jen jednou', () => {
    const ev = { timestamp: '2025-01-15T10:00:00Z', fieldId: 5, type: 'sowing', gameDay: 2, fruitName: 'WHEAT', area: 3.0 };
    const snap = makeSnapshot({ gameDay: 200, events: [ev] });
    db.saveSnapshot(snap);   // první zápis
    db.saveSnapshot({ ...makeSnapshot({ gameDay: 201 }), events: [ev] });   // druhý pokus se stejným eventem

    const events = db.getRecentEvents(100);
    const matches = events.filter(
        e => e.timestamp === ev.timestamp && e.field_id === ev.fieldId && e.type === ev.type,
    );
    assert.equal(matches.length, 1, `event musí být uložen právě jednou, got ${matches.length}`);
});

// ─── A2-3 (A-c): restart roundtrip — loadSeenEvents a dedup po restartu ─────
// Klíčová F1 predikce: db.js ukládá event s klíčem `fieldId`, ale při loadu
// ze souboru čte `field_id`. Pokud jsou různé, dedup po restartu selže.
test('A-c: dedup po simulovaném restartu — žádné duplicity z reloadu', () => {
    // Zapíšeme nový unikátní event
    const ts  = `restart-test-${Date.now()}`;
    const ev  = { timestamp: ts, fieldId: 42, type: 'harvest', gameDay: 3, fruitName: 'BARLEY', area: 2.0 };
    const snap = makeSnapshot({ gameDay: 300, events: [ev] });
    db.saveSnapshot(snap);

    // Simulace restartu: vymažeme require cache a načteme db znovu
    // (zachytíme stav JSONL souboru na disku)
    Object.keys(require.cache).forEach(k => {
        if (k.includes('db.js') || k.includes('config.js')) delete require.cache[k];
    });
    const db2 = require('../../db');

    // Pokusíme se zapsat stejný event přes novou instanci (post-restart load)
    const snap2 = makeSnapshot({ gameDay: 301, events: [ev] });
    db2.saveSnapshot(snap2);

    // Zkontrolujeme, kolik záznamů se zapsalo (oba mají stejný timestamp|fieldId|type)
    const events = db2.getRecentEvents(200);
    const matches = events.filter(
        e => e.timestamp === ts && e.field_id === ev.fieldId && e.type === ev.type,
    );
    // Klíčový assert: po restartu smí existovat právě 1 záznam.
    // Pokud jsou 2, bug A-c je POTVRZENÝ (klíč field_id vs fieldId nesedí).
    assert.equal(
        matches.length,
        1,
        `[A-c] po restartu smí event existovat právě jednou, got ${matches.length}. ` +
        'Pokud 2: loadSeenEvents čte field_id, ale seenEventKeys klíč používá fieldId → dedup selhává.',
    );
});

// ─── A2-4: maxGameDay s velkým polem — bez stack overflow ────────────────────
test('A2-4: maxGameDay 100k hodnot — žádný stack overflow', () => {
    // Simulujeme balancové řádky přímo přes seedHistory
    const rows = [];
    for (let i = 0; i < 100_000; i++) {
        rows.push({ game_day: i, balance: i * 100 });
    }
    // seedHistory přepíše balance.jsonl a obnoví cache
    db.seedHistory({ balance: rows, freezeDay: 100_001 });

    let hist;
    assert.doesNotThrow(() => {
        hist = db.getBalanceHistory(5);
    }, 'getBalanceHistory musí projít bez stack overflow');
    assert.ok(hist.length > 0, 'musí vrátit alespoň jeden řádek');
    const maxDay = hist[hist.length - 1].game_day;
    assert.ok(maxDay >= 99_994, `maxGameDay musí být blízko 99999, got ${maxDay}`);
});

// ─── A2-5: filterCurrentSave — 2 save_id → vrátí jen aktuální ───────────────
test('A2-5: filterCurrentSave vrátí jen řádky posledního save_id', () => {
    const rows = [
        { game_day: 1, balance: 1000, save_id: 'Stara Farma|Mapa1' },
        { game_day: 2, balance: 2000, save_id: 'Stara Farma|Mapa1' },
        { game_day: 3, balance: 3000, save_id: 'Nova Farma|Mapa2' },
    ];
    db.seedHistory({ balance: rows, freezeDay: 99999 });

    const hist = db.getBalanceHistory(100);
    const saveIds = [...new Set(hist.map(r => r.save_id))];
    assert.equal(saveIds.length, 1, `historii musí filtrovat na 1 save_id, got ${JSON.stringify(saveIds)}`);
    assert.equal(saveIds[0], 'Nova Farma|Mapa2', 'musí vrátit poslední (aktuální) save_id');
});

// ─── A2-6: getBalanceBefore — správná předchozí hodnota ──────────────────────
test('A2-6: getBalanceBefore vrátí správnou předchozí hodnotu pro deltu', () => {
    db.seedHistory({
        balance: [
            { game_day: 10, balance: 100_000 },
            { game_day: 11, balance: 120_000 },
            { game_day: 12, balance: 150_000 },
        ],
        freezeDay: 99999,
    });

    const before12 = db.getBalanceBefore(12);
    assert.ok(before12 !== null, 'musí najít předchozí řádek');
    assert.equal(before12.game_day, 11, 'musí vrátit game_day=11 (nejbližší před 12)');
    assert.equal(before12.balance, 120_000, 'balance musí být 120000');

    const before10 = db.getBalanceBefore(10);
    assert.equal(before10, null, 'před game_day=10 žádný záznam neexistuje → null');
});

// ─── A2-7 (BUG-02): eventy se tagují save_id → filtrovatelné na playthrough ──
// Před opravou saveEvents() save_id nezapisoval (jen saveSnapshot pro balance/prices/
// fields), takže eventy nešly omezit na aktuální savegame.
test('A2-7 (BUG-02): saveEvents taguje řádky save_id', () => {
    const ev = { timestamp: 'bug02-saveid-evt', fieldId: 7, type: 'sowing', gameDay: 4, fruitName: 'WHEAT', area: 1.0 };
    db.saveSnapshot(makeSnapshot({ gameDay: 400, events: [ev] }));
    const row = db.getRecentEvents(200).find(e => e.timestamp === ev.timestamp);
    assert.ok(row, 'event musí být uložen');
    assert.equal(
        row.save_id, 'Test Save|Hof Erlengrat',
        `event musí nést save_id playthrough (BUG-02 fix), got ${JSON.stringify(row.save_id)}`,
    );
});
