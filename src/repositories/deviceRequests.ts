import type { DB } from "../db.js";

// A raw record of every hit to the device image endpoint (/d/:id, /image) — so there's an audit
// trail of when each frame actually checked in, what it got, and its reported battery/firmware.
// Unlike usage_events ("show"/"battery" semantic events) this captures EVERY request, incl. 304s.

const MAX_ROWS = 5000; // ring buffer — frames fetch ~hourly so this is weeks of history

export interface DeviceRequest {
  id: number;
  device_id: string | null;
  created_at: number;
  ip: string | null;
  path: string | null;
  status: number | null;
  format: string | null; // epdgz | png
  asset_id: string | null;
  not_modified: number; // 1 if served 304
  firmware: string | null; // null = not a frame (e.g. browser preview)
  battery_pct: number | null;
  battery_mv: number | null; // battery voltage (mV) reported on this request
  user_agent: string | null;
  raw: string | null; // raw request line + headers as received
}

export interface DeviceRequestInput {
  deviceId: string | null;
  ip?: string | null;
  path?: string | null;
  status?: number | null;
  format?: string | null;
  assetId?: string | null;
  notModified?: boolean;
  firmware?: string | null;
  batteryPct?: number | null;
  batteryMv?: number | null;
  userAgent?: string | null;
  raw?: string | null;
}

export class DeviceRequestRepo {
  constructor(private readonly db: DB) {}

  log(e: DeviceRequestInput): void {
    this.db
      .prepare(
        `INSERT INTO device_requests
           (device_id, created_at, ip, path, status, format, asset_id, not_modified, firmware, battery_pct, battery_mv, user_agent, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.deviceId,
        Date.now(),
        e.ip ?? null,
        e.path ?? null,
        e.status ?? null,
        e.format ?? null,
        e.assetId ?? null,
        e.notModified ? 1 : 0,
        e.firmware ?? null,
        e.batteryPct ?? null,
        e.batteryMv ?? null,
        e.userAgent ?? null,
        e.raw ?? null,
      );
    // Trim to a ring buffer so the log can't grow unbounded.
    this.db
      .prepare("DELETE FROM device_requests WHERE id <= (SELECT MAX(id) FROM device_requests) - ?")
      .run(MAX_ROWS);
  }

  recent(limit = 200, deviceId?: string): DeviceRequest[] {
    const params: Array<string | number> = [];
    let clause = "";
    if (deviceId) {
      clause = "WHERE device_id = ?";
      params.push(deviceId);
    }
    params.push(limit);
    return this.db
      .prepare(`SELECT * FROM device_requests ${clause} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as DeviceRequest[];
  }
}
