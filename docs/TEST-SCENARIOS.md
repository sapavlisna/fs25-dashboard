# Test Scenarios — FS25 Dashboard

Kompletní soupis scénářů pro manuální/automatizované testování. Slouží jako referenční checklist pro `dashboard-qa` agenta + Playwright suite v `Server/test/smoke/`.

**Vyloučeno:** `/profit.html` (na pokyn uživatele).

Šablona per scénář:

```
### SC-N — <jméno>
**Stránka:** /
**Mock scenario:** name nebo náhodný mock
**Předpoklad:** stav dat
**Akce:** uživatelská akce (nebo „žádná, jen render")
**Očekáváno:** vizuální + funkční výsledek
**Pokrytí:** UI / data / state / cross-page
```

---

## A. Per-page render scenarios

### SC-01 — Prázdná farma
- **Stránka:** /
- **Mock:** `{ fields:[], vehicles:[], animals:[], storage:[], productions:[], prices:[], farmBalance:{balance:0} }`
- **Očekáváno:** KPI cards ukazují 0, sekce mají empty-state placeholders, žádný console error.

### SC-02 — Jen pole, žádná vozidla
- **Stránka:** /
- **Mock:** 5 polí (mix růst/sklízet/prázdné), 0 vozidel
- **Očekáváno:** sekce Pole vyrenderovaná, sekce Vozidla empty-state.

### SC-03 — 1 vozidlo, 1 implement
- **Stránka:** /
- **Mock:** vehicle + Opalenica wagon at 50 % grass
- **Očekáváno:** basic view — vehicle row + `vc-impl-summary` "Opalenica T-050/1 · Tráva 50 %" pod ní.

### SC-04 — 1 vozidlo, multi-implement
- **Stránka:** /
- **Mock:** combine + harvester header + grain tank (2 fillUnits) + chaser bin behind
- **Očekáváno:** summary chip line per fillUnit, expanded view ukazuje plný rozpad.

### SC-05 — 20 polí (stress)
- **Stránka:** /calendar.html
- **Mock:** 20 polí s různými plodinami + 3 skrytá
- **Očekáváno:** tabulka stable, sticky cols držet, scroll thumb proporční. Skrytá zóna ukazuje 3.

### SC-06 — Calendar prázdný plán
- **Stránka:** /calendar.html
- **Předpoklad:** žádné `fieldPlans` v DashState
- **Očekáváno:** Gantt timeline ukazuje jen růstové bary, editor empty-state "↑ Klikni na řádek pole".

### SC-07 — Calendar 5-letý plán (max)
- **Stránka:** /calendar.html
- **Předpoklad:** field #1 plan = `{2:WHEAT, 3:BARLEY, 4:CANOLA, 5:SUNFLOWER, 6:MAIZE}` (gameYear=1)
- **Akce:** klik na řádek #1
- **Očekáváno:** editor otevře 5 year rows, "+ Přidat rok" disabled (max reached). Gantt ukazuje task bars budoucích roků (limited by view window).

### SC-08 — Ozimá pšenice (year wrap)
- **Stránka:** /calendar.html
- **Předpoklad:** WHEAT plantableMonths = [.,.,.,.,.,.,.,true,true,...], harvestableMonths = [...,true,true,...,]
- **Očekáváno:** Sow window ve měsíci 8–9 (autumn), harvest ve měsíci 5–6 NEXT YEAR. Harvest bar musí být POZDĚJI v timeline než sow (žádný "harvest before sow" bug).

### SC-09 — History prázdná
- **Stránka:** /history.html
- **Mock:** Empty `data/*.jsonl`
- **Očekáváno:** "Nedostatek dat" placeholder ve všech grafech, KPI ukazují 0.

### SC-10 — History 1 hodnota
- **Stránka:** /history.html
- **Mock:** 1 balance entry
- **Očekáváno:** Buď zobrazí 1-bod graf, nebo placeholder. Žádný NaN crash.

