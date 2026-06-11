# Zpětná analýza + hodnocení: Per-section nastavení

**Větev:** `feature/per-section-settings`
**Datum:** 2026-05-29
**Navazuje na:** [PLAN-PER-SECTION-SETTINGS.md](PLAN-PER-SECTION-SETTINGS.md)

---

## 1. Co bylo dodáno (inventář možností)

| Sekce | Základní (počet) | Rozšířené (počet) | Celkem |
|---|---|---|---|
| 🌱 Pole | 3 | 4 (extra sloupce) | 7 |
| 🚜 Vozidla | 4 | 7 (3 vozidlo + 4 nářadí-skupiny) | 11 |
| 🐄 Zvířata | 3 | 6 (3 vstupy + 3 výstupy) | 9 |
| 📦 Sklady | 3 | 3 | 6 |
| 🏭 Výrobny | 3 | 2 | 5 |
| 💰 Ceny | 2 | 0 | 2 |
| **Σ** | **18** | **22** | **40 přepínačů** |

Plus: 4 sekce mají `expanded` (2 sloupce), panel s accordionem, mobilní full-width.

---

## 2. Zpětná analýza — co logicky NEdává smysl / chybí

### 🔴 Kritické (zhoršují použitelnost)

**Z-1: Není cesta zpět k výchozímu stavu.**
40 přepínačů, žádný reset. Uživatel, který se „prokliká" k nechtěné konfiguraci, nemá jak se snadno vrátit — musel by si pamatovat každý default. → **Implementovat reset tlačítko per sekce.**

**Z-2: Skrytý stav je neviditelný.**
Když uživatel vypne např. „zobrazit prázdné nářadí" nebo skryje skupinu fillType, ⚙ tlačítko vypadá identicky jako u nedotčené sekce. Po čase uživatel zapomene a diví se, proč data „chybí". → **Indikátor ne-výchozího stavu na ⚙ (tečka).**

### 🟡 Středně důležité (matoucí, ale ne blokující)

**Z-3: „Nářadí – skrýt skupiny" tiše nechává „Ostatní" vždy viditelné.**
Dle rozhodnutí v plánu se neznámé typy (voda, mléko, mod-typy) nedají skrýt. Uživatel to ale nikde nevidí → zapne všechny 4 skupiny a diví se, že něco zůstalo. → **Přidat vysvětlující poznámku do skupiny.**

**Z-4: Sklady — vypnutí „% zaplnění" i „progress bar" nechá sloupec Zaplnění prázdný.**
Není to chyba (uživatel to chtěl), ale sloupec pak nemá smysl. Akceptováno — uživatelská volba, není nutné gate-ovat.

### 🟢 Drobné / akceptované

- **Z-5:** Accordion se vždy otevírá sbalený (stav se neuchovává). → Akceptováno, rozumný default.
- **Z-6:** Každý toggle spustí `FS25App.rerender()`. Memo klíče to tlumí (re-render je no-op když se payload nezměnil, ale cfg klíče jsou v memo, takže jeden skutečný překreslení). Bez dopadu na výkon při ruční obsluze.
- **Z-7:** Ceny nemají rozšířené nastavení (accordion se nezobrazí). OK — `pricesShowTrend` z plánu nebyl implementován (trend data nejsou v payloadu cen).

---

## 3. Návrhy na vylepšení

### Iterace 1

| # | Vylepšení | Přínos |
|---|---|---|
| **V-1** | Reset tlačítko „↺ Výchozí" v patičce panelu | Řeší Z-1 — okamžitý návrat ke všem defaultům sekce |
| **V-2** | Indikátor (tečka) na ⚙ když sekce má ne-výchozí nastavení | Řeší Z-2 — viditelnost upraveného stavu |
| **V-3** | Poznámka „Ostatní (voda, mléko, …) se zobrazuje vždy" ve skupině nářadí | Řeší Z-3 — odstraní zmatení |

