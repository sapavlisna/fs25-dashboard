# FS25 Dashboard — Developer Guide

Living document. Updated 2026-05-24 (QA pass, viz `QA-PLAN.md`).

For end-user instructions see `USER-GUIDE.md`. For known bugs see `BUGS-2026-05.md`.

---

## 1. Architektura — tři vrstvy

```
┌─────────────────────────────────────────────────────────────┐
│  FS25 (Lua mod)                                             │
│  src/Dashboard/FS25/DashboardExport.lua                     │
│                                                             │
│  • addModEventListener → tick every 2 s (EXPORT_PERIOD)     │
│  • Reads g_currentMission, g_farmlandManager, g_fieldManager,│
│    g_animalManager, g_fruitTypeManager, vehicleSystem.       │
│  • Pure-Lua JSON encoder (no deps).                          │
│  • Writes JSON snapshot to dashboard_data.json in            │
│    UserProfileAppPath (~/Documents/My Games/FS25/).          │
└────────────────────────────┬────────────────────────────────┘
                             │ JSON file on disk
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Node.js server (src/Dashboard/Server/)                     │
│                                                             │
│  • chokidar watches dashboard_data.json                     │
│  • enrich() merges live data with savegame XML readings     │
│  • db.js appends to data/*.jsonl (history)                  │
│  • broadcasts via WebSocket to all connected clients         │
│  • serves static /public + REST endpoints (/api/*)           │
└──────────────────┬─────────────────────────┬────────────────┘
                   │ WebSocket               │ REST
                   ▼                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Browser (src/Dashboard/Server/public/)                     │
│                                                             │
│  Vanilla JS, no bundler. Five HTML pages share a common     │
│  module stack:                                              │
│    app.js · state.js · serverSync.js · theme.js · bell.js · │
│    notifications.js · tabletools.js · crop-icons.js ·       │
│    money.js · sortable.js                                   │
│                                                             │
│  Pages: /, /calendar.html, /profit.html, /history.html,     │
│         /help.html                                          │
└─────────────────────────────────────────────────────────────┘
```

**Žádná databáze.** Historie v append-only JSONL souborech (`data/*.jsonl`). Načítají se do paměti při startu, append-only zápisy na disk.

**XML přepisuje live mod data.** `fields.xml` je autoritativní pro persistentní vlastnosti polí (typ plodiny, spray/lime/plow úroveň). `savegame.js` znovuparsuje každých 30 s.

---

## 2. Backend — `src/Dashboard/Server/`

### `index.js` (364 ř.) — Express + WS + watcher

| Endpoint | Účel |
|---|---|
| `GET /api/current` | Aktuální snapshot z `dashboard_data.json` |
| `GET /api/dashboard-state` | Server-side preferences (theme, hidden, …) |
| `PUT /api/dashboard-state` | Replace celého state blobu |
| `PATCH /api/dashboard-state` | Partial update (delta broadcast přes WS) |
| `GET /api/history/prices?fillType=X&sellPoint=Y&days=N` | JSONL agregát ceny |
| `GET /api/history/balance?days=N` | Denní zůstatek |
| `GET /api/history/fields?ids=…` | Profit per pole |
| `GET /api/history/events?limit=N` | Recent events |
| `GET /api/history/options` | Available fillTypes + sellPoints (pro dropdowny) |

**WS broadcast topology:**
- `chokidar.on('change', …)` při změně `dashboard_data.json` → `enrich(data)` → `wss.clients.forEach(ws => ws.send(json))`
- `app.patch('/api/dashboard-state', …)` → `broadcastStatePatch({ __dashboardStatePatch: { …diff } })`

**Schema check:** mod stamps `schemaVersion`, server warní když mimo `MIN_MOD_SCHEMA=1..MAX_MOD_SCHEMA=1`. Viz `COMPATIBILITY.md`.

### `db.js` (275 ř.) — JSONL append-only history

Soubory v `DATA_DIR/`:
- `balance.jsonl` — `{ gameDay, balance, ts }` per den
- `prices.jsonl` — `{ gameDay, fillType, sellPoint, pricePerTon, ts }`
- `fields.jsonl` — per pole snapshot stavu
- `events.jsonl` — `{ key, type: sow|harvest|sale, fieldId, ts, ... }` (deduped by `timestamp|fieldId|type`)

API:
- `saveSnapshot(data)` — zápis denních snímků + new events (idempotent)
- `getPriceHistory(fillType, sellPoint, days)` — sorted desc by gameDay
- `getBalanceHistory(days)` — denní zůstatek
- `getFieldProfit(fieldIds)` — cost/revenue per field (sow=cost, harvest=revenue)
- `getRecentEvents(limit)` — last N events
- `getAvailableFillTypes()`, `getAvailableSellPoints()` — pro filtry

