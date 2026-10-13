# edisplay-server

A self-hosted backend and web dashboard for **e-paper photo frames** running the
[esp32-photoframe](https://github.com/aitjcize/esp32-photoframe) firmware (e.g. the Seeed Studio
XIAO EE02, 13.3" Spectra 6, 1200×1600).

It pulls photos from your **Immich** library, converts them server-side to the panel's 6-colour
palette (tone mapping + dithering via
[epaper-image-convert](https://github.com/aitjcize/epaper-image-convert)), adds optional overlays,
and serves a ready-to-display image to each frame over the firmware's *URL rotation* mode. The
frame does no image processing itself, which keeps it fast and saves battery.

## Features

- **Immich integration** — albums, people, favourites, dates and GPS locations as photo sources.
- **Profiles** — reusable "looks": which albums, filters (people / place / date range / favourites),
  random or chronological order, conversion preset, and overlays.
- **Weekly scheduler** — paint profiles onto hours of the week; each frame follows its schedule.
- **Multi-device** — per-device URLs and access tokens, groups, online/battery/firmware status.
- **Overlays** — weather (Open-Meteo, no key), local time, battery, next photo, photo date/place,
  birthdays (Immich people) and to-dos, rendered onto the image.
- **Telegram bot** — send a photo to the bot and it lands in an Immich album.
- **Firmware flashing & Wi-Fi provisioning** from the browser (ESP Web Tools / Improv Serial).
- **Usage & logs** — per-device request log, battery history, show counts.
- **Config backup** — export/import the full configuration (optionally encrypted).
- Smart caching: converted images are cached on disk; cache hits serve in ~10 ms.

Everything (Immich URL/API key, devices, profiles, …) is configured in the web UI and stored in a
SQLite database in `/data` — no `.env` editing required.

## Quick start

```bash
git clone https://github.com/noxqs/edisplay-server.git
cd edisplay-server
docker compose up -d --build
```

Open **http://&lt;host&gt;:8080**, then follow the in-app **How to** steps:

1. **Settings** → enter your Immich URL and API key.
2. **Albums** → pick the albums frames may use.
3. **Profiles** → create one or more profiles.
4. **Scheduler** → build a weekly schedule.
5. **Dashboard** → add your frame(s) and assign a schedule, then point the frame at the server.

Full instructions: **[docs/INSTALL.md](docs/INSTALL.md)** · How to use it:
**[docs/USER-GUIDE.md](docs/USER-GUIDE.md)** · HTTP API: **[docs/API.md](docs/API.md)**

## How it works

```
frame ──GET /d/<device>──▶ edisplay-server ──▶ Immich
                               │ resolve schedule → profile → candidate photos
                               │ pick next (shuffle bag / sequence)
                               │ download original (or preview JPEG for HEIC/RAW)
                               │ convert → Spectra-6 image + overlays (disk-cached)
                               ◀── 200 PNG / EPDGZ + ETag   (304 if unchanged)
```

## Development

Requires Node.js 22+ and the native build deps for `canvas` / `better-sqlite3`
(see [docs/INSTALL.md](docs/INSTALL.md#from-source)).

```bash
npm install && npm --prefix web install
npm run dev          # API on :8080 (tsx watch) + web UI on :5173 (Vite, proxies to :8080)
npm run build        # builds web/dist and dist/
npm start            # production: serves API + built UI on :8080
```

Project layout:

| Path | What |
|---|---|
| `src/` | Express server (TypeScript): device endpoint, conversion, selection, overlays, API |
| `src/routes/api.ts` | JSON API used by the web UI |
| `src/repositories/` | SQLite data access |
| `web/` | React + Vite dashboard |
| `deploy/` | Example deployment files (TrueNAS) |

## Credits

- [aitjcize/esp32-photoframe](https://github.com/aitjcize/esp32-photoframe) — frame firmware
- [aitjcize/epaper-image-convert](https://github.com/aitjcize/epaper-image-convert) — conversion pipeline
- [Immich](https://immich.app) — photo library
- [Open-Meteo](https://open-meteo.com) — weather data
