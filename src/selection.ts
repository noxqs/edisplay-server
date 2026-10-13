// Profile-driven image selection over Immich. A profile resolves to a candidate pool
// (its local albums' Immich albums, filtered by people/location/date/favorites); the pool
// is iterated in shuffled order (random) or date order (sequence/FIFO), with peek support.
import type { ImmichClient, SearchFilter } from "./immich.js";
import type { ProfileRepo, Profile, ProfileLogic, FilterToggles } from "./repositories/profiles.js";
import type { ScheduleRepo } from "./repositories/schedules.js";
import type { LocalAlbumRepo } from "./repositories/localAlbums.js";
import type { IgnoredRepo } from "./repositories/ignored.js";
import type { AppSettingsRepo } from "./repositories/appSettings.js";
import type { SettingsStore } from "./settings.js";
import type { Device } from "./repositories/devices.js";

const MAX_POOL = 2000;
const PAGE = 250;
const MAX_PAGES_PER_RANGE = 8;
// Location filtering is a post-filter (Immich can't query geo), so it can be sparse —
// scan deeper before giving up on filling the pool.
const MAX_PAGES_LOCATION = 24;
const ON_THIS_DAY_YEARS = 15;
const DAY = 24 * 60 * 60 * 1000;

type PickStrategy = "random" | "sequence" | "shuffle";

interface PoolState {
  recency: string[]; // newest-first
  order: string[]; // iteration order (sequence = chronological, shuffle = shuffled)
  index: number;
  builtAt: number;
  pick: PickStrategy;
  favorRecent: boolean;
}

export class Selection {
  private pools = new Map<string, PoolState>();

  constructor(
    private readonly immich: ImmichClient,
    private readonly profiles: ProfileRepo,
    private readonly schedules: ScheduleRepo,
    private readonly localAlbums: LocalAlbumRepo,
    private readonly ignored: IgnoredRepo,
    private readonly appSettings: AppSettingsRepo,
    private readonly settings: SettingsStore,
    private readonly refreshMs: number,
  ) {}

  /** The profile a device should use right now: schedule cell → device default → none. */
  resolveProfile(device: Device, now = new Date()): Profile | null {
    if (device.schedule_id) {
      const { dow, hour } = zonedDowHour(now, this.appSettings.get<string>("timezone", ""));
      const pid = this.schedules.profileAt(device.schedule_id, dow, hour);
      if (pid) {
        const p = this.profiles.get(pid);
        if (p) return p;
      }
    }
    if (device.profile_id) {
      const p = this.profiles.get(device.profile_id);
      if (p) return p;
    }
    return null;
  }

  presetFor(profile: Profile | null, fallback: string): string {
    // Empty preset = "use the server default" (the profile's processing toggle is off).
    return profile?.preset || fallback;
  }

  /** Next asset id for the profile (advances the pool cursor). */
  async nextAsset(profile: Profile | null): Promise<string> {
    const pool = await this.poolFor(profile);
    if (pool.recency.length === 0) throw new Error("No images match this selection");
    if (pool.pick === "random") return pool.recency[this.randomIndex(pool)];
    // sequence / shuffle: iterate the order; shuffle reshuffles after a full pass
    if (pool.pick === "shuffle" && pool.index >= pool.order.length) {
      pool.order = pool.favorRecent ? weightedShuffle(pool.recency) : shuffled(pool.recency);
      pool.index = 0;
    }
    const id = pool.order[pool.index % pool.order.length];
    pool.index += 1;
    return id;
  }

  /** The id that nextAsset would return next, without advancing (for the next-photo overlay). */
  async peekNext(profile: Profile | null): Promise<string | null> {
    const pool = await this.poolFor(profile);
    if (pool.recency.length === 0) return null;
    if (pool.pick === "random") return pool.recency[this.randomIndex(pool)]; // random has no fixed "next"
    return pool.order[pool.index % pool.order.length];
  }

  private randomIndex(pool: PoolState): number {
    const n = pool.recency.length;
    // favorRecent biases toward index 0 (newest); pool.recency is newest-first.
    return pool.favorRecent ? Math.floor(n * Math.pow(Math.random(), 2)) : Math.floor(Math.random() * n);
  }

