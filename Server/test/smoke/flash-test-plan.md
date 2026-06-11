# Flash Test Plan — Dashboard sekce

Každá sekce má vlastní spec soubor. Metodika viz `animals-flash.spec.js` a paměť `feedback_flash_test_methodology`.

---

## ✅ Zvířata / Animals — HOTOVO

Soubor: `animals-flash.spec.js`  
Config: `playwright.flash.config.js` (port 3098)  
Run: `npm run test:flash`

Otestováno 8 parametrů, každý izolovaně: food · straw · milk · manure · slurry · health · repro · count.

---

## 🌱 Pole / Fields

### Flash mechanismus
- `noteFlashRows('fields', fields.filter(owned), f => f.id, f => f.growthState)`
- Flash klíč: `fields::{f.id}` (číslo pole)
- Target element: `<tr data-tt-key="{f.id}">` v `#fields-body`
- CSS třída: `.flash-up` / `.flash-down` na `<tr>`

### Parametry a stavy
| Parametr | Typ | Rozsah | Poznámka |
|----------|-----|--------|----------|
| `growthState` | int % | 0–100 | jediný sledovaný parametr; null = nepozoruje |
| `owned` | bool | true/false | pouze `owned=true` se sleduje |
| `id` | int | 1–N | flash klíč |

### Stavy `growthState`
- `0` — zaseto / prázdné
- `1–99` — roste
- `100` — sklizeno / připraveno k žní (flash-up → červená = sklizeno je matoucí, ale takto funguje)
- `null` / neuvedeno — pole se nesleduje

### Testovací zvíře (testfield)
Pole č. 1, `owned: true`, ostatní pole buď žádná nebo s `owned: false` (nesmí flashovat).

### Izolace
Ostatní pole nesmí flash-upnout při změně pole č. 1. Testovat: 1 pole, 1 změna.

---

## 🚜 Vozidla / Vehicles

### Flash mechanismus
- `noteImplementFlashes(vehicles)` — sleduje `fillUnit.percent` každé jednotky nářadí
- Flash klíč: `vehicles::impl::{v.name}::{impl.name}::{unitIndex}`
- `getImplFlashCls(v.name)` — agreguje flash přes všechny fillUnits vozidla → třída na celý řádek
- Target element: `<div class="vehicle-row" data-tt-key="{v.name}">`
- CSS třída: `.flash-up` / `.flash-down` na `.vehicle-row`

### Parametry a stavy
| Parametr | Typ | Rozsah | Poznámka |
|----------|-----|--------|----------|
| `implements[].fillUnits[].percent` | float | 0–100 | sleduje se zaokrouhleno na int |
| `fillType` | string | enum | `AIR` se přeskakuje |

### Stavy `fillType`
- `DIESEL`, `WATER`, `FERTILIZER`, `SEEDS`, `MANURE`, `LIQUIDMANURE`, ... — sledují se
- `AIR` — explicitně přeskočen
- `EMPTY` — sleduje se (percent = 0)

### Důležité: flash na celý řádek, ne na konkrétní fillUnit
`getImplFlashCls` bere první aktivní flash přes všechny fillUnits → nelze izolovat na konkrétní implementaci. Testovat: vozidlo s **jedním nářadím s jednou fillUnit**, aby flash nešel z jiné jednotky.

### Izolační design
- 1 vozidlo, 1 nářadí (`implements`), 1 fillUnit (non-AIR)
- Ostatní vozidla buď žádná nebo se nesmí měnit

---

## 📦 Sklady / Storage

### Flash mechanismus — dvě úrovně
#### Header (silo aggregate)
- `noteFlashRows('storage', storageHeaderRows, x => x.k, x => x.v)`
- Klíč: `storage::header::{storageName}#{itemsHash}`
- Hodnota: součet všech `item.amount` v silu
- Target: `<tr class="st-row collapsible" data-tt-key="{storageName}">`

#### Item
- `noteFlashRows('storage', storageItemRows, x => x.k, x => x.v)`
- Klíč: `storage::item::{storageName}#{itemsHash}::{item.name}`
- Hodnota: `item.amount` (litry, int)
- Target (compact): `<tr class="group-item" data-group="{storageName}">`
- Target (expanded): `<div class="st-item">`

### Parametry a stavy
| Parametr | Typ | Rozsah | Poznámka |
|----------|-----|--------|----------|
| `item.amount` | int (l) | 0–capacity | jednotlivá komodita |
| `item.capacity` | int (l) | 0–N | 0 = neznámá kapacita |
| `item.name` | string | — | flash klíč + selector |
| `storageName` | string | — | flash klíč |

### Stavy
- `amount = 0` — prázdné
- `amount < capacity` — plní se / ubývá
- `amount = capacity` — plné (ipct = 100 %, třída `full`)
- `capacity = 0` — kapacita neznámá, bar se nezobrazuje

### Pozor: `storageFlashKey` obsahuje hash položek
Klíč header/item se mění, pokud se změní seznam komodit v silu. Test musí udržovat stejnou sadu komodit napříč ticky.

