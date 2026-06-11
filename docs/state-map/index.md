# State Map — index

Strojová mapa stavů napříč 14 povrchy Dashboardu. Generováno z dokumentace stavů.

- **Povrchů:** 14
- **Stavů celkem:** 449
- **Polí sahajících do >1 povrchu:** 56

## Souhrn povrchů

| povrch | klíč | stavů | soubory | biggestRisk (zkráceně) |
|---|---|---|---|---|
| Vozidla | [`vehicles`](./vehicles.md) | 29 | index.html (funkce vehicleCardHTML, vehicleRightHTML, bar, implementsHTML/implem… | Dvojí prahová nekonzistence kolem paliva + mrtvý fuel-flash kanál. (1) Lišta paliva (bar() index.html:305) přepíná na 'danger' už při pct<=20, ale zvonek (bell.js:18 FUEL_LOW=15) spustí alert až po… |
| Pole | [`fields`](./fields.md) | 38 | index.html (field render — fruitName/prázdné, growthState/growthPercent, isReady… | fieldStateTag větve Zvadlé (1497) a Strniště (1498) čtou f.isWithered / f.isCut, ale ŽÁDNÝ payload je nedodává: mock 'withered-crops' používá withered:true (ne isWithered) a saveGroundType:'STUBBLE… |
| Zvířata | [`animals`](./animals.md) | 37 | index.html (animal render — count/maxCount cap, foodPercent, waterPercent, straw… | Rozcházející se prahy mezi kartou Zvířata, zvonkem a generickým bar(): bar() je hardcoded (danger<=20, warn<=50, full>=95) nezávisle na input/output sémantice i na nastavitelných prazích karty (ani… |
| Produkce | [`productions`](./productions.md) | 28 | index.html (production render — status active/noInput/outputFull, cyclesPerHour,… | Stavy expanded (is-running / is-missing / is-full, ps-cost badge, Σ €/h hlavička, mid-badge 🔁) nejsou pokryty žádným scénářem v mock-scenarios.js — žádný scénář nespouští productionsExpanded=true.… |
| Sklady/sila | [`storage`](./storage.md) | 20 | index.html (donutSVG donut-warn>=70 / donut-full>=95 + silo/storage render, množ… | bar-fill warn/full prahy (70 % a 95 %) a odpovídající donut-warn/donut-full na silo hlavičce nejsou pokryty žádným scénářem ani smoke testem – žádný mock-scenario nedodává položku skladu s ipct >= … |
| Zvonek | [`bell`](./bell.md) | 21 | bell.js (CELÝ — prahy FOOD_LOW=25/WATER_LOW=20/STRAW_LOW=25/OUTPUT_HI=90/FUEL_LO… | Vehicle low-fuel alert (veh-fuel, urgent) is gated by TableTools.getHidden('vehicles') / DashState hiddenVehicles AND keyed on vehicle NAME (String(v.name)), not a stable id. Two distinct risks com… |
| Počasí | [`weather`](./weather.md) | 22 | index.html (weather render — typeId->ikona/titulek, temperature/temperatureMin/M… | Forecast typeId boundary case: if weather.forecast[N].typeId is null or outside [0, 8], the fallback emoji is '·' (dot), which is visually indistinguishable from the unknown-weather fallback. This … |
| Ceny/sez. křivka | [`prices`](./prices.md) | 22 | index.html + history.html (prices per výkup, priceForecast.fillTypes[].factors 1… | Stav „sez. křivka – hlídaný měsíc (watch)" je nejrizikovější nepokrytá větev: kombinuje zápis do DashState.forecastWatches, vizuální změny v Chart.js canvasu (gold border, opacity, 🔔 marker) a cro… |
| KPI lišta | [`kpi`](./kpi.md) | 21 | index.html (#kpi-balance, #kpi-time, #kpi-owned a další KPI karty — placeholder … | Hranice delta stavu — Zůstatek delta (podpora -0, 0, +0 hranic) není dobře zdokumentován; může nastat situace, kde farmBalanceDeltaDay je null/undefined vs 0 — logika na řádku 465-469 očekává Numbe… |
| Události | [`events`](./events.md) | 32 | index.html (events feed — typy sowing/harvest/spray, dedup klíč timestamp\|field… | Dedup klíč flash mechanismu: flashes Map je keyed ${section}::${rowKey}, ale rowKey pro storage+productions přidává header:: a item:: prefix. Pokud byly stavy mergovány špatně nebo _flashChannelOf(… |
| Flash systém | [`flash`](./flash.md) | 26 | index.html (getFlashCls/getImplFlashCls — flash-up/flash-down trigger na změnu h… | Vozidlový fuel flash fallback getFlashCls('vehicles', v.name) na index.html:904 je MRTVÝ KÓD: noteAllChanges nikdy neregistruje klíč vehicles::<name> (jen vehicles::impl::...), takže navzdory komen… |
| Témata | [`themes`](./themes.md) | 81 | theme.js + style.css (5 témat dark-green/dark-blue/light/high-contrast/fs25-nati… | Flash-down větev pro vehicles (vozidlo odevzdalo náklad / tankuje → implement se vyprazdňuje) — je implementována přes noteImplementFlashes() + getImplFlashCls(), ale žádný scénář v mock-scenarios.… |
| Kalendář | [`calendar`](./calendar.md) | 41 | calendar.html (+ sdílené rendery z index.html) — stavy crop kalendáře, KPI #kpi-… | Větev isCut (strniště) nemá žádný mock scenario, který by ji spolehlivě pokrýval — withered-crops scénář nastaví saveGroundType:'STUBBLE' ale nenastavuje isCut:true explicitně; žádný scénář neověřu… |
| Historie | [`history`](./history.md) | 31 | history.html — Chart.js grafy, KPI #kpi-fills, empty-state | Forecast watch + current-month souběh (history.html:560-562): pokud je hlídaný měsíc (forecastWatches) zároveň aktuálním měsíchem (currentPeriod), zlatý border (#fde047) přebije amber current-month… |

## MATICE KŘÍŽOVÝCH EFEKTŮ

Datové pole → povrchy, které ovlivňuje (jen pole sahající do **>1 povrchu**). Toto je klíč pro izolaci testů: změna jednoho datového pole se může projevit ve více povrchech najednou, takže test jednoho povrchu nesmí spoléhat na to, že pole je „jen jeho".

| datové pole | # povrchů | povrchy, které ovlivňuje |
|---|---|---|
| `storage[].items[].amount` | 6 | `bell`, `events`, `flash`, `prices`, `storage`, `themes` |
| `animals[].count` | 5 | `animals`, `bell`, `events`, `flash`, `themes` |
| `animals[].foodPercent` | 5 | `animals`, `bell`, `events`, `flash`, `themes` |
| `fields[].growthState` | 5 | `calendar`, `events`, `fields`, `flash`, `themes` |
| `animals[].liquidManurePercent` | 4 | `animals`, `bell`, `flash`, `themes` |
| `animals[].manurePercent` | 4 | `animals`, `bell`, `flash`, `themes` |
| `animals[].milkPercent` | 4 | `animals`, `bell`, `flash`, `themes` |
| `animals[].strawPercent` | 4 | `animals`, `bell`, `flash`, `themes` |
| `animals[].waterPercent` | 4 | `animals`, `bell`, `flash`, `themes` |
| `farmBalance` | 4 | `events`, `flash`, `kpi`, `themes` |
| `fields[].isReadyToHarvest` | 4 | `bell`, `calendar`, `fields`, `themes` |
| `prices[].items[].pricePerTon` | 4 | `events`, `flash`, `prices`, `themes` |
| `productions[].items[].amount` | 4 | `events`, `flash`, `productions`, `themes` |
| `vehicles[].fuelPercent` | 4 | `bell`, `events`, `themes`, `vehicles` |
| `vehicles[].implements[].fillUnits[].percent` | 4 | `events`, `flash`, `themes`, `vehicles` |
| `animals[].reproductionPercent` | 3 | `animals`, `flash`, `themes` |
| `farmBalanceDeltaDay` | 3 | `events`, `kpi`, `themes` |
| `fields[].daysToHarvest` | 3 | `calendar`, `fields`, `themes` |
| `fields[].fruitTypeId` | 3 | `calendar`, `fields`, `themes` |
| `fields[].isCut` | 3 | `calendar`, `fields`, `themes` |
| `fields[].isWithered` | 3 | `calendar`, `fields`, `themes` |
| `fields[].needsCultivating` | 3 | `calendar`, `fields`, `themes` |
| `fields[].needsLime` | 3 | `calendar`, `fields`, `themes` |
| `fields[].needsPlowing` | 3 | `calendar`, `fields`, `themes` |
| `fields[].needsSowing` | 3 | `calendar`, `fields`, `themes` |
| `fields[].owned` | 3 | `bell`, `calendar`, `fields` |
| `fields[].rollerLevel` | 3 | `calendar`, `fields`, `themes` |
| `fields[].stoneLevel` | 3 | `calendar`, `fields`, `themes` |
| `fields[].weedLevel` | 3 | `calendar`, `fields`, `themes` |
| `vehicles[].isInUse` | 3 | `events`, `themes`, `vehicles` |
| `animals[].productivity` | 2 | `animals`, `flash` |
| `animals[].reproductionStatus` | 2 | `animals`, `themes` |
| `availableFruits[].needsRolling` | 2 | `calendar`, `fields` |
| `DashState.vehiclesExpanded` | 2 | `themes`, `vehicles` |
| `fields[].area` | 2 | `calendar`, `fields` |
| `fields[].fruitName` | 2 | `bell`, `fields` |
| `fields[].saveGroundType` | 2 | `fields`, `themes` |
| `fields[].sprayLevel` | 2 | `fields`, `themes` |
| `fields[].weedState` | 2 | `fields`, `themes` |
| `gameSettings.limeRequired` | 2 | `calendar`, `fields` |
| `gameSettings.plowingRequiredEnabled` | 2 | `calendar`, `fields` |
| `gameSettings.stonesEnabled` | 2 | `calendar`, `fields` |
| `gameSettings.weedsEnabled` | 2 | `calendar`, `fields` |
| `gameYear` | 2 | `calendar`, `kpi` |
| `productions[].productions[].status` | 2 | `productions`, `themes` |
| `storage[].items[].capacity` | 2 | `bell`, `storage` |
| `storage[].storageName` | 2 | `bell`, `storage` |
| `vehicles[].adBlueCapacity` | 2 | `themes`, `vehicles` |
| `vehicles[].adBluePercent` | 2 | `themes`, `vehicles` |
| `vehicles[].conditionPercent` | 2 | `themes`, `vehicles` |
| `vehicles[].fuelCapacity` | 2 | `bell`, `vehicles` |
| `weather.forecast` | 2 | `kpi`, `weather` |
| `weather.temperature` | 2 | `kpi`, `weather` |
| `weather.temperatureMax` | 2 | `kpi`, `weather` |
| `weather.temperatureMin` | 2 | `kpi`, `weather` |
| `weather.typeId` | 2 | `kpi`, `weather` |
