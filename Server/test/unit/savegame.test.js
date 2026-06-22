'use strict';
// A3 — savegame.js
// Testujeme čisté parsovací funkce přes fixture XML soubory v temp adresáři.
// savegame.js exportuje readFieldsXml/readFarmlandXml nepřímo — callujeme
// přes volající vrstvu (re-require s vlastním saveDir) nebo testujeme parseAttrs.
// Funkce readFieldsXml a readFarmlandXml nejsou exportovány, ale refresh() ano.
// Strategii: require savegame, napsat fixture do temp dir, zavolat refresh()
// a zkontrolovat getFields() / getFarmlands() / getMeta().

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// Musíme nastavit env PŘED require, aby config.js četl správné cesty.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fs25-savegame-'));
const SAVEDIR = path.join(TMP, 'savegame1');
fs.mkdirSync(SAVEDIR, { recursive: true });

// Falešný log.txt, který odkáže na savegame1/
// Regex v detectSaveDir: /[\/\\]savegame(\d+)[\/\\]/ — vyžaduje lomítko PŘED i ZA.
const LOG_CONTENT = '2025-01-01 Loading: /savegame1/fields.xml loaded ok\n';
const LOG_FILE = path.join(TMP, 'log.txt');
fs.writeFileSync(LOG_FILE, LOG_CONTENT);

process.env.FS25_DOCS_DIR       = TMP;
process.env.FS25_LOG_FILE       = LOG_FILE;
process.env.SAVEGAME_REFRESH_MS = '999999';  // interval nespouštíme v testech
process.env.NO_COLOR            = '1';
process.env.DASHBOARD_DATA_DIR  = TMP;

// Vyčistíme require cache pro čistý load
Object.keys(require.cache).forEach(k => {
    if (k.includes('savegame.js') || k.includes('config.js')) delete require.cache[k];
});

// savegame.js spouští setInterval(refresh) při require(), který drží event loop.
// Zachytíme handle, abychom ho v teardownu zrušili — místo process.exit(), který
// by mohl přerušit další test soubory běžící ve stejném `node --test` procesu.
const _origSetInterval = global.setInterval;
let _savegameInterval = null;
global.setInterval = (fn, ms, ...args) => {
    const h = _origSetInterval(fn, ms, ...args);
    _savegameInterval = h;
    return h;
};
const savegame = require('../../savegame');
global.setInterval = _origSetInterval;

after(() => {
    if (_savegameInterval) clearInterval(_savegameInterval);
    fs.rmSync(TMP, { recursive: true, force: true });
});

// ─── A3-1: readFieldsXml — parsování fixture fields.xml ─────────────────────
test('A3-1: readFieldsXml vrátí Map s parsovanými atributy', () => {
    const fieldsXml = `<?xml version="1.0"?>
<fields>
  <field id="1" fruitType="WHEAT" growthState="3" sprayLevel="2" weedState="1" plowLevel="1" limeLevel="1" groundType="CULTIVATED" plannedFruit="" lastGrowthState="2" stoneLevel="0" sprayType="" rollerLevel="0" stubbleShredLevel="0" waterLevel="0"/>
  <field id="2" fruitType="MAIZE" growthState="5" sprayLevel="0" weedState="0" plowLevel="0" limeLevel="0" groundType="" plannedFruit="CANOLA" lastGrowthState="0" stoneLevel="0" sprayType="" rollerLevel="0" stubbleShredLevel="0" waterLevel="0"/>
  <field id="3" growthState="0" sprayLevel="0" weedState="0" plowLevel="0" limeLevel="0" groundType="" plannedFruit="" lastGrowthState="0" stoneLevel="0" sprayType="" rollerLevel="0" stubbleShredLevel="0" waterLevel="0"/>
</fields>`;
    fs.writeFileSync(path.join(SAVEDIR, 'fields.xml'), fieldsXml);

    savegame.refresh();   // synchronní — nevyžaduje live game
    const fields = savegame.getFields();

    assert.ok(fields instanceof Map, 'getFields musí vrátit Map');
    assert.equal(fields.size, 3, 'musí naparsovat 3 pole (včetně pole bez fruitType)');

    const f1 = fields.get(1);
    assert.ok(f1, 'pole id=1 musí existovat');
    assert.equal(f1.fruitType,   'WHEAT', 'fruitType pole 1');
    assert.equal(f1.growthState, 3,       'growthState pole 1');
    assert.equal(f1.sprayLevel,  2,       'sprayLevel pole 1');
    assert.equal(f1.weedState,   1,       'weedState pole 1');
    assert.equal(f1.plowLevel,   1,       'plowLevel pole 1');

    const f2 = fields.get(2);
    assert.equal(f2.fruitType,    'MAIZE',  'fruitType pole 2');
    assert.equal(f2.plannedFruit, 'CANOLA', 'plannedFruit pole 2');

    const f3 = fields.get(3);
    assert.equal(f3.fruitType, '', 'pole bez fruitType → prázdný string');
});

