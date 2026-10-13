// Weather via Open-Meteo (free, no API key). Geocode a place name, then fetch the
// current conditions + a short daily forecast. Cached ~1h per (location, units).
const TTL = 60 * 60 * 1000;

export interface WeatherDay {
  date: string;
  min: number;
  max: number;
  code: number;
}

export interface Weather {
  location: string;
  temp: number;
  code: number;
  description: string;
  units: "C" | "F";
  daily: WeatherDay[];
}

export interface GeoResult {
  label: string;
  latitude: number;
  longitude: number;
}

export class WeatherService {
  private cache = new Map<string, { at: number; data: Weather | null }>();

  async geocode(name: string): Promise<GeoResult[]> {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: Array<{ name: string; admin1?: string; country?: string; latitude: number; longitude: number }> };
    return (body.results ?? []).map((r) => ({
      label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  }

  /** Weather for a configured location (name or "lat,lon"), cached. */
  async get(location: string, units: "C" | "F" = "C"): Promise<Weather | null> {
    if (!location) return null;
    const key = `${location}|${units}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
    const data = await this.fetchFresh(location, units).catch(() => null);
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  private async fetchFresh(location: string, units: "C" | "F"): Promise<Weather | null> {
    let lat: number, lon: number, label: string;
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(location);
    if (m) {
      lat = Number(m[1]);
      lon = Number(m[2]);
      label = location;
    } else {
      const geo = await this.geocode(location);
      if (geo.length === 0) return null;
      ({ latitude: lat, longitude: lon, label } = geo[0]);
    }
    const tempUnit = units === "F" ? "fahrenheit" : "celsius";
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code` +
      `&temperature_unit=${tempUnit}&forecast_days=3&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const b = (await res.json()) as {
      current: { temperature_2m: number; weather_code: number };
      daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[] };
    };
    return {
      location: label,
      temp: Math.round(b.current.temperature_2m),
      code: b.current.weather_code,
      description: wmoText(b.current.weather_code),
      units,
      daily: b.daily.time.map((date, i) => ({
        date,
        min: Math.round(b.daily.temperature_2m_min[i]),
        max: Math.round(b.daily.temperature_2m_max[i]),
        code: b.daily.weather_code[i],
      })),
    };
  }
}

/** WMO weather-code → short label. */
export function wmoText(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}
