import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";

export type ProfileMode = "album" | "interest" | "generation";
export type PickStrategy = "random" | "sequence" | "shuffle";
export type DateMode = "none" | "on_this_day" | "years_ago" | "range";

/** A drawn region: one or more freeform polygons, each a ring of [lat, lng] points. */
export interface GeoLocationFilter {
  polygons: Array<Array<[number, number]>>;
}

/** Per-filter on/off so a filter can stay configured but ignored. A missing flag = on. */
export interface FilterToggles {
  people?: boolean;
  place?: boolean;
  date?: boolean;
  location?: boolean;
}

export interface ProfileLogic {
  people?: string[]; // Immich person ids; matched as OR (any of them)
  city?: string;
  country?: string;
  state?: string;
  date?: { mode: DateMode; years?: number; from?: string; to?: string };
  favorite?: boolean;
  /** Keep only photos whose GPS falls inside one of these polygons. Applied after
   * the Immich query (Immich has no geo search), so photos without GPS are dropped. */
  location?: GeoLocationFilter;
  enabled?: FilterToggles;
}

export interface Profile {
  id: string;
  name: string;
  mode: ProfileMode;
  albumIds: string[];
  localAlbumIds: string[];
  logic: ProfileLogic;
  pick: PickStrategy;
  favorRecent: boolean;
  preset: string;
  cropMode: string;
  interest: Record<string, unknown>;
  generationId: string | null;
  overlayConfigId: string | null;
  createdAt: number;
}

interface ProfileRow {
  id: string;
  name: string;
  mode: ProfileMode;
  album_ids: string;
  local_album_ids: string;
  logic: string;
  pick: PickStrategy;
  favor_recent: number;
  preset: string;
  crop_mode: string;
  interest: string;
  generation_id: string | null;
  overlay_config_id: string | null;
  created_at: number;
}

export interface ProfileInput {
  name: string;
  mode?: ProfileMode;
  albumIds?: string[];
  localAlbumIds?: string[];
  logic?: ProfileLogic;
  pick?: PickStrategy;
  favorRecent?: boolean;
  preset?: string;
  cropMode?: string;
  generationId?: string | null;
  overlayConfigId?: string | null;
}

function toDomain(r: ProfileRow): Profile {
  return {
    id: r.id,
    name: r.name,
    mode: r.mode,
    albumIds: safeParse<string[]>(r.album_ids, []),
    localAlbumIds: safeParse<string[]>(r.local_album_ids, []),
    logic: safeParse<ProfileLogic>(r.logic, {}),
    pick: r.pick ?? "random",
    favorRecent: !!r.favor_recent,
    preset: r.preset,
    cropMode: r.crop_mode,
    interest: safeParse<Record<string, unknown>>(r.interest, {}),
    generationId: r.generation_id,
    overlayConfigId: r.overlay_config_id,
    createdAt: r.created_at,
  };
}

export class ProfileRepo {
  constructor(private readonly db: DB) {}

  list(): Profile[] {
    return (this.db.prepare("SELECT * FROM profiles ORDER BY created_at").all() as ProfileRow[]).map(toDomain);
  }

  get(id: string): Profile | undefined {
    const r = this.db.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as ProfileRow | undefined;
    return r ? toDomain(r) : undefined;
  }

  create(input: ProfileInput): Profile {
    const id = randomUUID().slice(0, 8);
    this.db
      .prepare(
        `INSERT INTO profiles (id, name, mode, album_ids, local_album_ids, logic, pick, favor_recent, preset, crop_mode, generation_id, overlay_config_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.mode ?? "album",
        JSON.stringify(input.albumIds ?? []),
        JSON.stringify(input.localAlbumIds ?? []),
        JSON.stringify(input.logic ?? {}),
        input.pick ?? "random",
        input.favorRecent ? 1 : 0,
        input.preset ?? "balanced",
        input.cropMode ?? "cover",
        input.generationId ?? null,
        input.overlayConfigId ?? null,
        Date.now(),
      );
    return this.get(id)!;
  }

  update(id: string, patch: ProfileInput): Profile | undefined {
    const cur = this.get(id);
    if (!cur) return undefined;
    this.db
      .prepare(
        `UPDATE profiles SET name = ?, mode = ?, album_ids = ?, local_album_ids = ?, logic = ?, pick = ?,
           favor_recent = ?, preset = ?, crop_mode = ?, generation_id = ?, overlay_config_id = ? WHERE id = ?`,
      )
      .run(
        patch.name ?? cur.name,
        patch.mode ?? cur.mode,
        JSON.stringify(patch.albumIds ?? cur.albumIds),
        JSON.stringify(patch.localAlbumIds ?? cur.localAlbumIds),
        JSON.stringify(patch.logic ?? cur.logic),
        patch.pick ?? cur.pick,
        (patch.favorRecent ?? cur.favorRecent) ? 1 : 0,
        patch.preset ?? cur.preset,
        patch.cropMode ?? cur.cropMode,
        patch.generationId !== undefined ? patch.generationId : cur.generationId,
        patch.overlayConfigId !== undefined ? patch.overlayConfigId : cur.overlayConfigId,
        id,
      );
    return this.get(id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
  }
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
