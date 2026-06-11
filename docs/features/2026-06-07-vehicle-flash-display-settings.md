# Flash + zobrazení položek u vozidel

**Status:** ROZPRACOVÁNO
**Datum:** 2026-06-07
**Soubory:** `src/Dashboard/Server/public/index.html`, `sectionCfg.js`, `style.css`

---

## 1. Cíl (zadání)

V panelu nastavení sekce **Vozidla** (otevírá se přes ⚙ v hlavičce) je dnes
jedna rozbalovací záložka „▶ Rozšířené nastavení". Uživatel chce:

1. **Novou rozbalovací záložku „Flash nastavení"** ve stejném stylu, s přepínači:
   - **(bod 1) Master přepínač „všechna vozidla"** — jedním přepínačem vypne/zapne
     flash pro celou sekci vozidel.
   - **(bod 2) Per-položkové přepínače** — flash zvlášť pro: rychlost, motohodiny,
     poškození (kondice), vzduch (AIR), palivo, naplnění plodinou/zbožím. Prostě
     vše, co se u vozidla zrovna zobrazuje.

2. **(bod 3) Rozšířit „Rozšířené nastavení"** o zobrazit/schovat **všech**
   zobrazovaných položek — stejný seznam jako u flashe (rychlost, motohodiny,
   kondice, vzduch, palivo, naplnění). Tj. paralela: jedna záložka řídí *jestli
   položka bliká*, druhá *jestli se vůbec zobrazuje*.

---

## 2. Současný stav (jak to funguje teď)

### Panel nastavení sekce — `sectionCfg.js`
- `SectionCfg.define(key, def)` registruje sekci. `def = { title, basic:[item],
  advanced:[{group, items, note}] }`.
- `_open()` vyrenderuje `basic` položky (vždy viditelné) + **jednu** rozbalovací
  záložku „▶ Rozšířené nastavení" (`advanced` skupiny).
- Položka může mít vlastní `get/set` (flash kanály žijí v separátní mapě, ne v
  obyčejném DashState klíči) — viz `_flashItem` v `index.html:2215`.
- `_isDirty` / `reset` iterují `_allItems(def)` = `basic + advanced.items`.

### Flash systém — `index.html`
- Stav: dvě mapy — `flashPrev` (poslední hodnota) a `flashes` (`{dir, expiresAt}`),
  klíč `${section}::${rowKey}`. Flash trvá 10 s, pak fade.
- **Master + kanály:** `DashState.flashEnabled` mapa.
  - `isFlashEnabled(section, channel)` — true jen když master `map[section]!==false`
    **a** zároveň `map[section::channel]!==false`.
  - `setFlashEnabled(section,on)` = master; `setFlashChannel(section,channel,on)` = kanál.
  - `_flashChannelOf(rowKey)` rozpozná jen prefixy `header::` / `item::`.
- **Vizuál:** třídy `.flash-up` / `.flash-down` se přidají na element. Aplikuje se
  buď **na celý řádek** (`getFlashCls` / `getImplFlashCls` na `.vehicle-row`), nebo
  **per-buňku** (u zvířat — `index.html:1178` tintí jednotlivé bary přes
  `getFlashCls('animals', p.fk)`). **Per-cell flash tedy v kódu už existuje.**

### Co se u vozidla teď trackuje pro flash
V `noteAllChanges` (`index.html:753`) se pro vozidla volá **jen**
`noteImplementFlashes(d.vehicles)` → tintí celý řádek při změně % naplnění nářadí.
Klíč `vehicles::impl::<vName>::<implName>::<i>`, kanál `impl`. AIR se přeskakuje
(`fillType==='AIR' → continue`). Fallback `getFlashCls('vehicles', v.name)` je
**mrtvý** — nic takový klíč nenastavuje. Palivo / rychlost / motohodiny / kondice
se dnes **neflashují vůbec**.