Yield/cost estimates v `db.js` jako fallback když mod neposílá přesná čísla (pšenice 9000 L/ha, kukuřice 18000 L/ha, seed ~200 CZK/ha, fertilizer ~150 CZK/ha).

### `savegame.js` (200 ř.) — XML parser

Detekce save dir:
1. Tail `log.txt`, hledá `savegame(\d+)/` regex
2. Poslední match → `FS25_DOCS/savegame<N>/`
3. Cache state `{ saveDir, fields:Map, meta, farms, farmlands:Map, readAt, error }`

Parsuje:
- `careerSavegame.xml` → meta (jméno, mapId, datum)
- `fields.xml` → `{ fieldId, fruitType, growthState, groundType, weedState, sprayLevel, plowFactor, … }`
- `farms.xml` → `{ farmId, name, money }`
- `farmland.xml` → mapování `farmlandId → farmId`

Refresh interval: `SAVEGAME_REFRESH_MS` (default 30 s).

Ruční parsování bez deps (FS25 XML je řádkově regulární; jedno field per řádek).

### `dashboardState.js` (118 ř.) — Server-side preferences store

- Persistence: `dashboard-state.json` v `DATA_DIR` (atomický temp-rename zápis)
- `LOCAL_ONLY = new Set(['bell-dismissed', 'syncMode'])` — keys co se nikdy nesyncují
- API: `getAll()`, `replaceAll(payload)`, `patch(payload)` (vrací delta), `getValue(key)`, `setValue(key, value)`

### `config.js` (101 ř.) — Centralizovaná config

Pořadí: env var → `config.local.json` → default.

| Env var | Default |
|---|---|
| `DASHBOARD_PORT` | 3000 |
| `DASHBOARD_HOST` | 0.0.0.0 |
| `FS25_DOCS_DIR` | `~/Documents/My Games/FarmingSimulator2025` |
| `DASHBOARD_DATA_FILE` | `<FS25_DOCS_DIR>/dashboard_data.json` |
| `FS25_LOG_FILE` | `<FS25_DOCS_DIR>/log.txt` |
| `DASHBOARD_DATA_DIR` | `data/` (relativní k binárce) |
| `SAVEGAME_REFRESH_MS` | 30000 |
| `LOG_LEVEL` | `info` (alternativy: `quiet`, `debug`) |

Packaged exe (`npm run build` → pkg) — `DATA_DIR` defaultně vedle .exe, ne v repu.

### `logger.js` (80 ř.) — Strukturované logování

Per řádek: timestamp `HH:MM:SS`, ikona, kategorie, zpráva.

| Ikona | Význam | Použití |
|---|---|---|
| `ⓘ` | info | startup, sekce headers |
| `✓` | ok | success akce |
| `•` | tick | per-event (utlumeno v info levelu) |
| `▶` | write | zápis na disk |
| `+` | add | klient připojen / nová věc |
| `−` | drop | klient disconnect |
| `⚠` | warn | varování (vždy zobrazí) |
| `✗` | error | chyba (vždy) |
| `·` | debug | jen v debug levelu |

ANSI barvy, vypínají se `NO_COLOR=1` nebo neinteraktivní stdout.

---

## 3. Frontend moduly — `src/Dashboard/Server/public/`

### `app.js` (461 ř.) — globální setup

- `FS25App.connect(onData)` — WS klient s reconnect logikou. `onData(data)` callback při každém WS payload.
- Globální helpers: `bar(percent, opts)`, `fmt(num)`, `esc(s)` (HTML escape)
- Settings modal: tabovaný (Vzhled, Sekce, Vozidla, Notifikace, Sync), injektovaný do `.nav-status`
- Flash framework (jen na index.html): `noteFlashRows(section, items, getKey, getValue)` + `getFlashCls(section, rowKey)`
- Save-meta zobrazení v navbaru (název hry, save, gameYear)

### `state.js` (54 ř.) — DashState wrapper

- Namespace: `fs25.dash.v1.<key>`
- API: `DashState.get(key, fallback)`, `set(key, value)`, `setHas(key, item)`, `setToggle(key, item)`
- Klíče v `DashState.KEYS`:
  - `theme`
  - `hiddenVehicles`, `hiddenStorages`, `hiddenProductions`, `hiddenSections`
  - `emptyAnimalsCollapsed`
  - `collapsedGroups`
  - `flashEnabled` (map sectionKey → bool)
  - `vehiclesExpanded` (basic vs expanded vehicle view)

Set automaticky volá `ServerSync.syncWrite(key, value)`.

### `serverSync.js` (161 ř.) — cross-device sync

