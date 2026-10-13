# User guide

How the pieces fit together:

```
Immich albums ──▶ Local albums ──▶ Profiles (+ filters, overlays, preset) ──▶ Schedules ──▶ Devices
```

A **device** follows a **schedule**; the schedule says which **profile** applies at the current
hour; the profile picks a photo from its **local albums**, converts it and adds **overlays**.

## Dashboard

Your frames at a glance: current photo, next photo, online status, battery, firmware version.

- **Add a frame** with its host/IP (or a `*.local` name), then open its settings to assign a
  schedule, default profile, group and rotate interval.
- **Connect** pushes this server's image URL to the frame. **Access token** generates a per-device
  token (and pushes it when the frame is reachable) so only that frame can fetch its images.
- Actions: **ping** (works even while the frame deep-sleeps), **show next** / **re-send** the image,
  open the frame's own web UI, edit frame settings (orientation, sleep schedule, timezone…).
- **Flash a frame** installs esp32-photoframe firmware over USB from Chrome/Edge and sets Wi-Fi.
- "Online" means the frame checked in within the last ~95 minutes.

## Albums

Local albums are pools built from Immich albums. Browse the photos in a pool and click a photo to
**ignore** it (never shown on frames); click again to restore.

## Profiles

The logic that picks images:

- **Local albums** to draw from.
- **Filters:** people (any of the selected), place name, date range, favourites only.
- **Order:** random (shuffle bag — every photo once before repeats) or sequence (by date).
- **Conversion preset:** `balanced`, `dynamic`, `vivid`, `soft`, `grayscale`.
- **Overlay config** to composite onto the image.

The preview shows a matching photo as the frame will render it.

## Scheduler

A week grid of hours. Pick a profile and click/drag to paint it onto hours. Empty hours fall back to
the device's default profile. Assign the schedule to devices on the Dashboard.

## Overlays

Named sets of widgets drawn onto the photo, each placed in a corner:

| Widget | Shows |
|---|---|
| `local_time` | Time / date |
| `weather` | Current conditions + short forecast (Open-Meteo, set a location) |
| `battery` | The frame's battery level |
| `next_photo` | Thumbnail of the upcoming photo |
| `photo_date` / `photo_place` | When / where the photo was taken |
| `birthdays` | Upcoming birthdays, optionally linked to an Immich person (shows their face) |
| `todos` | A short to-do list |

Widgets use white panels with black/red content, which suits the 6-colour palette.

## Groups

Frames in a group rotate through a shared sequence, e.g. several frames on one wall showing
consecutive photos rather than duplicates.

## GenAI

Optional AI-generated or AI-curated content: generate an image from a prompt, re-style or remix
Immich photos, or summarise a feed/site into a visual. Configure providers under
**Settings → AI providers** (Gemini via API key). Spend is tracked under **Usage → AI Cost**.

## Telegram

Create a bot with [@BotFather](https://t.me/BotFather), paste its token, and pick a target Immich
album. Authorize who may send photos (pending users appear after they message the bot, or add a
Telegram user ID). Photos sent to the bot are uploaded to Immich and become available to frames.

## Usage

Activity per device (shows, errors), battery history and AI spend.

## Logs

Every request from the frames, including cached (`304`) hits. Click a row for the raw request
(the `Authorization` header is redacted). The first place to look when a frame isn't updating.

## Settings

- **Immich:** server URL and API key.
- **Timezone**, appearance (theme), conversion defaults.
- **AI providers** for GenAI.
- **Export / Import:** full configuration backup, optionally password-encrypted. Import replaces
  everything and restarts the server.
- **Maintenance:** rebuild and restart the backend.
