// Minimal Immich REST client. Auth via the `x-api-key` header.
// Docs: https://api.immich.app/
import type { Config } from "./config.js";

interface ImmichAsset {
  id: string;
  type: "IMAGE" | "VIDEO" | string;
  originalMimeType?: string;
}

/** MIME types node-canvas can decode directly; anything else we route via Immich's preview JPEG. */
const WEB_DECODABLE = /^image\/(jpeg|png|webp|gif)$/i;

interface ImmichAlbum {
  id: string;
  albumName: string;
  assets: ImmichAsset[];
}

export interface AlbumSummary {
  id: string;
  albumName: string;
  assetCount: number;
  albumThumbnailAssetId: string | null;
}

export interface ImmichStatus {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface BinaryResponse {
  buffer: Buffer;
  contentType: string;
}

/** Filters that map onto Immich's metadata/random search (all optional, AND-combined). */
export interface SearchFilter {
  albumIds?: string[];
  personIds?: string[];
  city?: string;
  country?: string;
  state?: string;
  takenAfter?: string; // ISO timestamp
  takenBefore?: string;
  isFavorite?: boolean;
}

function buildSearchBody(f: SearchFilter): Record<string, unknown> {
  const b: Record<string, unknown> = { type: "IMAGE" };
  if (f.albumIds?.length) b.albumIds = f.albumIds;
  if (f.personIds?.length) b.personIds = f.personIds;
  if (f.city) b.city = f.city;
  if (f.country) b.country = f.country;
  if (f.state) b.state = f.state;
  if (f.takenAfter) b.takenAfter = f.takenAfter;
  if (f.takenBefore) b.takenBefore = f.takenBefore;
  if (f.isFavorite) b.isFavorite = true;
  return b;
}

export class ImmichClient {
  private baseUrl = "";
  private api = "/api";
  private apiKey = "";
  private markerCache: { at: number; markers: Array<{ id: string; lat: number; lng: number }> } | null = null;
  private albumIdCache: { at: number; ids: Set<string> } | null = null;

  constructor(cfg?: Pick<Config, "immichBaseUrl" | "immichApiKey">) {
    if (cfg) this.configure(cfg.immichBaseUrl, cfg.immichApiKey);
  }

  /** Point the client at a (new) Immich server. Safe to call at runtime; existing
   * references keep working since the same instance is mutated in place. */
  configure(baseUrl: string, apiKey: string): void {
    this.baseUrl = (baseUrl ?? "").trim().replace(/\/+$/, "");
    this.api = `${this.baseUrl}/api`;
    this.apiKey = (apiKey ?? "").trim();
    this.markerCache = null; // creds changed → drop cached markers
    this.albumIdCache = null;
  }

  /** Current Immich origin (without /api, no trailing slash). */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  hasApiKey(): boolean {
    return this.apiKey !== "";
  }

  /** Both a base URL and an API key are set. */
  isConfigured(): boolean {
    return this.baseUrl !== "" && this.apiKey !== "";
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { "x-api-key": this.apiKey, Accept: "application/json", ...extra };
  }

  /** Collect deduplicated IMAGE asset ids across the given albums. A stale/invalid album
   * id (e.g. one deleted in Immich but still referenced locally) is skipped, not fatal. */
  async listAlbumImageAssetIds(albumIds: string[]): Promise<string[]> {
    const ids = new Set<string>();
    for (const albumId of albumIds) {
      try {
        const res = await fetch(`${this.api}/albums/${albumId}`, { headers: this.headers() });
        if (!res.ok) {
          console.warn(`[immich] skipping album ${albumId}: ${res.status} ${res.statusText}`);
          continue;
        }
        const album = (await res.json()) as ImmichAlbum;
        for (const asset of album.assets ?? []) {
          if (asset.type === "IMAGE") ids.add(asset.id);
        }
      } catch (err) {
        console.warn(`[immich] skipping album ${albumId}: ${(err as Error).message}`);
      }
    }
    return [...ids];
  }

