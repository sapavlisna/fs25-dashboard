# Changelog

All notable changes to this project will be documented here.

## Versioning

`MAJOR.MINOR.PATCH.BUILD` (FS25 4-digit convention; semver semantics on the first three).

- **MAJOR** — breaking payload contract (`schemaVersion` bumps) or full UI rewrite.
- **MINOR** — new feature, backward-compatible (new payload field, new page).
- **PATCH** — bug fix or refactor; mod & server still talk to each other.
- **BUILD** — internal `/fs25-build` test counter; **never** released alone, reset to 0 on PATCH/MINOR/MAJOR bump.

Mod and server share **one release version**. Each release ships both ZIPs even when only one component functionally changed — the release notes call out which one is the meaningful update so users can selectively download. `schemaVersion` in the JSON payload is independent and only bumps on incompatible payload shape changes.

## [1.10.1.0] — 2026-10-16

_Opravná verze módu: pole po pár minutách hraní přestala ukazovat skutečnou plodinu.
Server se funkčně nemění._

### Fixed
- **Pole se po pár minutách měnila na „tráva, 0 % růstu"** (`DashboardExport.lua`,
  [#2](https://github.com/sapavlisna/fs25-dashboard/issues/2)) — po vypršení cache
  (5 min) pole postupně přepočítával plošný sken, který měřil čtverec 1,5× větší než
  pole, tedy i travnaté okraje a sousední pozemky. Na mapách s trávou kolem polí
  (např. Riverbend Springs) tráva přeměřila skutečnou plodinu a růst vyšel 0. Nově
  plodinu určují vzorky uvnitř pole; výsledek skenu platí jen tehdy, když ho potvrdí
  stav pole ze hry, jinak se použije ten.
- **`deploy.bat` balil neúplný mód** — do ZIPu chyběly `DashboardSettings.lua`
  a `DashboardSettingsFrame.lua`, které `modDesc.xml` od 1.10.0.0 vyžaduje.

## [1.10.0.0] — 2026-08-18

_Živá mapa: nová stránka `map.html` s pozicí hráče a vozidel v reálném čase, skutečnými
obrysy polí, stanicemi a trasami AutoDrive / Courseplay. Vypínatelná přímo v herním menu._

### Added
- **Živá mapa (`public/map.html`)** — top-down mapa farmy nad snímkem herní mapy: pozice
  hráče a vozidel obnovované **4× za sekundu** vlastním kanálem (hlavní payload zůstává na
  2 s), skutečné obrysy polí (`densityMapPolygon`, fallback `field.polygonPoints`), čísla
  polí, značky stanic (prodej, sklady, obchody, výrobny, chovy, palivo) a **trasy
  AutoDrive / Courseplay** s odlišením ujeté a zbývající části. Vrstvy se vypínají
  tlačítkem ☰, volba se pamatuje v prohlížeči; zoom kolečkem/gesty, posun tažením.
  Vanilla pomocník trasu nemá — hra ji nikde nedrží jako seznam bodů.
- **Podklad mapy z módu mapy** (`mapOverview.js`, `zipread.js`) — vytáhne `overview.dds`
  ze ZIPu nahrané mapy a převede na PNG (rozbalování přes PowerShell, DDS přes `ffmpeg`,
  obojí best-effort). Cachuje se v `data/map-overview/` jednou za mapu. Bez `ffmpeg`
  mapa funguje dál, jen bez podkladu. Nová volba `DASHBOARD_MODS_DIR` / `modsDir`, mods
  složka se jinak hledá z `log.txt` (`Mod Directory:`).
- **Nastavení módu v herním menu** (`FS25/DashboardSettings.lua`,
  `DashboardSettingsFrame.lua`) — sekce **Dashboard** v Esc → Nastavení → Obecné
  s přepínačem **Živá mapa**. Vypnutí zháší kanál pozic, trasování obrysů i mapové
  hotspoty; zbytek exportu (pole, vozidla, zvířata, sklady, ceny, počasí) běží beze změny.
  Ukládá se **per savegame** do `<savegame>/dashboardSettings.xml`, výchozí stav zapnuto.
- **Zástupce na plochu** (`Server/create-shortcut.ps1`, `dashboard.ico`) — vyrobí ikonu
  z `FS25/icon_dashboard.png` a zástupce, který spustí `start.bat` se správným pracovním
  adresářem. `start.bat` teď po ukončení serveru drží okno otevřené, aby chyba při startu
  (obsazený port, chybějící Node) nezmizela z obrazovky.
- **Nápověda** — nová sekce *Mapa (živá)* (vrstvy, trasy, ovládání, vypnutí v hře),
  přegenerované screenshoty dashboardu, kalendáře, historie a mobilního zobrazení.
- **Sdílený tvar payloadu** (`payloadShape.js`) — jedno místo, které vrací zpět to, co mód
  z payloadu vynechává (defaultní klíče polí, session-statické sekce v
  `dashboard_static.json`). Používá ho server i `scripts/validate-json.js`, takže validace
  kontroluje stejný tvar, jaký vidí frontend.
- **Shardovaný běh smoke suity** (`scripts/run-sharded.js`, `test/smoke/sandbox-env.js`) —
  každý shard má vlastní port i sandbox (`SMOKE_PORT` / `SMOKE_SANDBOX` / `SMOKE_SCOPE`).
  Layout-citlivé specy (`scenarios`, `section-cfg`) jsou vyčleněné do scope `visual`
  a běží vždy sekvenčně.

### Fixed
- **Server zpracuje payload i při vzniku souboru** (`index.js`) — `dashboard_data.json`,
  který se objeví teprve za běhu serveru (první instalace, smazaná data složka,
  reinstalace módu), se dřív jen zalogoval a stránka zůstala na `—` až do dalšího zápisu.
  Nově se `add` ingestuje stejně jako `change`, jen bez zápisu do historie (soubor po
  startu může držet export z předchozí session).
- **Smoke sandbox** — `globalSetup` mazal celou sandbox složku, ale Playwright startuje
  webServery **před** ním, takže watcher serveru zůstal viset na neexistujícím inode
  a do prohlížeče nikdy nedorazila data (KPI stály na `—`). Nyní se maže obsah, ne složka.
- **Hledání aktivního savegame** (`savegame.js`) — reference na `savegameN` se v `log.txt`
  po dlouhé session vysune z čteného konce souboru; přidán průchod celým logem jako záložní
  cesta.

### Changed
- Verze serveru srovnána s módem na **1.10.0** (`package.json`, `package-lock.json`) —
  navbar a `/api/version` hlásily pořád 1.5.0.
- README (cz i en) — popis Živé mapy odpovídá skutečnosti (opravdové obrysy polí, ne
  odhadované čtverce), doplněn `ffmpeg` jako volitelná závislost a postup na zástupce.

### Removed
- **AI advisor** — celý `/advise` flow (destilace kontextu, hledání v knihovně módů,
  `advisor.html`, npm skripty, WS kanál reportů) i Lua export výbavy a katalogu obchodu,
  který sloužil jen jemu.

## [1.5.0.0] — 2026-07-06

_Precision Farming: data z módu FS25_precisionFarming (typ půdy, výnosový potenciál, dusík, pH)
promítnutá do dashboardu i kalendáře polí. Testováno živě na savu Kolonia (slot 10)._

### Added
- **Precision Farming v Lua exportu** (`FS25/DashboardExport.lua`) — čte `g_precisionFarming`
  (soilMap/nitrogenMap/pHMap/coverMap). Nový payload `pf = {active, soilTypes[]}` a per pole
  `fields[].pf = {sampled, soilType, soilTypeIndex, yieldPotential, nitrogenActual/Target, phActual/Target}`.
  Gated na existenci PF (bez módu se klíč nepřidá), throttlováno (max 3 pole/tick, TTL 30 s vlastněná).
  Cílové N/pH se převádějí z interního stavu na reálné jednotky (kg N/ha, pH škála).
- **Dashboard (index.html)** — volitelný kompaktní sloupec **„Půda / PF"**: typ půdy + druhý řádek
  `N akt→cíl · pH akt→cíl` (jen u vzorkovaných polí). Zapíná se v ⚙ sekce polí, skrytý bez PF.
- **Kalendář polí (calendar.html)** — vždy viditelný řádek `🌱 typ půdy · N akt→cíl` v popisku pole,
  plné hodnoty v tooltipu i detailu; jemné zebra podbarvení řádků pro odlišení.
- Mock (`mock-data.js`) a validace (`validate-json.js`) rozšířeny o PF data.
- **DashControl** (dev nástroj, 0.1.0.29) — nové příkazy pro autonomní přípravu herního stavu:
  `ping`, `dump`/`probe` (runtime introspekce), `buy_farmland`/`sell_farmland`, `buy_vehicle`,
  `attach_implement`, `set_seed`, `hire_worker` (přes `aiJobTypeManager`), `pf_sample`
  (nasimuluje odběr vzorku půdy → odemkne N/pH), `pf_field` (diagnostika). CLI sender `send-cmd.js`
  bez nutnosti restartu MCP session. Znalosti PF API v `knowledge/precision-farming-api.md`.

### Changed
- Sloupec „Dní do sklizně" v tabulce polí zkrácen na „Dní" (plný popis v tooltipu) — užší tabulka.

## [1.4.5.0] — 2026-06-21

_Výstup ekosystémového auditu. Vydáno jako 1.4.5.0 (bump modDesc.xml + package.json)._

### Added
- Nápověda: nové sekce **Jazyk** (CZ/EN přepínač), **Diagnostika a přehrávání** (record/replay/mockup),
  **První spuštění** (setup wizard) a popis omezení relay diváka (co nevidí, relay 404).
- **Unit testová vrstva** (`test/unit/`, 42 testů: validate-json, db, savegame, config, relay-client,
  dashboardState) + skript `npm run test:unit` — dosud chyběla pravá unit vrstva mimo Playwright.

### Changed
- Nápověda: oprava zastaralých údajů — příklad verze v navbaru a počet záložek Nastavení
  (4 → 6, doplněno Sdílení + Připojení).

### Fixed
- **Bezpečnost:** `npm audit fix` — zranitelnost `ws` (high) + `qs`/`express` (moderate); `ws` 8.20.0 → 8.21.0,
  0 zbývajících zranitelností. Týká se zejm. veřejně exponovaného relay.
- **Historie eventů se mísila mezi savegame sloty** — `db.js saveEvents()` nyní taguje řádky `save_id`,
  takže `/api/events` filtruje na aktuální playthrough (jako balance/prices/fields).
- **`validate-json.js` odmítal legitimní data z módu** — vozidla bez nádrže (`fuelCapacity: 0`, přívěsy)
  a auto-water stáje bez `waterPercent` (prasata/slepice) teď projdou; vadné hodnoty se dál chytají.

## [1.4.4.0] — 2026-06-21

### Fixed
- **Theme key bloat / relay 1009 disconnect loop (the real root cause).** The
  `theme` localStorage key was written raw by `theme.js`/pre-paint but mirrored
  JSON-encoded by `serverSync`; every server↔browser round-trip added a quote
  layer, so `fs25.dash.v1.theme` grew exponentially (12 B → 512 KB in ~30 min
  under the relay reconnect churn). The bloated value rode along in the room-ready
  state patch and blew past the relay's frame limit → endless 1009 reconnects.
  Unified the theme on JSON encoding everywhere (4 pre-paint snippets, `theme.js`,
  `app.js`) with a **self-healing, validating read**: any unknown / over-encoded
  value normalises back to a valid theme id (legacy-raw values are preserved), so
  existing corruption heals on the next page load and the round-trip is idempotent.

## [1.4.3.0] — 2026-06-21

### Fixed
- **Relay dropped the publisher with close 1009 (message too big).** A large
  farm's enriched frame is ~130 KB and spikes upward during heavy play, but the
  relay's per-frame limit was 256 KB — too tight, so the publisher got kicked and
  the share link flapped. Raised `MAX_FRAME_BYTES` 256 KB → 1 MB (and the
  backpressure threshold 1 MB → 4 MB), in both the relay default and
  `docker-compose.yml`. Relay-only change — redeploy the relay container to apply
  (mod + server binaries are unchanged this release).

## [1.4.2.0] — 2026-06-21

### Changed
- **History reads served from an in-memory cache.** `db.js` re-read and
  re-parsed the entire JSONL file (prices grows to 100k+ rows) from disk on
  every `/api/history/*` request, then discarded all but the current save's
  rows. Now each file is read once and served from RAM; appends and rewrites
  keep the cache in step. Behaviour, data format and per-save filtering are
  unchanged — only the I/O pattern. (Per-save file splitting for bounded size
  + per-save deletion is a deferred follow-up.)

## [1.4.1.0] — 2026-06-21

### Fixed
- **`PayloadTooLargeError` spam in the server log.** The always-on diagnostic
  snapshot dumped the *entire* `fs25.dash.*` localStorage in one POST; a large
  key pushed it past the JSON body limit and logged a full stack trace on every
  page load. The snapshot is now bounded (oversized values skipped with a size
  marker), the body limit raised 256kb → 1mb, and body-parser errors now log a
  single clean line instead of a stack dump.

## [1.4.0.0] — 2026-06-21

### Added
- **First-run setup wizard.** When the server can't find FS25 data, a welcome
  overlay appears in the browser; it auto-detects the standard FS25 folder,
  verifies it (log.txt / savegames / dashboard_data.json) and writes
  `config.local.json` — no hand-editing JSON. Reachable anytime via
  Nastavení → 📁 Připojení.
- **Native folder picker** ("Procházet…") — the server opens a real Windows
  folder dialog (`/api/setup/browse`) and fills the path back in.
- **Auto-open dashboard in browser on startup**, toggleable in
  Nastavení → Připojení (`DASHBOARD_OPEN_BROWSER` / `openBrowser`, default on).

### Changed
- Settings tabs stay on one row (no wrap); modal widened to 560px.
- FS25 folder auto-detection no longer suggests the OneDrive path; only
  existing folders are offered as chips.
- `start.bat` no longer opens the browser (the server does it now).

## [1.1.2.0] — 2026-05-22

### Added
- Weather KPI shows a 3-day forecast next to the current state, split by a
  vertical divider (icon + min/max temp per upcoming day).
- Balance KPI shows the last 3 game days' deltas in the same split layout.
- Per-section change-flash toggle is now an iOS-style switch with
  tooltip-only label (no "Flash změn" text crowding the headers).

### Changed
- **Versioning aligned on FS25 4-digit convention.** `modDesc.xml` is the
  source of truth (`MAJOR.MINOR.PATCH.BUILD`); git tags follow it literally
  (`v1.1.2.0`). `package.json` keeps 3-digit semver (npm requirement) but
  mirrors the first three components. See README for build/release flow.

### Removed
- Calculator page and its navbar link (use it manually? probably not).
- "Pouze aktivní" toggle in the Vehicles section (drag-to-hide covers it).

## [1.1.1] — 2026-05-21

### Changed
- CI: GitHub Actions runner bumped to Node 24 (was 20) ahead of the
  2026-06-02 Node 20 deprecation. `pkg` target stays at `node20-win-x64`
  since `@yao-pkg/pkg` doesn't ship a Node 24 cross-binary yet — the
  baked-in runtime inside the .exe is independent of the host build.
  Server payload and behaviour are identical to v1.1.0.

## [1.1.0] — 2026-05-21

### Added
- **Payload schema versioning.** Mod stamps `schemaVersion` (= 1) and
  `modVersion` on every export. Server warns about legacy mods and exposes
  the negotiated state via `/api/version`.
- **Reproduction indicator** for animals — 🐣 X % badge in the row, tinted
  green at ≥ 90 % (next animal almost due). Aggregated as the max across
  clusters; the modal also surfaces per-cluster reproduction.
- **Per-fruit `needsRolling`** flag in payload — calendar shows the `Válet`
  chip only for crops that actually benefit from rolling (corn, beet, rice
  and sugarcane skip it).
- **Field calendar — fixed-column needs chips:** Orat / Kultivovat /
  Vápno / Plevel / Kameny / Válet. Each column is gated by the matching
  in-game difficulty setting (`weedsEnabled`, `stonesEnabled`,
  `plowingRequiredEnabled`, `limeRequired`) so disabled mechanics don't
  generate UI noise. Header row labels the columns.
- **Field hide in the calendar** — drop-equivalent of the main dashboard's
  hide; hidden fields are excluded from KPI counts and the Gantt (with a
  "Skryté pole (N)" collapsible at the bottom).
- **Field state classification** — `isCut` and `isWithered` booleans on
  each field. Calendar bars + modal show "Sklizeno" / "Zvadlé" instead of
  the old bogus "7/5" growth phase after harvest.
- **Seasonal price forecast chart** on the History page — bar chart of the
  12-month price multiplier per fillType with current/best/worst month
  highlighting and a headline summary ("nejlepší v Říjen, nyní …").
- **History — smart commodity filter.** Commodities you own (stock > 0)
  are listed first in their own optgroup. Sell-point dropdown is filtered
  to places currently buying the selected commodity (from live prices).
- **Row-level change flash.** When a value changes between WS ticks the
  row tints green (rose) or red (fell) for 10 s. Active in: vehicles
  (fuel), animals (count), fields (growthState), storage (amount),
  productions (amount), prices (pricePerTon). Each section has its own
  iOS-style switch in the section header (state persisted in localStorage).
- **Bell guard** for low-fuel alerts — skips user-hidden vehicles and
  vehicles without a fuel tank (wheelbarrows, rest-station placeables)
  that were tripping the threshold via `fuelPercent = 0`.
- Drag-and-drop hide for vehicles (drop into the "Skryté vozidla" zone)
  with the hidden subgroup persisted across reloads.
- Month name shown next to the game day in the navbar.
- Shared `money.js` module — history & profit pages honor the active
  currency (AdditionalCurrencies converter).

### Changed
- **Czech is now the primary README.** English moved to `README.en.md`;
  language switcher at the top of each file.
- "Productivity" label on animals corrected to **"Zdraví"** (it was always
  showing average herd health, not a production multiplier).
- Calendar Gantt label widened from 160 px to 240 px + dedicated needs
  column area (420 px) so chips align vertically across rows.
- Notifier respects hidden items — no alerts for vehicles, animals or
  fields the user has explicitly hidden.
- Storage sort: empty silos now sink to the bottom based on actual total
  amount (not on item-list emptiness).
- Productions section width fixed (no horizontal scrollbar on dense data).
- Vehicle fuel bar is fixed-width.
- Server v1.1.0 — boot banner shows the negotiated mod schema range and
  the new `/api/version` endpoint exposes mod + server versions.

### Fixed
- Growth phase no longer reads as "7/5" after harvest (`maxGrowth` now
  uses `maxHarvestingGrowthState` instead of `numGrowthStates - 1`).

## [1.0.0] — initial public release

First public version. Real-time view of fields, vehicles, animals,
silos, productions, prices, weather. History & profit-per-field pages.
Browser notifications. AdditionalCurrencies support.
