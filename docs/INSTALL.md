# Installation guide

edisplay-server runs as a single Node.js process (port **8080**) that serves both the frame
endpoint and the web dashboard. All state lives in one data directory (`/data` in containers).

**You need:**

- A running [Immich](https://immich.app) server and an Immich **API key**
  (Immich → Account Settings → API Keys).
- One or more frames running [esp32-photoframe](https://github.com/aitjcize/esp32-photoframe)
  firmware, on a network that can reach this server. (You can flash the firmware from the
  dashboard — see [step 5](#5-connect-a-frame).)
- A host for the server: Docker (recommended), a NAS such as TrueNAS, or any machine with Node 22.

Contents: [Docker](#option-a-docker-compose-recommended) ·
[TrueNAS](#option-b-truenas-scale-custom-app) · [From source](#option-c-from-source) ·
[First-time setup](#first-time-setup) · [Remote frames / reverse proxy](#remote-frames--reverse-proxy) ·
[Updating](#updating) · [Backup](#backup--restore) · [Environment variables](#environment-variables) ·
[Troubleshooting](#troubleshooting)

---

## Option A: Docker Compose (recommended)

```bash
git clone https://github.com/noxqs/edisplay-server.git
cd edisplay-server
# optional: edit TZ in docker-compose.yml (used by the scheduler)
docker compose up -d --build
```

Open `http://<host>:8080`. Data persists in the `edisplay-data` volume.

If Immich runs **on the same Docker host**, use `http://host.docker.internal:2283` as the Immich
URL (the compose file maps that name). If Immich runs in another compose project you can instead
attach this service to Immich's network and use `http://immich-server:2283`.

Plain `docker` without compose:

```bash
docker build -t edisplay-server .
docker run -d --name edisplay-server -p 8080:8080 -e TZ=UTC \
  -v edisplay-data:/data --add-host host.docker.internal:host-gateway \
  --restart unless-stopped edisplay-server
```

## Option B: TrueNAS SCALE (Custom App)

[`deploy/truenas-compose.yml`](../deploy/truenas-compose.yml) builds and runs the app from source
on a dataset — no image registry needed.

1. Create two datasets, e.g. `/mnt/POOL/edisplay/src` and `/mnt/POOL/edisplay/data`.
2. Copy this repository into `src` (git clone, SMB, rsync…).
3. Apps → Discover Apps → **Custom App** → *Install via YAML*, paste
   `deploy/truenas-compose.yml`, adjust the two `/mnt/POOL/...` paths and `TZ`, and save.
4. The first start installs dependencies and builds (a few minutes). Watch the app logs until
   you see the server listening on 8080, then open `http://<truenas-ip>:8080`.

`node_modules` and build output live on named volumes because NFSv4-ACL datasets reject `chmod`,
which breaks `npm ci`. To update, sync the new source into `src` and restart the app.

## Option C: From source

Requires **Node.js 22+** plus native build tools for `canvas` and `better-sqlite3`:

- Debian/Ubuntu: `sudo apt install build-essential python3 pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev iputils-ping`
- macOS: `brew install pkg-config cairo pango libpng jpeg giflib librsvg`

```bash
git clone https://github.com/noxqs/edisplay-server.git
cd edisplay-server
npm ci && npm --prefix web ci
npm run build
npm start                    # serves on :8080
```

Data goes to `./data` and `./cache` by default (see [environment variables](#environment-variables)).
Run it under systemd, pm2 or similar to keep it alive and restart it after a config import.

---

## First-time setup

Open the dashboard and follow **How to** in the sidebar. In short:

### 1. Connect Immich
**Settings** → enter the Immich URL (origin only, no `/api`, no trailing slash) and API key.
The Dashboard shows a green *connected* chip when it works. Also set your **timezone** here.

### 2. Pick albums
**Albums** → create a *local album*: a named pool built from one or more Immich albums.
Profiles draw from local albums.

### 3. Create profiles
**Profiles** → a profile is a recipe: local album(s), filters (people, location, date range,
favourites), order (random or sequence), conversion preset (`balanced`, `dynamic`, `vivid`,
`soft`, `grayscale`) and overlays.

### 4. Build a schedule
**Scheduler** → paint profiles onto hours of the week.

### 5. Connect a frame
- **New frame:** on the Dashboard use **Flash a frame → Connect & Flash** (Chrome/Edge, USB) to
  install esp32-photoframe; Wi-Fi is set over USB right after flashing.
- **Add the device** on the Dashboard with its host/IP and assign a schedule.
- In the device's settings, fill in **This server's address** — the URL the frame fetches from, so
  it must be reachable from the frame (e.g. `http://192.168.1.10:8080`, never `localhost`).
- Click **Connect** to push the image URL to the frame automatically, or set it in the frame's own
  web UI (`http://photoframe.local`):
  - rotation mode: `url`
  - image URL: `http://<server>:8080/d/<device-id>.epdgz`
  - if the device has an access token: HTTP header `Authorization` = `Bearer <token>`

The frame reports its panel size and orientation via request headers; the server renders to match.

---

## Remote frames / reverse proxy

A frame at another location can fetch over the internet through a reverse proxy
(nginx, Nginx Proxy Manager, Caddy…). Recommended setup:

- **Device host** (e.g. `frame.example.com`) → proxies to `:8080`. The ESP32 firmware may not
  support TLS with your certificate, so plain HTTP is often required here. Protect each device
  with its own **access token** (Dashboard → device → access token); `/d/<id>` then requires
  `Authorization: Bearer <token>`.
- **Admin host** (e.g. `frame-admin.example.com`) → same backend, HTTPS + authentication
  (basic auth / SSO). The dashboard has no built-in login, so never expose it unauthenticated.
- Set the device's **This server's address** to the public device URL so its image URL is correct.

## Updating

- **Docker:** `git pull && docker compose up -d --build`
- **TrueNAS:** sync the new source into the `src` dataset, restart the app.
- **Source:** `git pull && npm ci && npm --prefix web ci && npm run build`, then restart.

Database migrations run automatically on start.

## Backup & restore

Everything lives in the data directory (`/data`): `app.db` (SQLite: settings, devices, profiles,
schedules, usage), `settings.json` and `cache/` (regenerable). Back up that directory/volume, or use
**Settings → Export** (optionally password-encrypted). **Import** replaces the database and
restarts the server, so it must run under a supervisor that restarts it (Docker/systemd do).

## Environment variables

Optional — the UI covers all normal configuration. Env values act as initial seeds.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `TZ` | system | Timezone for scheduling |
| `DB_FILE` | `./data/app.db` | SQLite database |
| `SETTINGS_FILE` | `./data/settings.json` | Legacy settings file |
| `CACHE_DIR` | `./cache` | Converted-image cache |
| `CACHE_MAX_ENTRIES` | `500` | Max cached images (0 = unbounded) |
| `WEB_DIST_DIR` | `./web/dist` | Built dashboard |
| `PUBLIC_BASE_URL` | — | Public origin for generated URLs (the address set in the UI wins) |
| `IMMICH_BASE_URL`, `IMMICH_API_KEY` | — | Seed Immich connection (UI wins) |
| `ALBUM_IDS` | — | Seed album ids, comma-separated |
| `DEVICE_AUTH_TOKEN` | — | Global bearer token for frames without their own token |
| `DEFAULT_WIDTH` / `DEFAULT_HEIGHT` / `DEFAULT_ORIENTATION` | `1200` / `1600` / `portrait` | Used if the frame sends no display headers |
| `CONVERT_PRESET` | `balanced` | Default conversion preset |
| `POOL_REFRESH_MS` | `3600000` | How often album contents are re-read from Immich |
| `FIRMWARE_REPO` | `aitjcize/esp32-photoframe` | GitHub repo used for firmware flashing |
| `GEMINI_API_KEY` | — | Seed Gemini key for GenAI (UI wins) |
| `SIM_TICK_MS` | `20000` | Tick for simulated test devices |

See [`.env.example`](../.env.example). When running from source, a `.env` file in the project root
is loaded automatically.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Frame shows a fetch/connect error | The server address must be the LAN IP/hostname reachable from the frame, not `localhost`. Check the **Logs** page for the frame's request. |
| `401` in Logs | Token mismatch — the frame must send `Authorization: Bearer <device token>`. |
| "No images match" | The profile's albums/filters yield nothing, or the device has no schedule/profile. Preview the profile on the Profiles page. |
| Immich not connected | URL must be the origin only (e.g. `http://192.168.1.5:2283`); from Docker use `host.docker.internal` rather than `localhost`. |
| Device always offline | "Online" means the frame checked in within ~95 minutes; deep-sleeping frames only wake on their rotate interval. |
| Server won't start after switching Node versions (`NODE_MODULE_VERSION` error) | `npm rebuild better-sqlite3 canvas` |
| `*.local` hostnames don't resolve in Docker | Use the frame's IP address. |
