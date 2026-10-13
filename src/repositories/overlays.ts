import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";

export type OverlayType = "battery" | "next_photo" | "weather" | "todos" | "birthdays" | "photo_date" | "photo_place" | "local_time";
export type OverlayPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export const OVERLAY_TYPES: OverlayType[] = ["battery", "next_photo", "weather", "todos", "birthdays", "photo_date", "photo_place", "local_time"];

export interface Overlay {
  type: OverlayType;
  enabled: boolean;
  position: OverlayPosition;
  scale: number;
  config: Record<string, unknown>;
}

export interface OverlayItem {
  id: string;
  kind: "todo" | "birthday";
  text: string;
  date: string | null;
  done: boolean;
  ref: string | null; // birthday → Immich person id
  created_at: number;
}

interface OverlayRow {
  type: OverlayType;
  enabled: number;
  position: OverlayPosition;
  scale: number;
  config: string;
}

const DEFAULT_POSITION: Record<OverlayType, OverlayPosition> = {
  battery: "top-right",
  next_photo: "bottom-right",
  weather: "top-left",
  todos: "bottom-left",
  birthdays: "bottom-left",
  photo_date: "bottom-right",
  photo_place: "bottom-right",
  local_time: "top-left",
};

export interface OverlayConfig {
  id: string;
  name: string;
  overlays: Overlay[];
  created_at: number;
}

export class OverlayRepo {
  constructor(private readonly db: DB) {
    this.ensureDefaults();
    this.migrateGlobalToConfig();
  }

  private ensureDefaults(): void {
    const ins = this.db.prepare(
      "INSERT OR IGNORE INTO overlays (type, enabled, position, scale, config) VALUES (?, 0, ?, 1, '{}')",
    );
    for (const t of OVERLAY_TYPES) ins.run(t, DEFAULT_POSITION[t]);
  }

  // One-time: if no named configs exist yet, fold the legacy global overlay set into a "My overlays"
  // config so existing settings aren't lost when overlays became profile-scoped.
  private migrateGlobalToConfig(): void {
    const count = (this.db.prepare("SELECT COUNT(*) n FROM overlay_configs").get() as { n: number }).n;
    if (count > 0) return;
    const global = this.list();
    if (!global.some((o) => o.enabled)) return; // nothing worth migrating
    this.db
      .prepare("INSERT INTO overlay_configs (id, name, overlays, created_at) VALUES (?, ?, ?, ?)")
      .run(randomUUID().slice(0, 8), "My overlays", JSON.stringify(global), Date.now());
  }

  // --- named overlay configs ---
  /** Full overlay set for a config id, with every type present (disabled ones included). */
  private withAllTypes(stored: Overlay[]): Overlay[] {
    const byType = new Map(stored.map((o) => [o.type, o]));
    return OVERLAY_TYPES.map(
      (t) => byType.get(t) ?? { type: t, enabled: false, position: DEFAULT_POSITION[t], scale: 1, config: {} },
    );
  }

  listConfigs(): Array<{ id: string; name: string }> {
    return this.db.prepare("SELECT id, name FROM overlay_configs ORDER BY created_at").all() as Array<{
      id: string;
      name: string;
    }>;
  }

  getConfig(id: string): OverlayConfig | undefined {
    const r = this.db.prepare("SELECT * FROM overlay_configs WHERE id = ?").get(id) as
      | { id: string; name: string; overlays: string; created_at: number }
      | undefined;
    if (!r) return undefined;
    let parsed: Overlay[] = [];
    try {
      parsed = JSON.parse(r.overlays) as Overlay[];
    } catch {
      parsed = [];
    }
    return { id: r.id, name: r.name, created_at: r.created_at, overlays: this.withAllTypes(parsed) };
  }

  createConfig(name: string): OverlayConfig {
    const id = randomUUID().slice(0, 8);
    this.db
      .prepare("INSERT INTO overlay_configs (id, name, overlays, created_at) VALUES (?, ?, '[]', ?)")
      .run(id, name.trim() || "Overlays", Date.now());
    return this.getConfig(id)!;
  }

  renameConfig(id: string, name: string): void {
    this.db.prepare("UPDATE overlay_configs SET name = ? WHERE id = ?").run(name.trim(), id);
  }

