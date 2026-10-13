// Tiny typed fetch wrapper for the backend JSON API.
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface ImmichStatus {
  ok: boolean;
  version?: string;
  error?: string;
  baseUrl: string;
}

export interface ImmichConfig {
  baseUrl: string;
  hasApiKey: boolean;
}

export interface Album {
  id: string;
  name: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  inUse: boolean;
}

export interface Device {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  orientation: string | null;
  firmware: string | null;
  battery_pct: number | null;
  battery_mv: number | null;
  last_seen: number | null;
  last_telemetry_at: number | null;
  last_asset_id: string | null;
  next_asset_id: string | null;
  mirror_of: string | null;
  profile_id: string | null;
  schedule_id: string | null;
  group_id: string | null;
  position: number;
  simulated: number;
  host: string | null;
  isLocal: boolean;
  hasAccessToken: boolean;
  accessToken: string | null;
  accessTokenMasked: string | null;
  rotate_every_min: number;
  last_rotation_at: number | null;
  preset: string;
  created_at: number;
  online: boolean;
  shows: number;
}

export interface LocalAlbumSource {
  id: string;
  type: "immich" | "telegram" | "ai";
  ref: string;
}
export interface LocalAlbum {
  id: string;
  name: string;
  createdAt: number;
  sources: LocalAlbumSource[];
}

export interface Person {
  id: string;
  name: string;
  birthDate?: string | null;
}

export type DateMode = "none" | "on_this_day" | "years_ago" | "range";
/** A drawn region: freeform polygons, each a ring of [lat, lng] points. */
export interface GeoLocationFilter {
  polygons: Array<Array<[number, number]>>;
}
export interface FilterToggles {
  people?: boolean;
  place?: boolean;
  date?: boolean;
  location?: boolean;
}
export interface ProfileLogic {
  people?: string[];
  city?: string;
  country?: string;
  state?: string;
  date?: { mode: DateMode; years?: number; from?: string; to?: string };
  favorite?: boolean;
  location?: GeoLocationFilter;
  enabled?: FilterToggles;
}

export interface Profile {
  id: string;
  name: string;
  mode: "album" | "interest" | "generation";
  albumIds: string[];
  localAlbumIds: string[];
  logic: ProfileLogic;
  pick: "random" | "sequence" | "shuffle";
  favorRecent: boolean;
  preset: string;
  cropMode: string;
  generationId: string | null;
  overlayConfigId: string | null;
  createdAt: number;
}

export interface Group {
  id: string;
  name: string;
  created_at: number;
}

export interface Schedule {
  id: string;
  name: string;
}

export interface Generation {
  id: string;
  name: string;
  sourceType: "existing" | "news" | "full_ai";
  prompt: string;
  style: string;
  provider: string;
  params: Record<string, unknown>;
  createdAt: number;
}

export interface ScheduleEntry {
  id: string;
  schedule_id: string;
  dow: number;
  hour: number;
  profile_id: string;
}

export interface Stats {
  frames: number;
  framesOnline: number;
  shows24h: number;
  errors24h: number;
  available: number;
}

export interface UsageEvent {
  id: number;
  device_id: string | null;
  type: "show" | "error" | "battery" | "genai";
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

export interface DeviceRequest {
  id: number;
  device_id: string | null;
  created_at: number;
  ip: string | null;
  path: string | null;
  status: number | null;
  format: string | null;
  asset_id: string | null;
  not_modified: number;
  firmware: string | null;
  battery_pct: number | null;
  battery_mv: number | null;
  user_agent: string | null;
  raw: string | null;
}

export interface OAuthProviderStatus {
  provider: "anthropic";
  connected: boolean;
  configured: boolean;
  account: string | null;
  expiresAt: number | null;
}

export interface GeminiConfig {
  hasApiKey: boolean;
}

export interface GenaiCost {
  totalUsd: number;
  byProvider: Array<{ provider: string; costUsd: number; calls: number }>;
  byModel: Array<{ model: string; costUsd: number; calls: number }>;
  series: Array<{ t: number; cost: number }>;
}

export interface OverlayConfigSummary {
  id: string;
  name: string;
}
export interface OverlayConfig {
  id: string;
  name: string;
  overlays: Overlay[];
  created_at: number;
}
export type OverlayType = "battery" | "next_photo" | "weather" | "todos" | "birthdays" | "photo_date" | "photo_place" | "local_time";
export type OverlayPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
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
  ref: string | null;
  created_at: number;
}
export interface GeoResult {
  label: string;
  latitude: number;
  longitude: number;
}
export interface PhotoLocation {
  id: string;
  lat: number;
  lng: number;
}
export interface Weather {
  location: string;
  temp: number;
  description: string;
  units: "C" | "F";
  daily: Array<{ date: string; min: number; max: number; code: number }>;
}

export function deviceUrl(id: string): string {
  return `${window.location.origin}/d/${id}`;
}

export function thumbUrl(assetId: string): string {
  return `/thumbnail/${assetId}`;
}

export function relativeTime(ms: number | null): string {
  if (!ms) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// Absolute timestamp — unlike relativeTime it doesn't go stale between renders. Drops the date
// for same-day times to keep it short (e.g. "2:05 PM"), shows month/day otherwise.
export function clockTime(ms: number | null): string {
  if (!ms) return "never";
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