### Iterace 2 — odložená vylepšení + granulární flash

| # | Vylepšení | Detail |
|---|---|---|
| **O-1** | Pole: „Skrýt prázdná pole" + „Skrýt strniště + zvadlá" | Nová advanced skupina „Filtr stavu" — `fieldsHideEmpty`, `fieldsHideStubble` |
| **O-2** | Vozidla: „Jen pracující vozidla" | Basic toggle `vehiclesActiveOnly` — filtruje `!v.isInUse` (skryté zůstávají skryté) |
| **O-3** | Zvířata: konfigurovatelný práh alarmu | Skupina „Práh alarmu" se **select** přepínači (vstupy 10/25/40/50 %, výstupy 75/85/90/95 %) — vyžádalo rozšíření `sectionCfg` o typ `select` |
| **FLASH** | Granulární kontrola co flashuje | Sklady + Výrobny: zvlášť „Souhrn" (header) a „Jednotlivé položky" (item). Flash framework rozšířen o pod-kanály `section::channel`; master vypínač zůstává v hlavičce |

**Rozšíření `sectionCfg`:** typ `select` (číselné/enum hodnoty) + `get`/`set` hook (flash kanály žijí v `flashEnabled` mapě, ne v plain DashState klíči). To otevírá dveře pro budoucí ne-bool nastavení.

### Stále odloženo

| # | Nápad | Proč |
|---|---|---|
| O-2b | Vozidla: filtr dle typu (traktor/kombajn/přívěs) | Vyžaduje typovou klasifikaci, kterou payload nenese |
| O-4 | Ceny: trend ↑↓ | Data nejsou v payloadu, vyžaduje server-side |
| O-5 | Hromadný „skrýt/zobrazit vše" pro skupiny | Až bude víc skupin než ~5 |
| O-6 | Export/import konfigurace nastavení | Sync už řeší cross-device; export je nice-to-have |

---

## 4. Testovací pokrytí

**Výsledek:** `section-cfg.spec.js` — **21 testů, všechny zelené** (15 z iterace 1 + 6 z iterace 2).

Iterace 2 přidala testy pro: O-2 (jen pracující vozidla), O-1 (skrýt prázdná pole), O-3 (práh alarmu jako numerický select + dirty/reset), flash kanál storage `item`/`header` (persistence do `flashEnabled` mapy + dirty/reset).

Nový smoke spec `section-cfg.spec.js` ověřuje:
- Otevření/zavření panelu (klik na ⚙, klik mimo, Escape, druhý klik)
- Každá sekce: panel se otevře s očekávaným titulkem + počet základních řádků
- Toggle základního nastavení → persistuje do DashState + projeví se v renderu
- Accordion „Rozšířené nastavení" se rozbalí a obsahuje skupiny
- Toggle rozšířeného nastavení (skrytí kategorie/sloupce) → projeví se v DOM
- Expanded toggle → přidá `.expanded-<section>` třídu
- Reset tlačítko → vrátí všechny klíče na default (V-1)
- Indikátor ne-výchozího stavu (V-2)
- Jen jeden panel otevřený najednou

---

## 5. Závěrečné hodnocení

**Co funguje dobře:**
- Konzistentní pattern napříč sekcemi (basic + advanced accordion).
- Logika defaultů: „zobrazit X" → true, „skrýt X" → false.
- Migrace vozidel z globálního nastavení proběhla čistě.
- Mobilní full-width řešení bez JS detekce.

**Co se zlepšilo touto iterací:**
- Reset (V-1) + indikátor (V-2) dělají z „nastavovací pasti" bezpečně reverzibilní nástroj.
- Poznámka (V-3) odstraňuje jediné reálné zmatení v UI.

**Doporučení do budoucna:** O-1 (filtr polí dle stavu) a O-2 (skrýt nečinná vozidla) mají největší praktickou hodnotu — uživatel s 50 poli / 30 vozidly je ocení nejvíc.