  /** Download the original (full-resolution) image bytes for an asset. */
  async downloadOriginal(assetId: string): Promise<BinaryResponse> {
    const res = await fetch(`${this.api}/assets/${assetId}/original`, {
      headers: this.headers({ Accept: "application/octet-stream" }),
    });
    if (!res.ok) {
      throw new Error(`Immich download original ${assetId} failed: ${res.status} ${res.statusText}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }

  /** Fetch a single asset's metadata. */
  async getAssetInfo(assetId: string): Promise<ImmichAsset> {
    const res = await fetch(`${this.api}/assets/${assetId}`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Immich GET /assets/${assetId} failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as ImmichAsset;
  }

  /** When/where a photo was taken (from EXIF) — for the photo date/location overlays. */
  async getAssetMeta(assetId: string): Promise<{ takenAt: string | null; place: string | null }> {
    try {
      const res = await fetch(`${this.api}/assets/${assetId}`, { headers: this.headers() });
      if (!res.ok) return { takenAt: null, place: null };
      const a = (await res.json()) as {
        localDateTime?: string;
        fileCreatedAt?: string;
        exifInfo?: { dateTimeOriginal?: string | null; city?: string | null; state?: string | null; country?: string | null };
      };
      const takenAt = a.exifInfo?.dateTimeOriginal || a.localDateTime || a.fileCreatedAt || null;
      const place = [a.exifInfo?.city, a.exifInfo?.country].filter(Boolean).join(", ") || null;
      return { takenAt, place };
    } catch {
      return { takenAt: null, place: null };
    }
  }

  /**
   * Download the best bytes for conversion: the full original when node-canvas can
   * decode it, otherwise Immich's high-res preview JPEG (covers HEIC/RAW/TIFF/etc).
   */
  async downloadConvertible(assetId: string): Promise<BinaryResponse> {
    const info = await this.getAssetInfo(assetId);
    const mime = info.originalMimeType ?? "";
    if (WEB_DECODABLE.test(mime)) {
      return this.downloadOriginal(assetId);
    }
    return this.getThumbnail(assetId, "preview");
  }

  /** Fetch a server-generated thumbnail (size: "thumbnail" small, "preview" larger). */
  async getThumbnail(assetId: string, size: "thumbnail" | "preview" = "preview"): Promise<BinaryResponse> {
    const res = await fetch(`${this.api}/assets/${assetId}/thumbnail?size=${size}`, {
      headers: this.headers({ Accept: "application/octet-stream" }),
    });
    if (!res.ok) {
      throw new Error(`Immich thumbnail ${assetId} failed: ${res.status} ${res.statusText}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType: res.headers.get("content-type") ?? "image/jpeg" };
  }

  /** List all albums visible to the API key (name + asset count + thumbnail). */
  async listAlbums(): Promise<AlbumSummary[]> {
    const res = await fetch(`${this.api}/albums`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Immich GET /albums failed: ${res.status} ${res.statusText}`);
    }
    const albums = (await res.json()) as Array<{
      id: string;
      albumName: string;
      assetCount?: number;
      albumThumbnailAssetId?: string | null;
    }>;
    return albums.map((a) => ({
      id: a.id,
      albumName: a.albumName,
      assetCount: a.assetCount ?? 0,
      albumThumbnailAssetId: a.albumThumbnailAssetId ?? null,
    }));
  }

  /**
   * Library-wide GPS markers (id + coordinates) for every geotagged asset. Immich's
   * search/metadata does NOT return GPS in exifInfo, so this is the source of truth for
   * coordinates; callers intersect it with album/filter results. Cached briefly since
   * it's a single large response shared across profiles.
   */
  async mapMarkers(): Promise<Array<{ id: string; lat: number; lng: number }>> {
    const TTL = 5 * 60 * 1000;
    if (this.markerCache && Date.now() - this.markerCache.at < TTL) return this.markerCache.markers;
    const res = await fetch(`${this.api}/map/markers`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Immich GET /map/markers failed: ${res.status} ${res.statusText}`);
    const raw = (await res.json()) as Array<{ id: string; lat?: number | null; lon?: number | null }>;
    const markers = raw
      .filter((m) => typeof m.lat === "number" && typeof m.lon === "number")
      .map((m) => ({ id: m.id, lat: m.lat as number, lng: m.lon as number }));
    this.markerCache = { at: Date.now(), markers };
    return markers;
  }

  /**
   * Set of album ids that actually exist (cached). Immich's search/metadata silently
   * returns ZERO results if any album id in the query is stale, so callers must filter
   * profile album ids against this before searching.
   */
  async albumIdSet(): Promise<Set<string>> {
    const TTL = 5 * 60 * 1000;
    if (this.albumIdCache && Date.now() - this.albumIdCache.at < TTL) return this.albumIdCache.ids;
    const albums = await this.listAlbums();
    const ids = new Set(albums.map((a) => a.id));
    this.albumIdCache = { at: Date.now(), ids };
    return ids;
  }

  /** List named people (faces) for the profile/birthday person-picker. */
  async listPeople(): Promise<Array<{ id: string; name: string; birthDate: string | null }>> {
    const res = await fetch(`${this.api}/people?withHidden=false`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Immich GET /people failed: ${res.status}`);
    const body = (await res.json()) as { people: Array<{ id: string; name: string; birthDate: string | null }> };
    return (body.people ?? []).filter((p) => p.name).map((p) => ({ id: p.id, name: p.name, birthDate: p.birthDate ?? null }));
  }

  async getPersonThumbnail(personId: string): Promise<BinaryResponse> {
    const res = await fetch(`${this.api}/people/${personId}/thumbnail`, {
      headers: this.headers({ Accept: "application/octet-stream" }),
    });
    if (!res.ok) throw new Error(`Immich person thumbnail failed: ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "image/jpeg" };
  }

  /** Random image asset ids matching the filter (Immich does the randomisation). */
  async searchRandom(filter: SearchFilter, size = 1): Promise<string[]> {
    const res = await fetch(`${this.api}/search/random`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...buildSearchBody(filter), size }),
    });
    if (!res.ok) throw new Error(`Immich /search/random failed: ${res.status}`);
    const assets = (await res.json()) as Array<{ id: string }>;
    return assets.map((a) => a.id);
  }

  /** One page of matching image asset ids (order: desc=newest first) + the total count. */
  async searchMetadata(
    filter: SearchFilter,
    page = 1,
    size = 100,
    order: "asc" | "desc" = "desc",
  ): Promise<{ ids: string[]; total: number; nextPage: number | null }> {
    const res = await fetch(`${this.api}/search/metadata`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...buildSearchBody(filter), page, size, order }),
    });
    if (!res.ok) throw new Error(`Immich /search/metadata failed: ${res.status}`);
    const body = (await res.json()) as {
      assets: { items: Array<{ id: string }>; total: number; nextPage: string | number | null };
    };
    const a = body.assets;
    return { ids: a.items.map((x) => x.id), total: a.total, nextPage: a.nextPage != null ? Number(a.nextPage) : null };
  }

  /** Count of image assets matching the filter (for "photos available"). */
  async countMatching(filter: SearchFilter): Promise<number> {
    const res = await fetch(`${this.api}/search/statistics`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(buildSearchBody(filter)),
    });
    if (!res.ok) throw new Error(`Immich /search/statistics failed: ${res.status}`);
    return ((await res.json()) as { total: number }).total;
  }

  /** Create a new (empty) Immich album. */
  async createAlbum(name: string): Promise<{ id: string; albumName: string }> {
    const res = await fetch(`${this.api}/albums`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ albumName: name }),
    });
    if (!res.ok) throw new Error(`Immich create album failed: ${res.status}`);
    return (await res.json()) as { id: string; albumName: string };
  }

  /** Upload an image into Immich. Returns the new asset id (or the existing one if a duplicate). */
  async uploadAsset(
    data: Buffer,
    filename: string,
    mime: string,
    createdAt = new Date().toISOString(),
  ): Promise<{ id: string; status: string }> {
    const form = new FormData();
    form.append("assetData", new Blob([new Uint8Array(data)], { type: mime }), filename);
    form.append("deviceAssetId", `telegram-${filename}-${createdAt}`);
    form.append("deviceId", "photoframe-telegram");
    form.append("fileCreatedAt", createdAt);
    form.append("fileModifiedAt", createdAt);
    form.append("filename", filename);
    const res = await fetch(`${this.api}/assets`, {
      method: "POST",
      headers: { "x-api-key": this.apiKey, Accept: "application/json" }, // no Content-Type: fetch sets the multipart boundary
      body: form,
    });
    if (!res.ok) throw new Error(`Immich upload failed: ${res.status} ${await res.text().catch(() => "")}`);
    return (await res.json()) as { id: string; status: string };
  }

  /** Add assets to an album. */
  async addToAlbum(albumId: string, assetIds: string[]): Promise<void> {
    const res = await fetch(`${this.api}/albums/${albumId}/assets`, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ids: assetIds }),
    });
    if (!res.ok) throw new Error(`Immich add-to-album failed: ${res.status}`);
  }

  /** Connectivity + auth check: verifies the API key is accepted, returns server version. */
  async status(): Promise<ImmichStatus> {
    if (!this.isConfigured()) {
      return { ok: false, error: "Immich URL and API key not set" };
    }
    try {
      const ping = await fetch(`${this.api}/server/ping`, { headers: this.headers() });
      if (!ping.ok) return { ok: false, error: `ping ${ping.status} ${ping.statusText}` };
      // /server/about requires a valid API key, so it doubles as an auth check.
      const about = await fetch(`${this.api}/server/about`, { headers: this.headers() });
      if (about.status === 401 || about.status === 403) {
        return { ok: false, error: "API key rejected (401/403)" };
      }
      let version: string | undefined;
      if (about.ok) {
        version = ((await about.json()) as { version?: string }).version;
      }
      return { ok: true, version };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Lightweight connectivity check used by /healthz. */
  async ping(): Promise<boolean> {
    const res = await fetch(`${this.api}/server/ping`, { headers: this.headers() });
    return res.ok;
  }
}