### Co se u vozidla zobrazuje (inventář položek)
| Položka | Element | Show/hide klíč dnes | Flash dnes |
|---|---|---|---|
| Palivo (bar + l) | `.vc-fuel` | — (vždy) | ne |
| Kondice | `.vc-cond` | `vehicleShowCondition` (sloučeno s rychlostí) | ne |
| Rychlost | `.vc-speed` | `vehicleShowCondition` (sloučeno) | ne |
| Motohodiny | `.vc-mh` | `vehicleShowEngineHours` | ne |
| Naplnění (plodina/zboží) | `.v-implements` / `.vi-*` | `vehicleShowEmptyImplements` + kategorie-hide | ano (`impl`) |
| Vzduch (AIR) | fill-unit | `vehicleHideAir` (invertované) | ne (přeskočeno) |
| Worker badge (AI/CP/AD) | `.vc-ai` | `vehicleShowWorkerBadge` | ne |
| AdBlue | proužek (expanded) | — | ne |

---

## 3. Návrh

### 3A. Druhá rozbalovací záložka v panelu (`sectionCfg.js`)
Zobecnit `_open()` tak, aby `def` mohl mít vedle `advanced` i **`flash`** pole
(stejná struktura `[{group, items, note}]`). Vyrenderuje druhou rozbalovačku
„▶ Flash nastavení" pod „Rozšířené nastavení". Tlačítka se přepínají nezávisle.
- `_allItems()` rozšířit o `def.flash` → správně počítá `_isDirty` a `reset`.
- `applyChange` / wiring checkboxů zůstává (vše čte z `_allItems`).

> Pozn.: jde o čistou generalizaci „1 rozbalovačka → N rozbalovaček". Alternativně
> obecné `def.sections = [{label, groups}]`, ale to je víc přepisu; `flash` pole
> stačí.

### 3B. Per-položkový flash u vozidel (per-cell)
Doporučený přístup = **per-cell flash** (jako u zvířat), aby měl každý přepínač
smysl (jinak by všechny tintily stejný řádek).

**Nové flash kanály** (default ON, žijí v `flashEnabled` mapě):
`fuel`, `cond`, `speed`, `mh`, `impl` (existuje), `air`.

**Tracking** v `noteAllChanges` — přidat `noteVehicleFlashes(d.vehicles)`:
- `vehicles::fuel::<name>` ← `fuelPercent`
- `vehicles::cond::<name>` ← `conditionPercent`
- `vehicles::speed::<name>` ← `speedKmh`
- `vehicles::mh::<name>` ← `motorHours`
- naplnění už řeší `noteImplementFlashes` (kanál `impl`); AIR odblokovat jen když
  je kanál `air` zapnutý.

**Vizuál** — v `vehicleRightHTML` / `vehicleCardHTML` / `implementsHTML` obalit
každou hodnotu a přidat `getVehFlashCls(name, channel)` (analogie `getFlashCls`,
ale respektuje per-vehicle kanál):
- palivo → třída na `.vc-fuel` (nebo `.vc-fuel-num`)
- kondice → `.vc-cond`, rychlost → `.vc-speed`, motohodiny → `.vc-mh`
- naplnění → zůstává tint řádku přes `getImplFlashCls`, **nebo** přejít taky na
  per-cell (tint `.vi-row`). Sjednotit s bodem výše.

**`getFlashCls` / kanály:** buď rozšířit `_flashChannelOf` o vehicle prefixy
(`fuel::`,`cond::`,…), nebo zavést dedikovaný `getVehFlashCls(name, channel)`
co volá `isFlashEnabled('vehicles', channel)` + čte `flashes.get('vehicles::'+channel+'::'+name)`.
Druhá varianta je čistší a nerozbíjí storage/productions logiku.

**Master „všechna vozidla" (bod 1):** položka s `get:()=>isFlashEnabled('vehicles')`,
`set:v=>setFlashEnabled('vehicles',v)`. Sdílí stav s **existujícím přepínačem v
hlavičce sekce** (oba čtou/píšou `map['vehicles']`) → automaticky synchronní.

