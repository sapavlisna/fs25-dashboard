# FS25 Dashboard — uživatelský průvodce

Webový dashboard pro Farming Simulator 25. Pole, vozidla, zvířata, sklady, výrobny, ceny komodit, počasí — vše v reálném čase v prohlížeči, paralelně se hrou.

**Stav:** 2026-05-24 · mod v1.1.2.11 · server v1.1.2

---

## Co Dashboard dělá

Lua mód uvnitř FS25 každé 2 s zapíše JSON snapshot stavu farmy. Node.js server na lokálním PC ten soubor sleduje, obohatí ho daty z XML savegame (autoritativní stav polí), připojí historické řady, a posílá vše do prohlížeče přes WebSocket. Stránka se aktualizuje **bez reloadu**.

Aplikace běží **jen lokálně** — žádný cloud, žádné sdílení s kamarády (vědomé rozhodnutí, viz `docs/AUDIT.md`).

---

## Instalace + spuštění

1. **Mod** — `FS25_Dashboard.zip` patří do `<SteamLibrary>\FS25-Mods\`. Build skript `scripts/build-mod-generic.ps1` to umí + bumpne verzi v `modDesc.xml`.
2. **Server** —
   ```cmd
   cd src\Dashboard\Server
   npm install         # poprvé
   npm start           # nebo start.bat
   ```
   Server poslouchá na `http://localhost:3000`. Prohlížeč otevři tu URL.
3. **Pusť FS25** s aktivovaným modem. Po cca 5 s by se měly objevit data.

Pro vývoj bez hry: `npm run mock` (oddělený proces) generuje fake `dashboard_data.json` každých 5 s.

---

## Stránky

Dashboard má 5 hlavních stránek (záložky v nav baru): **Dashboard**, **Kalendář polí**, **Zisk polí**, **Historie**, **Nápověda**.

### Dashboard (`/`)

