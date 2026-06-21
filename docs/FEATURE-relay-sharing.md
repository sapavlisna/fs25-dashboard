# Feature plán: Relay sdílení Dashboardu (read-only viewer přes Tailscale Funnel)

> **Status:** backlog / budoucí feature (neimplementováno).
> **Git:** celé se má dělat v nové větvi — navrhovaný název `feature/relay-sharing`.
> Do `main` nemergovat, dokud není odsouhlaseno a otestováno.
> Sepsáno 2026-06-20. Souvisí: memory `project-dashboard-relay-sharing`,
> překonává zahozený „cloud-relay na Render" (memory `feedback-dashboard-local-only`).

## Context

Lidé si stáhnou Dashboard mód, ale nemají kde ho hostovat a vystavit vlastní PC ven není
dobrý nápad. Cílem je **překládací (relay) server**, ke kterému se lokální dashboard server
připojí **odchozím** spojením (žádný otevřený port doma) a vygeneruje **sdílecí URL**.
Tu kdokoli (streamer) hodí do chatu na YouTube/Twitch a diváci si přes prohlížeč zobrazí
dashboard **read-only** — vidí všechno co dashboard umí teď, jen mají **vypnuté všechny akce**
(přehazování, skrývání, ⚙ nastavení, diag/record/replay).

Relay poběží **na RPi v Dockeru** a ven se vystaví přes **Tailscale Funnel** (žádný placený
hosting pro Pavlovo použití; placený VPS je až fallback pro cizí bez RPi). Docker je požadavek
kvůli izolaci — kompromitace relay procesu zůstane v kontejneru, ne v domácí síti.

**Fázování:** (1) relay pro Pavla + testovací kamarády; (2) později zabalené tak, aby si
kdokoli mohl relay hostovat sám (RPi nebo PC) a vystavit přes Tailscale.

## Cílová architektura

```
Mnoho domácích PC (uživatelé módu)
  každý: FS25 → dashboard_data.json → lokální Node server (Server/index.js)
                                        │  OUTBOUND wss (publisher, žádný otevřený port)
                                        ▼
                           ┌─────────────────────────────┐
                           │  RELAY (src/Dashboard/Relay) │  Docker na RPi
                           │  - rooms: Map<token,{...}>   │  network_mode: service:tailscale
                           │  - jen fan-out publisher→view│  Funnel 443 → relay
                           │  - ŽÁDNÉ mutující endpointy  │
                           └─────────────────────────────┘
                                        │  wss (read-only)
                                        ▼
       Diváci (prohlížeč) → https://<stroj>.<tailnet>.ts.net/#<token>
                            servíruje public/ v read-only módu
```