  /** Approximate count of images available to a profile (sums per-album, so assets in
   * multiple albums may be counted more than once). */
  async availableCount(profile: Profile | null): Promise<number> {
    try {
      const albumIds = this.albumIdsFor(profile);
      const cores = this.coreDateFilters(profile);
      let total = 0;
      for (const core of cores) {
        if (albumIds.length) {
          for (const id of albumIds) total += await this.immich.countMatching({ ...core, albumIds: [id] });
        } else if (hasMeaningfulFilter(core)) {
          total += await this.immich.countMatching(core);
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  invalidate(profileKey?: string): void {
    if (profileKey) this.pools.delete(profileKey);
    else this.pools.clear();
  }

  invalidateAll(): void {
    this.pools.clear();
  }

  // --- internals ---------------------------------------------------------

  private key(profile: Profile | null): string {
    return profile?.id ?? "__global__";
  }

  private async poolFor(profile: Profile | null): Promise<PoolState> {
    const key = this.key(profile);
    const existing = this.pools.get(key);
    if (existing && Date.now() - existing.builtAt < this.refreshMs) return existing;

    const recency = (await this.buildIds(profile)).slice(0, MAX_POOL); // newest-first
    const pick = (profile?.pick ?? "random") as PickStrategy;
    const favorRecent = !!profile?.favorRecent;
    let order: string[] = [];
    if (pick === "sequence") order = [...recency].reverse(); // chronological (oldest first)
    else if (pick === "shuffle") order = favorRecent ? weightedShuffle(recency) : shuffled(recency);
    const state: PoolState = { recency, order, index: 0, builtAt: Date.now(), pick, favorRecent };
    this.pools.set(key, state);
    return state;
  }

  /**
   * Search filters WITHOUT the album dimension: the people/place/favorite core, expanded
   * over date ranges (on_this_day yields one per year). Albums are applied separately,
   * one id per query, because Immich's albumIds is an AND filter — passing several at once
   * means "in ALL of them" (≈ always empty), not the union we want.
   */
  private coreDateFilters(profile: Profile | null): SearchFilter[] {
    const base: SearchFilter = {};
    if (profile) {
      const l = profile.logic ?? {};
      // People are applied as a separate OR dimension (see personIdsFor), not here.
      if (on(l, "place")) {
        if (l.city) base.city = l.city;
        if (l.country) base.country = l.country;
        if (l.state) base.state = l.state;
      }
      if (l.favorite) base.isFavorite = true;

      const d = on(l, "date") ? l.date : undefined;
      if (d && d.mode === "on_this_day") {
        return this.onThisDayRanges(now()).map((r) => ({ ...base, takenAfter: r.from, takenBefore: r.to }));
      }
      if (d && d.mode === "years_ago") {
        const center = new Date(now() - (d.years ?? 1) * 365 * DAY);
        return [{ ...base, ...windowAround(center, 7) }];
      }
      if (d && d.mode === "range" && (d.from || d.to)) {
        return [{ ...base, takenAfter: d.from, takenBefore: d.to }];
      }
    }
    return [base];
  }

  /** Selected person ids (OR-matched), or [] when the faces filter is off/empty. */
  private personIdsFor(profile: Profile | null): string[] {
    const l = profile?.logic;
    return l && on(l, "people") && l.people?.length ? l.people : [];
  }

  /** The Immich album ids a profile draws from (its local albums, else the global seed). */
  private albumIdsFor(profile: Profile | null): string[] {
    if (!profile) return this.settings.get().albumIds;
    const ids = this.localAlbums.immichAlbumIds(profile.localAlbumIds);
    return ids.length ? ids : this.settings.get().albumIds;
  }

  private async buildIds(profile: Profile | null): Promise<string[]> {
    const l = profile?.logic;
    const polygons = l && on(l, "location") ? validPolygons(l.location) : [];
    // Immich's search has no geo query and its search exifInfo omits GPS, so we build
    // the set of geotagged asset ids inside the polygons from /map/markers, then keep
    // only album/filter matches that are in it.
    let insideSet: Set<string> | null = null;
    if (polygons.length) {
      const markers = await this.immich.mapMarkers();
      insideSet = new Set(markers.filter((m) => pointInAnyPolygon(m.lat, m.lng, polygons)).map((m) => m.id));
    }

    // Resolve albums, dropping stale ids (a non-existent album id makes Immich's search
    // silently return nothing). Non-fatal if the lookup fails.
    let albumIds = this.albumIdsFor(profile);
    try {
      const valid = await this.immich.albumIdSet();
      albumIds = albumIds.filter((id) => valid.has(id));
    } catch {
      /* leave albumIds as-is */
    }
    // One query per album (unioned); undefined = no album dimension (global/people search).
    const albumDim: Array<string | undefined> = albumIds.length ? albumIds : [undefined];
    // Likewise one query per person, unioned — Immich treats multiple personIds as AND
    // ("photo with ALL these people"), which is almost never what a frame wants.
    const persons = this.personIdsFor(profile);
    const personDim: Array<string | undefined> = persons.length ? persons : [undefined];

    const maxPages = insideSet ? MAX_PAGES_LOCATION : MAX_PAGES_PER_RANGE;
    const out = new Set<string>();
    outer: for (const core of this.coreDateFilters(profile)) {
      for (const album of albumDim) {
        for (const person of personDim) {
          const filter: SearchFilter = { ...core };
          if (album) filter.albumIds = [album];
          if (person) filter.personIds = [person];
          if (!filter.albumIds?.length && !hasMeaningfulFilter(filter)) continue;
          let page = 1;
          for (let i = 0; i < maxPages && out.size < MAX_POOL; i++) {
            const { ids, nextPage } = await this.immich.searchMetadata(filter, page, PAGE);
            for (const id of ids) {
              if (insideSet && !insideSet.has(id)) continue;
              out.add(id);
            }
            if (!nextPage) break;
            page = nextPage;
          }
          if (out.size >= MAX_POOL) break outer;
        }
      }
    }
    const ignoredSet = this.ignored.set();
    return [...out].filter((id) => !ignoredSet.has(id));
  }

  private onThisDayRanges(ms: number): Array<{ from: string; to: string }> {
    const ranges: Array<{ from: string; to: string }> = [];
    const today = new Date(ms);
    for (let y = 1; y <= ON_THIS_DAY_YEARS; y++) {
      const center = new Date(today);
      center.setFullYear(today.getFullYear() - y);
      ranges.push(windowAroundObj(center, 2));
    }
    return ranges;
  }
}

function hasMeaningfulFilter(f: SearchFilter): boolean {
  return !!(f.personIds?.length || f.city || f.country || f.state || f.isFavorite || f.takenAfter || f.takenBefore);
}

/** Whether a filter dimension is enabled (a missing flag defaults to on). */
function on(logic: ProfileLogic, key: keyof FilterToggles): boolean {
  return logic.enabled?.[key] ?? true;
}

/** Well-formed rings only: ≥3 points, each a finite [lat, lng] pair. */
function validPolygons(loc: { polygons?: Array<Array<[number, number]>> } | undefined): Array<Array<[number, number]>> {
  if (!loc?.polygons) return [];
  return loc.polygons.filter(
    (ring) =>
      Array.isArray(ring) &&
      ring.length >= 3 &&
      ring.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])),
  );
}

function pointInAnyPolygon(lat: number | null, lng: number | null, polygons: Array<Array<[number, number]>>): boolean {
  if (lat == null || lng == null) return false;
  return polygons.some((ring) => pointInPolygon(lat, lng, ring));
}

/** Ray-casting point-in-polygon. Points are [lat, lng] (lat = y, lng = x). */
function pointInPolygon(lat: number, lng: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function windowAround(center: Date, days: number): { takenAfter: string; takenBefore: string } {
  const r = windowAroundObj(center, days);
  return { takenAfter: r.from, takenBefore: r.to };
}

function windowAroundObj(center: Date, days: number): { from: string; to: string } {
  return {
    from: new Date(center.getTime() - days * DAY).toISOString(),
    to: new Date(center.getTime() + days * DAY).toISOString(),
  };
}

function shuffled<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Each item once, in a random order biased so newer items (front of `recency`) tend to come first. */
function weightedShuffle(recency: string[]): string[] {
  const n = recency.length;
  return recency
    .map((id, i) => ({ id, key: Math.pow(Math.random(), 1 / (n - i)) })) // Efraimidis–Spirakis weighted sampling
    .sort((a, b) => b.key - a.key)
    .map((x) => x.id);
}

function now(): number {
  return Date.now();
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Weekday (0=Sun) and hour (0-23) for a timestamp, in the given IANA timezone (or server local). */
function zonedDowHour(date: Date, tz: string): { dow: number; hour: number } {
  if (!tz) return { dow: date.getDay(), hour: date.getHours() };
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    return { dow: WEEKDAY_INDEX[wd] ?? date.getDay(), hour: Number.isFinite(hour) ? hour % 24 : date.getHours() };
  } catch {
    return { dow: date.getDay(), hour: date.getHours() };
  }
}
