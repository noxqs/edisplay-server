// Centralised, env-driven configuration. Loaded once at startup.
import { getPresetNames } from "@aitjcize/epaper-image-convert";

export type Orientation = "portrait" | "landscape";

export interface Config {
  port: number;
  /** Immich origin without a trailing slash, e.g. "http://immich:2283". */
  immichBaseUrl: string;
  immichApiKey: string;
  /** Seed album ids (initial selection; can be changed at runtime via the admin UI). */
  albumIds: string[];
  /** JSON file holding runtime settings (selected albums). */
  settingsFile: string;
  /** SQLite database file for devices/profiles/schedules/usage. */
  dbFile: string;
  /** Directory of the built web app (served in production). */
  webDistDir: string;
  /** Optional bearer token the device must present (Authorization: Bearer ...). */
  deviceAuthToken?: string;
  /** Fallback display geometry when the device sends no X-Display-* headers. */
  defaultWidth: number;
  defaultHeight: number;
  defaultOrientation: Orientation;
  /** epaper-image-convert processing preset. */
  convertPreset: string;
  /** Public origin used to build absolute URLs (e.g. X-Thumbnail-URL) behind a proxy. */
  publicBaseUrl?: string;
  /** Directory for the converted-image disk cache. */
  cacheDir: string;
  /** Max cached PNGs before oldest are evicted (0 = unbounded). */
  cacheMaxEntries: number;
  /** How often to refresh the album asset pool from Immich (ms). */
  poolRefreshMs: number;
  /** Tick interval for simulated devices (ms) — fast, for testing group behaviour. */
  simTickMs: number;
  /** GitHub repo (owner/name) the frame firmware releases come from. */
  firmwareRepo: string;
  /** Gemini (Google AI) API key seed; can also be set at runtime via the Settings UI. */
  geminiApiKey: string;
  /** OAuth client config for Claude (run inference against the user's plan). Absent client id = "not configured". */
  oauth: OAuthConfig;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthConfig {
  /** Origin used to build the redirect URI, e.g. "http://localhost:8080". Falls back to publicBaseUrl/request origin. */
  redirectBase: string;
  anthropic: OAuthProviderConfig;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer for ${name}: ${v}`);
  return n;
}

export function loadConfig(): Config {
  // Immich URL/key are optional at startup: they can be set at runtime via the
  // admin UI (Settings tab), which persists them and overrides these env seeds.
  const immichBaseUrl = (process.env.IMMICH_BASE_URL ?? "").trim().replace(/\/+$/, "");

  // Optional seed: albums can also be chosen at runtime via the admin UI.
  const albumIds = (process.env.ALBUM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const convertPreset = (process.env.CONVERT_PRESET ?? "balanced").trim();
  const presets = getPresetNames();
  if (!presets.includes(convertPreset)) {
    throw new Error(`CONVERT_PRESET "${convertPreset}" is invalid. Valid: ${presets.join(", ")}`);
  }

  const defaultOrientation = (process.env.DEFAULT_ORIENTATION ?? "portrait").trim() as Orientation;
  if (defaultOrientation !== "portrait" && defaultOrientation !== "landscape") {
    throw new Error('DEFAULT_ORIENTATION must be "portrait" or "landscape"');
  }

  return {
    port: intEnv("PORT", 8080),
    immichBaseUrl,
    immichApiKey: (process.env.IMMICH_API_KEY ?? "").trim(),
    albumIds,
    deviceAuthToken: process.env.DEVICE_AUTH_TOKEN?.trim() || undefined,
    publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || undefined,
    defaultWidth: intEnv("DEFAULT_WIDTH", 1200),
    defaultHeight: intEnv("DEFAULT_HEIGHT", 1600),
    defaultOrientation,
    convertPreset,
    cacheDir: (process.env.CACHE_DIR ?? "./cache").trim(),
    cacheMaxEntries: intEnv("CACHE_MAX_ENTRIES", 500),
    settingsFile: (process.env.SETTINGS_FILE ?? "./data/settings.json").trim(),
    dbFile: (process.env.DB_FILE ?? "./data/app.db").trim(),
    webDistDir: (process.env.WEB_DIST_DIR ?? "./web/dist").trim(),
    poolRefreshMs: intEnv("POOL_REFRESH_MS", 60 * 60 * 1000),
    simTickMs: intEnv("SIM_TICK_MS", 20 * 1000),
    firmwareRepo: (process.env.FIRMWARE_REPO ?? "aitjcize/esp32-photoframe").trim(),
    geminiApiKey: (process.env.GEMINI_API_KEY ?? "").trim(),
    oauth: {
      redirectBase: (process.env.OAUTH_REDIRECT_BASE ?? "").trim().replace(/\/+$/, ""),
      anthropic: {
        clientId: (process.env.ANTHROPIC_OAUTH_CLIENT_ID ?? "").trim(),
        clientSecret: (process.env.ANTHROPIC_OAUTH_CLIENT_SECRET ?? "").trim(),
      },
    },
  };
}