### SC-11 — Help static
- **Stránka:** /help.html
- **Předpoklad:** žádný server, jen statika
- **Očekáváno:** TOC sticky, všechny sekce anchors funkční, screenshots loadují.

---

## B. Interakce — drag-and-drop hide/unhide

### SC-12 — Hide field on dashboard (drag)
- **Stránka:** /
- **Akce:** drag field row na "Skrytá pole" zone
- **Očekáváno:** field zmizí z visible list, "Skrytá pole (N)" počet ↑1, persist přes refresh.

### SC-13 — Unhide field (drag back)
- **Stránka:** /
- **Akce:** drag z hidden zone zpět nahoru
- **Očekáváno:** field zpět ve visible, počet ↓.

### SC-14 — Hide field na calendar
- **Stránka:** /calendar.html
- **Akce:** drag field row do hidden zone pod tabulkou
- **Očekáváno:** stejné jako SC-12, ale na Calendar stránce. **Cross-page:** field je teď skryté i na /.

### SC-15 — Reorder sections
- **Stránka:** /
- **Akce:** drag section header (drag handle)
- **Očekáváno:** sekce přerovnaná, `order:sections` v localStorage updateno.

### SC-16 — Toggle section visibility v Settings
- **Stránka:** / (Settings modal)
- **Akce:** uncheck "Sklady"
- **Očekáváno:** sec-storage zmizí, `hiddenSections` v DashState má `sec-storage`.

### SC-17 — Vehicle hide via drag
- **Stránka:** /
- **Akce:** drag vehicle row
- **Očekáváno:** vehicle skryté, badge tooltip "Pole s vozidlem skryto, drag zpět pro show".

---

## C. Interakce — Bell

### SC-18 — Bell shows alerts
- **Stránka:** /
- **Mock:** low fuel vehicle + ready field + low food animal
- **Očekáváno:** badge = 3, klik → panel s 3 řádky.

### SC-19 — Bell dismiss X
- **Stránka:** /
- **Akce:** klik ✕ na konkrétním alertu
- **Očekáváno:** řádek zmizí, badge ↓1, panel zůstává otevřený.

### SC-20 — Bell row click dismiss + scroll
- **Stránka:** /
- **Akce:** klik na řádek alertu (ne ✕)
- **Očekáváno:** panel zavře, scroll do dotčené sekce, sekce pulsne, alert dismissed, badge ↓.

### SC-21 — Bell "Skrýt vše"
- **Stránka:** /
- **Akce:** klik "Skrýt vše" button
- **Očekáváno:** všechny současné alerty dismissed, badge = 0, "Žádná upozornění" empty state.

### SC-22 — Bell re-fire po změně podmínky
- **Stránka:** /
- **Mock:** vehicle low fuel → dismiss → mock přidá DRUHÉ vehicle low fuel
- **Očekáváno:** Alert re-fires (items array změnilo se → nový fingerprint), badge ↑.

### SC-23 — Bell session-only dismiss
- **Stránka:** /
- **Akce:** dismiss alert → reload stránky
- **Očekáváno:** alert se vrátí (dismissed Set je session-only).

---

## D. Calendar — interakce

### SC-24 — Click row → select field
- **Stránka:** /calendar.html
- **Akce:** klik na řádek pole #5
- **Očekáváno:** chip "Pole #5 · X.X ha" v editor headeru, plan-years section vyrenderovaný, řádek highlighted (`.selected`).

### SC-25 — Switch field
- **Stránka:** /calendar.html
- **Akce:** klik na #5, pak klik na #7
- **Očekáváno:** highlight se přesune, editor ukazuje #7 plán, ne #5.

### SC-26 — Clear field selection
- **Stránka:** /calendar.html
- **Akce:** klik ✕ na chipu
- **Očekáváno:** chip zmizí, editor empty state, žádný row .selected.

### SC-27 — Plan: add year
- **Stránka:** /calendar.html
- **Předpoklad:** field selected, žádný plán
- **Akce:** klik "+ Přidat rok"
- **Očekáváno:** year row přidaný (gameYear+1), select s plodinami.

