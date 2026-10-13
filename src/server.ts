import express, { type Express, type Request } from "express";
import { createCanvas } from "canvas";
import path from "node:path";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import type { Config, Orientation } from "./config.js";
import type { DB } from "./db.js";
import { ImmichClient } from "./immich.js";
import { convert, pngToEpdgz, settingsHash, type ConvertParams } from "./convert.js";
import { DiskCache } from "./cache.js";
import { SettingsStore } from "./settings.js";
import { DeviceRepo } from "./repositories/devices.js";
import { UsageRepo } from "./repositories/usage.js";
import { DeviceRequestRepo } from "./repositories/deviceRequests.js";
import { ProfileRepo } from "./repositories/profiles.js";
import { ScheduleRepo } from "./repositories/schedules.js";
import { GroupRepo } from "./repositories/groups.js";
import { LocalAlbumRepo } from "./repositories/localAlbums.js";
import { IgnoredRepo } from "./repositories/ignored.js";
import { OverlayRepo, type Overlay } from "./repositories/overlays.js";
import { AppSettingsRepo } from "./repositories/appSettings.js";
import { GenerationRepo } from "./repositories/generations.js";
import { OAuthCredentialRepo } from "./repositories/oauthCredentials.js";
import { OAuthService } from "./oauth.js";
import { TelegramManager } from "./telegram.js";
import { TelegramMessageRepo } from "./repositories/telegramMessages.js";
import { FirmwareCache } from "./firmware.js";
import { Selection } from "./selection.js";
import { Simulator } from "./simulator.js";
import { WeatherService } from "./weather.js";
import { composite, type OverlayContext } from "./overlay.js";
import { createApiRouter } from "./routes/api.js";

// A neutral gradient stand-in so the overlay preview always has a base image to draw on,
// even when no Immich photo is available (no albums configured / Immich unreachable).
function placeholderPng(w: number, h: number): Buffer {
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#3b4a6b");
  grad.addColorStop(1, "#6b3b5a");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.textAlign = "center";
  g.font = `${Math.round(h * 0.035)}px sans-serif`;
  g.fillText("Overlay preview — no photo available", w / 2, h / 2);
  return c.toBuffer("image/png");
}

