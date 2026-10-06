import type { DataStatus, DayQuery, Place, WeatherForecast, WeatherSnapshot, TravelEstimate, LatLng, TransportMode } from '@/core/types';
import { H } from '@/core/hours';
import { zonedEpoch, HOUR } from '@/core/time';
import type { PlacesProvider, RoutingProvider, WeatherProvider, ProviderBundle } from '@/providers/types';
import { haversineMiles } from '@/core/geo';

export const TZ = 'America/Denver';
/** Tuesday 2026-10-06 */
export const DATE = '2026-10-06';
export const at = (h: number, m = 0, date = DATE) => zonedEpoch(date, h * 60 + m, TZ);
export const ORIGIN = { label: 'Denver', point: { lat: 39.7392, lng: -104.9903 }, timezone: TZ };

export function place(over: Partial<Place> & { id: string }): Place {
  return {
    name: over.id,
    summary: 'test',
    categories: ['outdoors'],
    tags: [],
    location: { lat: 39.745, lng: -104.99 },
    timezone: TZ,
    setting: 'indoor',
    priceLevel: 1,
    duration: { min: 45, typical: 60 },
    hours: { confidence: 'verified', verifiedThrough: '2030-01-01', weekly: H.daily(H.t(9), H.t(17)) },
    attributes: { exposure: 'none' },
    parking: null,
    source: 'demo',
    ...over,
  };
}

export function query(over: Partial<DayQuery> = {}): DayQuery {
  return {
    origin: ORIGIN,
    window: { start: at(10), end: at(16) },
    party: 'couple',
    partySize: 2,
    withKids: false,
    withDog: false,
    maxPrice: null,
    interests: [],
    transport: 'drive',
    constraints: {},
    tuning: {},
    ...over,
  };
}

export function forecast(fn: (hourOfDay: number) => Partial<WeatherSnapshot>, date = DATE): WeatherForecast {
  const hourly: WeatherSnapshot[] = [];
  for (let h = 0; h < 24; h++) {
    const time = zonedEpoch(date, h * 60, TZ);
    hourly.push({ time, tempF: 65, condition: 'clear', precipProb: 0, windMph: 5, severe: false, ...fn(h) });
  }
  return { timezone: TZ, hourly, sunrise: at(7), sunset: at(18, 40), source: 'demo', fetchedAt: 0 };
}

export class FixedRouting implements RoutingProvider {
  readonly id = 'demo' as const;
  constructor(private minutes: number | ((to: LatLng, mode: TransportMode) => TravelEstimate | null), private delay: number | null = 0) {}
  async estimate(_from: LatLng, to: LatLng, mode: Exclude<TransportMode, 'any'>): Promise<TravelEstimate | null> {
    if (typeof this.minutes === 'function') return this.minutes(to, mode);
    return { mode, durationMin: this.minutes, distanceMiles: haversineMiles(_from, to), trafficDelayMin: this.delay, source: 'demo' };
  }
}

export class ListPlaces implements PlacesProvider {
  readonly id = 'demo' as const;
  constructor(private list: Place[]) {}
  async search(): Promise<Place[]> {
    return this.list;
  }
}

export class FixedWeather implements WeatherProvider {
  readonly id = 'demo' as const;
  constructor(private f: WeatherForecast | null) {}
  async forecast(): Promise<WeatherForecast | null> {
    return this.f;
  }
}

export const STATUS: DataStatus = { places: 'demo', weather: 'demo', routing: 'demo', traffic: 'demo', parking: 'demo' };

export function bundle(places: Place[], routing: RoutingProvider = new FixedRouting(10), weather: WeatherForecast | null = null): ProviderBundle {
  return { places: new ListPlaces(places), routing, weather: new FixedWeather(weather), mode: 'demo' };
}

export { HOUR };
