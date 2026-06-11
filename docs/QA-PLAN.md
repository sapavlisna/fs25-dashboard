# Dashboard QA Plan — 2026-05-24

Komplexní revize a testovací pas přes celou Dashboard aplikaci. Plán má 6 fází; každá fáze produkuje konkrétní deliverable a ukládá výstup do `src/Dashboard/docs/`. Cíl: dohnat dokumentaci, najít regrese po nedávných redesignech (calendar Gantt, vehicle implements, plan editor), a kodifikovat workflow do agenta `dashboard-qa` pro budoucí použití.

**Co vynecháváme:** záložku **Zisk polí** (`/profit.html`) podle pokynu uživatele.

## Existující dokumenty (kontext)

Co už v `src/Dashboard/docs/` máme:

| Soubor | Stav | Použití v tomto QA |
|---|---|---|
| `PLAN.md` (308 ř.) | Původní MVP plán | Reference, neaktualizovat |
| `BUGS.md` (53 ř.) | Historické bugy | Append nové; přejmenovat původní na `BUGS-archive.md`? |
| `AUDIT.md` (80 ř.) | Code audit | Reference |
| `REDESIGN.md`, `REDESIGN-V2.md` | Design rounds | Reference, neaktualizovat |
| `RESEARCH-NEXT.md` | Výzkumný plán z 2026-05 | 4/4 hotovo; archivovat |
| `COMPATIBILITY.md` | Schema versioning | Reference |
| `lua-mod.md` | Lua mod interface | Reference |

Nové deliverables tohoto QA:

- **`QA-PLAN.md`** (tento dokument) — meta-plán
- **`USER-GUIDE.md`** — uživatelský průvodce po finálních úpravách
- **`DEV-GUIDE.md`** — architektura, datový tok, debug recepty
- **`TEST-SCENARIOS.md`** — soupis všech scénářů a edge cases
- **`BUGS-2026-05.md`** — bugy nalezené v tomto pasu

---

## Fáze 1 — Inventura aplikace

**Cíl:** mít kompletní soupis toho, co aplikace umí, kde to bydlí, jak to spolu mluví.

**Postup:**

1. **Stránky** — projít všechny HTML soubory v `Server/public/`, vypsat účel, sekce, hlavní interakce.
   - `index.html` (Dashboard hlavní)
   - `calendar.html` (Kalendář polí + plánování)
   - `history.html` (grafy historie)
   - `help.html` (nápověda)
   - ~~`profit.html` — vynecháno~~

2. **Sekce na hlavním dashboardu** — KPI hero, Pole, Vozidla, Zvířata, Sklady, Výrobny, Ceny, Počasí. Pro každou: data origin (Lua → server enrich? XML? historie?), drag-and-drop, flash, hide.

3. **Sdílené moduly** — `app.js`, `state.js`, `theme.js`, `bell.js`, `notifications.js`, `serverSync.js`, `tabletools.js`, `sortable.js`, `crop-icons.js`. Krátký popis API každého.

4. **Backend** — `Server/index.js`, `db.js`, `savegame.js`, `logger.js`. Endpointy, WS, enrich pipeline.

5. **Lua mod** — `FS25/DashboardExport.lua`. Hlavní `collect*` helpery, JSON encoder, schema verze.

6. **Integrace třetích stran** — Courseplay, AutoDrive, vanilla AI. Co dashboard čte a kde.

7. **State management** — DashState klíče v `state.js`, ServerSync klíče v `serverSync.js`, localStorage namespace.

**Deliverable:** sekce `## Aplikace — inventura` v `DEV-GUIDE.md`.

---

## Fáze 2 — Soupis testovacích scénářů

**Cíl:** pro každou funkční oblast vyjmenovat scénáře (happy path + edge cases).

**Struktura per scénář:**

```
### Scénář: <jméno>
**Stránka:** index.html
**Předpoklad:** mock posílá X
**Akce:** uživatel udělá Y
**Očekáváno:** UI ukazuje Z
**Edge cases:**
- prázdná data
- threshold boundary (0 %, 100 %)
- WS reconnect během akce
- multi-tab sync
```

**Kategorie scénářů:**

A. **Per-page render**
   - Dashboard: prázdná farma, 1 pole, 20 polí, 0 zvířat, plné silo, prázdné silo
   - Calendar: 0 plánů, plán na 1 rok, plán na 5 let, ozimá pšenice (wrap přes rok), kolize plan-tasků
   - History: žádná historie, 1 hodnota, 100 hodnot, gap v datech
   - Help: statika (jen smoke)

B. **Interakce**
   - Drag-and-drop hide/show ve všech tabulkách
   - Klik na řádek pole v Ganttu → výběr v editoru
   - Plán: přidat rok, smazat plán, výběr plodiny, refresh stránky mid-edit (memo guard)
   - Bell: klik na X / klik na řádek / Skrýt vše / re-fire po změně podmínky

