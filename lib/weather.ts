// Server-side weather fetcher. Uses Open-Meteo's free, key-free
// geocoding + forecast endpoints. We cache the geocode result for a
// week and the forecast for an hour so the dashboard never hammers the
// API.

import { unstable_cache } from "next/cache";

export type Forecast = {
  city: string;
  country: string | null;
  tempC: number;
  feelsC: number;
  highC: number;
  lowC: number;
  conditions: string; // human label
  code: number;       // raw WMO code
  precipChance: number; // 0..100
  isDay: boolean;
};

type Geo = {
  name: string;
  country: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
};

// WMO code → short, friendly label. Open-Meteo lists ~28 codes; we
// collapse them into a handful that are useful for outfit prompting.
function describeCode(code: number): string {
  if (code === 0) return "clear";
  if (code === 1) return "mostly clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if ([45, 48].includes(code)) return "foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzly";
  if ([61, 63, 65, 80, 81, 82].includes(code)) return "rainy";
  if ([66, 67].includes(code)) return "icy rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snowy";
  if ([95, 96, 99].includes(code)) return "thunderstorms";
  return "cloudy";
}

const geocode = unstable_cache(
  async (city: string): Promise<Geo | null> => {
    try {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.searchParams.set("name", city);
      url.searchParams.set("count", "1");
      url.searchParams.set("language", "en");
      url.searchParams.set("format", "json");
      const res = await fetch(url, { next: { revalidate: 60 * 60 * 24 * 7 } });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        results?: Array<{ name: string; country?: string; latitude: number; longitude: number; timezone?: string }>;
      };
      const r = data.results?.[0];
      if (!r) return null;
      return {
        name: r.name,
        country: r.country ?? null,
        latitude: r.latitude,
        longitude: r.longitude,
        timezone: r.timezone ?? null,
      };
    } catch {
      return null;
    }
  },
  ["weather-geocode"],
  { revalidate: 60 * 60 * 24 * 7 },
);

export async function getForecast(city: string): Promise<Forecast | null> {
  if (!city.trim()) return null;
  const geo = await geocode(city.trim());
  if (!geo) return null;

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(geo.latitude));
    url.searchParams.set("longitude", String(geo.longitude));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,is_day,weather_code,precipitation_probability");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("timezone", geo.timezone ?? "auto");
    const res = await fetch(url, { next: { revalidate: 60 * 60 } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      current?: {
        temperature_2m: number;
        apparent_temperature: number;
        is_day: number;
        weather_code: number;
        precipitation_probability: number;
      };
      daily?: {
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: number[];
      };
    };
    const c = data.current;
    if (!c) return null;
    return {
      city: geo.name,
      country: geo.country,
      tempC: Math.round(c.temperature_2m),
      feelsC: Math.round(c.apparent_temperature),
      highC: Math.round(data.daily?.temperature_2m_max?.[0] ?? c.temperature_2m),
      lowC: Math.round(data.daily?.temperature_2m_min?.[0] ?? c.temperature_2m),
      conditions: describeCode(c.weather_code),
      code: c.weather_code,
      precipChance: Math.round(data.daily?.precipitation_probability_max?.[0] ?? c.precipitation_probability ?? 0),
      isDay: c.is_day === 1,
    };
  } catch {
    return null;
  }
}

export function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

// One-line weather hint for the AI outfit prompt.
export function describeForOutfit(f: Forecast): string {
  const tempF = cToF(f.tempC);
  const high = cToF(f.highC);
  const low = cToF(f.lowC);
  const rain = f.precipChance >= 40 ? `, ${f.precipChance}% chance of rain` : "";
  return `In ${f.city}: ${tempF}°F now (${low}°-${high}°F today), ${f.conditions}${rain}.`;
}

export type TripForecast = {
  city: string;
  country: string | null;
  /** Start of the forecast window we actually fetched (clamped to today / +16d). */
  windowStart: string; // YYYY-MM-DD
  windowEnd: string;   // YYYY-MM-DD
  highF: number;
  lowF: number;
  /** Most common condition across the window. */
  conditions: string;
  /** Worst single-day precipitation chance (0..100). */
  maxPrecipChance: number;
};

function parseISODate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // UTC anchor — we just want the calendar day, not a moment.
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Forecast for a future trip window. Returns null if the trip is more
// than 16 days out (Open-Meteo's free tier maxes out there) — callers
// should fall back to season/destination context for far-future trips.
// For trips that overlap today, we clamp the window to [today, end].
export async function getTripForecast(
  city: string,
  startISO: string | null,
  endISO: string | null,
): Promise<TripForecast | null> {
  if (!city.trim()) return null;
  const start = startISO ? parseISODate(startISO) : null;
  const end = endISO ? parseISODate(endISO) : start;
  if (!start) return null;

  const today = todayUTC();
  const lastForecast = new Date(today);
  lastForecast.setUTCDate(lastForecast.getUTCDate() + 15); // forecast_days=16 → today + 15

  // Trip already over before today → no useful forecast.
  if ((end ?? start) < today) return null;
  // Trip starts beyond the forecast window → caller falls back to season language.
  if (start > lastForecast) return null;

  const windowStart = start < today ? today : start;
  const windowEndRaw = end && end > windowStart ? end : windowStart;
  const windowEnd = windowEndRaw > lastForecast ? lastForecast : windowEndRaw;

  const geo = await geocode(city.trim());
  if (!geo) return null;

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(geo.latitude));
    url.searchParams.set("longitude", String(geo.longitude));
    url.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    );
    url.searchParams.set("start_date", isoDate(windowStart));
    url.searchParams.set("end_date", isoDate(windowEnd));
    url.searchParams.set("timezone", geo.timezone ?? "auto");
    const res = await fetch(url, { next: { revalidate: 60 * 60 } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
        weather_code?: number[];
      };
    };
    const d = data.daily;
    if (!d?.temperature_2m_max?.length) return null;

    const highC = Math.max(...d.temperature_2m_max);
    const lowC = Math.min(...(d.temperature_2m_min ?? d.temperature_2m_max));
    const maxPrecip = d.precipitation_probability_max?.length
      ? Math.max(...d.precipitation_probability_max.map((n) => n ?? 0))
      : 0;

    // Most common WMO code → friendly label. Ties go to the rougher
    // condition since "expect rain on 2 of 5 days" is more useful than
    // averaging it out to "partly cloudy".
    const counts = new Map<number, number>();
    for (const code of d.weather_code ?? []) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    let dominantCode = d.weather_code?.[0] ?? 0;
    let bestCount = 0;
    for (const [code, n] of counts) {
      const rough = code >= 51; // anything precipitation-y
      const isBetter =
        n > bestCount || (n === bestCount && rough && code > dominantCode);
      if (isBetter) {
        dominantCode = code;
        bestCount = n;
      }
    }

    return {
      city: geo.name,
      country: geo.country,
      windowStart: isoDate(windowStart),
      windowEnd: isoDate(windowEnd),
      highF: cToF(Math.round(highC)),
      lowF: cToF(Math.round(lowC)),
      conditions: describeCode(dominantCode),
      maxPrecipChance: Math.round(maxPrecip),
    };
  } catch {
    return null;
  }
}

export function describeForTrip(f: TripForecast): string {
  const range = f.windowStart === f.windowEnd ? f.windowStart : `${f.windowStart} to ${f.windowEnd}`;
  const rain = f.maxPrecipChance >= 40 ? `, up to ${f.maxPrecipChance}% chance of rain` : "";
  return `Forecast for ${f.city} (${range}): ${f.lowF}°F-${f.highF}°F, ${f.conditions}${rain}.`;
}