### Testovací design
- 1 silo, 2 komodity (pšenice + ječmen), kapacita 10000 l každá
- Test header: změnit obě najednou o stejnou hodnotu → header agregát změní, item flash může taky
- Test item: změnit pouze jednu → item flash pro konkrétní komoditu, header taky (součet se změnil)
- Izolace: druhá komodita musí zůstat konstantní při testu první

---

## 🏭 Výrobny / Productions

### Flash mechanismus — dvě úrovně (stejná logika jako Sklady)
#### Header
- Klíč: `productions::header::{production.name}`
- Hodnota: součet všech `item.amount`
- Target: `<tr class="st-row collapsible">`

#### Item
- Klíč: `productions::item::{production.name}::{item.name}`
- Hodnota: `item.amount`
- Target (compact): `<tr class="group-item">`
- Target (expanded): `<div class="ps-stock-row">`

### Parametry a stavy
| Parametr | Typ | Rozsah | Poznámka |
|----------|-----|--------|----------|
| `item.amount` | int (l) | 0–capacity | stejná logika jako sklady |
| `production.name` | string | — | flash klíč |
| `production.isActive` | bool | — | ovlivňuje zobrazení, ne flash |
| `production.productivity` | int % | 0–100 | nesleduje se flashem |

### Stavy výrobny
- `items = []` — prázdná výrobna (žádný flash)
- `item.amount` roste — výrobna produkuje
- `item.amount` klesá — stock se vybírá
- Výrobna může mít vstupy i výstupy; obojí je `items[]`

### Testovací design
Stejný přístup jako sklady. 1 výrobna, 2 položky.

---

## 💰 Ceny / Prices

### Flash mechanismus
- `noteFlashRows('prices', priceRows, x => x.k, x => x.v)`
- Klíč: `prices::{sp.sellPoint}::{item.name}`
- Hodnota: `item.pricePerTon` (float, €/t)
- Target: `<tr class="group-item">` (cena za tunu pro danou komoditu na daném výkupním místě)

### Parametry a stavy
| Parametr | Typ | Rozsah | Poznámka |
|----------|-----|--------|----------|
| `pricePerTon` | float | 0–1000+ | základní cena €/t |
| `item.name` | string | — | klíč |
| `sp.sellPoint` | string | — | klíč |

### Stavy
- Cena roste (flash-up = zelená) — výhodná situace
- Cena klesá (flash-down = červená) — nevýhodná
- Cena = 0 — výkupní místo nekupuje (tracking stále probíhá)

### Testovací design
1 výkupní místo, 2 komodity. Měnit vždy jen jednu cenu, druhá zmrazena.

---

## 💰 Zůstatek / Balance

### Flash mechanismus
- `noteBalanceFlash(farmBalance)` — speciální funkce s threshold gate
- Klíč: `balance::main` (hardcoded)
- Threshold: `Math.abs(delta) >= Math.max(1000, Math.abs(prev) * 0.001)` — pod touto hranicí se flash nespustí
- Target: `<span id="kpi-balance">`
- CSS třída: `.flash-up` / `.flash-down` na `#kpi-balance`

### Parametry a stavy
| Parametr | Typ | Rozsah | Poznámka |
|----------|-----|--------|----------|
| `farmBalance` | float (€) | libovolné | může být záporné |

### Stavy a hraniční případy
- `delta >= 1000 €` → flash-up (příjem)
- `delta <= -1000 €` → flash-down (výdaj)
- `|delta| < 1000 € AND |delta| < 0.1% prev` → **žádný flash** (threshold)
- `delta < 1000 €` ale `delta >= 0.1% prev` (velký zůstatek) → flash se spustí
- Záporný zůstatek + záporná změna → flash-down

### Testovací design
- Nutno testovat threshold: změna 999 € nesmí flashovat, 1001 € musí
- Záporný zůstatek: prev = -500000, delta = -1000 → threshold = max(1000, 500) = 1000 → flash se spustí
- Base = 100000 €; up = 102000 € (delta=2000 ≥ 1000 → flash); down = 98000 € (delta=-2000 → flash)
- Threshold test: base = 100000, change = 100500 (delta=500 < 1000 → no flash)

---

## Postup pro nové spec soubory

1. Nový config: `playwright.{sekce}.config.js` — port +1 od předchozího (3098 animals, 3099 fields?, ...)
   → nebo rozšířit existující `playwright.flash.config.js` o `testMatch` array
2. Nový `flash-global-setup.js` nebo rozšířit existující o `build{SectionName}()` helper
3. Nový spec: `{sekce}-flash.spec.js` — stejná struktura jako `animals-flash.spec.js`
4. Přidat do `package.json` scripts: `"test:flash:{sekce}"`

### Doporučené pořadí implementace
1. Balance — nejjednodušší (1 hodnota, 1 element), ale threshold je zajímavý edge-case
2. Ceny — čistá tabulka, žádná hierarchie
3. Sklady — dvě úrovně (header + item), pozor na hash v klíči
4. Výrobny — identická logika jako sklady
5. Pole — jednoduchá, ale je třeba vlastní selector (data-tt-key="{fieldId}")
6. Vozidla — nejtěžší (impl + fillUnit vrstvení, AIR guard)
