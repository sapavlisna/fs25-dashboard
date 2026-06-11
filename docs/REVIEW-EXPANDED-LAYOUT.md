# Redesign rozšířeného (2-sloupcového) zobrazení sekcí

**Větev:** `feature/per-section-settings`
**Datum:** 2026-05-30
**Vstup:** návrhové workflow (26 agentů: pochopení → návrh variant → 3-hlediskové posouzení → syntéza)

---

## Problém

Když sekce přejde do `expanded-*` (span 2 masonry sloupce), obsah se dosud jen **roztáhl** — pořád 1 položka na řádek, takže uprostřed vznikalo prázdné místo. Cíl: investovat šířku do reálných dat, ne do natažení 1fr.

## Společný princip (z 12 verdiktů)

Vzor **„2 položky vedle sebe" prohrál všude** — jen přeskládá, nepřidá informaci, rozbíjí svislý sken a drag. Vítězný princip: **hustý řádek s tabulkovým zarovnáním**, šířka jde na inline absolutní hodnoty (litry/tuny), delší ale stropované bary a dříve skrytá data. Výjimka: výrobny, kde dvě kolony nesou různé role (zásoby vs. recepty).

Striktní izolace pod `.expanded-<key>` — základní (span 1) render se nedotkl. Jediná záměrná výjimka: **Pole** (always span 2) → zónový růstový bar je nový default.

## Co bylo dodáno

| Sekce | Varianta | Realizace |
|---|---|---|
| 🚜 Vozidla | Hustý řádek | palivo+litry · kondice · rychlost · mh ve sloupcích; nářadí jako **chipy** (label · mini-bar · % nebo tuny u aktivního vozidla, „+N" pro zbytek); AdBlue zlatý proužek pod palivem |
| 🐄 Zvířata | Odlepené bary | bary jako vnitřní grid `label·bar·litry`; **inline litry/tuny** u K/V/P/M/H/Kj; **N/max ks** (oranžová při plné kapacitě); **💰 hodnota stáda** (Σ počet×cena); plemena |
| 📦 Sklady | Stacked bar | barevný proporční **přehledový bar** v hlavičce (≥2 komodity) + „volné X l"; tělo ve **2 sloupcích** s barevnými tečkami (legenda) |
| 🏭 Výrobny | Side-by-side | **VSTUPY/VÝSTUPY vlevo · RECEPTY vpravo**; tříkošová klasifikace (📥 vstup / 📤 výstup / 🔁 meziprodukt); průtok l/h, náklady €/h (jen běžící), status jako levý barevný okraj; Σ l/h·€/h |
| 🌱 Pole | Wide-row | **zónový zrající růstový bar** (zelená→zlatá gradient, výrazně delší) — nový default; volitelný sloupec **Hnojení** (spray 0–2) |

## Klíčová rozhodnutí / odchylky od spec

- **Vozidla `vc-right` ponecháno jako jedna grid buňka** (5 stabilních sloupců) místo `display:contents` — robustní vůči skrytým cond/speed (spec to označil za hlavní riziko).
- **Pole: bezpečná podmnožina** — zónový bar + sloupec Hnoj (`fieldsColSpray`) místo riskantního `table-layout:fixed` + `fieldsWide` master, který spec sám flagoval jako nejméně jistou část. Spray donut zahozen ve prospěch `X/2` s barvou (konzistence s ostatními sloupci).
- **Sparkline mini-grafy odloženy** — server nedrží per-entitu historii (`db.js` = jen balance/prices/fields/events). Vyžadovalo by nový JSONL + `/api/history/<typ>/<id>` endpoint. Fáze 2.
- **Žádná změna topologie** Sortable/DnD kontejnerů — vehicles/animals zůstaly seznam, storage/productions `<table>`; mění se jen vnitřek pod `.expanded-*`.

## Responsivita

Recyklovány stávající breakpointy: `≤1300px` (masonry 2-sloup, expanded = celá řada — grid drží), `≤700px` (vše kolabuje na známý kompaktní stav: vozidla zpět na vertikální stack nářadí, sklady/výrobny 1-sloup, zvířata flex bary).

## Mock data

Obohaceno pro demonstrovatelnost + pokrytí: `mock-data.js` + `mock-scenarios.js` výrobny dostaly `inputs`/`outputs`/`costsPerHour`; `harvest-ready` silo multi-komoditní; `animal-needs` zvířata litry/kapacity/`maxCount`/`clusters`.

## Testy

`section-cfg.spec.js` +6 testů (Expanded layout redesign): expanded třída + inline litry (zvířata), chipy (vozidla), 2-sloup tělo (sklady), side-by-side grid + průtok (výrobny), zónový bar + sloupec Hnoj (pole). Vizuálně ověřeno screenshoty všech 5 sekcí.

## Co zvážit dál (fáze 2)

- Sdílená `sparkline()` utilita + per-entitu historie (trend zaplnění skladu, paliva).
- Autoritativní `plowLevel`/`limeLevel` z `savegame.js` → donut s podílem místo binárního ✓/— u polí.
- Hodnota stáda jako klikatelný rozpad po plemenech.
- Default řazení dle naléhavosti (aktivní vozidla / pole blízko sklizně nahoru).