- Boot: `GET /api/dashboard-state` → překlopí do localStorage
- Write: `syncWrite(key, value)` → `PATCH /api/dashboard-state` → server broadcast
- Read: WS message s `__dashboardStatePatch` → write to localStorage (suppress flag aby nesílaly echo)
- `LOCAL_ONLY = new Set(['bell-dismissed', 'syncMode'])`
- Toggle `syncMode: 'server' | 'local'` v Settings → off = local-only

### `tabletools.js` (673 ř.) — drag-drop + hide

Markup atributy:
- `data-tt-dnd="<groupKey>"` na containeru
- `data-tt-key="<itemKey>"` na řádku
- `data-tt-container="<groupKey>"` na elementu kam dropuje
- `data-tt-hidden` na container pro skryté items
- `data-tt-hidden-toggle="<groupKey>"` na separator řádku pro inline-sep mode

API:
- `applyOrder(items, key, keyFn)` — aplikuj uložené pořadí
- `split(items, key, keyFn)` → `{ visible, hidden }`
- `hideBtn(key, itemKey, label)`, `unhideBtn(key, itemKey, label)`
- `hiddenSubgroupRow(key, count, colspan)` → `<tr class="tt-hidden-sep">` markup
- `onChange(key, cb)` — registrace renderer callbacku (volá se po hide/unhide/drag)
- `getHidden(key)` → `Set<itemKey>`
- `dndAttrs(key, itemKey)` → returns `data-tt-dnd="..." data-tt-key="..."` string

Storage: `fs25.dash.v1.hidden:<key>` + `fs25.dash.v1.order:<key>`. Také dual-write na legacy klíče (`hiddenVehicles`, …) pro migraci.

Drag interní: Sortable.js (CDN, načtený `<script src="...sortablejs...">`), forceFallback + fallbackOnBody pattern.

### `bell.js` (322 ř.) — alert bell

Prahové konstanty na začátku souboru:
- `FOOD_LOW = 25`, `WATER_LOW = 20`, `STRAW_LOW = 25`
- `OUTPUT_HI = 90`
- `FUEL_LOW = 15`
- `STORAGE_HI = 95`

`genAlerts(data)` → `[{ key, icon, severity, title, detail, items, target }]`

Severity: `urgent` (red), `warning` (yellow), `info` (blue)

Targets (= section ids): `sec-animals`, `sec-fields`, `sec-vehicles`, `sec-storage`

Dismissed Set (session-only):
- Fingerprint: `${key}::${[...items].sort().join('|')}`
- `dismissed.add(fp)` na klik X nebo klik řádku
- Reset jen na page reload

API: `FS25Bell.update(data)` (volá page WS handler)

### `notifications.js` (169 ř.) — Browser Notification API

Settings v `localStorage['fs25_notif_settings']`:
```js
{ animalFood: 25, vehicleFuel: 20, emptyFieldDays: 5, cooldownMinutes: 60, enabled: false }
```

Cooldown v `localStorage['fs25_notif_cooldown']` jako map `<key>: timestamp`.

API: `Notifier.process(data)` (volá page WS handler), `getSettings()`, `saveSettings(s)`, `requestPermission()`.

### `theme.js` (53 ř.) — theme switcher

Registrované themes: `dark-green` (default), `dark-blue`, `light`, `high-contrast`, `fs25-native`.

CSS vars: `--bg`, `--surface`, `--surface2`, `--text`, `--muted`, `--border`, `--accent`, `--accent2`, `--red`, `--teal`, `--orange`.

**Pre-paint script v `<head>` každé stránky** aplikuje `data-theme` PŘED stylesheet parsováním → bez FOUC flash.

### `crop-icons.js` (138 ř.) — crop visuals

- `CropIcons.color(fruitTypeId)` → hex string (deterministicky z jména pro neznámé)
- `CropIcons.iconWithName(fruitTypeId, name, size)` → HTML s `<img>` + textem
- `CropIcons.setCatalog(availableFruits)` — sync z WS payload

Mapování: WHEAT→wheat.svg, BARLEY→barley.svg, MAIZE→maize.svg, atd. Synonyma (COTTON→generic, OAT→barley).

### `money.js` (61 ř.) — multi-currency

- `FS25Money.format(eurAmount, opts)` → "24 500 Kč" (cs-CZ locale)
- `FS25Money.setCurrency(curr)` — sync z WS payload (mod posílá currency settings)
- Cache v localStorage `fs25.dash.v1.currency` (pro history.html která jede REST-only)

### `sortable.js` (172 ř.) — Sortable.js wrapper

TableTools volá tohle pro drag. Pattern forceFallback + fallbackOnBody, ručně řízený pointer event handler kvůli flickeru native HTML5 DnD.

---

## 4. HTML stránky