**Rozhodnutí o rozsahu:**
- Viewer v1 = **jen `index.html`** (ostatní stránky relay neservíruje; kalendář/historie později).
- Publisher auth = **sdílený klíč `RELAY_PUBLISH_KEY`** (potvrzeno): jedno heslo rozdané různým
  lidem. Každý držitel klíče si na sdíleném relay **založí vlastní room** se **svou vlastní viewer URL
  pro své diváky** — rooms jsou navzájem izolované (frame z roomu A nikdy neteče do roomu B).
  (Přepnutí na „otevřené" = klíč nenastavit; jen konfigurace, ne kód.)
- Token model = **nový room token při každém startu publishera** (efemerní; po odpojení room zaniká →
  link umře). Jeden člověk = klidně víc roomů (každé spuštění serveru = nový room/URL).

## Komponenty a změny

### 1. Nový relay server — `src/Dashboard/Relay/` (standalone)

Samostatná minimální aplikace (ne součást `Server/` — nepotřebuje chokidar/savegame/db).
Závislosti: `ws`, `express` (stejné verze jako Server).

- **`Relay/index.js`**
  - Express + jeden `WebSocketServer` na interním portu (`RELAY_PORT`, default 8080).
  - **Static**: servíruje kopii `public/` na rootu `/` (v Dockeru COPY z `../public`; v devu cesta).
  - **`GET /api/mode`** → `{ readOnly: true, relay: true }` (frontend podle toho zapne viewer mód).
  - **`GET /r/:token` / root `/`** → vrací `index.html` (jen tahle stránka).
  - WS upgrade router podle cesty:
    - **`/ws/publish`** — ověří `RELAY_PUBLISH_KEY` (hlavička/první zpráva), `crypto.randomBytes`
      → room token, pošle publisherovi zpět `{ room, viewerPath: '/#'+token }`. Drží `lastFrame`.
      Forwarduje každý příchozí frame všem viewerům roomu. Na disconnect room zruší.
    - **`/ws/view/:token`** — najde room, hned pošle `lastFrame`, pak streamuje. **Nikdy** neposílá
      viewer→publisher (read-only). Neznámý token → close.
  - **ŽÁDNÉ** `/api/dashboard-state`, `/diag/*`, `/mock/*` (na relay nesmí existovat).
  - **Capy** (Funnel nemá rate-limit): max rooms, max viewers/room, max conns/IP, idle timeout.
  - `crypto.randomBytes(16)` token (neuhodnutelný = autorizace viewera).
- **`Relay/package.json`** — deps `ws`, `express`; `start` script.

### 2. Lokální server → publisher mód — `src/Dashboard/Server/`

- **Nový `Server/relay-client.js`** — pokud je `RELAY_URL` nastavená: otevře outbound `wss` na
  `RELAY_URL/ws/publish` (s `RELAY_PUBLISH_KEY`), reconnect s backoffem, drží poslední frame,
  vystaví `relay.send(frameString)` a `relay.viewerUrl`.
- **`Server/index.js`** — napojit na existující broadcast hrdla (`broadcast`, `broadcastRaw`,
  `broadcastStatePatch` ~ řádky 500–550): kamkoli se posílá lokálním WS klientům, navíc
  `relay.send(sameFrame)`. Žádná duplicitní serializace — posílá se identický frame co diváci dnes.
  Do startup banneru (~697–723) přidat řádek s **viewer URL** pro nasdílení.
- **`Server/config.js`** — přidat `RELAY_URL`, `RELAY_PUBLISH_KEY` (env > config.local.json).

### 3. Frontend read-only viewer — `src/Dashboard/public/`

Jeden globální flag + zhasnutí akcí. **Téma, řazení, notifikace zůstávají** (jen localStorage diváka).

- **`app.js`**
  - Oprava `ws://${location.host}` (ř. 598) → odvodit `wss` z `location.protocol === 'https:'`
    (Funnel je TLS-only). Room token číst z `location.hash`; pokud je → `wss://host/ws/view/<token>`.
  - Boot: `fetch('/api/mode')` → když `readOnly` → `FS25App.readOnly = true` + `<html data-readonly>`.
- **`serverSync.js`** (ř. ~81–86) — `syncWrite()`/PATCH **no-op** když `readOnly` (jedno hrdlo všech zápisů).
- **`tabletools.js`** — když `readOnly`: neinicializovat Sortable.js (drag), skrýt hide `✕` / drag `⠿`
  / ⚙ tlačítka (CSS přes `[data-readonly]` + guard v JS).
- **Settings/diag panel** (`app.js` + `sectionCfg.js`) — skrýt ⚙ panel, record/replay/upload ovládání.
- **`style.css`** — `[data-readonly] .tt-hide, .drag-handle, .sec-cfg-btn, .replay-ctl { display:none }`.

**Detekce:** read-only mód = odpověď `/api/mode` (decoupled od URL); room = `location.hash`.
Relay servíruje vždy jen read-only variantu, takže žádné riziko, že by se na něm objevila control verze.

### 4. Docker + Tailscale (RPi) — `src/Dashboard/Relay/`

- **`Relay/Dockerfile`** — `node:22-slim`, COPY relay app + `../public`, `npm ci --omit=dev`,
  běh jako **non-root** uživatel, žádné publikované porty.
- **`Relay/docker-compose.yml`** — dvě služby:
  - `tailscale` (image `tailscale/tailscale`): `TS_AUTHKEY`, `TS_USERSPACE=true` (bez TUN, ideál pro RPi),
    `TS_SERVE_CONFIG=/config/funnel.json` (Funnel 443 → `http://127.0.0.1:8080`), volume na `TS_STATE_DIR`.
  - `relay`: `network_mode: service:tailscale` (sdílí síťový namespace), naslouchá na 127.0.0.1:8080.
- **`Relay/tailscale-funnel.json`** — serve/funnel konfigurace (port 443 → relay).
- **`Relay/README.md`** — postup: vygenerovat auth key, `docker compose up -d`, kde najít Funnel URL,
  jak nasměrovat lokální server (`RELAY_URL`, `RELAY_PUBLISH_KEY`).

### 5. Bezpečnost (Funnel nemá síťový rate-limit)

- **Tailscale ACL** omezit, kam tento node smí v tailnetu (skutečná pojistka izolace).
- Relay běží **non-root**, ideálně read-only rootfs, žádné extra capabilities.
- Žádné mutující endpointy na relay (viz bod 1).
- Viewer token = `crypto.randomBytes(16)`; publisher = `RELAY_PUBLISH_KEY`.
- Capy na rooms/viewers/IP + idle timeout proti zaplnění.

## Klíčové soubory

| Akce | Soubor |
|---|---|
| nový | `src/Dashboard/Relay/index.js`, `package.json`, `Dockerfile`, `docker-compose.yml`, `tailscale-funnel.json`, `README.md` |
| nový | `src/Dashboard/Server/relay-client.js` |
| uprav | `src/Dashboard/Server/index.js` (broadcast hooky ~500–550, banner ~697–723) |
| uprav | `src/Dashboard/Server/config.js` (RELAY_URL, RELAY_PUBLISH_KEY) |
| uprav | `src/Dashboard/public/app.js` (wss + /api/mode + hash room + readOnly flag) |
| uprav | `src/Dashboard/public/serverSync.js`, `tabletools.js`, `sectionCfg.js`, `style.css` (gating akcí) |

## Implementační fáze (vše v `feature/relay-sharing`)

1. **MVP lokálně** — relay app (rooms+fan-out, `/api/mode`), publisher-client v lokálním serveru,
   read-only frontend. Otestovat celé na localhostu s `npm run mock`.
2. **Dockerizace + Tailscale Funnel** — Dockerfile + compose + funnel config; nasadit na RPi,
   ověřit veřejnou Funnel URL zvenčí.
3. **Hardening multi-tenant** — capy, ACL, reconnect/backoff, README pro self-host.

## Verifikace (end-to-end)

**Lokálně (bez hry, bez Dockeru):**
1. `cd src/Dashboard/Relay && npm i && RELAY_PORT=8080 RELAY_PUBLISH_KEY=test npm start`
2. `cd src/Dashboard/Server && RELAY_URL=ws://localhost:8080 RELAY_PUBLISH_KEY=test npm run mock` + `npm start`
   → v banneru lokálního serveru se objeví viewer URL `http://localhost:8080/#<token>`.
3. Otevřít viewer URL v prohlížeči → **live data tečou**, ale: žádné ⚙/drag/hide/record tlačítko,
   změna sekce se neuloží (žádný PATCH v Network tabu). Ověřit, že `PATCH /api/dashboard-state`
   a `POST /diag/*` na relay vrací 404.
4. (volitelně) `/dashboard-smoke` rozšířit o aserci „v read-only módu nejsou viditelná žádná akční tlačítka".

**Docker + Funnel (RPi):**
5. `docker compose up -d` s `TS_AUTHKEY` → `tailscale funnel status` ukáže veřejnou URL.
6. Z mobilní sítě (mimo tailnet) otevřít `https://<stroj>.<tailnet>.ts.net/#<token>` → dashboard se načte.
7. Lokální server nasměrovat `RELAY_URL=wss://<stroj>.<tailnet>.ts.net` → spustit FS25 (slot 10) →
   ověřit, že frame na relay dorazí (viewer vidí reálná data).

## Otevřené / pozdější

- Kalendář (Gantt) a historie pro diváky = **mimo v1**, přidat ve fázi 2+.
- Funnel bandwidth limit je „non-configurable", ale payload ~1–5 KB/2 s → pro desítky diváků v pohodě.
