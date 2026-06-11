# RESEARCH-NEXT — 4 features připravené k implementaci

**Vznik:** 2026-05-24, plánovací session. User chce výzkum a plán, ne implementaci. Tato verze čeká na nezávislé pokračování v další session.

**Stav:** Skeleton zapsán; sekce „Výzkum (findings)" se doplní z výsledků 3 paralelních `fs25-api-researcher` agentů, kteří právě běží.

---

## TL;DR — Pořadí implementace

Pořadí je optimalizované tak, aby:

- malé úkoly s jasným scope šly nejdříve (warm-up po pauze)
- větší + experimentální features byly v hlavní pracovní fázi
- nezávislé úkoly mohly probíhat paralelně, pokud bys to chtěl rozdělit

| # | Bod | Vel. | Závisí na | Důvod pořadí |
|---|-----|------|-----------|--------------|
| 1 | **Bod 1 — AI / Courseplay / AutoDrive progres** | M (1–2 dny) | nic | Začínáme malým rozšířením vehicle row. Graceful fallback při chybějících modech = brzy víme, jestli detekce funguje. |
| 2 | **Bod 2 — Implements / fillUnit sub-řádek** | M (1–2 dny) | nic (paralel s 1) | Nejviditelnější QoL přidání. Dat je tam dost, jen je vyčíst. |
| 3 | **Bod 3 — Settings basic vs extended** | S (0.5 dne) | Bod 2 | UX toggle co odhaluje implementy z Bodu 2. Žádný API research, jen CSS + DashState. |
| 4 | **Bod 4 — Crop planning na kalendáři** | L (3–5 dní) | nic (lze začít první, ale je nejvíc nová UX) | Největší samostatný feature. UI od nuly. Doporučeno až po menších bodech, kdy je člověk v rytmu. |

**Alternativa:** Pokud bys měl chuť na velký kus práce ráno na čerstvou hlavu, dej si Bod 4 první.

---

## Společné pravidlo pro celou tuhle várku

**Verzování:** Každý bod je 1 patch bump v `modDesc.xml` (1.1.2.2 → 1.1.2.3 → …). Server `package.json` zůstává 3-digit (1.1.2 → 1.1.3 jen pokud se mění schéma).

**Schema bump:** Kdykoliv se rozšíří payload (nové top-level pole), bump `schemaVersion` v `DashboardExport.lua` **a** zvedni `MAX_MOD_SCHEMA` v `Server/index.js`. Existující frontend musí dál fungovat s defaulty.

**Logování během vývoje:** V Lua módu používej:

```lua
Logging.info(string.format("[FS25_Dashboard][DIAG] %s — %s", topic, value))
```

`[DIAG]` prefix → v logu lze grep filtrovat, plus to máme v memory ([[fs25_launch_savegame3]]) jako diagnostický marker. Po hotovém featuru `[DIAG]` řádky odstranit nebo zatvořit za `if self.DEBUG then …`.

**Test cyklus pro každý bod:**

1. Build mod → deploy → killnout hru → spustit znovu se savegame 2 (memory [[feedback-kill-fs25-freely]] povoluje)
2. Otevřít `http://localhost:3000` → ověřit, že nová data dorazila
3. Logger heartbeat (60 s) ukáže payload size delta — pokud výrazně narostl, zvážit přesun do detail-modal-only nebo delta engine
4. Hard-refresh prohlížeče (Ctrl+Shift+R) kvůli cache JS/CSS
5. Restartovat Node server jen pokud měníš `index.js` / `db.js` / `logger.js` / `dashboardState.js` (powerless povoleno via [[feedback-restart-server-freely]])

---

## Bod 1 — AI / Courseplay / AutoDrive progres na vozidle

### Co user chce

Pokud má vozidlo aktivní AI úkol (vanilla helper, Courseplay nebo AutoDrive), zobrazit progres a kolik práce ještě zbývá. Cíl: vidět z jediného pohledu, kdo už skončil a kdo ještě pracuje.

### Návrh UI

V `sec-vehicles` v hlavním seznamu k řádku vozidla:

```text
🚜 Fendt 942 Vario    ⛽ 78%    🤖 65% • sklízí • Pole 7    💰 €12k
```

Nový **AI badge**: `🤖 <%> • <activity-icon/word> • <field>`. Tooltip s ETA pokud k dispozici. Bez badge pokud vozidlo nemá aktivní úkol.

V detail modalu (klik na řádek vozidla) přidat sekci „🤖 AI úkol":