### `index.html` (1852 ř.) — Hlavní dashboard

Hero KPI row (4 karty): `kpi-balance`, `kpi-owned`, `kpi-vehicles`, `kpi-animals`.

Sekce (data-tt-key na `.section` divu):
| ID | Klíč | Data origin | Skrývá se |
|---|---|---|---|
| `sec-fields` | `fields` | Lua mod + savegame XML | tabletools drag |
| `sec-vehicles` | `vehicles` | Lua mod | tabletools drag |
| `sec-animals` | `animals` | Lua mod | tabletools drag |
| `sec-storage` | `storages` | Lua mod | tabletools drag |
| `sec-productions` | `productions` | Lua mod | tabletools drag |
| `sec-prices` | `prices` | Lua mod | tabletools drag |
| `sec-weather` | `weather` | Lua mod | (whole section toggle v Settings) |
| `sec-balance` | `balance` | Lua mod + db.js historie | (whole section toggle) |

Per-section flash toggle (✏ ikonka) přepíná `data-flash-toggle="<sectionKey>"` (zapnutý = zelená/červená 10 s tint na změnu).

Drag-and-drop sekcí: per `data-tt-dnd="sections"` na `.section`. Persisted `fs25.dash.v1.order:sections`.

### `calendar.html` (1584 ř.) — Field Gantt

**Layout:** `<table class="gantt-table">` s `<colgroup>` definujícím 3 sloupce (260 + 240 + flex). První dva sloupce `position: sticky; left: 0/260px` (frozen panel).

**Sekce stránky:**
- KPI row (Vlastněná pole, Sklízet teď, Rostou, Čekají na setbu)
- Section header s počtem polí + datum chip + filter bar (Jen vlastněná pole / Všechna, Výhled slider 10–60 dní)
- Růst legenda + fert legenda
- Gantt table (visible + hidden tbody přes `.tt-hidden-zone`)
- Custom horizontal scrollbar (sibling `<div>` pod `#gantt-wrap`)
- Plan editor (oddělená sekce dole)