### SC-28 — Plan: select crop
- **Stránka:** /calendar.html
- **Akce:** vybrat "Pšenice" v year row
- **Očekáváno:** Gantt timeline ukazuje task bars (vápnění/orba/setba 'Pšenice'/hnojení/sklizeň/válení).

### SC-29 — Plan: 6th year (over max)
- **Stránka:** /calendar.html
- **Předpoklad:** 5-year plán existuje
- **Akce:** klik "+ Přidat rok"
- **Očekáváno:** disabled button, alert "Max 5 let dopředu".

### SC-30 — Plan: delete year
- **Stránka:** /calendar.html
- **Akce:** klik × na year row
- **Očekáváno:** year zmizí, Gantt task bars pro daný rok zmizí.

### SC-31 — Plan: clear all
- **Stránka:** /calendar.html
- **Akce:** klik "Smazat plán" → potvrdit
- **Očekáváno:** všechny year rows zmizí, editor empty (ale field stále selected).

### SC-32 — Plan: dropdown stays open during WS tick
- **Stránka:** /calendar.html
- **Akce:** otevři crop dropdown, počkej 3 s (přes 2 s WS tick)
- **Očekáváno:** dropdown zůstává otevřený, ne re-rendered (memo guard).

### SC-33 — Hidden zone collapse default
- **Stránka:** /calendar.html
- **Předpoklad:** 3 skryté pole
- **Očekáváno:** "Skrytá pole 3" sep ▶ (collapsed default).

### SC-34 — Hidden zone toggle
- **Stránka:** /calendar.html
- **Akce:** klik na "Skrytá pole 3" sep
- **Očekáváno:** rozbalí se, ▼ icon, hidden rows visible. Persists přes WS tick.

---

## E. Cross-page state sync

### SC-35 — Hide field syncs across pages
- **Stránka:** /
- **Akce:** hide field #5 na / → switch na /calendar.html
- **Očekáváno:** field #5 ve "Skrytá pole" zóně, ne ve visible Gantt.

### SC-36 — Plan persists across reload
- **Stránka:** /calendar.html
- **Akce:** plan WHEAT na #1 → F5
- **Očekáváno:** plan obnovený z DashState.

### SC-37 — Theme switch sync
- **Stránka:** /
- **Akce:** Settings → Light → switch na /history.html
- **Očekáváno:** /history.html taky Light theme (per-page pre-paint script).

### SC-38 — Multi-tab sync (ServerSync)
- **Stránka:** / (2 taby)
- **Akce:** tab 1 hide field → check tab 2
- **Očekáváno:** tab 2 dostal WS patch, field skryté i tam.

### SC-39 — ServerSync OFF doesn't propagate
- **Stránka:** / (2 taby)
- **Akce:** tab 2 Settings → sync OFF; tab 1 hide field
- **Očekáváno:** tab 2 ignoruje patch, field zůstává visible.

### SC-40 — Sync force pull
- **Stránka:** /
- **Akce:** Settings → "Načíst ze serveru"
- **Očekáváno:** lokální state přepsaný server values, indikátor success.

---

## F. State changes — flash framework

### SC-41 — Vehicle fuel ↑ flash green
- **Stránka:** /
- **Mock:** fuel 30 % → 90 % over 2 ticks (refuel)
- **Očekáváno:** vehicle row 10s zelená.

### SC-42 — Vehicle fuel ↓ flash red
- **Stránka:** /
- **Mock:** fuel 90 % → 30 %
- **Očekáváno:** červená 10s.

### SC-43 — Implement reach 100% flash
- **Stránka:** /
- **Mock:** Opalenica 99 % → 100 % grass
- **Očekáváno:** vehicle row 10s zelená (impl flash wins over fuel).

### SC-44 — Implement reach 0% flash
- **Stránka:** /
- **Mock:** trailer 50 % → 0 % (unload)
- **Očekáváno:** červená 10s.

### SC-45 — Field growth advance flash
- **Stránka:** /
- **Mock:** field growthState 3 → 4
- **Očekáváno:** fields tabulka řádek 10s zelená.

