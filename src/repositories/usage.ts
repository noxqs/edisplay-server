import type { DB } from "../db.js";

export type UsageType = "show" | "error" | "battery" | "genai";

export interface UsageEvent {
  id: number;
  device_id: string | null;
  type: UsageType;
  asset_id: string | null;
  message: string | null;
  battery_pct: number | null;
  created_at: number;
  // GenAI cost rows (type === "genai"); null on other event types.
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

export interface LogInput {
  deviceId: string | null;
  type: UsageType;
  assetId?: string | null;
  message?: string | null;
  batteryPct?: number | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
}

export interface GenaiCost {
  totalUsd: number;
  byProvider: Array<{ provider: string; costUsd: number; calls: number }>;
  byModel: Array<{ model: string; costUsd: number; calls: number }>;
}

export class UsageRepo {
  constructor(private readonly db: DB) {}

  log(e: LogInput): void {
    this.db
      .prepare(
        "INSERT INTO usage_events (device_id, type, asset_id, message, battery_pct, provider, model, input_tokens, output_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        e.deviceId,
        e.type,
        e.assetId ?? null,
        e.message ?? null,
        e.batteryPct ?? null,
        e.provider ?? null,
        e.model ?? null,
        e.inputTokens ?? null,
        e.outputTokens ?? null,
        e.costUsd ?? null,
        Date.now(),
      );
  }

  recent(limit = 100, deviceId?: string, type?: UsageType): UsageEvent[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (deviceId) {
      where.push("device_id = ?");
      params.push(deviceId);
    }
    if (type) {
      where.push("type = ?");
      params.push(type);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit);
    return this.db
      .prepare(`SELECT * FROM usage_events ${clause} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as UsageEvent[];
  }

  /** Total 'show' events per device id. */
  showCountsByDevice(): Record<string, number> {
    const rows = this.db
      .prepare("SELECT device_id AS id, COUNT(*) AS n FROM usage_events WHERE type = 'show' GROUP BY device_id")
      .all() as Array<{ id: string | null; n: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) if (r.id) out[r.id] = r.n;
    return out;
  }

  countSince(type: UsageType, sinceMs: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM usage_events WHERE type = ? AND created_at >= ?")
      .get(type, sinceMs) as { n: number };
    return row.n;
  }

  /** Battery readings for a device since a timestamp (for the chart). */
  batterySeries(deviceId: string, sinceMs: number): Array<{ t: number; battery: number }> {
    return this.db
      .prepare(
        "SELECT created_at AS t, battery_pct AS battery FROM usage_events WHERE device_id = ? AND battery_pct IS NOT NULL AND created_at >= ? ORDER BY created_at",
      )
      .all(deviceId, sinceMs) as Array<{ t: number; battery: number }>;
  }

  /** Aggregate GenAI spend since a timestamp: total + per-provider + per-model. */
  genaiCostSince(sinceMs: number): GenaiCost {
    const total = this.db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM usage_events WHERE type = 'genai' AND created_at >= ?")
      .get(sinceMs) as { c: number };
    const byProvider = this.db
      .prepare(
        "SELECT COALESCE(provider, 'unknown') AS provider, COALESCE(SUM(cost_usd), 0) AS costUsd, COUNT(*) AS calls FROM usage_events WHERE type = 'genai' AND created_at >= ? GROUP BY provider ORDER BY costUsd DESC",
      )
      .all(sinceMs) as Array<{ provider: string; costUsd: number; calls: number }>;
    const byModel = this.db
      .prepare(
        "SELECT COALESCE(model, 'unknown') AS model, COALESCE(SUM(cost_usd), 0) AS costUsd, COUNT(*) AS calls FROM usage_events WHERE type = 'genai' AND created_at >= ? GROUP BY model ORDER BY costUsd DESC",
      )
      .all(sinceMs) as Array<{ model: string; costUsd: number; calls: number }>;
    return { totalUsd: total.c, byProvider, byModel };
  }

  /** Daily GenAI cost points since a timestamp (for the chart), UTC day buckets. */
  genaiCostSeries(sinceMs: number): Array<{ t: number; cost: number }> {
    const rows = this.db
      .prepare(
        `SELECT CAST(created_at / 86400000 AS INTEGER) * 86400000 AS t, COALESCE(SUM(cost_usd), 0) AS cost
         FROM usage_events WHERE type = 'genai' AND created_at >= ? GROUP BY t ORDER BY t`,
      )
      .all(sinceMs) as Array<{ t: number; cost: number }>;
    return rows;
  }
}