**Gantt row content:**
- Frozen col 1 (`.g-label`): `g-label-inner` flex wrapper s `.g-label-text` (line1: #ID + crop icon + name, line2: ha) + fert badge
- Frozen col 2 (`.g-needs`): chip pills (max 3 visible + `+N`)
- Timeline (`.g-timeline`): position: relative; růstový bar + plan-task bars (.row-0 same strip jako growth, .row-1 níže)

**Custom scrollbar:** Native scrollbar hidden via `scrollbar-width: none`. Custom track s `margin-left: 500px` aby začínal kde sloupec timeline. `syncGanttScrollbar()` se volá z `renderGantt()`.

**Plan editor:** Hidden `<select id="plan-field-select">` driven by row click. Visible chip v section-header zobrazuje aktivní pole. Empty state když nic vybráno. Per-year crop selectors.

**Plan task generation** (`generateTasksForYear()`):
- Sow window: `findMonthWindow(fruitType.plantableMonths)`
- Harvest window: search po `sowEnd` v `harvestableMonths`
- Plow: -1 měsíc před sow (jen pokud `isFirstYear || followingDifferentCrop`)
- Lime: -2 měsíce před sow (jen pokud `consumesLime`)
- Roll: +1 měsíc po sow end (jen pokud `needsRolling`)
- Fertilize: mid-cycle (floor(lag/2))
- Harvest: ve harvest window

Events anchored na sow měsíc + signed `offsetFromSow` (handles year wrap pro ozimky).

### `history.html` (764 ř.) — Grafy

REST-only (žádné WS). Chart.js v1.

Grafy:
- Bilance v čase (čára)
- Pole profit (sloupcový)
- Cena komodity forecast (čára, 12 měsíců dopředu)
- Recent events (tabulka)

Filter bar: období picker (7d, 14d, 30d, custom), commodity dropdown.

### `help.html` (656 ř.) — Nápověda

Statická. Sticky levý TOC, scrollovatelné sekce.

### `profit.html` — Zisk polí

*Vyloučeno z této QA pasu na pokyn uživatele.*

---

## 5. Lua mod — `src/Dashboard/FS25/DashboardExport.lua` (1950 ř.)

`DashboardExport` globální tabulka. Aktivace: `addModEventListener(DashboardExport)`.

**Konstanty:**
- `MOD_VERSION = "1.1.2.11"` (sync z `modDesc.xml` via build skript)
- `SCHEMA_VERSION = 1`
- `EXPORT_PERIOD = 2000` ms
- `SCAN_PERIOD = 500` ms, `FRUITS_PER_CHUNK = 5` (incremental field scan pacing)

**Hlavní `collect*` funkce:**

| Funkce | Co vrací |
|---|---|
| `collectFarmBalance` | `{ balance }` z `g_farmManager` |
| `collectCurrency` | `{ code, symbol, factor, prefix }` z AdditionalCurrencies mod nebo default EUR |
| `collectAvailableFruits` | Pole `{ name, title, fillTitle, plantableMonths[], harvestableMonths[], needsRolling, consumesLime, growthRequiresLime, allowsSeeding, regrows, firstRegrowthState, startSprayLevel, numGrowthStates, minHarvestingGrowthState, isCultivationAllowed }` |
| `collectSaveMeta` | Save jméno, mapId, datum |
| `collectGameSettings` | `{ growthMode, plowingRequiredEnabled, limeRequired, weedsEnabled, stonesEnabled, ... }` |
| `collectPriceForecast` | Per fillType `{ name, fillType, pricePerTon, factors[1..12] }` |
| `collectWeather` | Aktuální + forecast 3 dny |
| `collectFields` | Pole field state, kombinováno z farmland iterace + density map čtení |
| `collectVehicles` | Vozidla + AI task (vanilla/Courseplay/AutoDrive), fuel/AdBlue, motohodiny, implements |
| `collectAnimals` | Husbandry per: count, foodPercent, waterPercent, strawPercent, milkPercent, manurePercent, liquidManurePercent, reproductionPossible |
| `collectStorages` | Per silo: items, capacity, ownerFarmId |
| `collectProductions` | Production placeables |
| `collectPrices` | Sell points × items pricePerTon |

**Implement detection** (`collectImplements`, `getImplementFillUnits`):
- Filter: `unit.capacity > 100` (drops plow LIME pseudo-tanks)
- Label fallback: current fillType → lastValidFillType → `EMPTY` (frontend renders as `—`)
- Recursive walk přes `vehicle:getAttachedImplements()` (depth limit 3)

**AI detection** (`getAITask`):
- Priority: AutoDrive → Courseplay → vanilla AI
- Returns `{ source, jobType, progress, eta, destination }` nebo nil

**JSON encoder:** Inline funkce `encodeJson(value)`, pure Lua, handles nil→null, booleans, numbers (integer + float distinction), strings escaped, arrays vs objects via numeric vs string keys.

**Field detection note:** Density map čtení je drahé. Mod paces incremental scans (`SCAN_PERIOD`, `FRUITS_PER_CHUNK`). Cache TTL 5 min. Server XML reading přepisuje live mod values pro autoritativní `fruitType`/`growth`.

---

## 6. Knowledge base — `knowledge/`

| Soubor | Co tam je |
|---|---|
| `fs25-crop-calendar-api.md` | FruitTypeDesc properties, growthMode, plantable/harvestable months |
| `fs25-implements-fillunits.md` | `getAttachedImplements`, `spec_fillUnit`, capacity heuristic |
| `ai-task-detection.md` | AutoDrive/Courseplay/vanilla AI source priority |
| `fs25-native-theme-proposal.md` | FS25 brand colors, font, theme spec |
| `dashboard-user-guide.md` | (precursor k USER-GUIDE.md, archiv) |
| `mod-additionalFieldInfo.md` | Reference mod analýza |
| `mod-ExtendedGameInfoDisplay.md` | Reference mod analýza (weather forecast) |
| `mod-InfoDisplayExtension.md` | Reference mod analýza (silos, husbandry) |
| `mod-PlayerWorkers.md` | Worker management API reference |

---

## 7. State klíče (registry)

### DashState (`fs25.dash.v1.<key>` v localStorage)

| Klíč | Typ | Default | Sync? |
|---|---|---|---|
| `theme` | string | `dark-green` | yes |
| `hiddenVehicles` | string[] | `[]` | yes |
| `hiddenStorages` | string[] | `[]` | yes |
| `hiddenProductions` | string[] | `[]` | yes |
| `hiddenSections` | string[] | `[]` | yes |
| `emptyAnimalsCollapsed` | bool | `true` | yes |
| `collapsedGroups` | string[] | `[]` | yes |
| `flashEnabled` | map | `{}` | yes |
| `vehiclesExpanded` | bool | `false` | yes |
| `fieldPlans` | object | `{}` | yes |
| `syncMode` | string | `'server'` | **NO** (local-only) |
| `bell-dismissed` | string[] | (session) | **NO** (session-only, in-memory) |
| `calHiddenCollapsed` | string | `'1'` | yes (calendar hidden zone collapse) |
| `collapsed:<id>` | string | unset | yes (tt-hidden-zone collapse, per-zone) |

### TableTools-managed (`fs25.dash.v1.{hidden,order}:<groupKey>`)

| Group | Klíče |
|---|---|
| `fields` | `hidden:fields`, `order:fields` |
| `vehicles` | `hidden:vehicles`, `order:vehicles` |
| `animals` | `hidden:animals`, `order:animals` |
| `storages` | `hidden:storages`, `order:storages` |
| `productions` | `hidden:productions`, `order:productions` |
| `prices` | `hidden:prices`, `order:prices` |
| `sections` | `order:sections` |

---

## 8. Časté pasti (gotchas)

### Lua

- **`or 0.001` neumí 0.** Lua `or` operátor neevaluuje 0 jako falsy. `ft.massPerLiter or 0.001` selže když `massPerLiter = 0` (mody to někdy nastaví). Guard: `if not x or x <= 0 then x = 0.001 end`. (Viz `BUGS.md` divide-by-zero fix.)
- **`getAttachedImplements()` může být `nil`** na placeable-only vehicles (rest stations). Safety: `if vehicle.getAttachedImplements then ... end`.
- **`unit.fillType == 0`** = UNKNOWN. Pseudo-UNKNOWN: g_fillTypeManager někdy vrátí `{ name="UNKNOWN", title="Unknown" }`. Kontroluj jméno, ne jen index.
- **`safeCall` wrapper** — všechny mod calls obalit, aby exception nesundala celý mod.

### Frontend

- **`position: sticky` v `<td>` vyžaduje** ancestor s `overflow: auto/scroll/hidden` na DANÉ ose. `display: flex` na `<td>` rozbíjí dědění výšky `<tr>` — buňka pak shrinkuje na content. Use inner wrapper div místo `display: flex` přímo na TD.
- **`[hidden]` vs `display: inline-flex`** — UA stylesheet `[hidden] { display: none }` MŮŽE být přebito user CSS s `display: inline-flex`. Explicit override: `.my-class[hidden] { display: none }`.
- **Sortable.js + table** — Sortable funguje na `<tbody>` jako container. Drag mezi dvěma tbodies vyžaduje stejný group name (`data-tt-container="..."` matchuje).
- **WS reconnect** — `app.js` má reconnect logiku ale state se z localStorage. Pokud server restartuje, ServerSync GETne fresh state on next connect.

### Calendar Gantt

- **Plan task harvest year wrap** — ozimá pšenice: sow měsíc 8, harvest měsíc 5 (next year). Naive `(harvMonth - sowMonth + 12) % 12` dá 9 měsíců lag, ale TIME-WISE je to year+1. `offsetFromSow` musí být signed, year wrap přes `Math.floor(absMonths / 12)`.
- **Custom scrollbar drift** — JS-driven thumb pozice se musí sync z `wrap.scroll` event A z `MutationObserver` (po renderu). Bez MO se thumb drifne při změně content width.
- **Memo guard re-renders** — plan editor renderer používá memo key zahrnující `JSON.stringify(getPlans()) + fid + fruitCatalog + gameYear`. WS tick každé 2 s by jinak zavřel otevřený dropdown při změně fuel %.

### Tests / mock

- **Mock posílá availableFruits + gameYear** — od QA fase 3 posílají všechny scénáře v `mock-scenarios.js` kompletní `availableFruits[]`, `gameYear`, `gameMonth`, `dayInMonth`, `daysPerMonth`. Plan-task bars se zobrazují i ve smoke testech.
- **Screenshot baselines** — v `test/smoke/screenshots/` (Playwright `toHaveScreenshot`). Prahová hodnota 0.5 % pixel diff. Regenerace: `npx playwright test --update-snapshots`.

---

## 4-mock. Mock server — scriptovatelné scénáře

### Soubory

| Soubor | Účel |
|---|---|
| `scripts/mock-data.js` | Hlavní generátor — zapisuje `dashboard_data.json` každých 5 s |
| `scripts/mock-scenarios.js` | Knihovna pojmenovaných scénářů |

### Dostupné scénáře

| Název | Popis |
|---|---|
| `default` | Původní random behavior (22 polí, 6 vozidel, drift každý tick) |
| `empty-farm` | Žádná pole, vozidla, zvířata, sklady. Testuje empty-state placeholders. |
| `harvest-ready` | 5 ze 6 polí isReadyToHarvest=true. Testuje harvest highlighting + bell. |
| `low-fuel` | 2 vozidla s fuelPercent ≤ 8 %. Testuje red fuel bar + bell low-fuel. |
| `animal-needs` | Kravín foodPercent 12 %, Vepřín 8 %. Testuje orange/red animal need. |
| `wagon-filling` | Opalenica wagon plní z 0→100 % (tick * 5 %). Testuje flash boundary. |
| `plan-3-years` | gameYear=3, 4 pole s různými plodinami. Testuje plan editor + gantt. |
| `withered-crops` | 2 pole s withered=true, 1 pole v stubble stavu. |
| `multi-fruit-types` | 8 polí × 8 různých plodin. Testuje crop icons + diverse labels. |
| `mixed-ai-tasks` | 5 vozidel s vanilla/Courseplay/AutoDrive/idle. Testuje AI badge. |

### CLI použití

```bash
cd src/Dashboard/Server

# Výchozí (random)
npm run mock

# Konkrétní scénář
node scripts/mock-data.js --scenario=harvest-ready

# S vlastní cestou k JSON souboru
node scripts/mock-data.js --scenario=low-fuel /tmp/dash.json
```

### Runtime přepínání bez restartu

Zapsat jméno scénáře do `<dirname(dashboard_data.json)>/mock-scenario.txt`.
Mock-data.js polluje soubor každou 1 s a po detekci změny okamžitě zapíše nový payload.

Server v mock módu (`DASHBOARD_MOCK=1`) nabízí HTTP API:

```bash
# Přepnout na scénář
curl -X POST http://localhost:3099/mock/scenario \
     -H 'Content-Type: application/json' \
     -d '{"scenario":"harvest-ready"}'

# Zjistit aktuální scénář
curl http://localhost:3099/mock/scenario
```

### Architektura scenario file

```
POST /mock/scenario  →  server  →  scenario.txt  →  mock-data.js (poll 1s)  →  immediate tick  →  dashboard_data.json  →  chokidar  →  WS broadcast  →  browser update
```

Celková latence: < 2 s (1 s poll + okamžitý tick + 150 ms chokidar stabilityThreshold).

### API `mock-scenarios.js`

```js
const { getScenario, listScenarios } = require('./scripts/mock-scenarios');

getScenario('harvest-ready', 0);   // → payload object
getScenario('wagon-filling', 10);  // → wagon at 50% fill (tick * 5%)
getScenario('default', 0);         // → null (caller uses own generateData())
listScenarios();                   // → ['animal-needs', 'default', ...]
```

---

## 4-tests. Playwright testy — screenshot diff

### Spuštění

```bash
cd src/Dashboard/Server

# Celá smoke suite (existující + scénáře + interakce)
npm run smoke

# Jen screenshot testy
npx playwright test --config=test/smoke/playwright.config.js scenarios.spec.js

# Regenerovat baselines (po UI změnách)
npx playwright test --config=test/smoke/playwright.config.js scenarios.spec.js --update-snapshots

# Interakční testy
npx playwright test --config=test/smoke/playwright.config.js interactions.spec.js
```

### Struktura testů

```
test/smoke/
├── playwright.config.js       – konfigurace, sandbox port 3099, threshold 0.5 %
├── dashboard.spec.js          – 4 stránky + 5 themes smoke (console errors + KPI render)
├── drag.spec.js               – drag-and-drop interakce (6 testů)
├── drag-visual.spec.js        – regrese „bounce back" po section drop
├── scenarios.spec.js          – screenshot diff: 8 scénářů × 4 stránky + 3×5 theme matrix
├── interactions.spec.js       – klikací interakce (8 testů)
└── screenshots/               – baseline PNG soubory (committed)
    └── scenarios.spec.js-snapshots/
        ├── empty-farm-dashboard-win32.png
        ├── harvest-ready-dashboard-win32.png
        ├── ...                (47 souborů)
```

### Threshold a masking

- **Prahová hodnota:** `maxDiffPixelRatio: 0.005` (0.5 % pixelů se může lišit)
- **Maskované elementy:** `.navbar-time`, `.live-dot`, `#kpi-time`, `.kpi-card[data-tt-key="time"]`
- **Viewport:** 1440 × 900 px (konzistentní napříč testy)
- **Animace:** zakázány (`animations: 'disabled'`)

### Scénář × stránka matice

| Scénář | Dashboard | Calendar | History | Help |
| --- | --- | --- | --- | --- |
| empty-farm | baseline | baseline | baseline | baseline |
| harvest-ready | baseline | baseline | baseline | baseline |
| low-fuel | baseline | baseline | baseline | baseline |
| animal-needs | baseline | baseline | baseline | baseline |
| plan-3-years | baseline | baseline | baseline | baseline |
| withered-crops | baseline | baseline | baseline | baseline |
| multi-fruit-types | baseline | baseline | baseline | baseline |
| mixed-ai-tasks | baseline | baseline | baseline | baseline |

Theme matrix: `empty-farm` / `harvest-ready` / `low-fuel` × `dark-green` / `dark-blue` / `light` / `high-contrast` / `fs25-native` = 15 screenshotů.

**Celkem: 47 screenshot baseline souborů.**

### Sandbox izolace

Playwright config spouští sandbox server na portu 3099 s:

- `DASHBOARD_DATA_FILE = .tmp/smoke/dashboard_data.json`
- `DASHBOARD_DATA_DIR  = .tmp/smoke/data`
- `DASHBOARD_MOCK = 1` (povoluje `POST /mock/scenario`)

Sandbox se nepotká s live serverem na portu 3000 ani s production `dashboard_data.json`.

### Interakční testy — pokryté scénáře

| Test | Scénář | Pokryje |
| --- | --- | --- |
| Field drag into hidden zone | harvest-ready | `#fields-body tr` → `#fields-hidden-body` |
| Vehicle drag into hidden zone | harvest-ready | `.vehicle-row` → `#vehicles-hidden-body` (soft flake) |
| Bell row click dismiss | low-fuel | panel open → row click → count ↓ |
| Calendar field click → editor | plan-3-years | `.gantt-row` click → `#plan-editor-body` visible |
| Calendar field drag (soft) | plan-3-years | drag → `hidden:fields` in LS (soft flake) |
| Settings modal open/close | harvest-ready | `#notif-toggle` → `#notif-modal` → `#nt-close` |
| Settings tabs height stable | harvest-ready | tab switch → height diff ≤ 2 px |
| Theme card click | harvest-ready | `.theme-card[data-theme-id="light"]` → `data-theme` attr |

### Známé flaky testy

Dva drag testy jsou označeny jako "soft fail" (nefailují suite, logují annotation):

- `vehicle drag into hidden zone` — drag funguje s 22 vozidly (default scenario), ale s 2 vozidly (harvest-ready) je hidden zone příliš blízko a Sortable hit detection může minout. Ekvivalentní test v `drag.spec.js` pokrývá tuto funkci spolehlivě.
- `calendar hide field via drag` — Gantt má horizontální scrollbar a hidden zone je pod tabulkou. Souřadnice se liší podle výšky stránky.

Oba mají odpovídající bug v `BUGS-2026-05.md`.

---

## 9. Build / deploy

### Mod ZIP

```powershell
& "scripts\build-mod-generic.ps1" -ModPath "src\Dashboard\FS25" -Bump patch
# Bump options: patch (default), minor, major
# -NoBump to rebuild bez bump verze
```

Skript:
1. Reads `modDesc.xml`, bumps version
2. Syncs `MOD_VERSION` v `DashboardExport.lua`
3. Builds ZIP s files at archive root (FS25 requirement)
4. Deploys do `E:\SteamLibrary\FS25-Mods\FS25_Dashboard.zip`

### Server packaged exe

```bash
cd src/Dashboard/Server
npm run build
# Output: dist/FS25_Dashboard_Server.exe
```

Used by `npm run build` → `pkg`. Default DATA_DIR resolves vedle .exe.

### `/publish` skill

Syncs `src/Dashboard/` content → `src/Dashboard/publish/` (separate git repo linked to `github.com/sapavlisna/fs25-dashboard`) → commit + push. Excludes private docs + local configs. Viz `.claude/skills/publish/SKILL.md`.

---

## 10. Debug recepty

| Symptom | Kde se podívat |
|---|---|
| Mod nezapisuje data | `~/Documents/My Games/FarmingSimulator2025/log.txt` — grep `[FS25_Dashboard]`. Viz `fs25-log-analyst` agent. |
| Schema warning | Server stdout, `seenMod` log. Mod schemaVersion vs MIN/MAX_MOD_SCHEMA v `index.js`. |
| WS disconnect loop | Chrome DevTools → Network → WS — check close codes. App.js reconnect cadence. |
| Plan task missing | `computeFieldTasksInView` debugger; check `currentData.availableFruits`, `gameYear`. |
| Drag-drop nepřebírá pořadí | `localStorage['fs25.dash.v1.order:<group>']` — manuálně inspect. |
| Theme flash on reload | Pre-paint inline script v `<head>` musí běžet PŘED stylesheet `<link>`. |
| Implement nevidět | DIAG-IMPL dump (jednorázový) v `collectImplements` — print `getAttachedImplements()` topology pro každé vozidlo. |
| Mod log řádky | `/fs25-log --mod=Dashboard --errors` skill. |

---

## 11. Repeatable QA — agent `dashboard-qa`

Pro automatizovaný QA pas existuje agent v `.claude/agents/dashboard-qa.md`. Pokrývá fáze 1–6 z `QA-PLAN.md`. Vyvoláš:

```
Spusť dashboard-qa pro celou aplikaci. Aktualizuj BUGS-2026-05.md, TEST-SCENARIOS.md, USER-GUIDE.md, DEV-GUIDE.md. Vynech /profit.html.
```

Agent volá Read/Write/Edit/Bash/PowerShell, neuvádí finální commit (musí ho explicitně udělat user).
