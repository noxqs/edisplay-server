import { Router, raw, type Request, type Response as ExpressResponse } from "express";
import { createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { exec } from "node:child_process";
import path from "node:path";
import os from "node:os";
import type { Config } from "../config.js";
import type { ImmichClient } from "../immich.js";
import type { SettingsStore } from "../settings.js";
import type { Selection } from "../selection.js";
import type { DeviceRepo } from "../repositories/devices.js";
import type { UsageRepo } from "../repositories/usage.js";
import type { DeviceRequestRepo } from "../repositories/deviceRequests.js";
import type { ProfileRepo, ProfileLogic, Profile } from "../repositories/profiles.js";
import type { ScheduleRepo } from "../repositories/schedules.js";
import type { GroupRepo } from "../repositories/groups.js";
import { randomBytes } from "node:crypto";
import { isReachable } from "../reachability.js";
import type { Device } from "../repositories/devices.js";
import type { LocalAlbumRepo, SourceType } from "../repositories/localAlbums.js";
import type { IgnoredRepo } from "../repositories/ignored.js";
import type { OverlayRepo, OverlayType } from "../repositories/overlays.js";
import type { WeatherService } from "../weather.js";
import type { AppSettingsRepo } from "../repositories/appSettings.js";
import type { GenerationRepo, SourceKind } from "../repositories/generations.js";
import type { OAuthCredentialRepo, OAuthProvider } from "../repositories/oauthCredentials.js";
import type { OAuthService } from "../oauth.js";
import type { TelegramManager } from "../telegram.js";
import type { TelegramMessageRepo } from "../repositories/telegramMessages.js";
import type { FirmwareCache } from "../firmware.js";
import type { ConvertParams } from "../convert.js";
import { VERSION } from "../version.js";

const ONLINE_WINDOW_MS = 95 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRESETS = ["balanced", "dynamic", "vivid", "soft", "grayscale"];
// Rotate cadence is free-form minutes (UI offers a value + min/hour unit), clamped to a sane range.
const ROTATE_MIN_MINUTES = 1;
const ROTATE_MAX_MINUTES = 7 * 24 * 60; // 1 week

export interface ApiDeps {
  cfg: Config;
  immich: ImmichClient;
  settings: SettingsStore;
  selection: Selection;
  devices: DeviceRepo;
  usage: UsageRepo;
  deviceRequests: DeviceRequestRepo;
  profiles: ProfileRepo;
  schedules: ScheduleRepo;
  groups: GroupRepo;
  localAlbums: LocalAlbumRepo;
  ignored: IgnoredRepo;
  overlays: OverlayRepo;
  weather: WeatherService;
  appSettings: AppSettingsRepo;
  generations: GenerationRepo;
  oauthCreds: OAuthCredentialRepo;
  oauth: OAuthService;
  telegram: TelegramManager;
  telegramMessages: TelegramMessageRepo;
  firmware: FirmwareCache;
  pngFor: (assetId: string, params: ConvertParams) => Promise<Buffer>;
  applyOverlays: (
    base: Buffer,
    battery: number | null,
    profile: Profile | null,
    assetId: string | null,
    overlayConfigId?: string | null,
  ) => Promise<Buffer>;
  serializeDb: () => Buffer;
  replaceDb: (buf: Buffer) => void;
}

interface TelegramConfig {
  enabled: boolean;
  targetAlbumId: string | null;
  botToken: string;
  allowedUsers?: Array<{ id: number; name?: string }>;
}

// Backup format: "PFB1" + flag byte (0=plain, 1=encrypted) + [salt16 iv12 tag16] + payload.
// Payload is gzip(db). When encrypted it's AES-256-GCM with a scrypt-derived key.
const BACKUP_MAGIC = Buffer.from("PFB1");
function packBackup(dbBuf: Buffer, password?: string): Buffer {
  const gz = gzipSync(dbBuf);
  if (!password) return Buffer.concat([BACKUP_MAGIC, Buffer.from([0]), gz]);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(gz), cipher.final()]);
  return Buffer.concat([BACKUP_MAGIC, Buffer.from([1]), salt, iv, cipher.getAuthTag(), enc]);
}
function unpackBackup(buf: Buffer, password?: string): Buffer {
  if (!Buffer.isBuffer(buf) || buf.length < 5 || !buf.subarray(0, 4).equals(BACKUP_MAGIC)) {
    throw new Error("Not a PhotoFrame backup file");
  }
  if (buf[4] === 0) return gunzipSync(buf.subarray(5));
  if (!password) throw new Error("This backup is password-protected — enter the password");
  const salt = buf.subarray(5, 21);
  const iv = buf.subarray(21, 33);
  const tag = buf.subarray(33, 49);
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let gz: Buffer;
  try {
    gz = Buffer.concat([decipher.update(buf.subarray(49)), decipher.final()]);
  } catch {
    throw new Error("Wrong password or corrupt file");
  }
  return gunzipSync(gz);
}

/** Mask the first 12 characters of the bot token, leaving the rest visible. */
function maskToken(token: string): string | null {
  if (!token) return null;
  const n = Math.min(12, token.length);
  return "•".repeat(n) + token.slice(n);
}

