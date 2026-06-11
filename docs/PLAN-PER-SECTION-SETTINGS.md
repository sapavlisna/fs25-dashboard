# Plán: Per-section nastavení

**Větev:** `feature/per-section-settings`  
**Datum:** 2026-05-29  
**Stav:** Schváleno — připraveno k implementaci

> Veškerá práce na tomto plánu probíhá **výhradně ve větvi `feature/per-section-settings`**.  
> Do `main` se merguje až po dokončení všech fází a ručním smoke testu.  
> Větev: `git checkout feature/per-section-settings`

---

## Záměr

Každá sekce hlavního dashboardu dostane vlastní ⚙ tlačítko v hlavičce. Kliknutím se otevře **inline panel** (dropdown pod hlavičkou) s dvěma úrovněmi nastavení:

1. **Základní** — přepínače pro nejčastější volby (2–4 položky)
2. **Rozšířené nastavení** — akordeon se skrytými detailními volbami pro jednotlivé kategorie dat

Globální settings modal přijde o tab „🚜 Vozidla" — všechna tamní nastavení se přesunou do per-section panelu vozidel.

---

## UI pattern: per-section settings panel

### Struktura hlavičky (after)

```html
<div class="section-header">
    <span class="drag-handle">⠿</span>
    🚜 Vozidla <span class="count" id="cnt-vehicles">0</span>
    <button class="sec-cfg-btn" data-sec-cfg="vehicles" title="Nastavení sekce">⚙</button>
    <label class="flash-toggle">…</label>
</div>
```

- `.sec-cfg-btn` — malé tlačítko (14 px, průhledné pozadí, accent hover), vždy vpravo před flash togglem
- `data-sec-cfg` — identifikátor sekce pro otevření správného panelu

### Panel (dropdown)

```
┌────────────────────────────────────┐
│ ⚙ Nastavení vozidel             × │
├────────────────────────────────────┤
│ ☑ Rozšířené zobrazení (2 sloupce) │
│ ☑ Zobrazit kondici + rychlost      │
│ ☑ Zobrazit prázdné nářadí          │
│ ☐ Skrýt vzduch (AIR)               │
├────────────────────────────────────┤
│ ▶ Rozšířené nastavení             │  ← accordion, defaultně sbalený
└────────────────────────────────────┘
```

Po kliknutí na „▶ Rozšířené nastavení":

```
│ ▼ Rozšířené nastavení             │
│                                    │
│   Nářadí                           │
│   ☑ Zobrazit zbylé fillType skupiny│
│   ☐ Skrýt plodiny                  │
│   ☐ Skrýt kapaliny                 │
│                                    │
│   AI/CP/AD                         │
│   ☑ Zobrazit worker badge          │
│   ☑ Zobrazit ETA                   │
└────────────────────────────────────┘
```

**Chování panelu:**
- Otevření: klik na `.sec-cfg-btn` nebo klik na `data-sec-cfg` toggle
- Zavření: klik mimo panel, klik na ×, nebo klik znovu na ⚙ (toggle)
- Jen jeden panel otevřený najednou
- Panel se pozicuje absolutně pod hlavičkou; nepřetéká mimo viewport (flip nahoru pokud nestačí místo)
- Nastavení se okamžitě ukládají do DashState + ServerSync (jako stávající vehicle settings)

---

## Matice nastavení per sekce

### 🌱 Pole

**Základní:**
| Nastavení | Klíč DashState | Default | Popis |
|---|---|---|---|
| Rozšířené zobrazení (2 sloupce) | `fieldsExpanded` | false | Sekce se roztáhne přes 2 sloupce |
| Zobrazit jen vlastní pole | `fieldsOwnedOnly` | true | Filtruje pronajatá/ne-vlastní pole |
| Zobrazit dny do sklizně | `fieldsShowDays` | true | Sloupec „Dní do sklizně" |

**Rozšířené — Sloupce:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Zobrazit sloupec Spray | `fieldsColSpray` | false |
| Zobrazit sloupec Lime | `fieldsColLime` | false |
| Zobrazit sloupec Plow | `fieldsColPlow` | false |
| Zobrazit sloupec Kameny/Plevel | `fieldsColWeed` | false |

**Rozšířené — Inline akce (čipy v sloupci Stav):**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Zobrazit čipy akcí (Orat, Sít…) | `fieldsShowChips` | true |

*Poznámka: Data pro spray/lime/plow/weed jsou v payloadu (`f.needsLime`, `f.weedLevel` atd.), jen nejsou zobrazena — jen přidat `<td>` a podmíněné CSS.*

---

### 🚜 Vozidla *(migrace z globálního settings)*

