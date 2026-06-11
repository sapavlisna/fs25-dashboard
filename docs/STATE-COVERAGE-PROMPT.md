# Orchestrační prompt — kompletní mapa stavů + izolované testy Dashboardu

> Účel dokumentu: prompt pro orchestrátora (Claude), který fan-outem agentů
> zdokumentuje **každý vizuální stav každé sekce a položky** Dashboardu, z té
> dokumentace vygeneruje mock-scénáře + funkční Playwright testy tak, aby šla
> **každá jednotlivá změna otestovat izolovaně**, a nakonec to ověří.
>
> Spouštět buď ručně řízenými agenty, nebo jako workflow (model overrides viz
> tabulka „Model tiers"). Sám orchestrátor nic needituje — jen koordinuje agenty.

---

## Kontext (pro orchestrátora)

Pracuješ v `e:\ClaudeProjects\FS25-dashboard`, projekt `src/Dashboard/`. Frontend
je vanilla JS bez bundleru; stavová logika UI je rozeseta mezi:

- `Server/public/index.html` — render funkce (`bar()`, `vehicleCardHTML`,
  `vehicleRightHTML`, animal / field / production / silo rendery, `donutSVG`)
- `Server/public/bell.js` — agregace alertů; prahy
  `FOOD_LOW=25`, `WATER_LOW=20`, `STRAW_LOW=25`, `OUTPUT_HI=90`, `FUEL_LOW=15`, `STORAGE_HI=95`
- `Server/public/app.js`, `theme.js`, `state.js` — DashState přepínače, které
  gateují render (`vehicleShowCondition`, `vehicleShowWorkerBadge`, …)
- `Server/scripts/mock-scenarios.js` — registr scénářů (mapa na konci souboru)
- `Server/scripts/mock-data.js` — runtime přepínání přes `POST /mock/scenario`
- testy: `Server/test/smoke/*.spec.js`; config `test/smoke/playwright.config.js`
  (port 3099, sandbox `.tmp/smoke`); spouští se přes
  `npm --prefix src/Dashboard/Server run smoke`
- vzor funkčního specu: `Server/test/smoke/low-fuel.spec.js`
  (helpery `setScenario`, `gotoDashboard`, `vehicleRow`)
- vzor čistého izolovaného scénáře: `scenarioLowFuel` v `mock-scenarios.js`

**Profit stránku (`/profit.html`) vynech** — uživatel ji z QA vyřadil.

---

## Cíl

1. **Fáze 1 (dokumentace, read-only):** pro každou sekci a každou položku zjistit
   *všechny* vizuální stavy — co je spouští (datové pole), přesnou podmínku/práh
   (s `file:line`), výsledný DOM (selektor + class/text), **křížové efekty**
   (které další povrchy totéž pole ovlivní) a stávající pokrytí.
2. **Fáze 2 (generování):** podle dokumentace přidat mock-scénáře + funkční
   Playwright specy tak, aby **každá jednotlivá změna šla otestovat izolovaně** —
   vždy na hranici prahu, z obou stran.
3. **Fáze 3 (verifikace):** nové testy musí běžet zeleně; výstup je matice
   pokrytí stav → scénář → spec.

---

## Model tiers (přiřazení modelu k typu úkolu)

**Princip:** silný model (**Opus + thinking**) tam, kde je chyba **tichá a šíří se
dál** — špatně pochopené provázání ve Fázi 1 nebo v konsolidaci rozbije izolaci
testů, aniž to verifikace odhalí. Levný model (**Haiku**) tam, kde je úkol
**rigidní/šablonový** a případná chyba spadne hned ve Fázi 3 na červeném testu.

| Typ úkolu | Model | Proč |
|---|---|---|
| Trasování provázaných větví + **mapa křížových efektů** (Fáze 1, složité povrchy) | **Opus + thinking** | Chyba tichá, propaguje se do návrhu testů; drží coupling napříč soubory |
| Enumerace přímočarých větví (Fáze 1, jednoduché povrchy) | **Haiku** | Mechanické „když pole X, třída Y"; málo provázání |
| **Konsolidace** — sloučení do cross-effect matice | **Opus + thinking** | Globální syntéza přes všechny povrchy; malý objem, vysoká páka |
| Fáze 2a — **návrh sady scénářů** (hraniční hodnoty, izolace, křížové efekty) | **Sonnet** (složité povrchy **Opus**) | „Co nastavit, ať netrefím vedlejší alert" je úsudek |
| Fáze 2b — **napsání spec souboru** ze schváleného návrhu | **Haiku** | Vyplnění šablony; chyba spadne na testu |
| Fáze 3 — **spuštění + report** | **Haiku** | Spustit `npm run smoke`, posbírat PASS/FAIL |
| Fáze 3 — **diagnóza červeného testu** (špatná aserce / scénář / reálný bug?) | **Sonnet → eskalace Opus** | Rozlišit tyhle tři je úsudková práce |

Dělící čára: **„rozhodování o coupling/hranicích" (silný) vs „vyplnění šablony" (slabý).**
Ve workflow zápisu dostane každý `agent()` `model:` override podle této tabulky;
default (dědění hlavního modelu) nech tam, kde tabulka nic neříká.

---

## Mapa povrchů — fan-out, 1 agent = 1 povrch

Fázi 1 spusť jako **paralelní read-only agenty** (Explore / general-purpose),
každý vlastní jeden povrch. Sloupec **Model** určuje tier dle tabulky výše.

| # | Povrch | Hlavní zdroj | Model |
|---|---|---|---|
| 1 | Vozidla — palivo/AdBlue bar, kondice, rychlost, motohodiny, in-use dot, AI/worker badge, implementy, flash, skrytá vozidla | `index.html` `vehicleCardHTML`/`vehicleRightHTML`/`bar()` | **Opus+think** |
| 2 | Pole — plodina/prázdné, růst, ready/sowing/plowing/lime, weed, fertilizace, kameny, dnů do sklizně, owned/leased | `index.html` field render | **Opus+think** |
| 3 | Zvířata — count/maxCount (cap), food/water/straw, výstupy (mléko/hnůj) full, produktivita, clustery (status blocked/young, health, reprodukce) | `index.html` animal render | **Opus+think** |
| 4 | Produkce — status receptu (active/noInput/outputFull), cykly/h, náklady/h, items vs kapacita | `index.html` production render | **Sonnet** |
| 5 | Sklady/sila — donut (warn ≥70, full ≥95), množství/kapacita, owner | `index.html` `donutSVG`/silo render | **Sonnet** |
| 6 | **Zvonek (cross-cutting)** — 6 prahů, seskupení alertů, severity, dismiss, interakce se skrytými vozidly, badge count, scroll na cíl | `bell.js` | **Opus+think** |
| 7 | Počasí — typeId→ikona/titulek, teploty min/max, předpověď | `index.html` weather render | **Haiku** |
| 8 | Ceny / sezónní křivka — cena/t per výkup, 12-faktorová křivka, click-to-watch, currentPeriod | `index.html` + history | **Sonnet** |
| 9 | KPI lišta — balance/čas/den/owned, placeholder „—" vs hodnota | `index.html` KPI render | **Haiku** |
| 10 | Události — typy sow/harvest/spray, dedup, timestamps | `index.html` events | **Haiku** |
| 11 | **Flash systém (cross-cutting)** — flash-up/down trigger, priorita impl-flash | `index.html` `getFlashCls`/`getImplFlashCls` | **Opus+think** |
| 12 | **Témata (cross-cutting)** — 5 témat, `data-theme`, tokeny | `theme.js`, `style.css` | **Sonnet** |
| 13 | Kalendář (`/calendar.html`) | stránka + sdílené rendery | **Sonnet** |
| 14 | Historie (`/history.html`) — grafy, KPI, empty-state | stránka + Chart.js | **Sonnet** |

---

## Fáze 1 — prompt pro dokumentačního agenta (šablona)

Dosaď `{POVRCH}`, seznam souborů a model dle tabulky.

> Jsi read-only analytik. Prozkoumej povrch **„{POVRCH}"** Dashboardu. Přečti
> uvedené soubory a vystopuj **každou** větev, která mění vykreslený DOM (CSS
> třídu, text, viditelnost, ikonu). NESPOUŠTĚJ nic, needituj kód.
>
> Pro každý nalezený stav zaznamenej:
> - **stav** — krátký název (např. „palivo kriticky nízké")
> - **trigger** — datové pole(a) z payloadu (`vehicles[].fuelPercent`)
> - **podmínka** — přesný výraz a práh + `file:line` (`pct <= 20`, `index.html:305`)
> - **DOM** — selektor a výsledná třída/text (`.vc-fuel .bar-fill.danger`)
> - **křížové efekty** — jiné povrchy, které totéž pole ovlivňuje (např.
>   `fuelPercent` → bar *i* zvonek `veh-fuel`); přepínače DashState, které render
>   gateují (`vehicleShowCondition`)
> - **stávající pokrytí** — existuje scénář v `mock-scenarios.js` / spec, který to
>   trefí? (cituj jméno)
>
> Zachyť i **hraniční hodnoty** (kde přesně se třída přepne) a **mezistavy**
> (žádná třída = OK stav).
>
> Výstup zapiš do `src/Dashboard/docs/state-map/{povrch}.md` jako tabulku s výše
> uvedenými sloupci + nahoře 3 odrážky: které soubory jsi četl, kolik stavů jsi
> našel, největší riziko (nepokrytá/provázaná větev). Vrať jen strukturovaný
> souhrn (ne dump kódu).

**Strukturovaný výstup** (vynuť `schema`): pole objektů
`{ surface, state, triggerFields[], condition, fileLine, domSelector, domClass, crossEffects[], coveredBy }`.

---

## Konsolidace (po Fázi 1) — **Opus + thinking**

Jeden agent slije všechny `state-map/*.md` do:

- `state-map/index.md` — celkový seznam + **matice křížových efektů** (které pole
  sahá do více povrchů — to je klíč pro izolaci testů)
- `state-map/states.json` — strojový seznam všech stavů (vstup pro Fázi 2)

---

## Fáze 2 — generování (fan-out po povrchu, dvoukrokově)

Rozděleno na dva kroky s různým modelem — kdyby šablonu psal slabý model bez
návrhu, netrefil by izolaci u provázaných polí; kdyby návrh dělal slabý model,
tiše by minul křížový efekt.

### 2a — návrh sady scénářů (**Sonnet**, složité povrchy **Opus**)

> Z `state-map/{povrch}.md` + `states.json` navrhni seznam scénářů: pro každý práh
> hodnotu **těsně pod** a **těsně nad**, plus seznam polí, která musí zůstat
> „zdravá", aby se netrhl vedlejší alert (dle cross-effect matice). Výstup =
> strukturovaný plán scénářů, **žádný kód**.

### 2b — codegen (**Haiku**)

> Podle schváleného plánu napiš scénáře do `mock-scenarios.js` (registruj v mapě na
> konci souboru) a specy do `test/smoke/state/{povrch}.spec.js` přesně podle vzoru
> `low-fuel.spec.js` (helpery `setScenario`/`vehicleRow`, funkční aserce). Nic
> nevymýšlej nad rámec plánu.

> **Pozor na race:** zápis scénářů do `mock-scenarios.js` serializuj do **jednoho**
> agenta (paralelní edity téhož souboru by se přepsaly). Spec soubory jsou
> per-povrch (`test/smoke/state/{povrch}.spec.js`), tedy paralelně bezpečné.

**Pravidla pro Fázi 2:**

1. **Izolace jedné proměnné.** Každý scénář nastaví jen to, co testuje, zbytek
   farmy drž „zdravý" (žádné vedlejší alerty). Vzor: `scenarioLowFuel`.
2. **Hranice prahu z obou stran.** Pro práh `< 15` udělej případ těsně pod (14)
   i těsně nad (15/16). Pojmenuj `…-boundary-low` / `…-boundary-ok`.
3. **Respektuj křížové efekty.** Pokud pole sahá do víc povrchů (fuel → bar +
   zvonek), test ověří *všechny* dopady, ne jen jeden.
4. **Funkční aserce, ne screenshoty** — aseruj třídu/text/count/atribut.
   Screenshot jen tam, kde je stav čistě layoutový.
5. Scénáře drž **deterministické** (žádné `Date.now()`/`Math.random()` kromě
   stávajícího `now()` helperu pro `exportedAt`).
6. Stav závislý na DashState přepínači nastav přes `addInitScript` +
   `localStorage` (vzor v `scenarios.spec.js`).
7. Nerozbij existující scénáře ani specy.

Po vygenerování vypiš pokrytí: stav → scénář → spec (a co se nedalo izolovat a proč).

---

## Fáze 3 — verifikace

**Spuštění + report (Haiku):**

> Spusť pouze nové specy: `npm --prefix src/Dashboard/Server run smoke -- state/`.
> Posbírej PASS/FAIL po jednotlivých testech.

**Diagnóza červeného testu (Sonnet → eskalace Opus):**

> U každého červeného rozhodni: špatná aserce / špatný scénář / **reálný bug**.
> Uprav scénář nebo aserci (NE produkční kód). Pokud najdeš reálný bug, zapiš ho do
> `docs/BUGS-*.md` a označ test `test.fixme` s odkazem na bug. Iteruj do zelena.

**Výstup:** matice pokrytí stav → scénář → spec → PASS/FAIL + seznam stavů, které
zůstaly nepokryté.

---

## Fáze 4 — kontrola (critic, read-only) — Sonnet, složité povrchy Opus

Vetkaná verifikace proti **tichému nedokončení** (ne druhý velký prompt „nad tím").
Per-povrch kritik útočí na to, co fan-out tiše mine:

1. **Úplnost** — re-grep zdroje na všechny výrazy přidělující DOM třídu/text/
   viditelnost (ternary, `classList`, `class=` v template literálech); cokoliv
   v kódu a chybí v `states.json` = díra.
2. **Věrnost** — namátkou ověř 3 `file:line` + prahy proti realitě kódu.
3. **Pravdivost pokrytí** — každý stav má scénář v `mock-scenarios.js` *i* aserci
   v `test/smoke/state/{povrch}.spec.js`, která ho **fakticky rozsvítí** (ne jen
   existuje), a spec ve Fázi 3 opravdu běžel (ne 0 testů / skip).

**Výstup:** `gaps` (typ: `missing-doc` | `wrong-threshold` | `missing-scenario` |
`missing-assert`) + verdict per povrch. Co kritik najde, jde do dalšího kola
Fáze 2 — **netiše zahodit**.

---

## Guardrails

- **Fáze 1 read-only** (žádné edity). Editovat smí jen Fáze 2/3, a to **jen**
  `mock-scenarios.js` + `test/smoke/state/*`.
- **Profit stránku vynechat.**
- Model override dávej jen tam, kde to tabulka říká — jinak nech dědění hlavního
  modelu, ať se neplýtvá.
- Orchestrátor sám nic needituje — pouze spouští agenty a slévá výsledky.

---

## Rozhodnutá nastavení (defaulty, lze změnit)

1. **Dokumentace → `src/Dashboard/docs/state-map/`** (1 `.md` na povrch + `index.md` + `states.json`).
2. **Nové testy → `test/smoke/state/`** (oddělené, jdou pouštět samostatně).
3. **Rozsah** = všech 14 povrchů včetně calendar/history, mimo profit.
