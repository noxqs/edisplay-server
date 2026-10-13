// SQLite (better-sqlite3) connection + idempotent schema migration, run once at boot.
import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

export type DB = Database.Database;

export function openDb(file: string): DB {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = openWithNativeGuard(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

// better-sqlite3 is a native addon compiled against a specific Node ABI. If the
// Node launching us differs from the one it was built with (a common WebStorm
// trap — it bundles its own Node), the .node fails to dlopen. Catch that, explain
// it clearly, and try to recompile against the running Node instead of dumping a
// raw stack trace.
function openWithNativeGuard(file: string): Database.Database {
  try {
    return new Database(file);
  } catch (err) {
    if (!isNativeAbiError(err)) throw err;

    reportAbiMismatch(err);

    if (process.env.PF_NO_AUTO_REBUILD === "1") {
      console.error("  Auto-rebuild disabled (PF_NO_AUTO_REBUILD=1). Run it yourself:");
      console.error("    npm rebuild better-sqlite3\n");
      process.exit(1);
    }

    console.error("  Attempting to recompile for this Node: npm rebuild better-sqlite3\n");
    try {
      execSync("npm rebuild better-sqlite3", { stdio: "inherit" });
    } catch {
      console.error("\n  Auto-rebuild failed. Fix your toolchain, then run:");
      console.error("    npm rebuild better-sqlite3\n");
      process.exit(1);
    }

    // The first failed load is evicted from the require cache, so a fresh
    // construct re-dlopens the newly compiled binary in this same process.
    console.error("\n  Rebuild succeeded — continuing startup.\n");
    try {
      return new Database(file);
    } catch {
      console.error("  Still failing after rebuild. Restart the server; if it persists,");
      console.error("  delete node_modules and reinstall with the Node you run the app with.\n");
      process.exit(1);
    }
  }
}

function isNativeAbiError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException;
  return e?.code === "ERR_DLOPEN_FAILED" || /NODE_MODULE_VERSION/.test(e?.message ?? "");
}

function reportAbiMismatch(err: unknown): void {
  const line = "─".repeat(64);
  console.error(`\n\x1b[31m${line}\x1b[0m`);
  console.error("\x1b[31m[photoframe-server] better-sqlite3 native module failed to load\x1b[0m");
  console.error(`  Running Node ${process.version} (module ABI ${process.versions.modules}).`);
  console.error("  The module was built against a different Node version.");
  console.error("  Most often this means the Node that installed deps differs from the");
  console.error("  one launching the app (e.g. WebStorm's bundled Node vs. your system Node).");
  console.error(`\x1b[31m${line}\x1b[0m\n`);
  console.error(`  (detail: ${(err as Error).message?.split("\n")[0] ?? err})\n`);
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      mode          TEXT NOT NULL DEFAULT 'album',      -- album | interest | generation
      album_ids     TEXT NOT NULL DEFAULT '[]',         -- json string[]
      preset        TEXT NOT NULL DEFAULT 'balanced',
      crop_mode     TEXT NOT NULL DEFAULT 'cover',
      interest      TEXT NOT NULL DEFAULT '{}',         -- json (future)
      generation_id TEXT,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_albums (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_album_sources (
      id             TEXT PRIMARY KEY,
      local_album_id TEXT NOT NULL,
      type           TEXT NOT NULL DEFAULT 'immich',   -- immich | telegram | ai
      ref            TEXT NOT NULL                      -- immich album id (for type=immich)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_entries (
      id          TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      dow         INTEGER NOT NULL,                     -- 0=Sun .. 6=Sat
      hour        INTEGER NOT NULL,                     -- 0..23
      profile_id  TEXT NOT NULL,
      UNIQUE(schedule_id, dow, hour)
    );

    CREATE TABLE IF NOT EXISTS generations (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'full_ai',      -- existing | news | full_ai
      prompt      TEXT NOT NULL DEFAULT '',
      style       TEXT NOT NULL DEFAULT '',
      params      TEXT NOT NULL DEFAULT '{}',           -- json
      provider    TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id            TEXT PRIMARY KEY,                   -- also the /d/:id URL token
      name          TEXT NOT NULL,
      width         INTEGER,
      height        INTEGER,
      orientation   TEXT,
      firmware      TEXT,
      battery_pct   REAL,
      last_seen     INTEGER,
      last_asset_id TEXT,
      last_etag     TEXT,
      profile_id    TEXT,
      schedule_id   TEXT,
      group_id      TEXT,
      position      INTEGER NOT NULL DEFAULT 0,
      simulated     INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id   TEXT,
      type        TEXT NOT NULL,                        -- show | error | battery | genai
      asset_id    TEXT,
      message     TEXT,
      battery_pct REAL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_device_time ON usage_events(device_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_events(created_at);

    CREATE TABLE IF NOT EXISTS device_requests (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id    TEXT,
      created_at   INTEGER NOT NULL,
      ip           TEXT,
      path         TEXT,
      status       INTEGER,
      format       TEXT,                                -- epdgz | png
      asset_id     TEXT,
      not_modified INTEGER NOT NULL DEFAULT 0,          -- 1 if served 304
      firmware     TEXT,                                -- null = not a frame (browser preview)
      battery_pct  REAL,
      user_agent   TEXT,
      raw          TEXT                                 -- raw request line + headers as received
    );
    CREATE INDEX IF NOT EXISTS idx_devreq_device_time ON device_requests(device_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_devreq_time ON device_requests(created_at);

    CREATE TABLE IF NOT EXISTS overlays (
      type     TEXT PRIMARY KEY,                        -- battery | next_photo | weather | todos | birthdays
      enabled  INTEGER NOT NULL DEFAULT 0,
      position TEXT NOT NULL DEFAULT 'bottom-left',     -- top-left | top-right | bottom-left | bottom-right
      scale    REAL NOT NULL DEFAULT 1,
      config   TEXT NOT NULL DEFAULT '{}'               -- json (e.g. weather location)
    );

    CREATE TABLE IF NOT EXISTS overlay_configs (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      overlays   TEXT NOT NULL DEFAULT '[]',            -- json array of {type,enabled,position,scale,config}
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS overlay_items (
      id         TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,                         -- todo | birthday
      text       TEXT NOT NULL,
      date       TEXT,                                  -- birthday: MM-DD or YYYY-MM-DD
      done       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      user_name  TEXT NOT NULL,
      direction  TEXT NOT NULL,                         -- in | out
      text       TEXT NOT NULL,
      at         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tg_user_at ON telegram_messages(user_id, at);

    CREATE TABLE IF NOT EXISTS ignored_assets (
      asset_id   TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_credentials (
      provider      TEXT PRIMARY KEY,                   -- anthropic (Claude, via the user's plan)
      access_token  TEXT,
      refresh_token TEXT,
      expires_at    INTEGER,                            -- ms epoch; null = no expiry known
      scope         TEXT,
      account       TEXT,                               -- display label (e.g. email), never the token
      updated_at    INTEGER NOT NULL
    );
  `);

  // Columns added after a table first shipped — add if missing so existing DBs upgrade.
  addColumn(db, "devices", "group_id", "TEXT");
  addColumn(db, "devices", "position", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "devices", "simulated", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "devices", "host", "TEXT"); // frame IP/mDNS host for its WiFi config API
  addColumn(db, "devices", "access_token", "TEXT"); // per-frame Bearer token for /d/:id
  addColumn(db, "devices", "rotate_every_min", "INTEGER NOT NULL DEFAULT 60"); // image change cadence
  addColumn(db, "devices", "last_rotation_at", "INTEGER"); // when the shown image last changed
  addColumn(db, "devices", "preset", "TEXT NOT NULL DEFAULT 'balanced'"); // epaper processing preset (moved off profile)
  addColumn(db, "devices", "next_asset_id", "TEXT"); // staged "next" image (pre-created, not yet sent to the frame)
  addColumn(db, "devices", "mirror_of", "TEXT"); // mirror another device's current image (family sharing)
  addColumn(db, "devices", "last_telemetry_at", "INTEGER"); // when battery/firmware were last read from the frame
  addColumn(db, "devices", "last_ping_failed_at", "INTEGER"); // last manual ping that got no reply (forces offline)
  addColumn(db, "devices", "battery_mv", "INTEGER"); // battery voltage in millivolts (more accurate than %)
  addColumn(db, "devices", "is_local", "INTEGER NOT NULL DEFAULT 1"); // frame is on the server's LAN (can probe/push); 0 = remote
  addColumn(db, "device_requests", "raw", "TEXT"); // raw request line + headers as received
  addColumn(db, "device_requests", "battery_mv", "INTEGER"); // battery voltage (mV) reported on this request
  addColumn(db, "profiles", "local_album_ids", "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, "profiles", "overlay_config_id", "TEXT"); // which named overlay config to render (null = none)
  addColumn(db, "profiles", "logic", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, "profiles", "pick", "TEXT NOT NULL DEFAULT 'random'");
  addColumn(db, "profiles", "favor_recent", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "overlay_items", "ref", "TEXT"); // birthday → Immich person id
  // GenAI cost tracking — recorded on usage_events rows of type 'genai'.
  addColumn(db, "usage_events", "provider", "TEXT");
  addColumn(db, "usage_events", "model", "TEXT");
  addColumn(db, "usage_events", "input_tokens", "INTEGER");
  addColumn(db, "usage_events", "output_tokens", "INTEGER");
  addColumn(db, "usage_events", "cost_usd", "REAL");
}

function addColumn(db: DB, table: string, col: string, def: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}
