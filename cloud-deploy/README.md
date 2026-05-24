# Cloud deploy — sdílej svůj dashboard s kamarády

Tento návod ti rozjede **veřejnou URL adresu**, na které kamarádi uvidí tvůj FS25 dashboard v reálném čase, aniž bys jim musel otevírat porty na routeru, řešit dynamické IP nebo si platit server.

Princip: na bezplatném hostingu [Render.com](https://render.com) ti běží **tenké relé**, kterému tvůj lokální server posílá změny v datech. Kamarádi se připojují k relé, ne k tobě domů.

```text
┌──────────────┐   2 s ticky    ┌──────────────────┐    →    ┌──────────┐
│  FS25 (Lua)  │ ─────────────► │  Tvůj počítač    │ wss://  │  Render  │ ───► kamarádi
│              │  json file     │  (npm start)     │ delta   │  relé    │
└──────────────┘                └──────────────────┘         └──────────┘
```

**Cena:** 0 Kč. Render má free tier (750 hodin/měsíc, bez kreditky). Když nikdo nehraje, relé spí.

**Bezpečnost:** dashboard defaultně otevřený. Heslo si **zapneš až z lokálního dashboardu** (⚙ Nastavení → 🌐 Vzdálený přístup). Plaintext nikdy disk neopouští — do cloudu jde jen otisk SHA-256.

---

## Co o Renderu a GitHubu potřebuješ vědět

Repo `sapavlisna/fs25-dashboard` je **veřejné**, takže Render ho umí klonovat bez OAuth, bez forku, bez GitHub účtu. To zjednodušuje úplně všechno:

| Potřebuješ              | Pro public repo (=tohle) | Pro privátní fork      |
| ----------------------- | ------------------------ | ---------------------- |
| GitHub účet             | Ne                       | Ano                    |
| Fork repa               | Ne                       | Ano                    |
| GitHub OAuth pro Render | Ne                       | Ano (jeden klik v UI)  |
| Render účet             | Ano (email stačí)        | Ano                    |

Tj. **stačí ti email pro Render** a jdeš.

---

## Cesta A — Render UI (nejjednodušší, ~5 min)

1. **Účet** — [render.com](https://render.com) → *Sign Up* (email + heslo, žádná kreditka).

2. **New +** → **Web Service** → zvol **„Public Git Repository"** záložku (uprostřed).

3. **Vlož URL repa**:

   ```text
   https://github.com/sapavlisna/fs25-dashboard
   ```

   → klikni *Connect*.

4. **Vyplň nastavení**:
   - **Name**: cokoliv unikátního, např. `fs25-dashboard-tvojejmeno` → tvá URL bude `https://fs25-dashboard-tvojejmeno.onrender.com`
   - **Branch**: `cloud-relay` *(zatím — než PR mergne)*
   - **Root Directory**: `src/Dashboard/Server`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node cloud-server.js`
   - **Plan**: Free
   - **Region**: Frankfurt

5. **Environment Variables** (sekce dole):
   - `INGEST_TOKEN` = libovolný náhodný řetězec (~20 znaků). Toto je tajný token, kterým se tvůj lokální server ověří proti cloudu. **Zapamatuj si ho.**
   - `NODE_ENV` = `production`
   - `SESSION_SECRET` = klikni *Generate* (Render vygeneruje 32 random bajtů sám)
   - **Žádný `DASHBOARD_PASSWORD`** — heslo zapneš až z lokálního UI.

6. **Create Web Service**. Render buildne (~3 min). Dostaneš URL `https://<jméno>.onrender.com`.

7. **Lokálně** v `src/Dashboard/Server/` vytvoř soubor `.env`:

   ```env
   BRIDGE_UPSTREAM_URL=wss://<jméno>.onrender.com/ingest
   INGEST_TOKEN=<stejný řetězec jako v Render env>
   ```

8. **Spusť server** (`npm start`) a hru. Otevři cloud URL → uvidíš data. Pošli URL kamarádům.

9. **Volitelně — heslo**. V lokálním dashboardu (`http://localhost:3000`) → ⚙ Nastavení → 🌐 Vzdálený přístup → zapni přepínač + zadej heslo + Uložit. Cloud URL od tohoto okamžiku vyžaduje heslo.

---

## Cesta B — PowerShell skript `deploy.ps1` (CLI)

Pokud preferuješ CLI a chceš deploy spustit jedním příkazem.

### Předpoklady

1. **Render účet** — [render.com](https://render.com), email + heslo.
2. **API klíč** — [dashboard.render.com/u/settings](https://dashboard.render.com/u/settings) → *API Keys* → *Create API Key* → zkopíruj `rnd_…`.

**Žádný GitHub fork. Žádný OAuth.** Skript volá Render API a Render umí klonovat `sapavlisna/fs25-dashboard` jako public repo přímo.

### Spuštění

```powershell
# v této složce (src/Dashboard/cloud-deploy/)
Copy-Item .env.example .env
notepad .env
# vyplň RENDER_API_KEY, případně změň SERVICE_NAME

.\deploy.ps1
```

Skript:

- Ověří API klíč
- Vytvoří službu na Renderu (`free` plán, Frankfurt, branch `cloud-relay`)
- Počká, až bude deploy hotov (~3 min)
- Vygeneruje `INGEST_TOKEN` a zapíše `BRIDGE_UPSTREAM_URL` + `INGEST_TOKEN` do `../Server/.env`
- Vypíše URL

Po skončení už jen spustíš `npm start` v `../Server/` a hru.

---

## Časté otázky

### Render službu uspí po 15 min nečinnosti — vadí to?

Ne. Dokud běží tvůj `npm start` + hra, lokální bridge posílá data každé 2 s a relé je vzhůru. Když přestaneš hrát, relé usne — kamarád, který otevře URL, čeká ~30 s na probuzení a uvidí **„FS25 server je offline"**. Jakmile zase rozjedeš hru, do 10 s je dashboard živý.

Pokud chceš, aby relé nikdy nespalo (např. ho ukazuješ veřejně), v Render Settings změň plán z `free` na `starter` ($7/měs).

### Jak nastavím heslo pro vzdálený dashboard?

V **lokálním** dashboardu (`http://localhost:3000`):

1. ⚙ Nastavení (vpravo nahoře)
2. Záložka **🌐 Vzdálený přístup**
3. Zapni přepínač *„Vyžadovat heslo pro přístup"*
4. Zadej heslo (min. 4 znaky)
5. *Uložit*

Tvůj lokální server vypočítá SHA-256 hash + náhodný salt, pošle to bridžem do cloudu. Cloud heslo nikdy nevidí v plaintextu, ukládá jen hash do RAM. Při restartu cloudu (sleep/wake) ho bridge automaticky pošle znovu při následujícím připojení.

Heslo můžeš kdykoliv změnit (staré přihlášení viewerů ztratí platnost) nebo odstranit (přepínač *Off* + Uložit).

### Free tier limity Renderu

- **750 hodin / měsíc** — 1 služba běžící 24/7 zabere ~720 h, takže OK
- **100 GB egress / měs** — 1 viewer × 2 s × 14 KB = ~600 MB/den. 5 kamarádů 8 h denně = ~600 MB/den celkem. Zvládneš desítky kamarádů.
- **512 MB RAM** — relé využívá ~80 MB

### Cloudová verze nemá grafy „Ceny" a „Statistiky"?

**Má**, ale data drží *jen v paměti* — bootstrap z tvého lokálního serveru. Když cloud restartuje (sleep/wake), grafy budou prázdné, dokud se tvůj bridge znovu nepřipojí (~30 s). Žádná persistentní DB v cloudu není (free tier nepodporuje persistent disk).

### Můžu deploynout místo Renderu jinam?

Ano — `cloud-server.js` je standardní Node.js + Express. Funguje na Fly.io, Railway, Heroku, libovolném VPS. Akorát si přizpůsobíš deploy způsob (skript je Render-specific).

---

## Soubory v této složce

| Soubor | Co dělá |
| --- | --- |
| `README.md` | Tento návod |
| `render.yaml` | Render Blueprint (pro „Deploy to Render" tlačítko, pokud bys ho chtěl) |
| `deploy.ps1` | PowerShell skript pro deploy přes Render API |
| `.env.example` | Šablona pro `deploy.ps1` — zkopíruj na `.env` a vyplň |
