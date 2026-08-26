# FS25 Dashboard — Relay

Read-only **relay** for the FS25 Dashboard. A local dashboard server connects
**outbound** as a *publisher* and gets a shareable viewer URL; anyone you give that
URL to watches the dashboard live in their browser, **read-only** (no controls, no
settings, no diag). The relay runs in Docker and is exposed publicly via **Tailscale
Funnel** — no open port on your home network.

```
your PC: FS25 → dashboard server ──outbound wss──► RELAY (RPi, Docker) ──Funnel 443──► viewers
```

- **Publisher** authenticates with a personal key from `publishers.json` (per-publisher,
  individually enable/disable). **Viewer** needs no password — only the unguessable room
  token in the URL.
- The room token is **stable per publisher** (derived from the publish key via SHA-256), so
  the viewer URL stays the same across restarts/reconnects — share it once. On reconnect the
  publisher reclaims the same room and current viewers keep streaming. Set
  `RELAY_STABLE_ROOMS=false` to revert to a fresh random token per connect (pre-1.3 behavior).
- When the source goes away, viewers see a **full-page "source offline" overlay** instead of
  stale data: a graceful publisher shutdown sends `{__bye}` → room ends immediately ("stream
  ended"); a crash holds the room for `GRACE_SEC` (5 min default) showing "source offline",
  then ends if the publisher doesn't reconnect.

## Files

| File | Purpose |
|---|---|
| `index.js`, `logger.js` | the relay app |
| `Dockerfile`, `docker-compose.yml` | container + Tailscale sidecar |
| `tailscale-funnel.json` | Funnel config (443 → relay) |
| `publishers.example.json` → `publishers.json` | per-publisher key allowlist (**gitignored**) |
| `.env.example` → `.env` | `TS_AUTHKEY` (**gitignored**) |

> **Never commit `publishers.json` or `.env`** — both are in `.gitignore`.

## Setup A — self-hosted (Docker + Tailscale Funnel)

1. **Generate per-publisher keys** (one per person who will publish):
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
   Copy the template and fill them in:
   ```bash
   cp publishers.example.json publishers.json
   # edit: set a unique key per publisher, enabled:true to allow
   ```
   `publishers.json` is `[{ "id", "label", "key", "enabled" }]`. To block someone, set their
   `enabled:false` (takes effect on their next connect; the relay re-reads the file each time).

2. **Tailscale auth key** — create one at
   <https://login.tailscale.com/admin/settings/keys> (reusable or ephemeral, tagged `tag:relay`):
   ```bash
   cp .env.example .env
   # edit: TS_AUTHKEY=tskey-auth-...
   ```

3. **Start:**
   ```bash
   docker compose up -d
   docker compose ps           # both services up, relay healthy
   ```

4. **Find the public URL:**
   ```bash
   docker compose exec tailscale tailscale funnel status
   ```
   It prints `https://fs25-relay.<your-tailnet>.ts.net`.

## Setup B — hosted (no Tailscale, no home server)

The relay is stateless (no database, no disk writes), so it drops straight onto any
platform that runs a container or a Node process. TLS, the public domain and the
restart policy come from the host; `docker-compose.yml` and `tailscale-funnel.json`
are **not** used in this mode. Two things replace them:

- `PUBLISHERS_JSON` — the allowlist inline in an env var, since hosted platforms
  give you env vars but no file mounts.
- `PORT` — injected by the platform; the relay binds it (falls back to `RELAY_PORT`).

### Render (free, no credit card)

`render.yaml` in the repo root describes the whole service, so there is nothing to
configure by hand:

1. Sign up at <https://render.com> (GitHub login is enough — the free tier asks for
   no card).
2. **New → Blueprint**, pick this repo. Render reads `render.yaml` and prompts for
   **`PUBLISHERS_JSON`** — paste the allowlist, generated as in step 1 of Setup A:
   ```
   [{"id":"pavel","label":"Pavel","key":"<24-byte hex key>","enabled":true}]
   ```
3. Deploy. You get `https://fs25-relay.onrender.com` with TLS.

What the free instance costs you: it **spins down after 15 minutes with no traffic**
and takes ~1 minute to wake, so the first publisher connect after an idle spell fails
and the dashboard's reconnect loop picks it up on the next attempt. WebSocket messages
count as traffic, so it stays awake for as long as you are playing. The Hobby workspace
includes **5 GB egress/month** — with compression on that is roughly 150 hours of
streaming to one viewer, and every extra viewer divides it.

### Other hosts

| Host | Notes |
|---|---|
| **Northflank** | free Sandbox runs 2 always-on services (no spin-down), but wants a card for verification; build context = repo root, dockerfile `Relay/Dockerfile`, expose 8080 |
| **Fly.io** | `fly launch` over the same Dockerfile; ~$2/month for a 256 MB always-on machine, egress $0.02/GB. No free tier |
| **Railway** | template deploy, $5/month minimum |

On any of them the allowlist lives in `PUBLISHERS_JSON`, so changing it means editing
the env var and restarting — there is no file to re-read.

Avoid anything that scales to zero or caps request duration (Cloud Run tops out at
60 minutes per connection) — the publisher holds one long-lived WS connection.

## Point your local dashboard at the relay

On the PC running the dashboard server, set the relay URL + **your** publisher key
(env or `config.local.json`):

```bash
# Windows PowerShell
$env:RELAY_URL="wss://fs25-relay.<your-tailnet>.ts.net"
$env:RELAY_PUBLISH_KEY="<your-key-from-publishers.json>"
npm start
```

The server's startup banner prints a `Relay room připraven` box with the **viewer URL**
(`https://fs25-relay.<tailnet>.ts.net/#<token>`). Share that link — viewers see live data,
read-only. Without `RELAY_URL` the server runs exactly as before (relay disabled).

## Tunables (env on the relay container)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | — | set by hosted platforms; wins over `RELAY_PORT` |
| `RELAY_PORT` | 8080 | internal port (Funnel maps 443 → here) |
| `PUBLISHERS_JSON` | — | allowlist inline instead of `publishers.json`; wins over the file |
| `RELAY_COMPRESS` | true | permessage-deflate on the WS fan-out (~9× smaller frames); `false` trades egress for CPU |
| `RELAY_STABLE_ROOMS` | true | stable viewer URL per publisher; `false` = random token per connect |
| `MAX_ROOMS` | 50 | global room cap |
| `MAX_VIEWERS_PER_ROOM` | 30 | viewers per room |
| `MAX_CONNS_PER_IP` | 5 | connections per IP |
| `MAX_ROOMS_PER_PUBLISHER` | 3 | fairness cap |
| `IDLE_ROOM_MIN` | 10 | minutes before an empty room is GC'd |
| `GRACE_SEC` | 300 | publisher reconnect grace (viewers see "source offline" overlay) before the room ends |
| `MAX_FRAME_BYTES` | 1048576 | max publisher message size |
| `MAX_VIEW_FAILS` / `VIEW_BLOCK_MS` | 5 / 60000 | per-IP throttle on bad room tokens |

## Security notes

- The relay has **no mutating endpoints** — only `GET /api/mode`, `GET /health`, the static
  read-only `index.html`, and the two WS routes. It forwards bytes; it never accepts state.
- Publisher keys are compared **timing-safe**; the WS `Origin` is checked (anti-CSWSH).
- Container runs **non-root**, `read_only` rootfs, `cap_drop: ALL`, `no-new-privileges`.
- Harden the tailnet with an ACL so `tag:relay` cannot reach other devices (see Etapa 3 in
  `../docs/PLAN-relay-sharing.md`).