### SC-46 — Animal count change flash
- **Stránka:** /
- **Mock:** husbandry count 50 → 52 (new births)
- **Očekáváno:** zelená 10s.

### SC-47 — Flash disabled per section
- **Stránka:** / (Settings)
- **Akce:** uncheck flash toggle pro Vozidla → trigger fuel change
- **Očekáváno:** žádný flash na vehicles, ale jiné sekce flashují normálně.

---

## G. State changes — Bell thresholds

### SC-48 — Bell low fuel threshold crossing
- **Stránka:** /
- **Mock:** vehicle fuel 16 % → 14 %
- **Očekáváno:** alert "veh-fuel" se objeví, badge ↑.

### SC-49 — Bell low food
- **Stránka:** /
- **Mock:** husbandry foodPercent 26 % → 24 %
- **Očekáváno:** alert "anim-food".

### SC-50 — Bell harvest ready
- **Stránka:** /
- **Mock:** field isReadyToHarvest = true
- **Očekáváno:** alert "field-ready", severity info.

### SC-51 — Bell full silo
- **Stránka:** /
- **Mock:** storage item amount/capacity = 0.96
- **Očekáváno:** alert "storage-full", severity info.

---

## H. WS / network edge cases

### SC-52 — WS reconnect
- **Stránka:** /
- **Akce:** kill server, počkej 5 s, restart
- **Očekáváno:** klient `Připojování…`, pak `Live`, data se obnoví, žádný JS error.

### SC-53 — Server pomalý startup
- **Stránka:** /
- **Předpoklad:** server běží ale `dashboard_data.json` neexistuje
- **Očekáváno:** "Čeká na data ze serveru…" empty state, žádný crash.

### SC-54 — Schema mismatch warning
- **Stránka:** /
- **Mock:** payload `schemaVersion: 99`
- **Očekáváno:** server log warní, klient pokračuje (best-effort render).

---

## I. Theme matrix

### SC-55 — Theme `dark-green` (default)
- **Stránka:** /
- **Očekáváno:** zelený accent, tmavé pozadí. Snapshot baseline.

### SC-56 — Theme `dark-blue`
- **Stránka:** /
- **Očekáváno:** modrý accent, tmavé pozadí.

### SC-57 — Theme `light`
- **Stránka:** /
- **Očekáváno:** světlé pozadí, čitelnost zachována.

### SC-58 — Theme `high-contrast`
- **Stránka:** /
- **Očekáváno:** vysoký kontrast, WCAG AAA.

### SC-59 — Theme `fs25-native`
- **Stránka:** /
- **Očekáváno:** brand color #A0C213, NunitoSans font.

### SC-60 — Theme switch persists cross-page
- **Stránka:** / → switch Light → switch /calendar.html
- **Očekáváno:** Light na všech stránkách (pre-paint script).

---

## J. Edge cases

### SC-61 — Field empty (owned, žádná plodina)
- **Stránka:** /calendar.html
- **Mock:** field owned, `fruitTypeId = 0`, `needsSowing = true`
- **Očekáváno:** v Ganttu žádný růstový bar, místo něj "Sít" indicator. Pill "Sít" v needs.

### SC-62 — Field withered
- **Stránka:** /calendar.html
- **Mock:** field `isWithered = true`
- **Očekáváno:** červený růstový bar s textem "Zvadlé".

### SC-63 — Field cut (stubble)
- **Stránka:** /calendar.html
- **Mock:** field `isCut = true`
- **Očekáváno:** muted bar "Sklizeno", pill "Kultivovat" v needs.

### SC-64 — Pickup wagon empty (no history)
- **Stránka:** /
- **Mock:** Opalenica `fillType=0, lastValid=0, capacity=10000`
- **Očekáváno:** v expanded view "Opalenica T-050/1 · — · 0 / 10 t · 0 %". Label em-dash, ne "Pšenice" (no supportedFillTypes guess).

