import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";

export type SourceType = "immich" | "telegram" | "ai";

export interface LocalAlbumSource {
  id: string;
  type: SourceType;
  ref: string;
}

export interface LocalAlbum {
  id: string;
  name: string;
  createdAt: number;
  sources: LocalAlbumSource[];
}

interface SourceRow {
  id: string;
  local_album_id: string;
  type: SourceType;
  ref: string;
}

export class LocalAlbumRepo {
  constructor(private readonly db: DB) {}

  list(): LocalAlbum[] {
    const albums = this.db.prepare("SELECT * FROM local_albums ORDER BY created_at").all() as Array<{
      id: string;
      name: string;
      created_at: number;
    }>;
    return albums.map((a) => ({ id: a.id, name: a.name, createdAt: a.created_at, sources: this.sources(a.id) }));
  }

  get(id: string): LocalAlbum | undefined {
    const a = this.db.prepare("SELECT * FROM local_albums WHERE id = ?").get(id) as
      | { id: string; name: string; created_at: number }
      | undefined;
    return a ? { id: a.id, name: a.name, createdAt: a.created_at, sources: this.sources(a.id) } : undefined;
  }

  private sources(localAlbumId: string): LocalAlbumSource[] {
    return (this.db.prepare("SELECT * FROM local_album_sources WHERE local_album_id = ?").all(localAlbumId) as SourceRow[]).map(
      (s) => ({ id: s.id, type: s.type, ref: s.ref }),
    );
  }

  create(name: string): LocalAlbum {
    const id = randomUUID().slice(0, 8);
    this.db.prepare("INSERT INTO local_albums (id, name, created_at) VALUES (?, ?, ?)").run(id, name, Date.now());
    return this.get(id)!;
  }

  rename(id: string, name: string): void {
    this.db.prepare("UPDATE local_albums SET name = ? WHERE id = ?").run(name, id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM local_albums WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM local_album_sources WHERE local_album_id = ?").run(id);
  }

  /** Replace all sources of a local album. */
  setSources(id: string, sources: Array<{ type: SourceType; ref: string }>): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM local_album_sources WHERE local_album_id = ?").run(id);
      const ins = this.db.prepare("INSERT INTO local_album_sources (id, local_album_id, type, ref) VALUES (?, ?, ?, ?)");
      for (const s of sources) ins.run(randomUUID().slice(0, 8), id, s.type, s.ref);
    });
    tx();
  }

  /** Union of Immich album ids referenced by the given local albums. */
  immichAlbumIds(localAlbumIds: string[]): string[] {
    if (localAlbumIds.length === 0) return [];
    const out = new Set<string>();
    for (const lid of localAlbumIds) {
      for (const s of this.sources(lid)) {
        if (s.type === "immich") out.add(s.ref);
      }
    }
    return [...out];
  }
}