  deleteConfig(id: string): void {
    this.db.prepare("DELETE FROM overlay_configs WHERE id = ?").run(id);
  }

  updateConfigOverlay(id: string, type: OverlayType, patch: Partial<Omit<Overlay, "type">>): OverlayConfig | undefined {
    const cfg = this.getConfig(id);
    if (!cfg) return undefined;
    const overlays = cfg.overlays.map((o) =>
      o.type === type
        ? {
            ...o,
            enabled: patch.enabled ?? o.enabled,
            position: patch.position ?? o.position,
            scale: patch.scale ?? o.scale,
            config: patch.config ?? o.config,
          }
        : o,
    );
    this.db.prepare("UPDATE overlay_configs SET overlays = ? WHERE id = ?").run(JSON.stringify(overlays), id);
    return this.getConfig(id);
  }

  /** Enabled overlays for a config id; empty when id is null/unknown (no overlays). */
  enabledFor(id: string | null | undefined): Overlay[] {
    if (!id) return [];
    return this.getConfig(id)?.overlays.filter((o) => o.enabled) ?? [];
  }

  list(): Overlay[] {
    return (this.db.prepare("SELECT * FROM overlays").all() as OverlayRow[])
      .map(toOverlay)
      .sort((a, b) => OVERLAY_TYPES.indexOf(a.type) - OVERLAY_TYPES.indexOf(b.type));
  }

  get(type: OverlayType): Overlay | undefined {
    const r = this.db.prepare("SELECT * FROM overlays WHERE type = ?").get(type) as OverlayRow | undefined;
    return r ? toOverlay(r) : undefined;
  }

  enabled(): Overlay[] {
    return this.list().filter((o) => o.enabled);
  }

  update(type: OverlayType, patch: Partial<Omit<Overlay, "type">>): Overlay | undefined {
    const cur = this.get(type);
    if (!cur) return undefined;
    this.db
      .prepare("UPDATE overlays SET enabled = ?, position = ?, scale = ?, config = ? WHERE type = ?")
      .run(
        (patch.enabled ?? cur.enabled) ? 1 : 0,
        patch.position ?? cur.position,
        patch.scale ?? cur.scale,
        JSON.stringify(patch.config ?? cur.config),
        type,
      );
    return this.get(type);
  }

  // --- items (todos & birthdays) ---
  items(kind: "todo" | "birthday"): OverlayItem[] {
    return (this.db.prepare("SELECT * FROM overlay_items WHERE kind = ? ORDER BY created_at").all(kind) as Array<{
      id: string;
      kind: "todo" | "birthday";
      text: string;
      date: string | null;
      done: number;
      ref: string | null;
      created_at: number;
    }>).map((r) => ({ ...r, done: !!r.done }));
  }

  addItem(kind: "todo" | "birthday", text: string, date: string | null, ref: string | null = null): OverlayItem {
    const id = randomUUID().slice(0, 8);
    this.db
      .prepare("INSERT INTO overlay_items (id, kind, text, date, done, ref, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .run(id, kind, text, date, ref, Date.now());
    return this.items(kind).find((i) => i.id === id)!;
  }

  updateItem(id: string, patch: { text?: string; date?: string | null; done?: boolean; ref?: string | null }): void {
    const cur = this.db.prepare("SELECT * FROM overlay_items WHERE id = ?").get(id) as
      | { text: string; date: string | null; done: number; ref: string | null }
      | undefined;
    if (!cur) return;
    this.db
      .prepare("UPDATE overlay_items SET text = ?, date = ?, done = ?, ref = ? WHERE id = ?")
      .run(
        patch.text ?? cur.text,
        patch.date !== undefined ? patch.date : cur.date,
        (patch.done ?? !!cur.done) ? 1 : 0,
        patch.ref !== undefined ? patch.ref : cur.ref,
        id,
      );
  }

  removeItem(id: string): void {
    this.db.prepare("DELETE FROM overlay_items WHERE id = ?").run(id);
  }
}

function toOverlay(r: OverlayRow): Overlay {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(r.config);
  } catch {
    config = {};
  }
  return { type: r.type, enabled: !!r.enabled, position: r.position, scale: r.scale, config };
}