### 3C. Show/hide všech položek v „Rozšířené nastavení" (bod 3)
Do `advanced` doplnit/rozdělit show-hide přepínače:
- **rozdělit** `vehicleShowCondition` „Kondice + rychlost" → `vehicleShowCondition`
  (jen kondice) + nový `vehicleShowSpeed` (rychlost). *Pozn.: mění chování
  existujícího klíče — viz rizika.*
- nový `vehicleShowFuel` (default true) — gate na `.vc-fuel` bloku.
- naplnění: případně master `vehicleShowFill` (default true) navíc ke kategorie-hide.
- motohodiny (`vehicleShowEngineHours`), vzduch (`vehicleHideAir`) — už existují,
  jen je seskupit do jednoho srozumitelného bloku „Zobrazit položky".

Renderery (`vehicleRightHTML`, `vehicleCardHTML`) gate-ovat podle nových klíčů.

---

## 4. Rozhodovací body — ROZHODNUTO (2026-06-07)

1. **Flash vizuál = ROW-LEVEL.** Bliká celý řádek vozidla jako dnes. Per-položkové
   přepínače určují, KTERÁ změna smí řádek rozblikat (agreguje se: živý flash na
   libovolném *zapnutém* kanálu → tint řádku). → odpadá per-cell CSS práce.
2. **speed/mh = default OFF + práh změny.** Kanály existují, ale defaultně vypnuté;
   navíc práh (speed ≥ 3 km/h, mh ≥ 0.1) ať netiká pořád. Palivo/kondice/naplnění
   default ON.
3. **Rozdělit „Kondice + rychlost"** → dva klíče: `vehicleShowCondition` (kondice)
   + nový `vehicleShowSpeed` (rychlost).
4. **Naplnění:** zůstává tint celého řádku (plyne z bodu 1).

---

## 5. Implementační kroky (po odsouhlasení)

1. `sectionCfg.js`: přidat podporu `def.flash` (2. rozbalovačka) + zahrnout do
   `_allItems`/`reset`/`_isDirty`.
2. `index.html`: `noteVehicleFlashes()` + zapojit do `noteAllChanges`; volitelný
   práh pro speed/mh.
3. `index.html`: `getVehFlashCls(name, channel)`; obalit hodnoty ve
   `vehicleRightHTML` / `vehicleCardHTML` (+ sjednotit naplnění).
4. `index.html`: rozšířit `SectionCfg.define('vehicles', …)` o blok `flash`
   (master + 6 kanálů přes `_flashItem`) a o show/hide položky v `advanced`.
5. `index.html`: nové show/hide klíče do `renderVehicles` memo (`vCfgKeys`) +
   ověřit, že přepnutí flash kanálu busti memo (`flashSnapshot` řeší jen *živé*
   flashe — přidat flash-kanál stavy do memo klíče).
6. `style.css`: per-cell `.flash-up`/`.flash-down` varianty pro `.vc-cond`,
   `.vc-speed`, `.vc-mh`, `.vc-fuel`, `.vi-row` (dnes je tint laděný na řádek).
7. Aktualizovat `USER-GUIDE.md` (sekce vozidla — flash) a `help.html`.
8. Flash testy dle `flash-test-plan.md` metodiky (1 parametr = 1 test, reload
   místo sleep) — viz paměť „Flash test metodika".

---

## 6. Rizika / poznámky

- **Memo busting:** `renderVehicles` má memo klíč; flash kanály nejsou v klíči,
  dokud neběží živý flash → přepnutí kanálu bez živého flashe by se neprojevilo.
  Nutno přidat stav kanálů do memo (krok 5).
- **`vehicleShowCondition` split** je breaking pro toho, kdo má klíč uložený —
  ale projekt je osobní, zpětnou kompatibilitu neřešíme (CLAUDE.md).
- **AIR flash** má smysl jen u strojů, co reálně mění AIR fill — okrajové, default OFF.
- Žádný server/Lua zásah — čistě frontend (statické soubory, stačí refresh).
- DashState klíče: namespace `fs25.dash.v1.*` (viz `state.js`).