export function createServer(cfg: Config, db: DB): Express {
  const app = express();
  app.use(express.json());

  // Cheap liveness probe so the web UI can tell when the backend is unreachable.
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  const immich = new ImmichClient(cfg);
  const settings = new SettingsStore(cfg.settingsFile, { albumIds: cfg.albumIds });
  const cache = new DiskCache(cfg.cacheDir, cfg.cacheMaxEntries);
  const devices = new DeviceRepo(db);
  const usage = new UsageRepo(db);
  const deviceRequests = new DeviceRequestRepo(db);
  const profiles = new ProfileRepo(db);
  const schedules = new ScheduleRepo(db);
  const groups = new GroupRepo(db);
  const localAlbums = new LocalAlbumRepo(db);
  const ignored = new IgnoredRepo(db);
  const overlays = new OverlayRepo(db);
  const appSettings = new AppSettingsRepo(db);
  // Runtime Immich credentials (set via the Settings UI) override the env seed.
  const savedImmich = appSettings.get<{ baseUrl?: string; apiKey?: string }>("immich", {});
  if (savedImmich.baseUrl || savedImmich.apiKey) {
    immich.configure(savedImmich.baseUrl ?? cfg.immichBaseUrl, savedImmich.apiKey ?? cfg.immichApiKey);
  }
  const generations = new GenerationRepo(db);
  const oauthCreds = new OAuthCredentialRepo(db);
  const oauth = new OAuthService(cfg.oauth, oauthCreds);
  const firmware = new FirmwareCache(cfg.cacheDir, cfg.firmwareRepo);
  const weather = new WeatherService();
  const selection = new Selection(immich, profiles, schedules, localAlbums, ignored, appSettings, settings, cfg.poolRefreshMs);

  const simulator = new Simulator(devices, selection, usage, cfg.simTickMs);
  simulator.start();

  const telegramMessages = new TelegramMessageRepo(db);
  const telegram = new TelegramManager(immich, appSettings, (uid, name, dir, text) =>
    telegramMessages.log(uid, name, dir, text),
  );
  telegram.apply(); // start the bot if it's already configured + enabled

  function cacheKey(assetId: string, params: ConvertParams): string {
    return `${assetId}-${settingsHash(params)}`;
  }

  async function pngFor(assetId: string, params: ConvertParams): Promise<Buffer> {
    const key = cacheKey(assetId, params);
    const hit = await cache.get(key);
    if (hit) return hit;
    const { buffer } = await immich.downloadConvertible(assetId);
    const { png } = await convert(buffer, params);
    await cache.set(key, png);
    return png;
  }

  async function buildOverlayContext(
    active: Overlay[],
    battery: number | null,
    profile: Parameters<typeof selection.peekNext>[0],
    assetId: string | null,
  ): Promise<OverlayContext> {
    const ctx: OverlayContext = { battery };
    if (assetId && active.some((o) => o.type === "photo_date" || o.type === "photo_place")) {
      const meta = await immich.getAssetMeta(assetId);
      ctx.photoDate = meta.takenAt;
      ctx.photoPlace = meta.place;
    }
    if (active.some((o) => o.type === "next_photo")) {
      try {
        const nextId = await selection.peekNext(profile);
        // 'preview' is JPEG (node-canvas can't decode Immich's webp 'thumbnail').
        if (nextId) ctx.nextThumb = (await immich.getThumbnail(nextId, "preview")).buffer;
      } catch {
        /* ignore */
      }
    }
    const w = active.find((o) => o.type === "weather");
    if (w) {
      // Global location/units from Settings, falling back to the overlay's own config.
      const loc = appSettings.get<string>("weatherLocation", "") || String(w.config.location ?? "");
      const units = appSettings.get<string>("weatherUnits", "") || (w.config.units === "F" ? "F" : "C");
      ctx.weather = await weather.get(loc, units === "F" ? "F" : "C");
    }
    if (active.some((o) => o.type === "todos")) ctx.todos = overlays.items("todo");
    if (active.some((o) => o.type === "birthdays")) {
      const birthdays = overlays.items("birthday");
      ctx.birthdays = birthdays;
      const faces: Record<string, Buffer> = {};
      for (const b of birthdays.slice(0, 8)) {
        if (!b.ref || faces[b.ref]) continue;
        const buf = await facePhoto(b.ref);
        if (buf) faces[b.ref] = buf;
      }
      ctx.faces = faces;
    }
    return ctx;
  }

  // Cached "photo of this person" — a real image (JPEG) of an Immich person, for birthday overlays.
  const faceCache = new Map<string, { at: number; buf: Buffer | null }>();
  async function facePhoto(personId: string): Promise<Buffer | null> {
    const hit = faceCache.get(personId);
    if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.buf;
    let buf: Buffer | null = null;
    try {
      const ids = await immich.searchRandom({ personIds: [personId] }, 1);
      if (ids[0]) buf = (await immich.getThumbnail(ids[0], "preview")).buffer;
    } catch {
      buf = null;
    }
    faceCache.set(personId, { at: Date.now(), buf });
    return buf;
  }

  async function applyOverlays(
    base: Buffer,
    battery: number | null,
    profile: Parameters<typeof selection.peekNext>[0],
    assetId: string | null,
    overlayConfigId?: string | null,
  ): Promise<Buffer> {
    // Overlays are profile-scoped: render the profile's named config (none if unset). Callers can
    // pass an explicit config id (e.g. the preview) to override.
    const configId = overlayConfigId !== undefined ? overlayConfigId : profile?.overlayConfigId ?? null;
    const active = overlays.enabledFor(configId);
    if (active.length === 0) return base;
    return composite(base, active, await buildOverlayContext(active, battery, profile, assetId));
  }

  // Overlay preview for the UI: composite current overlays onto a sample photo. Always returns
  // an image — a real photo if one is available (default selection, else any profile), otherwise
  // a generated placeholder — so the preview never shows a broken-image icon.
  app.get("/api/overlays/preview.png", async (req, res) => {
    const previewConfigId = typeof req.query.config === "string" ? req.query.config : null;
    const params = {
      width: cfg.defaultWidth,
      height: cfg.defaultHeight,
      orientation: cfg.defaultOrientation,
      preset: cfg.convertPreset,
    };
    // Candidate selections to try in order: default pool, then each configured profile.
    const candidates = [null, ...profiles.list()];
    let base: Buffer | null = null;
    let assetId: string | null = null;
    for (const profile of candidates) {
      try {
        const id = await selection.peekNext(profile);
        if (!id) continue;
        base = await pngFor(id, params);
        assetId = id;
        break;
      } catch {
        /* this source failed (Immich down, empty album, …) — try the next */
      }
    }
    if (!base) {
      assetId = null;
      base = placeholderPng(cfg.defaultWidth, cfg.defaultHeight);
    }
    try {
      const out = await applyOverlays(base, 72, null, assetId, previewConfigId);
      res.type("image/png").set("Cache-Control", "no-store").send(out);
    } catch (err) {
      res.status(500).type("text/plain").send((err as Error).message);
    }
  });

  // Per-frame auth: a device's own access token wins; else the global token; else open.
  function authorized(req: Request, device: { access_token: string | null }): boolean {
    const required = device.access_token || cfg.deviceAuthToken;
    if (!required) return true;
    const m = /^Bearer\s+(.+)$/i.exec(req.header("authorization") ?? "");
    return m?.[1] === required;
  }

  function thumbnailUrl(req: Request, assetId: string): string {
    const base = cfg.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
    return `${base}/thumbnail/${assetId}`;
  }

  // Reconstruct the raw HTTP request (request line + headers, original casing/order via rawHeaders)
  // for the Logs page. Redacts the Authorization value so per-frame tokens aren't persisted.
  function rawRequest(req: Request): string {
    const lines = [`${req.method} ${req.originalUrl} HTTP/${req.httpVersion}`];
    const rh = req.rawHeaders;
    for (let i = 0; i < rh.length; i += 2) {
      const name = rh[i];
      const value = /^authorization$/i.test(name) ? rh[i + 1].replace(/\S+$/, "‹redacted›") : rh[i + 1];
      lines.push(`${name}: ${value}`);
    }
    return lines.join("\n");
  }

  // A frame is only awake (its HTTP server reachable) while it's fetching + refreshing an image,
  // then it deep-sleeps for ~1h. So we piggy-back on that fetch to read battery from the frame's
  // own /api/battery — no separate polling needed. Fire-and-forget so it never delays the image.
  async function pullFrameTelemetry(host: string, deviceId: string, firmware: string | undefined): Promise<void> {
    const base = /^https?:\/\//.test(host) ? host : `http://${host}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`${base}/api/battery`, { signal: ctrl.signal });
      const j = r.ok ? await r.json() : undefined;
      const pct = typeof j?.battery_level === "number" ? j.battery_level : undefined;
      const mv = typeof j?.battery_voltage === "number" ? j.battery_voltage : undefined;
      devices.recordTelemetry(deviceId, { batteryPct: pct, batteryMv: mv, firmware });
      if (pct != null) usage.log({ deviceId, type: "battery", batteryPct: pct });
    } catch {
      // Frame already asleep or PMIC-less (no /api/battery) — still stamp firmware from the header.
      devices.recordTelemetry(deviceId, { firmware });
    } finally {
      clearTimeout(t);
    }
  }

  // --- Device endpoint: URL-rotation fetch -------------------------------
  // The frame issues a plain GET each rotation interval and displays the response.
  const deviceHandler: express.RequestHandler = async (req, res) => {
    // A real frame (sends X-Firmware-Version / X-Display-* headers) can't decode a full-res PNG,
    // so always give it EPDGZ regardless of the URL. Browsers honor the extension (.png for debug).
    const raw = req.params.deviceId ?? "default";
    const isFrame = !!(req.header("x-firmware-version") || req.header("x-display-width") || req.header("x-display-height"));
    const format: "epdgz" | "png" = isFrame || /\.epdgz$/i.test(raw) ? "epdgz" : "png";
    const deviceId = raw.replace(/\.(png|jpe?g|bmp|epdgz)$/i, "");
    const device = devices.ensure(deviceId);
    if (!authorized(req, device)) {
      res.status(401).type("text/plain").send("unauthorized");
      return;
    }
    // Mirror devices borrow the parent's profile/preset/image so they always show the same photo.
    const parent = device.mirror_of ? devices.get(device.mirror_of) : undefined;
    const source = parent ?? device;
    const profile = selection.resolveProfile(source);
    const firmware = req.header("x-firmware-version") ?? undefined;
    // The frame reports battery right in the fetch headers: X-Battery-Percentage always, and
    // X-Battery-Voltage if the firmware sends it (more accurate — % is guessed without knowing the
    // cell). Record straight from the headers; no callback needed (works even across subnets).
    const batteryPct = numHeader(req, "x-battery-percentage");
    const batteryMv = numHeader(req, "x-battery-voltage");
    if (batteryPct != null || batteryMv != null || firmware) {
      devices.recordTelemetry(deviceId, { batteryPct, batteryMv, firmware });
      if (batteryPct != null) usage.log({ deviceId, type: "battery", batteryPct });
    }
    // If the frame doesn't send voltage in headers, try to read it off /api/battery while it's
    // awake (best-effort — fails silently if the frame isn't reachable from the server).
    if (isFrame && device.host && batteryMv == null) void pullFrameTelemetry(device.host, deviceId, firmware);
    // Audit trail of every incoming device request (see the Logs page). Capture the raw request
    // line + headers as received (Authorization redacted so tokens aren't stored in the log).
    const rawHttp = rawRequest(req);
    const logReq = (status: number, opts: { assetId?: string | null; notModified?: boolean } = {}) =>
      deviceRequests.log({
        deviceId, ip: req.ip ?? null, path: req.path, status, format,
        assetId: opts.assetId ?? null, notModified: opts.notModified, firmware,
        batteryPct: batteryPct ?? device.battery_pct, batteryMv: batteryMv ?? device.battery_mv,
        userAgent: req.header("user-agent") ?? null, raw: rawHttp,
      });
    const params: ConvertParams = {
      width: intHeader(req, "x-display-width", cfg.defaultWidth),
      height: intHeader(req, "x-display-height", cfg.defaultHeight),
      orientation: (req.header("x-display-orientation") as Orientation) ?? cfg.defaultOrientation,
      preset: source.preset || cfg.convertPreset,
    };
    try {
      // Rotate only when the device's cadence has elapsed; otherwise keep showing the current
      // image. Mirror devices never rotate on their own — they track the parent's current image.
      let assetId: string;
      let rotatedAt: number | undefined;
      let due: boolean;
      if (parent) {
        assetId = parent.last_asset_id ?? (await selection.nextAsset(profile));
        rotatedAt = undefined;
        due = false;
      } else {
        const everyMs = Math.max(1, device.rotate_every_min ?? 60) * 60_000;
        due = !device.last_asset_id || Date.now() - (device.last_rotation_at ?? 0) >= everyMs;
        assetId = due ? await selection.nextAsset(profile) : device.last_asset_id!;
        rotatedAt = due ? Date.now() : undefined;
      }
      const etag = `"${cacheKey(assetId, params)}-${format}"`;
      const info = { width: params.width, height: params.height, orientation: params.orientation, firmware };

      if (req.header("if-none-match") === etag) {
        devices.recordFetch(deviceId, { ...info, rotatedAt });
        logReq(304, { assetId, notModified: true });
        res.status(304).end();
        return;
      }

      const png = await applyOverlays(await pngFor(assetId, params), device.battery_pct, profile, assetId);
      const body = format === "epdgz" ? await pngToEpdgz(png) : png;
      devices.recordFetch(deviceId, { ...info, assetId, etag, rotatedAt });
      logReq(200, { assetId });
      if (due) usage.log({ deviceId, type: "show", assetId });
      res
        .status(200)
        .type(format === "epdgz" ? "application/octet-stream" : "image/png")
        .set("ETag", etag)
        .set("Cache-Control", "no-cache")
        .set("X-Thumbnail-URL", thumbnailUrl(req, assetId))
        .send(body);
    } catch (err) {
      console.error("[device] render failed:", err);
      usage.log({ deviceId, type: "error", message: (err as Error).message });
      logReq(500);
      res.status(500).type("text/plain").send(`render failed: ${(err as Error).message}`);
    }
  };
  app.get("/image", deviceHandler);
  app.get("/d/:deviceId", deviceHandler);

  // Companion thumbnail (small JPEG) used by X-Thumbnail-URL and the web app.
  // ?size=preview returns Immich's larger preview JPEG (for the dashboard's image modal).
  app.get("/thumbnail/:id", async (req, res) => {
    try {
      const size = req.query.size === "preview" ? "preview" : "thumbnail";
      const { buffer, contentType } = await immich.getThumbnail(req.params.id, size);
      res.type(contentType).set("Cache-Control", "public, max-age=86400").send(buffer);
    } catch (err) {
      res.status(502).type("text/plain").send(`thumbnail failed: ${(err as Error).message}`);
    }
  });

  // --- JSON API consumed by the web app ----------------------------------
  app.use(
    "/api",
    createApiRouter({ cfg, immich, settings, selection, devices, usage, deviceRequests, profiles, schedules, groups, localAlbums, ignored, overlays, weather, appSettings, generations, oauthCreds, oauth, telegram, telegramMessages, firmware, pngFor, applyOverlays,
      // Full config backup = the SQLite DB. Restore swaps the file then restarts.
      serializeDb: () => db.serialize(),
      replaceDb: (buf: Buffer) => {
        db.close();
        for (const suf of ["", "-wal", "-shm"]) { try { unlinkSync(cfg.dbFile + suf); } catch { /* ignore */ } }
        writeFileSync(cfg.dbFile, buf);
        setTimeout(() => process.exit(0), 200); // supervisor (Docker/dev) restarts with the new DB
      },
    }),
  );

  // --- Static SPA (production) + client-side routing fallback ------------
  const indexHtml = path.join(cfg.webDistDir, "index.html");
  app.use(express.static(cfg.webDistDir));
  app.get("*", (req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    if (existsSync(indexHtml)) {
      res.sendFile(path.resolve(indexHtml));
    } else {
      res
        .status(200)
        .type("html")
        .send("<h1>photoframe-server</h1><p>Web app not built. Run <code>npm run dev</code> (Vite on :5173) or <code>npm run build</code>.</p>");
    }
  });

  return app;
}

function intHeader(req: Request, name: string, fallback: number): number {
  const raw = req.header(name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n <= 0 ? fallback : n;
}

// Parse a numeric header (e.g. battery %/voltage); returns undefined if absent or not a number.
function numHeader(req: Request, name: string): number | undefined {
  const raw = req.header(name);
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
