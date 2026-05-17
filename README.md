# FS25 Dashboard

Real-time web dashboard for **Farming Simulator 25** — see your farm's fields, vehicles, animals, silos, market prices and balance live in your browser while you play.

![status](https://img.shields.io/badge/status-beta-yellow) ![FS25](https://img.shields.io/badge/FS25-1.x-green) ![license](https://img.shields.io/badge/license-MIT-blue)

> 📸 **Screenshots / GIF placeholder** — add `docs/screenshot-main.png`, `docs/screenshot-history.png`, `docs/demo.gif` before the first release.

---

## What it shows

- 🚜 **Vehicles** — fuel/AdBlue %, motor hours, in-use status. Drag & drop to hide ones you don't care about.
- 🐄 **Animals** — food/water/straw levels, milk/manure storage, productivity. Alerts when something needs attention.
- 🌾 **Fields** — ownership, current crop, growth %, days to harvest, fertilization/lime/plow state. Pulled from `fields.xml` so it matches the in-game UI.
- 🏭 **Silos & productions** — fill levels per commodity, active recipes, output stock.
- 💰 **Market prices** — current sell-point prices per ton, sortable, with hide-zero-stock filter.
- 📅 **Calendar** — what's planted on which field, sortable by harvest date.
- 📈 **History** — balance trend over 7/30/90 days, commodity price history per sell-point.
- 💵 **Profit per field** — revenue, cost, profit aggregated from event history.
- 🔔 **Browser notifications** — low fuel, low food, harvest ready, field empty too long.

Works with **AdditionalCurrencies** — when the in-game converter is on, the dashboard mirrors the same currency and symbol.

---

## Requirements

- Farming Simulator 25 (any version)
- Windows (the server ships as a Windows .exe)
- A modern browser (Chrome / Edge / Firefox)
- ~60 MB disk space

Node.js is **not** required — the server is a bundled single-file executable
that includes its own runtime. If you want to run from source or build the
exe yourself, see *Development* below.

---

## Install

### 1. Install the in-game mod

Download `FS25_Dashboard.zip` from [Releases](../../releases) and drop it into:

```
Documents/My Games/FarmingSimulator2025/mods/
```

Enable it in the FS25 mod menu when loading your save.

### 2. Run the server

Download `FS25_Dashboard_Server.zip` from [Releases](../../releases) and
extract anywhere (any folder works — the server doesn't care where it lives).

Double-click `FS25_Dashboard_Server.exe`. A console window opens showing the
server log. Then open in your browser:

```
http://localhost:3000
```

Leave the console open while you play. The server reads
`Documents/My Games/FarmingSimulator2025/dashboard_data.json` (which the mod
writes every 2 seconds) and pushes updates to the browser over WebSocket.

Stopping the server: close the console window (or press Ctrl+C in it).

---

## How it works

```
FS25 Game (Lua mod)
    │
    │ writes dashboard_data.json every 2 s when state changes
    ▼
Node.js Server  (Express + WebSocket + chokidar file watcher)
    │
    │ enriches payload with XML metadata from your savegame
    │ (fields.xml, farms.xml, farmland.xml) — XML is the
    │ source of truth for persistent field state
    │
    │ appends daily snapshots to data/*.jsonl (balance, prices,
    │ field events) for the history & profit pages
    │
    ▼
Web Browser
    └─ receives live updates over WebSocket (no page reload)
    └─ REST endpoints serve historical data
```

The mod has no external dependencies and writes plain JSON. The server is vanilla JS (no bundler, no framework) — easy to fork and modify.

---

## FAQ

**Q: Port 3000 is already in use, or I want to change paths.**
Copy `Server/config.example.json` to `Server/config.local.json` and edit. Or
use environment variables before starting:

```powershell
$env:DASHBOARD_PORT="4000"
$env:FS25_DOCS_DIR="D:\Games\FS25-Docs"   # if your Documents folder is redirected
npm start
```

Available keys (env / json):
- `DASHBOARD_PORT` / `port` — default `3000`
- `DASHBOARD_HOST` / `host` — default `0.0.0.0` (all interfaces)
- `FS25_DOCS_DIR` / `fs25DocsDir` — root of `My Games\FarmingSimulator2025`
- `DASHBOARD_DATA_FILE` / `dataFile` — full path to `dashboard_data.json`
- `FS25_LOG_FILE` / `logFile` — full path to FS25's `log.txt`
- `DASHBOARD_DATA_DIR` / `dataDir` — where to store `*.jsonl` history

**Q: Does it work in multiplayer?**
Single-player and listen-server hosts: yes. Pure clients on a dedicated server: not currently — the mod reads game state from the host's `g_currentMission`.

**Q: Where is the savegame folder?**
`Documents/My Games/FarmingSimulator2025/savegame<N>/`. The server auto-detects the most recent save; you can override via `SAVE_DIR` env var.

**Q: Can I run the dashboard on a different machine / phone?**
Yes — find your PC's local IP (e.g. `192.168.1.20`) and open `http://192.168.1.20:3000` on the other device. Both have to be on the same network.

**Q: Does this work with other mods (Seasons Geo, Courseplay, etc.)?**
Most things work. Maps that change field/farmland behavior may show inconsistencies. Open an issue with a save folder snippet if you hit something.

**Q: Will it slow down my game?**
The mod writes a JSON file every 2 s only if state changed. Negligible CPU. The dashboard itself runs out-of-process.

---

## Customizing notifications

Click the 🔔 in the top bar. You can set thresholds for low fuel, low food, empty fields, and the cooldown between repeated alerts. State is saved to `localStorage`.

---

## Development

Clone, then:

```bash
cd Server
npm install
npm run mock    # generates a fake dashboard_data.json — develop UI without FS25
npm start       # in another terminal, serves the dashboard
```

To build the single-file Windows executable locally:

```bash
cd Server
npm install
npm run build   # produces dist/FS25_Dashboard_Server.exe (~50 MB)
```

The mod lives in `FS25/`. Run `deploy.bat` to build a ZIP and copy it to the
FS25 mods folder.

Project structure:

```
FS25/                  ← Lua mod (DashboardExport.lua + modDesc.xml)
Server/
├── index.js           ← Express + WebSocket entrypoint
├── db.js              ← append-only JSONL history
├── savegame.js        ← XML parser for fields/farms/farmland
├── public/            ← static frontend (vanilla JS, no build)
└── scripts/
    ├── mock-data.js
    └── validate-json.js
```

---

## Contributing

Issues and PRs welcome. For bug reports include:
- FS25 version
- Other active mods
- A snippet of `dashboard_data.json` showing the issue
- Browser console errors if the issue is visual

---

## License

MIT — see [LICENSE](LICENSE).

The Lua mod and the Node.js server are released together but are independently licensed under MIT. You can fork, modify, redistribute, and use commercially.