C. **Cross-page**
   - DashState klíče sdílené přes stránky (skrytá pole na dashboardu = skrytá v kalendáři)
   - ServerSync — multi-tab/multi-device propagation
   - Theme switch ve všech 5 motivech (dark-green, dark-blue, light, high-contrast, fs25-native)

D. **State changes**
   - Flash: fuel ↑↓, fields growth, implements 100/0%, animals count, storage amount
   - Bell threshold překroky: low fuel, low food, ready harvest, full silo
   - WS reconnect: server stop → start, klient si data nepřemaže

E. **Edge cases**
   - Field empty (žádná plodina, owned)
   - Crop withered / cut (stubble)
   - Pickup wagon empty (label "—") vs filled
   - AI task: vanilla / Courseplay / AutoDrive, různé fáze
   - Game year wrap (winter wheat, plowing in autumn of year N for sow in year N+1)
   - Žádné implementy

**Deliverable:** `TEST-SCENARIOS.md`.

---

## Fáze 3 — Mock server rozšíření

**Cíl:** scriptovatelný mock, který umí přepínat scénáře přes env var nebo HTTP endpoint.

**Aktuální stav:** `Server/scripts/mock-data.js` generuje náhodná data každých 5 s. Neumí scénáře.

**Co přidat:**

1. **Scenario module** — `Server/scripts/mock-scenarios.js` exportuje pojmenované scénáře jako funkce vracející payload:
   ```js
   module.exports = {
       'empty-farm':       () => ({ fields: [], vehicles: [], ... }),
       'harvest-ready':    () => ({ fields: [{ id:1, isReadyToHarvest:true, ... }], ... }),
       'low-fuel':         () => ({ vehicles: [{ name:'T1', fuelPercent:8, ... }] }),
       'animal-needs':     () => ({ animals: [{ husbandryName:'X', foodPercent:15 }] }),
       'wagon-filling':    (tick) => ({ vehicles: [/* wagon at tick*10% */] }),
       'plan-3-years':     () => ({ availableFruits:[...], gameYear:3 }),
       // …
   };
   ```

2. **CLI scenario switch** — `node scripts/mock-data.js --scenario=harvest-ready`.

3. **HTTP scenario endpoint** — `POST /mock/scenario` (v dev módu) přepne aktivní scénář bez restartu mocku. Užitečné pro Playwright testy: jeden mock proces, mnoho testů.

4. **Time progression** — `--scenario=wagon-filling` posune tick každé 2 s, takže wagon postupně plní z 0 → 100 %. Umožní testovat flash boundary.

**Deliverable:** rozšíření `scripts/mock-data.js` + nový `scripts/mock-scenarios.js`. Sekce `## Mock server` v `DEV-GUIDE.md`.

---

## Fáze 4 — UI testy přes screenshoty

**Cíl:** pro každý scénář získat screenshot na všech relevantních stránkách, vizuálně ověřit, uložit jako baseline.

**Infrastruktura:**

1. **Playwright fixtures** — rozšířit `Server/test/smoke/`:
   - `screenshots/` adresář pro baselines
   - `playwright.config.js` přidá `expect.toHaveScreenshot` pro vizuální diff (existující smoke používá jen `screenshot: 'only-on-failure'` — chybí baseline porovnání)

2. **Per-scenario spec** — `test/smoke/scenarios.spec.js`:
   ```js
   for (const scenario of SCENARIOS) {
       test(scenario.name + ' — dashboard', async ({ page }) => {
           await setMockScenario(scenario.name);
           await page.goto('/');
           await page.waitForFunction(...);  // wait for first paint
           await expect(page).toHaveScreenshot(`${scenario.name}-dashboard.png`);
       });
       // calendar, history, help
   }
   ```

3. **Theme matrix** — pro každý theme vyrenderovat hlavní stránku v každém scénáři. 5 × N = může být moc; vybrat 3 reprezentativní scénáře × 5 themes.

4. **Interakční testy** — Playwright klikací testy nad statickým mockem:
   - drag-and-drop hide
   - bell dismiss
   - calendar row click → editor select
   - settings modal tab switching

**Pravidla pro screenshot baselines:**

- Maskovat dynamické prvky (čas v navbaru, "Live" indikátor) přes `mask: [page.locator(...)]` v Playwright API.
- Threshold na pixel diff: 0.5 % (zachytí změny layoutu, toleruje font sub-pixel render).

**Deliverable:** nové testy v `Server/test/smoke/`, screenshot baselines v `Server/test/smoke/screenshots/`. Sekce `## Testy + screenshots` v `DEV-GUIDE.md`.

---

## Fáze 5 — Dokumentace

**Dva dokumenty:**