**Základní** *(přesunuto ze současného „Vozidla" tabu):*
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Rozšířené zobrazení (2 sloupce) | `vehiclesExpanded` | false |
| Zobrazit kondici + rychlost | `vehicleShowCondition` | true |
| Zobrazit prázdné nářadí | `vehicleShowEmptyImplements` | true |
| Skrýt vzduch (AIR) | `vehicleHideAir` | false |

**Rozšířené — Zobrazení vozidla:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Zobrazit motorové hodiny | `vehicleShowEngineHours` | true |
| Zobrazit AI/CP/AD worker badge | `vehicleShowWorkerBadge` | true |
| Zobrazit ETA u workera | `vehicleShowWorkerETA` | true |

**Rozšířené — Nářadí (fillType skupiny):**

Kategorie fillType skupin k zobrazení/skrytí — mapují na `fillType` hodnoty z Lua:

| Skupina | Fill typy | Klíč DashState | Default |
|---|---|---|---|
| Plodiny | WHEAT, BARLEY, CANOLA, … (všechny plodinové) | `vehicleImplHideCrops` | false |
| Kapaliny (hnojivo/postřik) | LIQUID_FERTILIZER, HERBICIDE, SLURRY | `vehicleImplHideLiquids` | false |
| Pevné vstupy | FERTILIZER, SEEDS, LIME | `vehicleImplHideSolids` | false |
| Biomasa | GRASS, CHAFF, STRAW, SILAGE | `vehicleImplHideBiomass` | false |
| Ostatní (voda, mléko…) | WATER, MILK, … | `vehicleImplHideOther` | false |

*Implementace: `displayFillUnits` dostane mapu skrytých kategorií; `fillType` jméno se porovná s lookup tabulkou kategorií.*

---

### 🐄 Zvířata

**Základní:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Rozšířené zobrazení (2 sloupce) | `animalsExpanded` | false |
| Zobrazit alarm badge | `animalsShowAlarm` | true |
| Zobrazit reprodukci | `animalsShowReproduction` | true |

**Rozšířené — Vstupy:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Zobrazit Krmivo (K%) | `animalsShowFood` | true |
| Zobrazit Vodu (V%) | `animalsShowWater` | true |
| Zobrazit Podestýlku (P%) | `animalsShowBedding` | true |

**Rozšířené — Výstupy:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Zobrazit Mléko (M%) | `animalsShowMilk` | true |
| Zobrazit Hnůj (H%) | `animalsShowManure` | true |
| Zobrazit Kejdu (Kj%) | `animalsShowSlurry` | true |

---

### 📦 Sklady

**Základní:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Rozšířené zobrazení (2 sloupce) | `storageExpanded` | false |
| Defaultně sbalit skupiny | `storageDefaultCollapsed` | true |
| Skrýt komodity s 0 l | `storageHideEmpty` | false |

**Rozšířené — Zobrazení:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Zobrazit kapacitu (l) | `storageShowCapacity` | true |
| Zobrazit % zaplnění | `storageShowPercent` | true |
| Zobrazit progress bar | `storageShowBar` | true |

---

### 🏭 Výrobny

**Základní:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Rozšířené zobrazení (2 sloupce) | `productionsExpanded` | false |
| Zobrazit jen aktivní | `productionsActiveOnly` | false |
| Defaultně sbalit skupiny | `productionsDefaultCollapsed` | true |

**Rozšířené — Detail receptury:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Zobrazit vstupy (suroviny) | `productionsShowInputs` | true |
| Zobrazit výstupy | `productionsShowOutputs` | true |
| Zobrazit cykly/hod | `productionShowCycles` | true |

---

### 💰 Výkupní ceny

**Základní:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Jen komodity s mým skladem | `pricesOwnedOnly` | false |
| Defaultně sbalit výkupní místa | `pricesDefaultCollapsed` | false |

*Poznámka: „Skrýt vše bez skladu" tlačítko se chová jako one-shot akce (skryje a uloží do TableTools) — zůstane jako tlačítko; `pricesOwnedOnly` je naopak live filter (neukládá skrytí per-item, jen filtruje render).*

**Rozšířené — Zobrazení:**
| Nastavení | Klíč DashState | Default |
|---|---|---|
| Zobrazit dostupné množství (t) | `pricesShowStock` | true |
| Zobrazit trend (↑↓) | `pricesShowTrend` | false |

---

## Architektura implementace

### Nové soubory / moduly

**`public/sectionCfg.js`** — sdílený modul (všechny stránky):

```js
window.SectionCfg = {
    // Registrace sekce: sectionKey → { basicItems[], advancedGroups[] }
    register(key, def) {},
    
    // Otevření/zavření panelu
    open(sectionKey, anchorEl) {},
    close() {},
    toggle(sectionKey, anchorEl) {},
    
    // Renderování panelu (DOM inject, wire-up DashState + ServerSync)
    _render(key, def, anchorEl) {},
    
    // Zavření při kliknutí mimo
    _onOutsideClick(e) {},
};
```

Panel se renderuje do `<div id="sec-cfg-panel">` (singleton, přesouvá se v DOM pod anchor).

### CSS (přidat do `style.css`)

```css
/* Per-section config button */
.sec-cfg-btn { … }          /* malé tlačítko v hlavičce */
.sec-cfg-btn:hover { … }

/* Dropdown panel */
#sec-cfg-panel { … }        /* position: absolute, z-index nad obsahem */
.sec-cfg-header { … }       /* titulek + zavírací × */
.sec-cfg-basic { … }        /* sekce základních přepínačů */
.sec-cfg-advanced-toggle { … } /* accordion trigger */
.sec-cfg-advanced { … }     /* accordion obsah */
.sec-cfg-group { … }        /* skupina v rozšířeném nastavení */
.sec-cfg-group-label { … }  /* nadpis skupiny */
```

### Změny existujících souborů

| Soubor | Změna |
|---|---|
| `index.html` | Přidat `.sec-cfg-btn` do každé `.section-header`; importovat `sectionCfg.js`; přidat registraci sekcí; napojit nastavení na render funkce |
| `app.js` | Odstranit tab `data-panel="vehicles"` z settings modalu; odstranit handler `vehicles-expanded`, `vehicles-show-empty-impl`, `vehicles-show-condition`, `vehicles-hide-air` |
| `style.css` | Přidat CSS pro panel + button |
| `state.js` | Přidat nové klíče do `DashState.KEYS` |

### Integrace render funkcí

Každá render funkce (`renderFields`, `renderVehicles`, `renderAnimals`, atd.) si stávajícím způsobem čte DashState:

```js
// před:
const showEmpty = DashState.get('vehicleShowEmptyImplements', true) !== false;

// po: beze změny — jen klíče se přidávají
const showEngineHours = DashState.get('vehicleShowEngineHours', true) !== false;
```

Memoizační klíče (`_vehiclesMemo` atd.) musí zahrnout nové DashState hodnoty — přidat je do `memoKey` stringu.

---

## Fáze implementace

### Fáze 1 — Infrastruktura panelu (CSS + JS shell)
- [ ] Přidat `.sec-cfg-btn` HTML do všech section-header v `index.html`
- [ ] Napsat `sectionCfg.js` (open/close/render, bez obsahu)
- [ ] CSS pro button + prázdný panel
- [ ] Otestovat otevírání/zavírání na všech sekcích

### Fáze 2 — Migrace vozidel
- [ ] Zaregistrovat sekci `vehicles` v `sectionCfg`
- [ ] Přidat 4 stávající checkboxy do panelu (přesun z globálního settings)
- [ ] Odstranit tab „Vozidla" z globálního settings modalu (`app.js`)
- [ ] Přidat rozšířené nastavení vozidel (engineHours, workerBadge, fillType skupiny)
- [ ] Napojit nové klíče na `implementsSummary` / `implementsHTML` / `vehicleCardHTML`

### Fáze 3 — Ostatní sekce
- [ ] Pole (základní + advanced)
- [ ] Zvířata (základní + advanced)
- [ ] Sklady (základní + advanced)
- [ ] Výrobny (základní + advanced)
- [ ] Ceny (základní + advanced)

### Fáze 4 — 2-sloupce rozšíření
- [ ] Zobecnit mechanismus `vehiclesExpanded` na libovolnou sekci
- [ ] Přidat `expanded` toggle do každé sekce (Pole, Zvířata, Sklady, Výrobny)

### Fáze 5 — Cleanup + QA
- [ ] Odstranit zastaralé DashState klíče (pokud se přejmenovaly)
- [ ] Aktualizovat memoizační klíče ve všech render funkcích
- [ ] Smoke testy (nový `.spec.js` pro per-section settings toggle)

---

## Co se **nemění**

- Flash toggle zůstává v hlavičce sekce (je to one-click akce, ne nastavení)
- Drag-to-hide řádků (TableTools) zůstává beze změny
- Drag-to-reorder sekcí (TableTools sections scope) zůstává beze změny
- Globální settings: Notifikace, Sekce, Vzhled, Sync, Diagnostika (hidden) — zůstávají

---

## Rozhodnuté otázky

1. **Pozice panelu na mobilu** — ponecháno na implementaci. Zvoleno: dropdown desktop, na mobilním viewportu (`max-width: 600px`) se panel roztáhne přes celou šířku sekce (full-width inline, `position: static`). Čistě CSS, žádná JS detekce viewportu.

2. **Kategorie fillType pro vozidla** — neznámé typy (přidané modem, nestandardní) spadají do skupiny **Ostatní**, která se zobrazuje vždy. Skupinu Ostatní nelze skrýt — zabraňuje ztrátě dat u modů s vlastními typy.

3. **`storageDefaultCollapsed`** — klíč platí pouze jako výchozí hodnota pro skupiny, které uživatel ještě ručně nemanipuloval. Stávající per-group stav v `collapsedGroups` zůstává nedotčen.
