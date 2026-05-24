# Cloud deploy — sdílej svůj dashboard s kamarády

Tento návod ti rozjede **veřejnou URL adresu**, na které kamarádi uvidí tvůj FS25 dashboard v reálném čase, aniž bys jim musel otevírat porty na routeru, řešit dynamické IP nebo si platit server.

Princip: na bezplatném hostingu [Render.com](https://render.com) ti běží **tenké relé**, kterému tvůj lokální server posílá změny v datech. Kamarádi se připojují k relé, ne k tobě domů.

```
┌──────────────┐   2 s ticky    ┌──────────────────┐    →    ┌──────────┐
│  FS25 (Lua)  │ ─────────────► │  Tvůj počítač    │ wss://  │  Render  │ ───► kamarádi
│              │  json file     │  (npm start)     │ delta   │  relé    │
└──────────────┘                └──────────────────┘         └──────────┘
```

**Cena:** 0 Kč. Render má free tier (750 hodin/měsíc, bez kreditky). Když nikdo nehraje, relé spí.

**Bezpečnost:** dashboard chráníš heslem, které si nastavíš. Bez něj ho kdokoliv s URL otevře (volitelné).

---

## Cesta A — „Deploy to Render" tlačítko (nejjednodušší, bez instalace)

1. **Forkni si tento repozitář** na svůj GitHub (nahoře tlačítko *Fork*).

2. **Otevři tento odkaz** (nahraď `<TVE-JMENO>` svým GitHub uživatelem):

   ```
   https://render.com/deploy?repo=https://github.com/<TVE-JMENO>/fs25-dashboard
   ```

   Nebo klikni přímo na **[Deploy to Render](https://render.com/deploy)** a zadej URL svého forku.

3. **Render se zeptá** na dvě hodnoty:
   - `DASHBOARD_PASSWORD` — heslo, které budou kamarádi zadávat. Nech prázdné, pokud chceš veřejný přístup.
   - `INGEST_TOKEN` — tajný řetězec. Vygeneruj cokoliv náhodného (např. heslo z password manageru).

4. **Render vytvoří službu** (~3 minuty). Dostaneš URL ve tvaru `https://fs25-dashboard-XXXX.onrender.com`.

5. **Lokálně** v `src/Dashboard/Server/` vytvoř `.env` (nebo doplň existující):

   ```env
   BRIDGE_UPSTREAM_URL=wss://fs25-dashboard-XXXX.onrender.com/ingest
   INGEST_TOKEN=stejna-hodnota-jako-na-renderu
   ```

6. **Spusť server** (`npm start`) a hru. Otevři cloud URL → uvidíš data. Pošli URL kamarádům.

---

## Cesta B — PowerShell skript (pro CLI uživatele)

Pokud nechceš proklikávat UI, skript `deploy.ps1` udělá vše přes Render API.

### Předpoklady (jednorázově)

1. **Render účet** — registrace přes GitHub na [render.com](https://render.com). Zdarma, bez kreditky.

2. **API klíč** — na [dashboard.render.com/u/settings](https://dashboard.render.com/u/settings) → *API Keys* → *Create API Key*. Zkopíruj hodnotu (`rnd_…`).

3. **Fork repa** — forkni si tento repo na svůj GitHub.

4. **GitHub OAuth** — v Render UI klikni *New +* → *Web Service* → vyber svůj GitHub účet → autorizuj Render. Pak můžeš stránku zavřít, jen jsme potřebovali, aby Render věděl o tvém GitHubu. *(Tohle je jediný krok, který skript neumí.)*

### Spuštění

```powershell
# v této složce (src/Dashboard/cloud-deploy/)
Copy-Item .env.example .env
# Otevři .env v editoru, vyplň RENDER_API_KEY a GITHUB_REPO_URL, případně heslo
notepad .env

# Spusť
.\deploy.ps1
```

Skript:
- Ověří API klíč
- Vytvoří službu na Renderu (`free` plán, region Frankfurt)
- Počká, až bude deploy hotov (~3 min)
- Zapíše `BRIDGE_UPSTREAM_URL` + `INGEST_TOKEN` do `../Server/.env`
- Vypíše URL + heslo

Po skončení už jen spustíš `npm start` v `../Server/` a hru. Vše je propojené.

---

## Časté otázky

### Render službu uspí po 15 min nečinnosti — vadí to?

Ne. Dokud běží tvůj `npm start` + hra, lokální bridge posílá data každé 2 s a relé je vzhůru. Když přestaneš hrát, relé usne — kamarád, který otevře URL, čeká ~30 s na probuzení a uvidí **„FS25 server je offline"**. Jakmile zase rozjedeš hru, do 10 s je dashboard živý.

Pokud chceš, aby relé nikdy nespalo (např. ho ukazuješ veřejně), v `render.yaml` změň `plan: free` na `plan: starter` ($7/měs).

### Free tier limity Renderu

- **750 hodin / měsíc** — 1 služba běžící 24/7 zabere ~720 h, takže OK
- **100 GB egress / měs** — 1 viewer × 2 s × 14 KB = ~600 MB/den. 5 kamarádů 8 h denně = ~600 MB/den celkem. Zvládneš desítky kamarádů, než narazíš.
- **512 MB RAM** — relé využívá ~80 MB. Dost prostoru.

### Cloudová verze nemá grafy „Ceny" a „Statistiky"?

**Má**, ale data drží *jen v paměti* — bootstrap z tvého lokálního serveru. Když cloud restartuje (sleep/wake), grafy budou prázdné, dokud se tvůj bridge znovu nepřipojí (~30 s). Žádná persistentní DB v cloudu není (free tier nepodporuje persistent disk).

### Co když chci vlastní doménu?

Render Settings → *Custom Domains* → přidej `dashboard.tvojedomena.cz` a nastav CNAME u registrátora. Postup je v Render docs.

### Můžu deploynout místo Renderu jinam?

Ano — `cloud-server.js` je standardní Node.js + Express. Funguje na Fly.io, Railway, Heroku, libovolném VPS. Akorát si přizpůsobíš deploy způsob (skript je Render-specific).

---

## Soubory v této složce

| Soubor | Co dělá |
|---|---|
| `README.md` | Tento návod |
| `render.yaml` | Render Blueprint — používá ho „Deploy to Render" tlačítko |
| `deploy.ps1` | PowerShell skript pro deploy přes Render API |
| `.env.example` | Šablona pro `deploy.ps1` — zkopíruj na `.env` a vyplň |
| `update-env.ps1` | *(plánováno)* změna hesla / tokenu bez nového deploye |
