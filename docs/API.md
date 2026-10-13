# HTTP API

> The `/api` routes have **no authentication** — they are meant for the dashboard on a trusted
> network. If you expose the server, put the admin side behind an authenticating reverse proxy
> (see [INSTALL.md](INSTALL.md#remote-frames--reverse-proxy)).

## Frame endpoints

### `GET /d/:deviceId[.epdgz|.png]`

Returns the device's current image, rendered for its panel.

- **Format:** `.epdgz` (native 4-bit gzipped firmware format, ~6× smaller) or `.png`. Requests from
  the frame firmware default to EPDGZ.
- **Auth:** if the device has an access token (or `DEVICE_AUTH_TOKEN` is set), send
  `Authorization: Bearer <token>`; otherwise `401`.
- **Request headers read:** `X-Display-Width`, `X-Display-Height`, `X-Display-Orientation`
  (panel geometry), `If-None-Match` (returns `304` when unchanged), plus firmware version.
- **Response headers:** `ETag`, `X-Thumbnail-URL`, `Cache-Control: no-cache`.
- The photo advances once per device rotate interval; earlier requests get the same image.

### `GET /image`
Legacy single-frame endpoint (same handler, no device id).

### `GET /thumbnail/:assetId[?size=preview]`
Small JPEG thumbnail (or larger preview) proxied from Immich.

### `POST /api/telemetry/:deviceId`
Frame-reported telemetry: `{ "batteryPct": 87 }`.

## Dashboard API (`/api`)

JSON in/out. Grouped overview — see `src/routes/api.ts` for request/response shapes.

| Area | Routes |
|---|---|
| Server | `GET /health`, `GET /version`, `GET /presets`, `POST /reload` (rebuild + restart) |
| Backup | `POST /config/export` (`{password?}` → `.pfb` file), `POST /config/import` (raw body, `X-Backup-Password`) |
| Immich | `GET/PUT /immich/config`, `GET /immich/status`, `GET /albums`, `PUT /albums/selection`, `POST /immich/albums`, `GET /people`, `GET /people/:id/thumbnail`, `GET /photo-locations` |
| Local albums | `GET/POST /local-albums`, `PATCH/DELETE /local-albums/:id`, `GET /local-albums/:id/assets` |
| Ignored photos | `GET/POST /ignored`, `DELETE /ignored/:assetId` |
| Devices | `GET/POST /devices`, `PATCH/DELETE /devices/:id`, `GET/POST /devices/:id/frame-config`, `POST /devices/:id/connect`, `POST /devices/:id/use-server`, `POST /devices/:id/access-token`, `GET /devices/:id/system-info`, `GET /devices/:id/ping`, `POST /devices/:id/rotate`, `POST /devices/:id/next-image`, `POST /devices/:id/show-next` |
| Server address | `GET/PUT /server-base` |
| Groups | `GET/POST /groups`, `PATCH/DELETE /groups/:id` |
| Profiles | `GET/POST /profiles`, `PATCH/DELETE /profiles/:id`, `GET /profiles/:id/preview.png` |
| Schedules | `GET/POST /schedules`, `PATCH/DELETE /schedules/:id`, `GET /schedules/:id/entries`, `PUT /schedules/:id/cell` |
| Overlays | `GET /overlays`, `PUT /overlays/:type`, `GET/POST /overlay-configs`, `GET/PATCH/DELETE /overlay-configs/:id`, `PUT /overlay-configs/:id/overlays/:type`, `GET/POST /overlay-items`, `PATCH/DELETE /overlay-items/:id`, `GET /overlays/preview.png` |
| Weather | `GET /weather/geocode`, `GET /weather/preview` |
| GenAI | `GET/POST /generations`, `PATCH/DELETE /generations/:id`, `GET/PUT /gemini/config`, `GET /oauth/providers`, `GET /oauth/:provider/start`, `GET /oauth/:provider/callback`, `POST /oauth/:provider/disconnect` |
| Telegram | `GET/PUT /telegram`, `GET/DELETE /telegram/messages`, `POST /telegram/authorize` |
| Firmware | `GET /firmware/boards`, `GET /firmware/:board/manifest.json`, `GET /firmware/:board/firmware.bin` |
| Stats & logs | `GET /device-requests`, `GET /usage`, `GET /usage/battery/:deviceId`, `GET /usage/genai-cost`, `GET /stats` |
| App settings | `GET/PUT /app-settings` |