- Typ úkolu (sklizeň / setba / kultivace / orba / postřik / přeprava)
- Pole / cíl
- Progres v procentech
- ETA (pokud API umí)
- Helper jméno / Course name / AutoDrive sekvence

### Návrh datového toku

V Lua módu `collectVehicles()` přidat pole `aiTask` k záznamu vozidla:

```lua
rec.aiTask = {
    source       = "vanilla",  -- vanilla | courseplay | autodrive
    type         = "harvesting",
    typeTitle    = "Sklizeň",
    progress     = 65,         -- %
    etaSeconds   = 1240,       -- nil pokud nedostupné
    fieldId      = 7,
    helperName   = "Karel",    -- jen vanilla
    courseName   = nil,        -- jen courseplay
    activity     = nil,        -- jen autodrive (parking/driving/unloading/...)
}
```

Pokud žádná z 3 sourců nehlásí task, `rec.aiTask = nil` (nepřítomnost ⇒ žádný badge).

### Plán implementace

1. **Detekce vanilla AI** — Lua `vehicle.spec_aiJobVehicle` nebo `spec_aiVehicle`. (Konkrétní field paths viz Výzkum sekce níže.)
2. **Detekce Courseplay** — `vehicle.spec_cpAIWorker` nebo `vehicle.cp` global helper. Safe-read pattern.
3. **Detekce AutoDrive** — `vehicle.ad` table. Safe-read.
4. **Priorita zdrojů** — pokud běží více (např. CP nad vanilla helperem), preferuj v pořadí: courseplay > autodrive > vanilla.
5. **Server `index.js`** — žádná změna (data prochází přes WS jak jsou).
6. **Frontend `index.html` `renderVehicles()`** — přidat `aiBadge(v.aiTask)` helper, vrátí HTML span s ikonou a tooltipem.
7. **Frontend modal** — nová sekce v `openVehicleModal()` pokud `v.aiTask`.
8. **i18n** — `typeTitle` posílá Lua (lokalizováno z `g_i18n`).

### Logování pro vývoj

```lua
if self.DEBUG_AI then
    Logging.info(string.format("[FS25_Dashboard][DIAG][AI] %s: source=%s type=%s progress=%d eta=%s",
        vehicle:getName(), source, taskType, progress, tostring(etaSeconds)))
end
```

### Test plán