export function createApiRouter(deps: ApiDeps): Router {
  const { cfg, immich, settings, selection, devices, usage, deviceRequests, profiles, schedules, groups, localAlbums, ignored, overlays, weather, appSettings, generations, oauthCreds, oauth, telegram, telegramMessages, firmware, pngFor, applyOverlays, serializeDb, replaceDb } = deps;
  const r = Router();
  // Frames deep-sleep and persist last_seen across restarts, so a stale last_seen from before a
  // restart shouldn't show as "online". A frame counts as online only once it's checked in during
  // THIS server run (and recently) — on boot everything starts offline until its next fetch.
  const serverStartedAt = Date.now();
  const isOnline = (d: Device, now: number): boolean => {
    // A manual ping that failed AFTER the last check-in is authoritative — it's offline now.
    if (d.last_ping_failed_at && d.last_ping_failed_at > (d.last_seen ?? 0)) return false;
    return !!d.last_seen && d.last_seen >= serverStartedAt && now - d.last_seen < ONLINE_WINDOW_MS;
  };

  r.get("/health", (_req, res) => res.json({ status: "ok" }));
  r.get("/version", (_req, res) => res.json({ version: VERSION }));
  r.get("/presets", (_req, res) => res.json(PRESETS));

  // --- config backup / restore (the whole SQLite DB; may contain tokens) ---
  r.post("/config/export", (req, res) => {
    const password = typeof req.body?.password === "string" && req.body.password ? req.body.password : undefined;
    res
      .setHeader("Content-Type", "application/octet-stream")
      .setHeader("Content-Disposition", `attachment; filename="photoframe-backup.pfb"`)
      .send(packBackup(serializeDb(), password));
  });
  r.post("/config/import", raw({ type: "*/*", limit: "256mb" }), (req, res) => {
    const password = req.header("x-backup-password") || undefined;
    try {
      const dbBuf = unpackBackup(req.body as Buffer, password);
      if (dbBuf.subarray(0, 15).toString("latin1") !== "SQLite format 3") throw new Error("Not a valid backup file");
      res.json({ ok: true, message: "Imported — the server is restarting." });
      replaceDb(dbBuf); // closes DB + exits; supervisor restarts with the imported config
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.get("/immich/status", async (_req, res) => {
    const st = await immich.status();
    res.json({ ...st, baseUrl: immich.getBaseUrl() });
  });

  // Immich connection settings, editable from the Settings tab. The API key is
  // write-only: we report whether one is set, never its value.
  r.get("/immich/config", (_req, res) => {
    res.json({ baseUrl: immich.getBaseUrl(), hasApiKey: immich.hasApiKey() });
  });
  r.put("/immich/config", async (req, res) => {
    const b = req.body ?? {};
    const baseUrl =
      typeof b.baseUrl === "string" ? b.baseUrl.trim().replace(/\/+$/, "") : immich.getBaseUrl();
    const saved = appSettings.get<{ baseUrl?: string; apiKey?: string }>("immich", {});
    // A blank apiKey field means "keep the existing key" (so the URL can change alone).
    const apiKey =
      typeof b.apiKey === "string" && b.apiKey.trim()
        ? b.apiKey.trim()
        : (saved.apiKey ?? cfg.immichApiKey);
    appSettings.set("immich", { baseUrl, apiKey });
    immich.configure(baseUrl, apiKey);
    selection.invalidateAll();
    const status = await immich.status();
    res.json({ baseUrl: immich.getBaseUrl(), hasApiKey: immich.hasApiKey(), status });
  });

  // Photo GPS markers for the map painter. Scope: the given local albums (repeatable
  // ?localAlbumId=), else the global album selection. Immich has no per-album marker API
  // on all versions, so we intersect the album's asset ids with the library-wide
  // /map/markers coordinates. Capped for the map.
  r.get("/photo-locations", async (req, res) => {
    const raw = req.query.localAlbumId;
    const localIds = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
    const albumIds = localIds.length ? localAlbums.immichAlbumIds(localIds) : settings.get().albumIds;
    if (!albumIds.length) return res.json({ points: [], total: 0 });
    try {
      const [assetIds, markers] = await Promise.all([
        immich.listAlbumImageAssetIds(albumIds),
        immich.mapMarkers(),
      ]);
      const wanted = new Set(assetIds);
      const points = markers.filter((m) => wanted.has(m.id));
      const CAP = 5000;
      res.json({ points: points.slice(0, CAP), total: points.length });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // --- Albums ---
  r.get("/albums", async (_req, res) => {
    try {
      const inUse = new Set(settings.get().albumIds);
      const albums = await immich.listAlbums();
      res.json(
        albums.map((a) => ({
          id: a.id,
          name: a.albumName,
          assetCount: a.assetCount,
          thumbnailAssetId: a.albumThumbnailAssetId,
          inUse: inUse.has(a.id),
        })),
      );
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  r.put("/albums/selection", (req, res) => {
    const raw = (req.body?.albumIds ?? []) as unknown;
    const albumIds = Array.isArray(raw) ? raw.map(String) : [];
    settings.update({ albumIds });
    selection.invalidate();
    res.json({ albumIds });
  });

  // --- Local albums (pools composed of Immich albums) ---
  r.get("/local-albums", (_req, res) => res.json(localAlbums.list()));
  r.post("/local-albums", (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    res.status(201).json(localAlbums.create(name));
  });
  r.patch("/local-albums/:id", (req, res) => {
    const la = localAlbums.get(req.params.id);
    if (!la) return res.status(404).json({ error: "not found" });
    if (typeof req.body?.name === "string") localAlbums.rename(la.id, req.body.name.trim());
    if (Array.isArray(req.body?.sources)) {
      const sources = (req.body.sources as Array<{ type?: string; ref?: string }>)
        .filter((s) => s.ref)
        .map((s) => ({ type: (s.type as SourceType) ?? "immich", ref: String(s.ref) }));
      localAlbums.setSources(la.id, sources);
    }
    selection.invalidateAll();
    res.json(localAlbums.get(la.id));
  });
  r.delete("/local-albums/:id", (req, res) => {
    localAlbums.remove(req.params.id);
    res.status(204).end();
  });
  r.get("/local-albums/:id/assets", async (req, res) => {
    const la = localAlbums.get(req.params.id);
    if (!la) return res.status(404).json({ error: "not found" });
    const albumIds = localAlbums.immichAlbumIds([la.id]);
    if (albumIds.length === 0) return res.json({ ids: [], total: 0 });
    try {
      const ids = await immich.listAlbumImageAssetIds(albumIds);
      res.json({ ids: ids.slice(0, 120), total: ids.length, ignored: ignored.ids() });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // --- Ignored assets (never shown) ---
  r.get("/ignored", (_req, res) => res.json(ignored.ids()));
  r.post("/ignored", (req, res) => {
    const id = String(req.body?.assetId ?? "");
    if (!id) return res.status(400).json({ error: "assetId required" });
    ignored.add(id);
    selection.invalidateAll();
    res.status(201).json({ ok: true });
  });
  r.delete("/ignored/:assetId", (req, res) => {
    ignored.remove(req.params.assetId);
    selection.invalidateAll();
    res.status(204).end();
  });

  // --- People (Immich faces) ---
  r.get("/people", async (_req, res) => {
    try {
      res.json(await immich.listPeople());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });
  r.get("/people/:id/thumbnail", async (req, res) => {
    try {
      const { buffer, contentType } = await immich.getPersonThumbnail(req.params.id);
      res.type(contentType).set("Cache-Control", "public, max-age=86400").send(buffer);
    } catch (err) {
      res.status(502).type("text/plain").send((err as Error).message);
    }
  });

  // --- Devices ---
  // The per-frame access token is not a secret (it only authorizes fetching this frame's
  // already-public image), so expose it in full alongside the masked form for the UI.
  const publicDevice = (d: Device) => {
    const { access_token, ...rest } = d;
    return {
      ...rest,
      isLocal: !!d.is_local,
      hasAccessToken: !!access_token,
      accessToken: access_token ?? null,
      accessTokenMasked: access_token ? maskToken(access_token) : null,
    };
  };

  // Server→frame actions (probe, push config, rotate) only work when the frame is on the
  // server's LAN. Remote frames (e.g. shared with family abroad) are configured on the frame's
  // own web page; guard those endpoints so the UI gets a clear message instead of a timeout.
  const requireLocal = (d: Device, res: ExpressResponse): boolean => {
    if (d.is_local) return true;
    res.status(400).json({ error: "Remote frame — set it up on the frame itself." });
    return false;
  };

  r.get("/devices", async (_req, res) => {
    const now = Date.now();
    const shows = usage.showCountsByDevice();
    const list = devices.list();
    // Battery frames deep-sleep and only wake ~hourly, so we don't ping them on an interval.
    // "Online" means the frame checked in (fetched an image) within the online window. Use the
    // manual "ping the frame" button for a live reachability check.
    res.json(
      list.map((d) => ({
        ...publicDevice(d),
        online: isOnline(d, now),
        shows: shows[d.id] ?? 0,
      })),
    );
  });

  r.post("/devices", (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    res.status(201).json(publicDevice(devices.create(name, { simulated: !!req.body?.simulated })));
  });

  r.patch("/devices/:id", (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    const b = req.body ?? {};
    if (typeof b.name === "string") devices.rename(d.id, b.name.trim());
    if ("profileId" in b) devices.assign(d.id, { profile_id: b.profileId ?? null });
    if ("scheduleId" in b) devices.assign(d.id, { schedule_id: b.scheduleId ?? null });
    if ("groupId" in b) devices.assign(d.id, { group_id: b.groupId ?? null });
    if ("mirrorOf" in b) devices.assign(d.id, { mirror_of: b.mirrorOf === d.id ? null : (b.mirrorOf ?? null) });
    if (typeof b.position === "number") devices.assign(d.id, { position: b.position });
    if ("host" in b) devices.setHost(d.id, typeof b.host === "string" ? b.host.trim() : null);
    if (typeof b.isLocal === "boolean") devices.setLocal(d.id, b.isLocal);
    if (typeof b.accessToken === "string") devices.setAccessToken(d.id, b.accessToken.trim() || null);
    if (typeof b.preset === "string" && PRESETS.includes(b.preset)) devices.setPreset(d.id, b.preset);
    if ("rotateEveryMin" in b && Number.isFinite(Number(b.rotateEveryMin))) {
      const minutes = Math.min(ROTATE_MAX_MINUTES, Math.max(ROTATE_MIN_MINUTES, Math.round(Number(b.rotateEveryMin))));
      devices.setRotateEvery(d.id, minutes);
      // Best-effort: tell a reachable real frame to wake at this cadence (rotate_interval is seconds).
      if (!d.simulated && d.host && d.is_local) {
        frameFetch(d.host, "/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rotate_interval: minutes * 60, auto_rotate: true }),
        }).catch(() => undefined);
      }
    }
    res.json(publicDevice(devices.get(d.id)!));
  });

  r.delete("/devices/:id", (req, res) => {
    devices.remove(req.params.id);
    res.status(204).end();
  });

  // --- Groups ---
  r.get("/groups", (_req, res) => res.json(groups.list()));
  r.post("/groups", (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    res.status(201).json(groups.create(name));
  });
  r.patch("/groups/:id", (req, res) => {
    if (typeof req.body?.name === "string") groups.rename(req.params.id, req.body.name.trim());
    res.json(groups.get(req.params.id));
  });
  r.delete("/groups/:id", (req, res) => {
    groups.remove(req.params.id);
    res.status(204).end();
  });

  // --- Profiles ---
  r.get("/profiles", (_req, res) => res.json(profiles.list()));
  r.post("/profiles", (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    res.status(201).json(profiles.create({ name, ...pickProfile(req.body) }));
  });
  r.patch("/profiles/:id", (req, res) => {
    const updated = profiles.update(req.params.id, { name: req.body?.name, ...pickProfile(req.body) });
    if (!updated) return res.status(404).json({ error: "not found" });
    selection.invalidateAll();
    res.json(updated);
  });
  r.delete("/profiles/:id", (req, res) => {
    profiles.remove(req.params.id);
    res.status(204).end();
  });

  // Preview a profile: convert a random asset from its albums. Processing preset now lives on
  // the device, so the profile preview uses the server default.
  r.get("/profiles/:id/preview.png", async (req, res) => {
    const profile = profiles.get(req.params.id);
    if (!profile) return res.status(404).end();
    try {
      const assetId = await selection.nextAsset(profile);
      const png = await pngFor(assetId, {
        width: cfg.defaultWidth,
        height: cfg.defaultHeight,
        orientation: cfg.defaultOrientation,
        preset: cfg.convertPreset,
      });
      // Composite overlays so the preview matches what frames show. An ?overlayConfig query
      // overrides the saved one (lets the editor preview an unsaved selection; "" = none).
      const override = typeof req.query.overlayConfig === "string" ? req.query.overlayConfig || null : undefined;
      const withOverlays = await applyOverlays(png, 72, profile, assetId, override);
      res.type("image/png").set("Cache-Control", "no-store").send(withOverlays);
    } catch (err) {
      res.status(500).type("text/plain").send((err as Error).message);
    }
  });

  // --- Schedules ---
  r.get("/schedules", (_req, res) => res.json(schedules.list()));
  r.post("/schedules", (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    res.status(201).json(schedules.create(name));
  });
  r.patch("/schedules/:id", (req, res) => {
    if (typeof req.body?.name === "string") schedules.rename(req.params.id, req.body.name.trim());
    res.json(schedules.get(req.params.id));
  });
  r.delete("/schedules/:id", (req, res) => {
    schedules.remove(req.params.id);
    res.status(204).end();
  });
  r.get("/schedules/:id/entries", (req, res) => res.json(schedules.entries(req.params.id)));
  r.put("/schedules/:id/cell", (req, res) => {
    const { dow, hour, profileId } = req.body ?? {};
    if (typeof dow !== "number" || typeof hour !== "number") {
      return res.status(400).json({ error: "dow and hour required" });
    }
    schedules.setCell(req.params.id, dow, hour, profileId ?? null);
    selection.invalidateAll();
    res.json({ ok: true });
  });

  // Raw incoming device requests (audit log) — every hit to /d/:id, incl. 304s.
  r.get("/device-requests", (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 200), 1000);
    const deviceId = req.query.deviceId ? String(req.query.deviceId) : undefined;
    res.json(deviceRequests.recent(limit, deviceId));
  });

  // --- Usage & stats ---
  r.get("/usage", (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const deviceId = req.query.deviceId ? String(req.query.deviceId) : undefined;
    const t = String(req.query.type ?? "");
    const type = t === "show" || t === "error" || t === "battery" || t === "genai" ? t : undefined;
    res.json(usage.recent(limit, deviceId, type));
  });
  r.get("/usage/battery/:deviceId", (req, res) => {
    const days = Math.min(Number(req.query.days ?? 7), 90);
    res.json(usage.batterySeries(req.params.deviceId, Date.now() - days * DAY_MS));
  });
  r.get("/usage/genai-cost", (req, res) => {
    const days = Math.min(Number(req.query.days ?? 30), 365);
    const since = Date.now() - days * DAY_MS;
    res.json({ ...usage.genaiCostSince(since), series: usage.genaiCostSeries(since) });
  });
  r.get("/stats", async (_req, res) => {
    const now = Date.now();
    const list = devices.list();
    // "Available" = distinct images across all local albums' Immich albums (or the global selection).
    let available = 0;
    try {
      const allLocal = localAlbums.list().flatMap((la) => la.sources.filter((s) => s.type === "immich").map((s) => s.ref));
      const valid = await immich.albumIdSet();
      const albumIds = [...new Set(allLocal.length ? allLocal : settings.get().albumIds)].filter((id) => valid.has(id));
      // Immich treats multiple albumIds as AND (assets in ALL of them), so querying them together
      // returns ~0. Count per-album and sum (union; overlapping assets may be double-counted).
      for (const id of albumIds) available += await immich.countMatching({ albumIds: [id] });
    } catch {
      available = 0;
    }
    const reach = list.map((d) => isOnline(d, now));
    res.json({
      frames: list.length,
      framesOnline: reach.filter(Boolean).length,
      shows24h: usage.countSince("show", now - DAY_MS),
      errors24h: usage.countSince("error", now - DAY_MS),
      available,
    });
  });

  // --- Generations (AI content config; provider wired later) ---
  r.get("/generations", (_req, res) => res.json(generations.list()));
  r.post("/generations", (req, res) => {
    res.status(201).json(generations.create({ name: req.body?.name }));
  });
  r.patch("/generations/:id", (req, res) => {
    const b = req.body ?? {};
    const updated = generations.update(req.params.id, {
      name: b.name,
      sourceType: ["existing", "news", "full_ai"].includes(b.sourceType) ? (b.sourceType as SourceKind) : undefined,
      prompt: typeof b.prompt === "string" ? b.prompt : undefined,
      style: typeof b.style === "string" ? b.style : undefined,
      provider: typeof b.provider === "string" ? b.provider : undefined,
      params: typeof b.params === "object" && b.params !== null ? b.params : undefined,
    });
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  });
  r.delete("/generations/:id", (req, res) => {
    generations.remove(req.params.id);
    res.status(204).end();
  });

  // --- Overlays ---
  r.get("/overlays", (_req, res) => res.json(overlays.list()));
  r.put("/overlays/:type", (req, res) => {
    const b = req.body ?? {};
    const updated = overlays.update(req.params.type as OverlayType, {
      enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
      position: b.position,
      scale: typeof b.scale === "number" ? b.scale : undefined,
      config: typeof b.config === "object" && b.config !== null ? b.config : undefined,
    });
    if (!updated) return res.status(404).json({ error: "unknown overlay" });
    res.json(updated);
  });

  // --- named overlay configs (assignable to profiles) ---
  r.get("/overlay-configs", (_req, res) => res.json(overlays.listConfigs()));
  r.post("/overlay-configs", (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    res.status(201).json(overlays.createConfig(name));
  });
  r.get("/overlay-configs/:id", (req, res) => {
    const cfg = overlays.getConfig(req.params.id);
    if (!cfg) return res.status(404).json({ error: "unknown config" });
    res.json(cfg);
  });
  r.patch("/overlay-configs/:id", (req, res) => {
    if (typeof req.body?.name === "string") overlays.renameConfig(req.params.id, req.body.name);
    const cfg = overlays.getConfig(req.params.id);
    if (!cfg) return res.status(404).json({ error: "unknown config" });
    res.json(cfg);
  });
  r.delete("/overlay-configs/:id", (req, res) => {
    overlays.deleteConfig(req.params.id);
    res.status(204).end();
  });
  r.put("/overlay-configs/:id/overlays/:type", (req, res) => {
    const b = req.body ?? {};
    const updated = overlays.updateConfigOverlay(req.params.id, req.params.type as OverlayType, {
      enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
      position: b.position,
      scale: typeof b.scale === "number" ? b.scale : undefined,
      config: typeof b.config === "object" && b.config !== null ? b.config : undefined,
    });
    if (!updated) return res.status(404).json({ error: "unknown config" });
    res.json(updated);
  });

  r.get("/overlay-items", (req, res) => {
    const kind = req.query.kind === "birthday" ? "birthday" : "todo";
    res.json(overlays.items(kind));
  });
  r.post("/overlay-items", (req, res) => {
    const kind = req.body?.kind === "birthday" ? "birthday" : "todo";
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "text required" });
    res.status(201).json(overlays.addItem(kind, text, req.body?.date ?? null, req.body?.ref ?? null));
  });
  r.patch("/overlay-items/:id", (req, res) => {
    overlays.updateItem(req.params.id, {
      text: req.body?.text,
      date: req.body?.date,
      done: typeof req.body?.done === "boolean" ? req.body.done : undefined,
      ref: "ref" in (req.body ?? {}) ? (req.body.ref ?? null) : undefined,
    });
    res.json({ ok: true });
  });
  r.delete("/overlay-items/:id", (req, res) => {
    overlays.removeItem(req.params.id);
    res.status(204).end();
  });

  // --- Weather (Open-Meteo) ---
  r.get("/weather/geocode", async (req, res) => {
    try {
      res.json(await weather.geocode(String(req.query.q ?? "")));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });
  r.get("/weather/preview", async (req, res) => {
    const units = req.query.units === "F" ? "F" : "C";
    res.json(await weather.get(String(req.query.location ?? ""), units));
  });

  // --- Create an Immich album (used as a Telegram upload target, etc.) ---
  r.post("/immich/albums", async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      res.status(201).json(await immich.createAlbum(name));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // --- Telegram config (scaffold; bot/upload wired in a later pass) ---
  const telegramView = (t: TelegramConfig) => ({
    enabled: t.enabled,
    targetAlbumId: t.targetAlbumId,
    hasToken: !!t.botToken,
    tokenMasked: maskToken(t.botToken),
    allowedUsers: t.allowedUsers ?? [],
    status: telegram.status(),
  });

  r.get("/telegram", (_req, res) => {
    res.json(telegramView(appSettings.get<TelegramConfig>("telegram", { enabled: false, targetAlbumId: null, botToken: "" })));
  });
  r.put("/telegram", (req, res) => {
    const cur = appSettings.get<TelegramConfig>("telegram", { enabled: false, targetAlbumId: null, botToken: "" });
    const b = req.body ?? {};
    const next: TelegramConfig = {
      enabled: typeof b.enabled === "boolean" ? b.enabled : cur.enabled,
      targetAlbumId: "targetAlbumId" in b ? (b.targetAlbumId ?? null) : cur.targetAlbumId,
      botToken: typeof b.botToken === "string" && b.botToken ? b.botToken : cur.botToken,
      allowedUsers: Array.isArray(b.allowedUsers)
        ? b.allowedUsers
            .map((u: { id?: unknown; name?: unknown }) => ({ id: Number(u.id), name: typeof u.name === "string" ? u.name : undefined }))
            .filter((u: { id: number }) => Number.isFinite(u.id) && u.id !== 0)
        : cur.allowedUsers,
    };
    appSettings.set("telegram", next);
    telegram.apply(); // (re)start the bot or update its live config
    res.json(telegramView(next));
  });
  r.get("/telegram/messages", (_req, res) => res.json(telegramMessages.threads()));
  r.delete("/telegram/messages", (req, res) => {
    const uid = req.query.userId !== undefined ? Number(req.query.userId) : undefined;
    telegramMessages.clear(uid !== undefined && Number.isFinite(uid) ? uid : undefined);
    res.status(204).end();
  });
  r.post("/telegram/authorize", async (req, res) => {
    const id = Number(req.body?.id);
    const name = typeof req.body?.name === "string" ? req.body.name : undefined;
    if (!Number.isFinite(id) || id === 0) return res.status(400).json({ error: "id required" });
    const cur = appSettings.get<TelegramConfig>("telegram", { enabled: false, targetAlbumId: null, botToken: "" });
    const allowedUsers = cur.allowedUsers ?? [];
    if (!allowedUsers.some((u) => u.id === id)) allowedUsers.push({ id, name });
    const next = { ...cur, allowedUsers };
    appSettings.set("telegram", next);
    telegram.apply(); // refresh the bot's live allowlist (no restart)
    await telegram
      .notify(id, name ?? String(id), "✅ You've been authorized! Send me photos and I'll save them to Immich.")
      .catch(() => undefined);
    res.json(telegramView(next));
  });

  // --- Firmware (server downloads + caches release binaries, serves same-origin) ---
  r.get("/firmware/boards", async (_req, res) => {
    try {
      res.json({ boards: firmware.boards(), tag: await firmware.tag() });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message, boards: firmware.boards() });
    }
  });
  r.get("/firmware/:board/manifest.json", async (req, res) => {
    if (!firmware.isBoard(req.params.board)) return res.status(404).json({ error: "unknown board" });
    try {
      res.json(await firmware.manifest(req.params.board));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });
  r.get("/firmware/:board/firmware.bin", async (req, res) => {
    if (!firmware.isBoard(req.params.board)) return res.status(404).end();
    try {
      const file = await firmware.binPath(req.params.board);
      res.type("application/octet-stream").sendFile(path.resolve(file));
    } catch (err) {
      res.status(502).type("text/plain").send((err as Error).message);
    }
  });

  // --- Frame settings over its WiFi HTTP API (server proxies to avoid browser CORS) ---
  // Default 5s suits quick config calls. Rotation is SYNCHRONOUS on the frame (it downloads +
  // runs the ~30s e-paper refresh before replying), so those callers pass a longer timeout.
  async function frameFetch(host: string, pathname: string, init?: RequestInit, timeoutMs = 5000): Promise<Response> {
    const base = /^https?:\/\//.test(host) ? host : `http://${host}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(`${base}${pathname}`, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }
  // Read battery + firmware off a frame while it's awake (e.g. right after a successful ping).
  // Best-effort: a deep-sleeping frame answers ICMP but its HTTP server may be down, so this can
  // fail silently. Records whatever it gets and returns the battery level (or null).
  async function pullTelemetry(d: Device): Promise<{ batteryPct: number | null; batteryMv: number | null }> {
    if (!d.host) return { batteryPct: null, batteryMv: null };
    let batteryPct: number | undefined;
    let batteryMv: number | undefined;
    let firmware: string | undefined;
    try {
      const br = await frameFetch(d.host, "/api/battery", undefined, 4000);
      if (br.ok) {
        const j = await br.json();
        if (typeof j?.battery_level === "number") batteryPct = j.battery_level;
        if (typeof j?.battery_voltage === "number") batteryMv = j.battery_voltage;
      }
    } catch { /* HTTP server asleep */ }
    try {
      const sr = await frameFetch(d.host, "/api/system-info", undefined, 4000);
      if (sr.ok) {
        const j = await sr.json();
        if (typeof j?.version === "string") firmware = j.version;
      }
    } catch { /* HTTP server asleep */ }
    if (batteryPct != null || batteryMv != null || firmware != null) {
      devices.recordTelemetry(d.id, { batteryPct, batteryMv, firmware });
      if (batteryPct != null) usage.log({ deviceId: d.id, type: "battery", batteryPct });
    }
    return { batteryPct: batteryPct ?? null, batteryMv: batteryMv ?? null };
  }

  // Frame blocks the HTTP response through the full download + e-paper update.
  const ROTATE_TIMEOUT_MS = 60_000;
  r.get("/devices/:id/frame-config", async (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    if (!requireLocal(d, res)) return;
    if (!d.host) return res.status(400).json({ error: "Set the device host first" });
    try {
      const fr = await frameFetch(d.host, "/api/config");
      if (!fr.ok) return res.status(502).json({ error: `Frame returned ${fr.status}` });
      res.json(await fr.json());
    } catch (err) {
      res.status(502).json({ error: `Cannot reach frame at ${d.host}: ${(err as Error).message}` });
    }
  });
  r.post("/devices/:id/frame-config", async (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    if (!requireLocal(d, res)) return;
    if (!d.host) return res.status(400).json({ error: "Set the device host first" });
    try {
      const fr = await frameFetch(d.host, "/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body ?? {}),
      });
      if (!fr.ok) return res.status(502).json({ error: `Frame returned ${fr.status}` });
      const text = await fr.text();
      res.json(text ? JSON.parse(text) : { ok: true });
    } catch (err) {
      res.status(502).json({ error: `Cannot reach frame: ${(err as Error).message}` });
    }
  });
  r.post("/devices/:id/use-server", async (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    if (!requireLocal(d, res)) return;
    if (!d.host) return res.status(400).json({ error: "Set the device host first" });
    const imageUrl = `${effectiveBase(req)}/d/${d.id}.epdgz`;
    try {
      const fr = await frameFetch(d.host, "/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl, rotation_mode: "url", auto_rotate: true, rotate_interval: (d.rotate_every_min ?? 60) * 60 }),
      });
      if (!fr.ok) return res.status(502).json({ error: `Frame returned ${fr.status}` });
      res.json({ ok: true, imageUrl });
    } catch (err) {
      res.status(502).json({ error: `Cannot reach frame: ${(err as Error).message}` });
    }
  });

  // The address frames should fetch from: UI-set value wins, then env, then the request host.
  const effectiveBase = (req: Request) =>
    (appSettings.get<string>("publicBaseUrl", "") || cfg.publicBaseUrl || `${req.protocol}://${req.get("host")}`).replace(
      /\/+$/,
      "",
    );
  const looksLocal = (url: string) => /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);

  // This machine's LAN address — what a frame on the same network should fetch from.
  const lanUrl = (): string | null => {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list ?? []) {
        if (i.family === "IPv4" && !i.internal) return `http://${i.address}:${cfg.port}`;
      }
    }
    return null;
  };

  r.get("/server-base", (req, res) => {
    res.json({
      baseUrl: appSettings.get<string>("publicBaseUrl", "") || cfg.publicBaseUrl || "",
      requestOrigin: `${req.protocol}://${req.get("host")}`,
      effective: effectiveBase(req),
      suggested: lanUrl(),
    });
  });
  r.put("/server-base", (req, res) => {
    const v = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim().replace(/\/+$/, "") : "";
    appSettings.set("publicBaseUrl", v);
    res.json({ baseUrl: v });
  });

  // Global app settings (weather location/units, timezone) edited from the Settings tab.
  r.get("/app-settings", (_req, res) => {
    res.json({
      weatherLocation: appSettings.get<string>("weatherLocation", ""),
      weatherUnits: appSettings.get<string>("weatherUnits", "C"),
      timezone: appSettings.get<string>("timezone", ""),
    });
  });
  r.put("/app-settings", (req, res) => {
    const b = req.body ?? {};
    if (typeof b.weatherLocation === "string") appSettings.set("weatherLocation", b.weatherLocation.trim());
    if (b.weatherUnits === "C" || b.weatherUnits === "F") appSettings.set("weatherUnits", b.weatherUnits);
    if (typeof b.timezone === "string") appSettings.set("timezone", b.timezone.trim());
    res.json({
      weatherLocation: appSettings.get<string>("weatherLocation", ""),
      weatherUnits: appSettings.get<string>("weatherUnits", "C"),
      timezone: appSettings.get<string>("timezone", ""),
    });
  });

  // --- Gemini (Google AI) API key — stored like the Immich key, never returned. ---
  const geminiHasKey = () => !!(appSettings.get<{ apiKey?: string }>("gemini", {}).apiKey || cfg.geminiApiKey);
  r.get("/gemini/config", (_req, res) => res.json({ hasApiKey: geminiHasKey() }));
  r.put("/gemini/config", (req, res) => {
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    if (apiKey) appSettings.set("gemini", { apiKey });
    res.json({ hasApiKey: geminiHasKey() });
  });

  // --- Claude OAuth — run inference against the user's Claude plan, not metered API billing. ---
  const OAUTH_PROVIDERS: OAuthProvider[] = ["anthropic"];
  const asProvider = (s: string): OAuthProvider | null =>
    (OAUTH_PROVIDERS as string[]).includes(s) ? (s as OAuthProvider) : null;
  const oauthRedirectUri = (req: Request, provider: OAuthProvider) =>
    `${cfg.oauth.redirectBase || effectiveBase(req)}/api/oauth/${provider}/callback`;

  r.get("/oauth/providers", (_req, res) => {
    res.json(
      OAUTH_PROVIDERS.map((p) => ({ ...oauthCreds.statusOf(p), configured: oauth.isConfigured(p) })),
    );
  });
  r.get("/oauth/:provider/start", (req, res) => {
    const provider = asProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: "unknown provider" });
    if (!oauth.isConfigured(provider)) return res.status(400).json({ error: `${provider} OAuth is not configured` });
    try {
      res.redirect(oauth.startAuthorize(provider, oauthRedirectUri(req, provider)));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  r.get("/oauth/:provider/callback", async (req, res) => {
    const provider = asProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: "unknown provider" });
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state) return res.redirect(`/settings?oauth=${provider}&status=error`);
    try {
      await oauth.handleCallback(code, state);
      res.redirect(`/settings?oauth=${provider}&status=connected`);
    } catch (err) {
      res.redirect(`/settings?oauth=${provider}&status=error&message=${encodeURIComponent((err as Error).message)}`);
    }
  });
  r.post("/oauth/:provider/disconnect", (req, res) => {
    const provider = asProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: "unknown provider" });
    oauthCreds.delete(provider);
    res.json({ ok: true });
  });

  const genToken = () => randomBytes(24).toString("base64url");

  r.get("/devices/:id/system-info", async (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    if (!requireLocal(d, res)) return;
    if (!d.host) return res.status(400).json({ error: "Set the device host first" });
    try {
      const fr = await frameFetch(d.host, "/api/system-info");
      if (!fr.ok) return res.status(502).json({ error: `Frame returned ${fr.status}` });
      res.json(await fr.json());
    } catch (err) {
      res.status(502).json({ error: `Cannot reach frame at ${d.host}: ${(err as Error).message}` });
    }
  });

  r.post("/devices/:id/rotate", async (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    if (!requireLocal(d, res)) return;
    if (!d.host) return res.status(400).json({ error: "Set the device host first" });
    // Rotate just re-sends the CURRENT image (no promotion). The frame's rotate is SYNCHRONOUS and
    // slow (download + ~30–60s e-paper refresh) and it deep-sleeps, so don't block on its reply —
    // fire it and report based on a quick reachability check (ICMP), which works even mid-update.
    const reachable = await isReachable(d.host);
    frameFetch(d.host, "/api/rotate", { method: "POST" }, ROTATE_TIMEOUT_MS).catch(() => {});
    res.json({
      ok: true,
      reachable,
      message: reachable
        ? "Re-sending current image — frame is updating (~30–60s). Watch the screen."
        : "Frame looks asleep — it'll refresh on its next wake.",
    });
  });

  // Pre-create the NEXT image on the server (server-side only — does NOT touch the frame).
  // It's staged as the device's "next" image; press rotate to actually send it to the frame.
  r.post("/devices/:id/next-image", async (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    try {
      const profile = selection.resolveProfile(d);
      const assetId = await selection.nextAsset(profile);
      if (!assetId) return res.status(502).json({ error: "No images available for this device's profile." });
      devices.setNextAsset(d.id, assetId);
      res.json({ ok: true, assetId, message: "Next image ready — press Show next to send it." });
    } catch (err) {
      res.status(502).json({ error: `Couldn't pick a new image: ${(err as Error).message}` });
    }
  });

  // Show next: promote the staged next image to current, send it to the frame, and pre-create the
  // following "next" image so there's always one ready.
  r.post("/devices/:id/show-next", async (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    const profile = selection.resolveProfile(d);
    try {
      // Make sure there's a staged next to promote (generate one if New image wasn't used).
      if (!d.next_asset_id) {
        const a = await selection.nextAsset(profile);
        if (a) devices.setNextAsset(d.id, a);
      }
      devices.promoteNextAsset(d.id); // next -> current
      // Pre-create the following next image.
      try {
        const a2 = await selection.nextAsset(profile);
        if (a2) devices.setNextAsset(d.id, a2);
      } catch { /* leave next empty if selection fails */ }
    } catch (err) {
      return res.status(502).json({ error: `Couldn't pick a new image: ${(err as Error).message}` });
    }
    if (!d.host || !d.is_local) {
      return res.json({ ok: true, reachable: false, message: "Advanced to next image — the frame will show it on its next fetch." });
    }
    const reachable = await isReachable(d.host);
    frameFetch(d.host, "/api/rotate", { method: "POST" }, ROTATE_TIMEOUT_MS).catch(() => {});
    res.json({
      ok: true,
      reachable,
      message: reachable
        ? "Showing next — frame is updating (~30–60s). A new next image is ready."
        : "Advanced to next — frame asleep; it'll show on next wake. New next ready.",
    });
  });

  // On-demand reachability check (ICMP ping). A deep-sleeping frame's WiFi chip usually still
  // answers, so this verifies the frame is on the network even when HTTP/rotate would fail.
  r.get("/devices/:id/ping", async (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    if (!requireLocal(d, res)) return;
    if (!d.host) return res.status(400).json({ error: "Set the device host first" });
    const reachable = await isReachable(d.host);
    let batteryPct: number | null = null;
    let batteryMv: number | null = null;
    if (reachable) {
      // It answered, so it's on the network now — update "last seen" and grab battery/firmware
      // while its HTTP server is likely up.
      devices.markSeen(d.id);
      ({ batteryPct, batteryMv } = await pullTelemetry(d));
    } else {
      // No reply → flip the badge to offline immediately (we don't poll on an interval anymore).
      devices.markPingFailed(d.id);
    }
    res.json({ reachable, batteryPct, batteryMv });
  });

  // Point the frame at this server AND set a per-frame access token (stored both sides).
  r.post("/devices/:id/connect", async (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    if (!requireLocal(d, res)) return;
    if (!d.host) return res.status(400).json({ error: "Set the device host first" });
    // Use (and remember) an explicit base from the request, so the button is WYSIWYG.
    const explicit =
      typeof req.body?.baseUrl === "string" && req.body.baseUrl.trim()
        ? req.body.baseUrl.trim().replace(/\/+$/, "")
        : null;
    if (explicit) appSettings.set("publicBaseUrl", explicit);
    const token = d.access_token || genToken();
    const imageUrl = `${explicit || effectiveBase(req)}/d/${d.id}.epdgz`;
    try {
      const fr = await frameFetch(d.host, "/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: imageUrl, rotation_mode: "url", auto_rotate: true, rotate_interval: (d.rotate_every_min ?? 60) * 60, access_token: token }),
      });
      if (!fr.ok) return res.status(502).json({ error: `Frame returned ${fr.status}` });
      devices.setAccessToken(d.id, token);
      res.json({ ok: true, imageUrl, accessTokenMasked: maskToken(token), localhost: looksLocal(imageUrl) });
    } catch (err) {
      res.status(502).json({ error: `Cannot reach frame: ${(err as Error).message}` });
    }
  });

  // Regenerate the per-frame token and push it to the frame.
  r.post("/devices/:id/access-token", async (req, res) => {
    const d = devices.get(req.params.id);
    if (!d) return res.status(404).json({ error: "not found" });
    const token = genToken();
    // Remote frames (or ones with no host) are configured by hand — store the token and return it
    // so the user can paste it into the frame's own web page. Local frames get it pushed first.
    if (!d.is_local || !d.host) {
      devices.setAccessToken(d.id, token);
      return res.json({ ok: true, pushed: false, accessToken: token, accessTokenMasked: maskToken(token) });
    }
    try {
      const fr = await frameFetch(d.host, "/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token }),
      });
      if (!fr.ok) return res.status(502).json({ error: `Frame returned ${fr.status}` });
      devices.setAccessToken(d.id, token);
      res.json({ ok: true, pushed: true, accessToken: token, accessTokenMasked: maskToken(token) });
    } catch (err) {
      res.status(502).json({ error: `Cannot reach frame: ${(err as Error).message}` });
    }
  });

  // --- Restart backend / hot-reload after a source sync -----------------------------------------
  // Deploy = sync source to the mounted dataset, then POST here. We rebuild FIRST and only exit if
  // the build succeeds, so the container's restart policy relaunches on the new build — and a broken
  // push can never crash-loop prod (we stay on the working process). Reachable only via ff-admin
  // (basic-auth) since nginx 403s /api on the public device host.
  r.post("/reload", (_req, res) => {
    res.json({ ok: true, reloading: true, message: "Rebuilding; backend will restart if the build succeeds." });
    console.log("[reload] rebuild requested — running `npm run build`…");
    exec("npm run build", { cwd: process.cwd(), timeout: 5 * 60_000 }, (err, _stdout, stderr) => {
      if (err) {
        console.error("[reload] build FAILED — staying on current build:\n" + (stderr || err.message));
        return;
      }
      console.log("[reload] build OK — exiting so the container restarts on the new build.");
      setTimeout(() => process.exit(0), 100);
    });
  });

  // --- Telemetry (frame-reported) ---
  r.post("/telemetry/:id", (req, res) => {
    const battery = req.body?.batteryPct;
    if (typeof battery === "number") {
      devices.recordTelemetry(req.params.id, { batteryPct: battery });
      usage.log({ deviceId: req.params.id, type: "battery", batteryPct: battery });
    }
    res.json({ ok: true });
  });

  return r;
}

function pickProfile(b: Record<string, unknown> | undefined) {
  return {
    mode: b?.mode as "album" | "interest" | "generation" | undefined,
    albumIds: Array.isArray(b?.albumIds) ? (b!.albumIds as unknown[]).map(String) : undefined,
    localAlbumIds: Array.isArray(b?.localAlbumIds) ? (b!.localAlbumIds as unknown[]).map(String) : undefined,
    logic: b && typeof b.logic === "object" && b.logic !== null ? (b.logic as ProfileLogic) : undefined,
    pick: ["random", "sequence", "shuffle"].includes(b?.pick as string) ? (b!.pick as "random" | "sequence" | "shuffle") : undefined,
    favorRecent: typeof b?.favorRecent === "boolean" ? b.favorRecent : undefined,
    preset: typeof b?.preset === "string" ? b.preset : undefined,
    cropMode: typeof b?.cropMode === "string" ? b.cropMode : undefined,
    overlayConfigId:
      "overlayConfigId" in (b ?? {})
        ? (typeof b?.overlayConfigId === "string" ? b.overlayConfigId : null)
        : undefined,
  };
}
