import type { DB } from "../db.js";

/** Globally ignored assets — never selected for any frame. */
export class IgnoredRepo {
  constructor(private readonly db: DB) {}

  ids(): string[] {
    return (this.db.prepare("SELECT asset_id FROM ignored_assets").all() as Array<{ asset_id: string }>).map((r) => r.asset_id);
  }

  set(): Set<string> {
    return new Set(this.ids());
  }

  add(assetId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO ignored_assets (asset_id, created_at) VALUES (?, ?)")
      .run(assetId, Date.now());
  }

  remove(assetId: string): void {
    this.db.prepare("DELETE FROM ignored_assets WHERE asset_id = ?").run(assetId);
  }
}