### SC-65 — AI task: Courseplay
- **Stránka:** /
- **Mock:** vehicle `aiTask = { source: 'courseplay', jobType: 'fieldwork', progress: 0.55 }`
- **Očekáváno:** AI badge "🚜 Courseplay 55 %".

### SC-66 — AI task: AutoDrive with ETA
- **Stránka:** /
- **Mock:** vehicle `aiTask = { source: 'autodrive', destination: 'Sklad', etaText: '5 min' }`
- **Očekáváno:** badge "🚛 → Sklad (5 min)".

### SC-67 — AI task: vanilla
- **Stránka:** /
- **Mock:** `aiTask = { source: 'vanilla', jobType: 'BALE_LOADING', helperName: 'Jakub' }`
- **Očekáváno:** badge "AI Jakub · BALE_LOADING".

### SC-68 — No implements on vehicle
- **Stránka:** /
- **Mock:** tractor bez attached implements
- **Očekáváno:** žádná summary chipline, žádný vc-impl-summary div.

### SC-69 — Multiple production placeables
- **Stránka:** /
- **Mock:** 5 production placeables s různými inputs/outputs
- **Očekáváno:** vše vyrenderované, drag-drop funguje, hide funguje.

### SC-70 — Storage farm-owned filter
- **Stránka:** /
- **Mock:** mix farm-owned + public silos
- **Očekáváno:** Lua mod filtruje na farmId match (`ownerFarmId == player farm`), public silos se neukazují.

---

## K. Performance / stress

### SC-71 — 100 polí
- **Stránka:** /
- **Mock:** 100 fields
- **Očekáváno:** render < 500 ms, scroll smooth, žádný layout thrash.

### SC-72 — 50 vozidel
- **Stránka:** /
- **Mock:** 50 vehicles
- **Očekáváno:** render OK, expanded view smooth scroll.

### SC-73 — 10 stránek historie (50 dní balance)
- **Stránka:** /history.html
- **Mock:** 50-day balance.jsonl
- **Očekáváno:** graf renderuje, Chart.js bez crash.

---

## L. Smoke (already in `test/smoke/`)

### SC-74 — All pages load without console errors
- Aktuální `dashboard.spec.js` testy.

### SC-75 — Theme switch — všech 5 motivů
- Aktuální theme matrix v `dashboard.spec.js`.

### SC-76 — Drag interactions
- `drag.spec.js` 7 testů.

### SC-77 — Drag visual diff
- `drag-visual.spec.js`.

---

## Pokrytí přehled

| Kategorie | # scénářů | Stav pokrytí (existing tests) |
|---|---|---|
| Per-page render | 11 (SC-01..11) | 2 (smoke) |
| Hide/unhide | 6 (SC-12..17) | 2 (drag.spec.js) |
| Bell | 6 (SC-18..23) | 0 |
| Calendar | 11 (SC-24..34) | 0 |
| Cross-page sync | 6 (SC-35..40) | 0 |
| Flash | 7 (SC-41..47) | 0 |
| Bell thresholds | 4 (SC-48..51) | 0 |
| WS edge | 3 (SC-52..54) | 0 |
| Theme matrix | 6 (SC-55..60) | 5 (smoke) |
| Edge cases | 10 (SC-61..70) | 0 |
| Performance | 3 (SC-71..73) | 0 |
| Existing smoke | 4 (SC-74..77) | 20 (smoke) |
| **Total** | **77** | **29 (~38 %)** |

Velký prostor pro rozšíření Playwright suite — viz `QA-PLAN.md § Fáze 4`.

---

## Mock scenario API (target stav)

Po dokončení `QA-PLAN.md § Fáze 3` bude možné:

```bash
# CLI switch
node scripts/mock-data.js --scenario=harvest-ready

# HTTP switch (during Playwright run)
curl -X POST http://localhost:3099/mock/scenario -d '{"name":"low-fuel"}'

# Time progression
node scripts/mock-data.js --scenario=wagon-filling
# tick 0: 0% → tick 5: 50% → tick 10: 100%
```

Scénáře mapují na konkrétní SC-čísla v tomto dokumentu.