// ─── A3-2: readFarmlandXml → Map<farmlandId, farmId> ────────────────────────
test('A3-2: readFarmlandXml vrátí správnou Map farmland→farmId', () => {
    const farmlandXml = `<?xml version="1.0"?>
<farmlands>
  <farmland id="1" farmId="1"/>
  <farmland id="7" farmId="2"/>
  <farmland id="99" farmId="1"/>
</farmlands>`;
    fs.writeFileSync(path.join(SAVEDIR, 'farmland.xml'), farmlandXml);

    savegame.refresh();
    const farmlands = savegame.getFarmlands();

    assert.ok(farmlands instanceof Map, 'getFarmlands musí vrátit Map');
    assert.equal(farmlands.size, 3, 'musí naparsovat 3 záznamy');
    assert.equal(farmlands.get(1),  1, 'farmland 1 → farmId 1');
    assert.equal(farmlands.get(7),  2, 'farmland 7 → farmId 2');
    assert.equal(farmlands.get(99), 1, 'farmland 99 → farmId 1');
});

// ─── A3-3: parseAttrs — přímé testování přes veřejně dostupné chování ────────
// parseAttrs není exportováno, ale jeho výsledky vidíme přes readFieldsXml.
// Testujeme edge case: atributy s číselnými hodnotami a prázdnými stringy.
test('A3-3: parseAttrs správně parsuje atributy (přes readFieldsXml)', () => {
    const xml = `<?xml version="1.0"?>
<fields>
  <field id="42" fruitType="" growthState="0" sprayLevel="0" weedState="9" plowLevel="0" limeLevel="0" groundType="GRASS" plannedFruit="" lastGrowthState="0" stoneLevel="3" sprayType="" rollerLevel="0" stubbleShredLevel="0" waterLevel="5"/>
</fields>`;
    fs.writeFileSync(path.join(SAVEDIR, 'fields.xml'), xml);
    savegame.refresh();

    const f = savegame.getFields().get(42);
    assert.ok(f, 'pole id=42 musí existovat');
    assert.equal(f.weedState,   9, 'weedState=9 (max)');
    assert.equal(f.stoneLevel,  3, 'stoneLevel=3');
    assert.equal(f.waterLevel,  5, 'waterLevel=5');
    assert.equal(f.groundType,  'GRASS', 'groundType string');
    assert.equal(f.fruitType,   '',      'prázdný fruitType → ""');
});

// ─── A3-4: log bez savegameN/ → getFields() vrátí null ──────────────────────
// Dokládá robustnost: bez save dir server nespadne, jen vrátí null.
test('A3-4: log bez savegameN/ → getFields vrátí null', () => {
    // Přepíšeme log.txt tak, aby neobsahoval žádnou savegame referenci
    fs.writeFileSync(LOG_FILE, 'INFO: Starting game...\nINFO: No save loaded yet.\n');

    // Smažeme fields.xml, aby refresh nenašel nic ani z předchozího testu
    try { fs.unlinkSync(path.join(SAVEDIR, 'fields.xml')); } catch (_) {}

    savegame.refresh();
    const fields = savegame.getFields();
    assert.equal(fields, null, 'bez aktivního save dir musí getFields vrátit null');
});

// ─── A3-5: careerSavegame.xml — parsování meta dat ───────────────────────────
test('A3-5: readCareerSavegameXml vrátí správná meta data', () => {
    // Obnovíme log s validním savegame1 odkazem (musí mít lomítko PŘED i ZA savegameN)
    fs.writeFileSync(LOG_FILE, `INFO: Loading /savegame1/careerSavegame.xml loaded ok\n`);

    const careerXml = `<?xml version="1.0"?>
<careerSavegame>
  <settings>
    <savegameName>Hof Erlengrat</savegameName>
    <mapId>FS25_MAP_EU</mapId>
    <mapTitle>Hof Erlengrat</mapTitle>
    <creationDate>2025-01-01</creationDate>
    <saveDate>2025-06-15</saveDate>
    <saveDateFormatted>15. 6. 2025</saveDateFormatted>
    <economicDifficulty>2</economicDifficulty>
  </settings>
</careerSavegame>`;
    fs.mkdirSync(SAVEDIR, { recursive: true });
    fs.writeFileSync(path.join(SAVEDIR, 'careerSavegame.xml'), careerXml);

    savegame.refresh();
    const meta = savegame.getMeta();

    assert.ok(meta, 'getMeta musí vrátit objekt');
    assert.equal(meta.name,     'Hof Erlengrat', 'name ze savegameName');
    assert.equal(meta.mapId,    'FS25_MAP_EU',   'mapId');
    assert.equal(meta.mapTitle, 'Hof Erlengrat', 'mapTitle');
    assert.equal(meta.saveDate, '2025-06-15',    'saveDate');
});