1. Vanilla — najmout AI workera na pole 7 → sklizeň → badge se objeví do 5 s
2. Courseplay — pokud nainstalován; spustit course → badge `source: courseplay`
3. AutoDrive — pokud nainstalován; spustit cestu → badge `source: autodrive`
4. **Negativní test** — odinstalovat CP+AD → dashboard musí zůstat funkční, aiTask jen vanilla nebo nil. Pomocí `[DIAG]` logu ověřit, že detekce CP/AD selhala graceful (vyloženě „spec_cpAIWorker nil → skip", nikoliv crash).

### Výzkum (findings z fs25-api-researcher)

#### A) Vanilla AI Helper — `spec_aiJobVehicle`

**Pozor: NE `spec_aiVehicle` (to je staré FS22).** V FS25 je správný spec `spec_aiJobVehicle`.

```lua
-- Detekce:
local function getVanillaAI(vehicle)
    local spec = vehicle.spec_aiJobVehicle
    if spec == nil or spec.job == nil then return nil end
    local job = spec.job
    local jobType = g_currentMission.aiJobTypeManager:getJobTypeByIndex(job.jobTypeIndex)
    return {
        active     = true,
        jobClass   = jobType and jobType.name or "unknown",   -- AIJobFieldWork, AIJobDeliver, …
        helperName = (pcall(function() return job:getHelperName() end)) and job:getHelperName() or nil,
        taskIndex  = job.currentTaskIndex,   -- 1 = driving to field, 2 = working
    }
end
```

- `jobTypeManager` vrací class name (např. `AIJobFieldWork`); konkrétní akce (sow/harvest/…) **NENÍ v AI layer** — musí se odvodit z `spec_workArea` / `spec_fillUnit` připojeného nářadí
- **Žádný progress / ETA** ve vanilla FS25. `AITaskFieldWork:update()` je prázdný. Lze nepřímo z `job.pendingCost` (akumulátor 0.0005/ms u fieldwork), ale to není %.
- Helper jméno přes `job:getHelperName()` (interně volá `g_helperManager`)

**Gotchas:**
- `currentTaskIndex` má 1-tick lag na klientech (sync přes `onReadStream`)
- `spec.job` může být non-nil chvilku po stopu — pro strict check přidat `spec.job.isRunning == true`

#### B) Courseplay — `spec_cpAIWorker`

```lua
local function getCP(vehicle)
    if vehicle.getIsCpActive == nil then return nil end   -- CP not installed
    if not vehicle:getIsCpActive() then return nil end
    local progress = vehicle.getCpFieldWorkProgress and vehicle:getCpFieldWorkProgress() or nil
    return {
        active   = true,
        progress = progress,   -- 0..1 nebo nil v drive-to fázi
        hasCourse = vehicle.hasCpCourse and vehicle:hasCpCourse() or false,
    }
end
```

- **CP přebije vanilla:** když CP běží, `spec_aiJobVehicle.job` je non-nil ale je to `CpAIJob` instance. Tj. detekuj v pořadí: CP → AD → vanilla.
- Všechny CP volání musí být guarded `vehicle.getCpXxx ~= nil` (pokud CP není installed, metody chybí)
- `getCpFieldWorkProgress()` vrátí `nil` během drive-to fáze (jen pendant samotné práci na poli)
- Course name **NENÍ** přímo na vehicle — je v `spec_cpAIFieldWorker.cpJob` parametrech
- Zdroj: <https://github.com/Courseplay/Courseplay_FS25/blob/main/scripts/specializations/CpAIWorker.lua>

#### C) AutoDrive — `vehicle.ad`

```lua
local function getAD(vehicle)
    if not (vehicle.ad and vehicle.ad.stateModule) then return nil end
    local sm = vehicle.ad.stateModule
    if not sm:isActive() then return nil end
    local wps, wpIdx = nil, nil
    if vehicle.ad.drivePathModule then
        wps, wpIdx = vehicle.ad.drivePathModule:getWayPoints()
    end
    return {
        active       = true,
        mode         = sm:getMode(),                 -- 1=DRIVETO, 2=PICKUPANDDELIVER, 3=DELIVERTO, 4=LOAD, 5=UNLOAD, 6=BGA
        dest1        = sm:getFirstMarkerName(),
        dest2        = sm:getSecondMarkerName(),
        remainingSec = sm:getRemainingDriveTime(),   -- ETA (int sec, může být 0/negativní při recalc)
        progress     = (wps and #wps > 0) and (wpIdx / #wps) or nil,
    }
end
```

- `vehicle.ad` injektuje AD při load vehicle — `nil` když AD není installed
- AD MŮŽE INTERN použít vanilla AI nebo CP jako podhelper (`stateModule:getUsedHelper()` vrací `HELPER_AI=1` / `HELPER_CP=2` / `HELPER_AIVE=3`)
- Mode constanty `AutoDrive.MODE_*` jsou available jen pokud AD je installed — neporovnávat proti enumům, používat raw int hodnoty

#### Priorita zdrojů (pro frontend)

V `collectVehicles()` zkoušet v pořadí, vrátit první co najde:

1. **AutoDrive** (`vehicle.ad.stateModule:isActive()`) — má nejvíc dat (ETA, mode, destinations)
2. **Courseplay** (`vehicle:getIsCpActive()`) — má progress %
3. **Vanilla** (`spec_aiJobVehicle.job ~= nil`) — fallback s class name a helper

#### Shrnutí

| Source | Active check | Progress | ETA |
|---|---|---|---|
| Vanilla | `spec_aiJobVehicle.job ~= nil` | ❌ | ❌ |
| Courseplay | `vehicle:getIsCpActive()` | ✅ `getCpFieldWorkProgress()` 0..1 | ❌ |
| AutoDrive | `vehicle.ad.stateModule:isActive()` | ✅ `wpIdx / #wps` | ✅ `getRemainingDriveTime()` sec |

#### Návrh `knowledge/ai-task-detection.md`

Tento výzkum stojí za uložení do `knowledge/ai-task-detection.md` jako trvalá reference. Implementace v módu by ho měla cite v komentáři.

---

## Bod 2 — Implements / fillUnit „podřádek"

### Co user chce

Pod každým vozidlem ukázat malou tabulku připojeného nářadí, zejména:

- **Trailery** — jak plné, jaká plodina
- **Kombajn** — kapacita zásobníku úrody
- **Seeder** — kolik semen zbývá
- **Sprayer / spreader** — kolik chemie

User zmínil existující mod, který tohle dělá v HUDu hry — pojď zjistit který (pravděpodobně `InfoDisplayExtension` nebo `ExtendedGameInfoDisplay`, oba máme analýzu).

### Návrh UI

```text
🚜 John Deere S790        ⛽ 32%    💰 €1.2M
   └ 🌾 Pšenice 18.4t / 24t (77%)
   └ 📦 Header — vyloučen z UI (no fillUnit)

🚜 Fendt 942 Vario        ⛽ 78%    💰 €240k
   └ 🚛 Tipper 12t — Bramborová mouka 12.0/12.0t (100%)

🚜 Massey Ferguson 4709   ⛽ 91%
   └ 🌱 Seeder — Pšenice 245L (40%) · Hnojivo 0L (0%)
```

Každý implement se zobrazí jako odsazený sub-řádek s ikonou, plodinou/fillType, fill levelem a procenty.

**Heuristika filtrace:** zobrazit jen implementy, kde `fillUnit.capacity > 100 L` a `fillType != UNKNOWN`. Plow / cultivator / disk harrow mají malé tank pro vápno → mimo limit, vypadnou.

### Návrh datového toku

V Lua `collectVehicles()` přidat `rec.implements`:

```lua
rec.implements = {
    {
        name       = "John Deere W155",   -- z storeItem
        category   = "trailer",            -- trailer | header | seeder | sprayer | other
        fillUnits  = {
            { fillType = "WHEAT", typeTitle = "Pšenice", levelL = 18400, capacityL = 24000, percent = 77 },
        },
    },
    ...
}
```

### Plán implementace

1. **Iterace implementů** — `vehicle.spec_attacherJoints.attachedImplements`, viz výzkum níže
2. **Capacity heuristika** — filter implementů kde aspoň jeden fillUnit ≥ 100 L
3. **Kategorizace** — z `vehicle.typeName` nebo `specializationNames` odvodit `category` (trailer/header/seeder/sprayer)
4. **Frontend** — v `renderVehicles()` rozšířit row template o `<div class="v-implements">` pokud `v.implements && v.implements.length`
5. **CSS** — nový block pro `.v-implements`, mírně odsazené, menší font, ikona per kategorie

### Logování

```lua
if self.DEBUG_IMPL then
    for _, impl in ipairs(implementsList) do
        Logging.info(string.format("[FS25_Dashboard][DIAG][IMPL] %s → %s cat=%s units=%d",
            vehicle:getName(), impl.name, impl.category, #impl.fillUnits))
    end
end
```

### Test plán

1. Připojit prázdný trailer → očekáváme `0L / 24000L (0%)`
2. Naplnit trailer pšenicí → 77 % visible
3. Sklízet kombajnem → `Header` (filtered out) + tělo kombajnu (visible fillUnit)
4. Připojit pluh → musí být **vyloučen** (filter `< 100 L`)
5. Odpojit trailer → mizí ze seznamu do 2 s

### Výzkum (findings z fs25-api-researcher)

#### Iterace nad implementy

```lua
-- vehicle:getAttachedImplements() vrátí self.spec_attacherJoints.attachedImplements
-- Každý prvek: { object = <Vehicle-like>, jointDescIndex = <int> }

local function collectImplements(vehicle, depth)
    depth = depth or 0
    if depth > 3 then return {} end                       -- anti-loop guard
    if not (vehicle and vehicle.getAttachedImplements) then return {} end
    local result = {}
    for _, impl in pairs(vehicle:getAttachedImplements()) do
        if impl.object then
            local entry = {
                name      = impl.object.getName and impl.object:getName() or "",
                fillUnits = getImplementFillUnits(impl),
            }
            -- recursive: trailer s dalším trailerem
            local sub = collectImplements(impl.object, depth + 1)
            for _, s in ipairs(sub) do table.insert(result, s) end
            table.insert(result, entry)
        end
    end
    return result
end
```

**Zdroj:** `giantsDocu/fs25_dokumentace/version_script_category_77_class_636.md:1580-1582` (signature), `:2882-2895` (recursive pattern z enginu).

**Safety guard:** ne všechna vozidla mají AttacherJoints. Vždy `vehicle.getAttachedImplements ~= nil` před voláním.

#### FillUnit data — API i raw

```lua
local function getImplementFillUnits(impl)
    local obj = impl.object
    if not (obj and obj.spec_fillUnit) then return nil end
    local units = obj.spec_fillUnit.fillUnits
    if not units then return nil end
    local result = {}
    for i, unit in ipairs(units) do
        local capacity = unit.capacity or 0
        if capacity > 100 then                            -- filtr symbolických tanků (pluhy, kultivátory)
            local ftIdx = unit.fillType or 0
            if ftIdx == 0 then ftIdx = unit.lastValidFillType or 0 end
            local ftName = ""
            if ftIdx ~= 0 and g_fillTypeManager then
                local ft = g_fillTypeManager:getFillTypeByIndex(ftIdx)
                ftName = ft and (ft.title or ft.name) or ""
            end
            table.insert(result, {
                fillType  = ftName,
                levelL    = math.floor(unit.fillLevel or 0),
                capacityL = math.floor(capacity),
                percent   = pctOf(unit.fillLevel or 0, capacity),
            })
        end
    end
    return #result > 0 and result or nil
end
```

**Klíčové API metody:**

- `vehicle:getFillUnits()` → `spec_fillUnit.fillUnits` (array 1-indexed)
- `vehicle:getFillUnitFillType(i)` → integer (`FillType.UNKNOWN = 0` = prázdný)
- `vehicle:getFillUnitFillLevel(i)` → litry
- `vehicle:getFillUnitCapacity(i)` → kapacita L
- `vehicle:getFillUnitFillLevelPercentage(i)` → 0..1

**Zdroj metod:** `giantsDocu/fs25_dokumentace/version_script_category_77_class_678.md:821, 883, 893, 909, 845`.

**Raw vs API:** existující `DashboardExport.lua:957-981` už čte přímo přes `v.spec_fillUnit.fillUnits` bez metod — funguje protože jsme uvnitř Lua mod scope. Pro implementy raw access OK, ale metody by zachytily i jiné módy co spec patchují.

#### Filtrace „uložiště" vs „nástroj"

**Doporučená heuristika:** `unit.capacity > 100`. Plow, cultivator, disc harrow mají buď žádný fillUnit (`spec_fillUnit == nil`) nebo capacity ≤ 100 (vápnění, symbolika) — vypadnou. Trailery, kombajny, seedery, sprayery mají > 100 L.

**Alternativa:** `unit.showOnHud == true` (stejná logika jako engine HUD, viz `version_script_category_77_class_678.md:2525`) — možná spolehlivější ale méně známý field.

#### Specifika typů

- **Kombajn** — tělo má `spec_fillUnit` s úrodou, header (řezací lišta) je attached implement, často s vlastní (malou nebo žádnou) capacity. **Úroda se hromadí v těle kombajnu, ne v headeru.**
- **Seeder** — 2 fillUnity: seed hopper + fertilizer tank, oba `capacity > 100`
- **Sprayer** — 1 fillUnit, fillType varies podle naplnění (hnojivo / herbicid / kapalné)
- **Plow / cultivator / disc harrow** — vypadnou filtrem

#### Edge case prázdný fillUnit

`fillType == 0 (UNKNOWN)` → použij `lastValidFillType` (= co tam bylo). Existující code (`DashboardExport.lua:965`) tuhle pattern už používá pro fuel.

#### Návrh `knowledge/fs25-implements-fillunits.md`

Tento výzkum stojí za samostatný knowledge file.

---

## Bod 3 — Settings: basic vs extended view

### Co user chce

Bod 2 přidá implementy = víc obsahu = vozidla jsou užší. Možnost si přepnout:

- **Základní** — současný layout, vozidla v 1 sloupci (lehčí na první pohled)
- **Rozšířený** — implementy + ostatní info, sekce vozidel přes **2 sloupce** (jako pole)

### Návrh UI

Nový switch v ⚙ Nastavení → 📋 Sekce nebo úplně nová tab „Hustota":

```text
☐ Rozšířený režim vozidel (implementy, dvojsloupec)
```

### Návrh datového toku

DashState klíč `vehiclesExpanded: bool` (default false). Synchronizuje se s ostatními zařízeními přes existující ServerSync.

### Plán implementace

1. **DashState** — přidat key, default false
2. **app.js settings panel** — v existující „Sekce" tab nový checkbox
3. **`index.html` `applyExpandedVehicles()`** — na load + na change nastaví class `.expanded` na `.section[data-tt-key="vehicles"]`
4. **CSS** — `.sec-vehicles.expanded { grid-column: span 2; }` + show/hide `.v-implements` (default skryté, expanded ukazuje)

### Test plán

1. Default: sec-vehicles je 1 sloupec, implementy schované
2. Zapnout switch: sec-vehicles ihned přejde do 2 sloupců, implementy se objeví
3. Vypnout: vrátí se zpět
4. Na druhém zařízení po sync: změna se objeví do 2 s

### Závislost

Implementy z Bodu 2 musí být v payloadu — jinak nemá co rozšiřovat. Pokud bys Bod 3 dělal *před* Bodem 2, switch bude jen kosmetický (2-column layout bez nového obsahu).

---

## Bod 4 — Crop planning na stránce kalendář

### Co user chce

Na `calendar.html` (existující stránka „Kalendář polí") přidat:

- **Spodní část**: picker vlastněných polí + per-rok výběr plodiny (pšenice 2026, řepka 2027, …)
- **Horní část**: pro vybraný plán vygenerovaný harmonogram prací — kdy zorat, kdy zasít, kdy hnojit, kdy sklidit, vše po dnech/měsících

Hra už ukáže (v menu nebo info štítku) kdy lze plodinu zasít/sklidit — chceme to programaticky a do vlastního plánu.

### Návrh UI

```text
┌─ Plán pole F7 — 2026 ─────────────────────────────────────┐
│  Plodina: Pšenice (ozimá)                                 │
│                                                            │
│  ┌────────────────────────────────────────────────────┐   │
│  │ Měsíc:  9 10 11 12  1  2  3  4  5  6  7  8         │   │
│  │ Práce:   ▆  ▆        🌱             💧      🌾 🌾  │   │
│  │         orát zasít  ozima           hnoj.   sklízet │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  Stav: zaseto (růst 35 %), naposled hnojeno před 8 dny    │
└────────────────────────────────────────────────────────────┘

┌─ Naplánovat ──────────────────────────────────────────────┐
│  Pole:  [F7  ▾]                                            │
│  2026:  [Pšenice    ▾]                                     │
│  2027:  [Řepka      ▾]                                     │
│  2028:  [Brambory   ▾]                                     │
│  + Přidat rok                                              │
└────────────────────────────────────────────────────────────┘
```

### Návrh datového toku

**Persistence:** DashState klíč `fieldPlans` = `{ [fieldId]: { [year]: { fruitType, notes? } } }`.

**Generování plánu prací:**

```js
// Pseudokód v JS, runs in browser:
function generateWorkPlan(fieldId, year, fruitType, currentState) {
    const ft = catalog.fruitTypes[fruitType];  // sowingMonths, harvestMonths, needsPlowing, ...
    const events = [];
    if (currentState.stubbleLevel > 0) events.push({ type: 'plow', month: ... });
    events.push({ type: 'sow',   month: ft.sowingMonths[0] });
    events.push({ type: 'fertilize', month: midGrowth(ft) });
    events.push({ type: 'harvest', month: ft.harvestMonths[0] });
    return events;
}
```

**Catalog dat** posílá mod jednou v `availableFruits[]` (už dnes) — rozšířit o `sowingMonths`, `harvestMonths`, `needsPlowing`, `growthDuration`. Frontend si z toho generuje plán.

### Plán implementace

1. **Lua** — rozšířit `collectAvailableFruits()` o per-fruit properties (sowingMonths, harvestMonths, …)
2. **Server** — žádná změna (DashState už podporuje libovolné klíče)
3. **Frontend** — `calendar.html` nový section „Plán" v spodní části:
   - Field picker (jen vlastněná = `field.owned`)
   - Per-year crop selector
   - „Přidat rok" pro multi-year rotation
4. **Frontend** — horní část `calendar.html` rozšířit o **timeline graf** pro vybraný plán:
   - 12 měsíců osa X
   - Barevné dlaždice prací (zasít/sklízet/orat/hnojit)
   - Aktuální měsíc highlight
5. **Persistence** — `fieldPlans` v DashState přes `/api/dashboard-state` (existující PATCH)
6. **i18n** — všechny labels CZ-first (memory [[feedback_czech_primary]])

### Logování

```lua
if self.DEBUG_FRUIT then
    for _, ft in ipairs(self.availableFruitsList) do
        Logging.info(string.format("[FS25_Dashboard][DIAG][FRUIT] %s sow=%s harv=%s plow=%s",
            ft.name, table.concat(ft.sowingMonths, ","),
            table.concat(ft.harvestMonths, ","), tostring(ft.needsPlowing)))
    end
end
```

### Test plán

1. Otevřít kalendář → vidět picker
2. Vybrat pole 7 → vidět current state
3. Nastavit „2026 pšenice" → timeline se vykreslí
4. Přidat „2027 řepka" → timeline pokračuje na další rok
5. Změnit plodinu → timeline se přepočítá
6. Reload stránky → plán zůstává (z DashState)
7. Druhé zařízení → vidí stejný plán (sync)

### Výzkum (findings z fs25-api-researcher)

#### Fruit type properties (`g_fruitTypeManager.fruitTypes[i]`)

| Co potřebuji | Existuje? | Jak |
|---|---|---|
| Měsíce setí | nepřímo | `ft:getIsPlantableInPeriod(growthMode, p)` pro `p = 1..12` → bool |
| Měsíce sklizně | nepřímo | `ft:getIsHarvestableInPeriod(growthMode, p)` analogicky |
| Délka vegetace | aproximace | `ft.numGrowthStates` × `daysPerPeriod / numGrowthStates` |
| Regrowth (jetel, tráva) | ANO | `ft.regrows`, `ft.firstRegrowthState` |
| Potřeba válcování | ANO | `ft.needsRolling` (default true; false pro kukuřici, řepu) |
| Vápnění | ANO | `ft.consumesLime`, `ft.growthRequiresLime` |
| Kultivace povolena | ANO | `ft.isCultivationAllowed` |
| Setí povoleno | ANO | `ft.allowsSeeding` |
| Catch crop | ANO | `ft.isCatchCrop` |
| Výnos (L/m²) | ANO | `ft.literPerSqm` |
| Startovní spray | ANO | `ft.startSprayLevel` |

**Zdroj:** `giantsDocu/fs25_dokumentace/version_script_category_37_class_416.md` (FruitTypeDesc kompletní)

**KRITICKÝ parametr `growthMode`:** `g_currentMission.missionInfo.growthMode`. Hodnoty: `SEASONAL` (sezónní rotace — ozimá/jará rozdíl) vs `NON_SEASONAL` (sít kdykoliv). Bez něj `getIsPlantableInPeriod` vrátí false pro všechno mimo sezónu. Vždy předávat.

#### SeasonPeriod 1–12

`1 = EARLY_SPRING`, `12 = LATE_WINTER`. Aktuální období: `env.currentPeriod` ve stejné stupnici. **NE 0-indexované.**

#### Field state — `FieldUtil.getFieldStatus(field)`

Dashboard už dnes volá v `DashboardExport.lua:684` (přes `collectFieldStatus`). Vrátí:

```lua
status.plowFactor          -- 0..1; < 0.5 = potřeba orby
status.needsLime           -- bool
status.fertilizationFactor -- 0..1; 0 = bez hnojení, 1 = plně
status.weedFactor          -- 0..1
status.stoneFactor         -- 0..1
```

Payload už posílá: `needsPlowing`, `needsCultivating`, `needsLime`, `fertilizationLevel (0-2)`, `weedLevel (0-3)`, `stoneLevel (0-3)`, `growthState`, `maxGrowthState`, `isReadyToHarvest`, `isCut`, `isWithered`, `daysToHarvest`.

#### Co chybí v aktuálním payloadu

| Chybí | Kde vzít | Priorita |
|---|---|---|
| `plantableMonths[1..12]` (bool array) | Iterace `getIsPlantableInPeriod(growthMode, p)` per fruit | Kritická |
| `harvestableMonths[1..12]` | `getIsHarvestableInPeriod(...)` | Kritická |
| `regrows`, `firstRegrowthState` | `ft.regrows`, `ft.firstRegrowthState` | Důležitá |
| `needsRolling`, `consumesLime`, `allowsSeeding`, `startSprayLevel` | `ft.*` | Střední |
| `numGrowthStates`, `minHarvestingGrowthState` | `ft.*` (pro aproximaci délky) | Střední |

#### Triggery pro práce — odvození

- **Orba** = `plowFactor < 0.5` (řízeno `missionInfo.plowingRequiredEnabled`)
- **Hnojení** = `fertilizationLevel < 2` (2× za cyklus: před setím + během růstu). `ft.resetsSpray = true` (default) = sklizeň resetuje na 0.
- **Plevel** = `weedLevel > 0`. Sází se při setbě (`ft.plantsWeed = true`).
- **Válcování** = `ft.needsRolling == true && growthState == 1`

#### Gotchas

- **Ozimá vs jará** — NEMÁ enum flag. Modelováno čistě přes `plantableMonths`: ozimá → plantable v 9–10, jará → 1–2. Calendar UI to musí **inferencovat z dat**, ne z labelu.
- **Stubble level** — v FS25 NENÍ samostatný field property. Stav po sklizni = `isCut == true`. „Stubble" je nepřímo přes `plowFactor` a `needsCultivating`.
- **Roller level** — nemá vlastní property. Implicitní z `needsRolling + growthState == 1`.
- **Lime level** — `FieldUtil` vrací jen `needsLime: bool`, ne skóre.
- **Multi-state plodiny (tráva, řepka)** — `ft.regrows == true` → po sklizni se vrátí do `firstRegrowthState`, ne 0. Plan nesmí navrhnout nové setí — jen sklizeň a hnojení.
- **`numGrowthStates`** zahrnuje jen `isGrowing=true` stavy; sentinely (cut, withered) nejsou počítány. `minHarvestingGrowthState` je absolutní state číslo.

#### Návrh rozšíření `collectAvailableFruits()` v DashboardExport.lua

```lua
local growthMode = g_currentMission.missionInfo.growthMode or 1
for _, ft in pairs(g_fruitTypeManager:getFruitTypes()) do
    local plantable, harvestable = {}, {}
    for p = 1, 12 do
        plantable[p]   = ft:getIsPlantableInPeriod(growthMode, p) and true or false
        harvestable[p] = ft:getIsHarvestableInPeriod(growthMode, p) and true or false
    end
    -- emit:
    table.insert(self.availableFruits, {
        name              = ft.name,
        typeTitle         = ft.fillType and ft.fillType.title or ft.name,
        plantableMonths   = plantable,
        harvestableMonths = harvestable,
        regrows           = ft.regrows or false,
        firstRegrowthState = ft.firstRegrowthState or 1,
        needsRolling      = ft.needsRolling and true or false,
        consumesLime      = ft.consumesLime and true or false,
        growthRequiresLime= ft.growthRequiresLime and true or false,
        startSprayLevel   = ft.startSprayLevel or 0,
        numGrowthStates   = ft.numGrowthStates or 0,
        minHarvestingGrowthState = ft.minHarvestingGrowthState or 0,
        literPerSqm       = ft.literPerSqm or 0,
    })
end
```

Toto stačí calendar UI ke generování celého plánu prací.

#### Návrh `knowledge/fs25-crop-calendar-api.md`

Tento výzkum stojí za samostatný knowledge file.

**Hlavní zdroje:**

- `giantsDocu/fs25_dokumentace/version_script_category_37_class_416.md` — FruitTypeDesc properties
- `giantsDocu/fs25_dokumentace/version_script_category_77_class_803.md:270, 1164` — `getIsPlantableInPeriod` real usage
- `src/Dashboard/FS25/DashboardExport.lua:142-168` — `collectAvailableFruits` (rozšiřit zde)
- `src/Dashboard/FS25/DashboardExport.lua:684-705` — `collectFieldStatus` (existující field stav)

---

## Společné kroky pro start další session

1. **Pull poslední stav** (jen jistota) — `git status` v `e:\ClaudeProjects\FS25-dashboard`
2. **Přečíst tento dokument celý** + sekce „Výzkum (findings)" v každém bodě
3. **Vybrat bod podle pořadí výše** (1 nebo 4 dle nálady)
4. **Vytvořit feature větev** — `git checkout -b feat/ai-progress` (nebo podobně)
5. **TodoWrite z plánu** — sekce „Plán implementace" konkrétního bodu rozepsat jako kroky
6. **Build / deploy / test cyklus** podle „Společné pravidlo" výše

## Soubory, které tahle várka pravděpodobně dotkne

```text
src/Dashboard/FS25/DashboardExport.lua   — rozšíření collectVehicles, collectAvailableFruits, schemaVersion bump
src/Dashboard/FS25/modDesc.xml            — version bump per feature
src/Dashboard/Server/index.js             — pravděpodobně beze změny (jen MAX_MOD_SCHEMA bump)
src/Dashboard/Server/public/index.html    — vehicle row renderer + vehicle modal
src/Dashboard/Server/public/calendar.html — plán + timeline (Bod 4)
src/Dashboard/Server/public/app.js        — settings toggles (Bod 3)
src/Dashboard/Server/public/style.css     — implementy CSS + timeline CSS
```

## Co tohle dokument nezahrnuje

- Detail UI mockups (přijdou až při implementaci)
- Persistence Server-side změny (zatím vše v DashState postačí)
- Mobil layout (asi vyžaduje samostatné kolo po hotových desktop variantách)
- Localizaci do EN (CZ-first podle memory [[feedback_czech_primary]])

---

**Předpokládaný celkový čas:** 7–10 dní intenzivně, nebo 2–3 týdny v hobby tempu (večery + víkendy).

**Až bude tento dokument doplněn o findings z agentů, je připraven na pickup v další session.**
