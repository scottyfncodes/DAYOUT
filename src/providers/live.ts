/**
 * Live providers: thin clients for the server-side functions under /api.
 * No keys here — the browser only ever talks to our own endpoints.
 */
import type { LatLng, Place, TimeWindow, TransportMode, TravelEstimate, WeatherForecast } from '@/core/types';
import type { GeocodeProvider, GeocodeResult, PlacesProvider, PlaceSearch, RoutingProvider, WeatherProvider } from './types';

export interface LiveConfig {
  places: 'google' | null;
  routing: 'google' | 'osrm';
  traffic: 'google' | null;
  weather: 'open-meteo';
}

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchLiveConfig(): Promise<LiveConfig | null> {
  try {
    return await getJson<LiveConfig>('/api/config', undefined, 5000);
  } catch {
    return null;
  }
}

export class LiveGeocoder implements GeocodeProvider {
  async search(query: string): Promise<GeocodeResult[]> {
    const r = await getJson<{ results: GeocodeResult[] }>(`/api/geocode?q=${encodeURIComponent(query)}`);
    return r.results ?? [];
  }
}

export class LiveWeatherProvider implements WeatherProvider {
  readonly id = 'open-meteo' as const;
  async forecast(point: LatLng, window: TimeWindow): Promise<WeatherForecast | null> {
    try {
      return await getJson<WeatherForecast>(`/api/weather?lat=${point.lat.toFixed(4)}&lng=${point.lng.toFixed(4)}&start=${window.start}`);
    } catch {
      return null;
    }
  }
}

export class LivePlacesProvider implements PlacesProvider {
  readonly id = 'google' as const;
  async search(q: PlaceSearch): Promise<Place[]> {
    const r = await getJson<{ places: Place[] }>(
      `/api/places?lat=${q.origin.point.lat.toFixed(4)}&lng=${q.origin.point.lng.toFixed(4)}&radius=${Math.round(q.radiusMiles)}` +
        `&tz=${encodeURIComponent(q.origin.timezone)}&interests=${q.interests.join(',')}`,
      undefined,
      20000,
    );
    return r.places ?? [];
  }
}

/**
 * Routing with request coalescing: `prime()` fetches a whole origin→N matrix
 * in one call so the pipeline's per-candidate `estimate()` hits the cache.
 */
export class LiveRoutingProvider implements RoutingProvider {
  readonly id: 'osrm' | 'google';
  private cache = new Map<string, TravelEstimate | null>();
  constructor(id: 'osrm' | 'google') {
    this.id = id;
  }

  private key(from: LatLng, to: LatLng, mode: string, departAt: number) {
    return `${mode}:${from.lat.toFixed(4)},${from.lng.toFixed(4)}>${to.lat.toFixed(4)},${to.lng.toFixed(4)}:${Math.round(departAt / 600000)}`;
  }

  async prime(from: LatLng, tos: LatLng[], mode: Exclude<TransportMode, 'any'>, departAt: number): Promise<void> {
    const missing = tos.filter((t) => !this.cache.has(this.key(from, t, mode, departAt)));
    for (let i = 0; i < missing.length; i += 50) {
      const batch = missing.slice(i, i + 50);
      try {
        const r = await getJson<{ estimates: (TravelEstimate | null)[] }>('/api/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: batch, mode, departAt }),
        });
        batch.forEach((t, j) => this.cache.set(this.key(from, t, mode, departAt), r.estimates[j] ?? null));
      } catch {
        batch.forEach((t) => this.cache.set(this.key(from, t, mode, departAt), null));
      }
    }
  }

  async estimate(from: LatLng, to: LatLng, mode: Exclude<TransportMode, 'any'>, departAt: number): Promise<TravelEstimate | null> {
    const k = this.key(from, to, mode, departAt);
    if (!this.cache.has(k)) await this.prime(from, [to], mode, departAt);
    return this.cache.get(k) ?? null;
  }
}