Hlavní obrazovka, masonry layout sekcí (každá sekce je „karta" v gridu).

**KPI hero řádek (4 karty nahoře):**

- 💰 **Zůstatek** — aktuální peníze farmy + denní delta (zelená/červená podle směru)
- 🌾 **Vlastněná pole** — počet + plocha + počet připravených ke sklizni
- 🚜 **Vozidla** — celkem + počet aktivních (Courseplay/AutoDrive/vanilla AI)
- 🐄 **Zvířata** — celkem + počet chovů potřebujících krmivo/vodu

**Sekce (drag-and-drop pořadí + skrytí):**

| Sekce | Co ukazuje | Skrytí |
|---|---|---|
| 🌾 Pole | Tabulka polí s rostoucí plodinou, fází, dny do sklizně. Klik → modal s plnými detaily. | Drag na „📥 Skrytá pole" zónu pod tabulkou |
| 🚜 Vozidla | Vozidla farmy, palivo, motohodiny, AI badge (Courseplay/AutoDrive/vanilla), kompaktní zápis naplnění připojeného nářadí | Drag řádku |
| 🐄 Zvířata | Chovy: počet kusů, krmivo %, voda %, podestýlka %, výstup (mléko/hnůj/kejda). Klik → modal s clustery a obsahem fillUnitů | Drag |
| 🏭 Sklady | Silo + farmské skladiště, agregát všech komodit + per-položka rozpis | Drag |
| ⚙ Výrobny | Production placeables: vstupy, výstupy, plnost | Drag |
| 📊 Ceny | Per-prodejní místo aktuální cena vs. forecast (12 měsíců dopředu) | Drag |
| ☁ Počasí | Aktuální + forecast 3 dny | Drag |

**Flash framework:** ⚡ toggle u sekce přepíná „zvýraznit změny". Při změně hodnoty se řádek na 10 s rozsvítí zeleně (přírůstek) nebo červeně (úbytek). Vozidlo navíc bliká když připojené nářadí dosáhne 100 % (plné) nebo 0 % (prázdné).

### Kalendář polí (`/calendar.html`)

Gantt diagram polí v čase. Dva frozen levé sloupce (**Pole** + **Co potřebuje**), pravá strana je timeline s denními značkami a horizontálním scrollbarem.

**Frozen sloupce:**

- **Pole** — `#ID 🌿 Plodina` na první řádce, `area ha · ●● fert badge` na druhé (fert ukazuje úroveň hnojení: ●● plné, ●○ 1×, ○○ nehnojeno).
- **Co potřebuje** — chip pilulky pro každou aktuální potřebu: 🔴 urgent (Plevel 2/3, Kameny 2/3), 🟡 warn (Orat, Vápno, Kultivovat, Sít), 🔵 info (Uválet). Max 3 pilulky + `+N` přebytek.

**Timeline (pravá strana):**

- **Strip 1 (růst):** aktuální plodina, barva podle fáze (teal=roste, zelená=sklízet, červená=zvadlé, šedá=sklizeno). Plus plánovaný úkol row-0 (na stejné y-souřadnici, ale tenčí).
- **Strip 2 (plán row-1):** stagger pro překryv — když dva plánované úkoly v čase navazují, druhý jde pod první.

Plánované úkoly s názvy přímo uvnitř pruhů: **setba** (žlutá, název plodiny uvnitř), **sklizeň** (zelená), **orba** (fialová), **hnojení** (modrá), **válení** (oranžová), **vápnění** (šedá).

**Datum:** chip v hlavičce ukazuje aktuální FS25 datum (`Den 42 · 15. Březen, rok 3`).

**Plánování:** klikni na řádek pole v Ganttu → editor dole se otevře pro to pole. Přidávej roky, vybírej plodinu pro každý rok (max 5 let dopředu). Plán se automaticky promítne jako pruhy do Ganttu nahoře.

### Historie (`/history.html`)

Grafy přes JSONL append-only soubory v `data/`:

- **Bilance** — denní zůstatek
- **Pole** — počet/plocha podle stavu (roste/sklízet/prázdné)
- **Komodity** — výnosy a tržby (sow/harvest/sale events)
- **Forecast** — ceny vybrané komodity (dropdown výběr)

KPI hero: počet eventů v DB, počet komodit, aktuální zůstatek.

### Nápověda (`/help.html`)

Statická dokumentace s TOC, screenshoty hlavních stránek, FAQ.

---

## Nastavení (⚙ vpravo nahoře)

Modal s 4 záložkami:

1. **Vzhled** — výběr motivu (`dark-green` default, `dark-blue`, `light`, `high-contrast`, `fs25-native`), reset DashState.
2. **Sekce** — checkboxy pro zobrazení/skrytí sekcí na hlavním dashboardu + drag pro pořadí.
3. **🚜 Vozidla** — Rozšířené zobrazení (vypíše naplnění nářadí ve sub-řádcích pod vozidlem; basic view ukazuje jen kompaktní summary).
4. **Notifikace** — browser Notification API toggle, prahy (low food %, low fuel %, empty field days), cooldown.
5. **Sync** — server-driven sync mezi zařízeními (default on), tlačítko „Načíst ze serveru" forsne refresh state z serveru.

---

## Zvoneček (🔔 vpravo nahoře)

Agreguje aktivní upozornění ze živých dat. Badge ukazuje počet, klikem se otevře panel.

**Co dělá:**

- Pravidla pro alerty: nízké krmivo < 25 %, nízká voda < 20 %, podestýlka < 25 %, plné výstupy ≥ 90 %, pole připravená ke sklizni, nízké palivo < 15 %, plné silo ≥ 95 %.
- Klikem na řádek → scroll do dotčené sekce + alert se skryje (acknowledged).
- ✕ na řádku → skryje samostatně (bez scrollu).
- „Skrýt vše" → skryje všechny současné alerty (vrátí se až se podmínka změní).

**Persistence:** dismissed alerty jen pro session (po refresh stránky se vrátí).

---

## Plánování plodin (calendar editor)

Per pole můžeš nastavit, co tam chceš pěstovat v které roky (1–5 let dopředu).

**Jak to funguje vnitřně:**

1. Pro vybranou plodinu mod posílá metadata: `plantableMonths[1..12]`, `harvestableMonths[1..12]`, `needsRolling`, `consumesLime` atd.
2. Frontend z toho generuje úkoly: setba (první true v plantable), sklizeň (první true v harvestable po setbě, s wrap přes rok pro ozimky), orba (-1 měsíc před setbou), válení (+1 měsíc po setbě, jen pokud `needsRolling`), hnojení (mid-cycle), vápnění (-2 měsíce před setbou, jen pokud `consumesLime`).
3. Úkoly se renderují jako proužky v Ganttu na timeline. Šířka = délka okna (sow window 1–3 měsíce, ostatní 1 měsíc). Color-coded.

**Multi-year stagger:** dva úkoly co navazují v čase (např. sklizeň roku N + orba roku N+1) se rozhodí na dva řádky aby se nepřekrývaly.

**Persistence:** `DashState.fieldPlans` ⇒ localStorage + ServerSync.

---

## Multi-device sync

Default zapnutý. Když měníš nastavení (motiv, skrytí sekcí, pořadí, plány), zápis jde paralelně do localStorage a do `dashboard-state.json` na serveru. Server pak vysílá patch ostatním WS klientům, kteří updateují svůj localStorage.

**Sync OFF** (toggle v Settings): zápisy zůstávají lokální, příchozí WS patche se ignorují. Užitečné pro „pracovní" tab kde nechceš aby přepsal preference.

**LOCAL_ONLY klíče** (nikdy nesyncují): `bell-dismissed`, `syncMode`.

---

## Notifikace prohlížeče

Volitelné. V Nastavení → Notifikace zapni a povol browseru. Prahy zvlášť od bell prahů:

- Krmivo < 25 %
- Palivo < 20 %
- Pole prázdné ≥ 5 dní

Cooldown 60 minut per podmínka — nezahltí.

Browser zobrazí toast + tag (replace older s tag stejným klíčem). Klikem se neaktivuje žádná akce.

---

## Troubleshooting

| Problém | Příčina | Fix |
|---|---|---|
| „Připojování…" navždy | Server neběží | Spusť `start.bat` nebo `npm start` v `Server/` |
| „Čeká na data ze serveru…" | Mod neexportuje | Zkontroluj `log.txt` na `[FS25_Dashboard]` řádky |
| Mod-server schema warning | Mod schemaVersion mimo MIN/MAX | Aktualizuj mod nebo server |
| Implement (vlečka) nevidět | Mod ji nečte | Zapni Rozšířené zobrazení v Nastavení; nebo v kompaktní formě je summary chip pod vozidlem |
| Calendar `vše OK` u všech polí | Settings všechno vypnuté | Zkontroluj `data.gameSettings.{plowingRequiredEnabled, limeRequired, weedsEnabled, stonesEnabled}` |
| WS disconnect po každých 2 s | Reverse-proxy timeout | Pokud běží za nginx, zvyš `proxy_read_timeout` > 10 s |

**Log lokace:**
- Mod log: `~/Documents/My Games/FarmingSimulator2025/log.txt`
- Server log: stdout (nebo `LOG_LEVEL=debug npm start`)
- Mod payload: `~/Documents/My Games/FarmingSimulator2025/dashboard_data.json`

---

## Klávesové zkratky

- `Esc` — zavře otevřený modal nebo panel
- (zatím žádné další)

---

## Co Dashboard NEDĚLÁ (přiznané limity)

- **Není cloud-hosted.** Sdílení s kamarády nepodporujeme — bylo zkoušeno, zahozeno (Render relé). Lokální server, lokální data.
- **Neukládá historii do databáze.** Jen append-only JSONL soubory v `data/`. Při miliónech eventů by to bobtnalo paměťově.
- **Nevidí AI vozidel jiných farem.** Jen tvoje farma.
- **Pro pole bere XML jako autoritativní.** Live čtení z módu se přepisuje hodnotami z `fields.xml` při každém 30 s refresh — žádný „live" tick mid-second.
