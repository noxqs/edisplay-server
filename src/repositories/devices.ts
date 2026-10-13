import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";

export interface Device {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  orientation: string | null;
  firmware: string | null;
  battery_pct: number | null;
  battery_mv: number | null; // battery voltage in millivolts (more accurate than %)
  last_seen: number | null;
  last_telemetry_at: number | null; // when battery/firmware were last read from the frame
  last_ping_failed_at: number | null; // last manual ping that got no reply (forces offline)
  last_asset_id: string | null;
  next_asset_id: string | null; // staged next image (pre-created via "New image", not yet sent)
  mirror_of: string | null; // when set, shows this parent device's current image
  last_etag: string | null;
  profile_id: string | null;
  schedule_id: string | null;
  group_id: string | null;
  position: number;
  simulated: number; // 0 | 1
  host: string | null;
  is_local: number; // 1 = on the server's LAN (probe/push enabled); 0 = remote frame
  access_token: string | null;
  rotate_every_min: number; // how often the shown image changes (minutes)
  last_rotation_at: number | null;
  preset: string; // epaper processing preset (balanced|dynamic|vivid|soft|grayscale)
  created_at: number;
}

export interface FetchInfo {
  width?: number;
  height?: number;
  orientation?: string;
  firmware?: string;
  assetId?: string;
  etag?: string;
  batteryPct?: number;
  rotatedAt?: number; // set when the image actually changed (advances the rotation clock)
}

export class DeviceRepo {
  constructor(private readonly db: DB) {}

  list(): Device[] {
    return this.db.prepare("SELECT * FROM devices ORDER BY created_at").all() as Device[];
  }

  get(id: string): Device | undefined {
    return this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as Device | undefined;
  }

  listSimulated(): Device[] {
    return this.db.prepare("SELECT * FROM devices WHERE simulated = 1").all() as Device[];
  }

  create(name: string, opts: { simulated?: boolean; id?: string } = {}): Device {
    const id = opts.id ?? randomUUID().slice(0, 8);
    this.db
      .prepare("INSERT INTO devices (id, name, simulated, created_at) VALUES (?, ?, ?, ?)")
      .run(id, name, opts.simulated ? 1 : 0, Date.now());
    return this.get(id)!;
  }

  /** Return the device, creating a stub row if this id has never been seen. */
  ensure(id: string): Device {
    const existing = this.get(id);
    if (existing) return existing;
    this.db
      .prepare("INSERT INTO devices (id, name, created_at) VALUES (?, ?, ?)")
      .run(id, defaultName(id), Date.now());
    return this.get(id)!;
  }

  rename(id: string, name: string): void {
    this.db.prepare("UPDATE devices SET name = ? WHERE id = ?").run(name, id);
  }

  setHost(id: string, host: string | null): void {
    this.db.prepare("UPDATE devices SET host = ? WHERE id = ?").run(host || null, id);
  }

  setLocal(id: string, on: boolean): void {
    this.db.prepare("UPDATE devices SET is_local = ? WHERE id = ?").run(on ? 1 : 0, id);
  }

  setAccessToken(id: string, token: string | null): void {
    this.db.prepare("UPDATE devices SET access_token = ? WHERE id = ?").run(token || null, id);
  }

  assign(
    id: string,
    patch: { profile_id?: string | null; schedule_id?: string | null; group_id?: string | null; position?: number; mirror_of?: string | null },
  ): void {
    if ("profile_id" in patch) {
      this.db.prepare("UPDATE devices SET profile_id = ? WHERE id = ?").run(patch.profile_id ?? null, id);
    }
    if ("mirror_of" in patch) {
      this.db.prepare("UPDATE devices SET mirror_of = ? WHERE id = ?").run(patch.mirror_of || null, id);
    }
    if ("schedule_id" in patch) {
      this.db.prepare("UPDATE devices SET schedule_id = ? WHERE id = ?").run(patch.schedule_id ?? null, id);
    }
    if ("group_id" in patch) {
      this.db.prepare("UPDATE devices SET group_id = ? WHERE id = ?").run(patch.group_id ?? null, id);
    }
    if (typeof patch.position === "number") {
      this.db.prepare("UPDATE devices SET position = ? WHERE id = ?").run(patch.position, id);
    }
  }