### `USER-GUIDE.md`

Pro koncového uživatele (modder, hráč FS25). CZ-first podle preference uživatele.

Struktura:

1. Co Dashboard dělá (overview)
2. Instalace (mod + server)
3. Spuštění (start.bat / npm start)
4. Stránky:
   - Dashboard (sekce, KPI, drag/hide, flash, zvoneček)
   - Kalendář polí (Gantt, sticky cols, plánování klikem)
   - Historie (grafy)
   - Nápověda
5. Nastavení (Settings modal: motivy, flash toggles, basic/expanded vehicles, sync mode)
6. Notifikace (zvoneček + browser notifications)
7. Plánování plodin (per-pole, multi-year, jak se generují task bars)
8. Multi-device sync (ServerSync)
9. Troubleshooting (mod neexportuje, server nevidí data, WS disconnect, atd.)

### `DEV-GUIDE.md`

Pro budoucího vývojáře (nebo Claude v další session). EN nebo CZ podle volby.

Struktura:

1. Architektura (3 vrstvy: Lua → Server → Frontend)
2. Datový tok (JSON → enrich pipeline → WS broadcast → DashState localStorage)
3. Aplikace — inventura (z Fáze 1)
4. Mock server (z Fáze 3)
5. Testy + screenshots (z Fáze 4)
6. Schema verze + COMPATIBILITY.md odkaz
7. State klíče (DashState/ServerSync registry)
8. Časté pasti (Lua `or` + 0, `position:sticky` v `<td>`, `display:none` vs UA hidden, flex on table-cell)
9. Build/deploy (FS25 mod ZIP, `/fs25-build`, `/publish` skill)
10. Debug recepty (jak číst log.txt, dashboard_data.json, kde je live FS25 save)

**Deliverable:** `USER-GUIDE.md` + `DEV-GUIDE.md`.

---

## Fáze 6 — Bug soupis

**Cíl:** všechno, co v Fáze 4 vyletělo jako rozdíl od očekávání, sepsat s reprodukčními kroky.

**Šablona per bug:**

```
### BUG #N — <krátký název>
**Severity:** crit / high / med / low
**Stránka:** /calendar.html
**Reprodukce:**
1. Nastav mock na scénář X
2. Otevři /calendar.html
3. Klikni Y
**Očekáváno:** Z
**Pozorováno:** Q
**Pravděpodobná příčina:** (file:line + krátký popis)
**Návrh fixu:**
**Screenshot:** screenshots/bug-N.png
```

**Kategorie bugů, na které se cíleně zaměřit (na základě dosavadní práce):**

- Calendar: sticky cols vs scrollbar, has-plan-2 row height edge cases, plan editor memo guard při rychlé interakci
- Vehicles: implement flash on schema změny (pickup wagon z prázdné na grass), basic vs expanded view persistence
- Bell: dismissed set se neresetuje po refresh (záměrné — session-only), ale uživatel by mohl chtít persistent
- ServerSync: race condition při paralelním zápisu z dvou tabů
- Themes: layout posun při přepnutí (Light má jiné padding než Dark?)
- AI badge: chybějící integrace AutoDrive vs Courseplay, fallback na vanilla AI

**Deliverable:** `BUGS-2026-05.md`.

---

## Agent `dashboard-qa`

Po dokončení tohoto kola vytvořit agenta v `.claude/agents/dashboard-qa.md` se shrnutím:

- Když je vyvolán, projde kroky 1–6 automaticky pro aktuální stav repa
- Tools: `Read, Write, Edit, Glob, Grep, Bash, PowerShell`
- Promptové vodítko: "Aktualizuj `BUGS-2026-05.md`, `USER-GUIDE.md`, `DEV-GUIDE.md`, `TEST-SCENARIOS.md` podle aktuálního kódu. Spusť Playwright suite. Pokud screenshoty drift > 0.5 %, zaznamenej jako bug."

---

## Postup v této session

Tahle session pojede v pořadí:

1. ✅ QA-PLAN.md (tento dokument)
2. Dashboard-qa agent definice
3. Fáze 1 (inventura) — vyplodí `DEV-GUIDE.md` skeleton
4. Fáze 2 (test scénáře) — `TEST-SCENARIOS.md`
5. Fáze 3 (mock rozšíření) — kód + sekce v `DEV-GUIDE.md`
6. Fáze 4 (UI testy) — testy + screenshoty + populate `BUGS-2026-05.md`
7. Fáze 5 (docs) — dotáhnout `USER-GUIDE.md` + `DEV-GUIDE.md`
8. Fáze 6 (bug list) — finalizovat `BUGS-2026-05.md` z nálezů

Pokud kontext začne tlačit, fáze 4 (screenshoty) se může delegovat na `dashboard-qa` agenta (background) a hlavní thread se věnuje dokumentaci.