  setRotateEvery(id: string, minutes: number): void {
    this.db.prepare("UPDATE devices SET rotate_every_min = ? WHERE id = ?").run(minutes, id);
  }

  setPreset(id: string, preset: string): void {
    this.db.prepare("UPDATE devices SET preset = ? WHERE id = ?").run(preset, id);
  }

  /** Force the next image fetch to advance to a new asset (zero the rotation clock). */
  forceRotateDue(id: string): void {
    this.db.prepare("UPDATE devices SET last_rotation_at = 0 WHERE id = ?").run(id);
  }

  /** Stage a pre-created "next" image (does not change the current image or touch the frame). */
  setNextAsset(id: string, assetId: string): void {
    this.db.prepare("UPDATE devices SET next_asset_id = ? WHERE id = ?").run(assetId, id);
  }

  /** Promote the staged next image to current (so the frame's next fetch serves it). No-op if none staged. */
  promoteNextAsset(id: string): void {
    this.db
      .prepare(
        `UPDATE devices SET last_asset_id = next_asset_id, last_etag = NULL, last_rotation_at = ?, next_asset_id = NULL
         WHERE id = ? AND next_asset_id IS NOT NULL`,
      )
      .run(Date.now(), id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM devices WHERE id = ?").run(id);
  }

  /**
   * Record battery/firmware read from a frame while it was awake (e.g. pulled from its
   * /api/battery on an image fetch, or pushed via /api/telemetry). Stamps last_telemetry_at
   * so the UI can show when these settings were last retrieved.
   */
  recordTelemetry(id: string, info: { batteryPct?: number; batteryMv?: number; firmware?: string }): void {
    this.db
      .prepare(
        `UPDATE devices SET
           battery_pct = COALESCE(?, battery_pct),
           battery_mv = COALESCE(?, battery_mv),
           firmware = COALESCE(?, firmware),
           last_telemetry_at = ?
         WHERE id = ?`,
      )
      .run(info.batteryPct ?? null, info.batteryMv ?? null, info.firmware ?? null, Date.now(), id);
  }

  /** Mark the frame as just heard-from (e.g. a successful manual ping). Drives "online" + last seen. */
  markSeen(id: string): void {
    this.db.prepare("UPDATE devices SET last_seen = ?, last_ping_failed_at = NULL WHERE id = ?").run(Date.now(), id);
  }

  /** Record a manual ping that got no reply — forces the device offline until it's next heard from. */
  markPingFailed(id: string): void {
    this.db.prepare("UPDATE devices SET last_ping_failed_at = ? WHERE id = ?").run(Date.now(), id);
  }

  /** Record a fetch from a frame, auto-registering an unknown device id. */
  recordFetch(id: string, info: FetchInfo): void {
    const existing = this.get(id);
    if (!existing) {
      this.db
        .prepare("INSERT INTO devices (id, name, created_at) VALUES (?, ?, ?)")
        .run(id, defaultName(id), Date.now());
    }
    this.db
      .prepare(
        `UPDATE devices SET
           width = COALESCE(?, width),
           height = COALESCE(?, height),
           orientation = COALESCE(?, orientation),
           firmware = COALESCE(?, firmware),
           battery_pct = COALESCE(?, battery_pct),
           last_asset_id = COALESCE(?, last_asset_id),
           last_etag = COALESCE(?, last_etag),
           last_rotation_at = COALESCE(?, last_rotation_at),
           last_seen = ?
         WHERE id = ?`,
      )
      .run(
        info.width ?? null,
        info.height ?? null,
        info.orientation ?? null,
        info.firmware ?? null,
        info.batteryPct ?? null,
        info.assetId ?? null,
        info.etag ?? null,
        info.rotatedAt ?? null,
        Date.now(),
        id,
      );
  }
}

function defaultName(id: string): string {
  return id === "default" ? "Default frame" : `Frame ${id}`;
}
