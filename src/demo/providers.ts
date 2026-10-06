/**
 * DEMO PROVIDERS — simulated weather, travel, traffic.
 * Deterministic so the demo is explainable; clearly labelled in the UI.
 */
import type { LatLng, Place, TimeWindow, TransportMode, TravelEstimate, WeatherCondition, WeatherForecast, WeatherSnapshot } from '@/core/types';
import type { PlacesProvider, RoutingProvider, WeatherProvider, PlaceSearch } from '@/providers/types';
import { haversineMiles } from '@/core/geo';
import { wallClock, zonedEpoch, HOUR } from '@/core/time';
import { DENVER_PLACES, DENVER_TZ, findDemoPlace } from './denver';

export type DemoWeatherScenario = 'clear' | 'rain-afternoon' | 'heat' | 'cold' | 'storm' | 'snow';

export const DEMO_SCENARIOS: { id: DemoWeatherScenario; label: string; blurb: string }[] = [
  { id: 'clear', label: 'Clear & 68°F', blurb: 'Perfect afternoon outside.' },
  { id: 'rain-afternoon', label: 'Rain at 2 PM', blurb: 'Outdoor stops move earlier.' },
  { id: 'heat', label: '94°F heat', blurb: 'Shade and indoors move up.' },
  { id: 'cold', label: '22°F cold', blurb: 'Indoor options ranked higher.' },
  { id: 'storm', label: 'Thunderstorms', blurb: 'Exposed outdoor activities excluded.' },
  { id: 'snow', label: 'Snow day', blurb: 'Indoor wins; mountains get slow.' },
];

export class DemoPlacesProvider implements PlacesProvider {
  readonly id = 'demo' as const;
  async search(q: PlaceSearch): Promise<Place[]> {
    return DENVER_PLACES.filter((p) => haversineMiles(q.origin.point, p.location) <= Math.max(q.radiusMiles, 5));
  }
  async refresh(placeId: string): Promise<Place | null> {
    return findDemoPlace(placeId) ?? null;
  }
}

export class DemoWeatherProvider implements WeatherProvider {
  readonly id = 'demo' as const;
  constructor(public scenario: DemoWeatherScenario = 'clear') {}

  async forecast(_point: LatLng, window: TimeWindow): Promise<WeatherForecast> {
    const tz = DENVER_TZ;
    const day = wallClock(window.start, tz);
    const start = zonedEpoch(day.date, 0, tz) - 24 * HOUR;
    const hourly: WeatherSnapshot[] = [];
    for (let i = 0; i < 72; i++) {
      const time = start + i * HOUR;
      const h = wallClock(time, tz).minutes / 60;
      hourly.push(sample(this.scenario, time, h));
    }
    return {
      timezone: tz,
      hourly,
      sunrise: zonedEpoch(day.date, 7 * 60 + 2, tz),
      sunset: zonedEpoch(day.date, 18 * 60 + 42, tz),
      source: 'demo',
      fetchedAt: Date.now(),
      label: DEMO_SCENARIOS.find((s) => s.id === this.scenario)?.label,
    };
  }
}

function sample(s: DemoWeatherScenario, time: number, h: number): WeatherSnapshot {
  const diurnal = (base: number, swing: number) => base + swing * Math.sin(((h - 9) / 24) * 2 * Math.PI);
  const mk = (tempF: number, condition: WeatherCondition, precipProb: number, windMph: number, severe = false): WeatherSnapshot => ({
    time, tempF: Math.round(tempF), condition, precipProb, windMph, severe,
  });
  switch (s) {
    case 'clear':
      return mk(diurnal(62, 10), h < 8 || h > 19 ? 'clear' : 'clear', 5, 6);
    case 'rain-afternoon':
      if (h >= 14 && h < 19) return mk(diurnal(56, 6), 'rain', 80, 12);
      if (h >= 12 && h < 14) return mk(diurnal(58, 6), 'cloudy', 55, 10);
      return mk(diurnal(58, 8), 'partly', 20, 8);
    case 'heat':
      return mk(diurnal(84, 12), 'clear', 0, 5);
    case 'cold':
      return mk(diurnal(18, 7), 'partly', 10, 14);
    case 'storm':
      if (h >= 13 && h < 18) return mk(diurnal(70, 8), 'storm', 90, 28, true);
      return mk(diurnal(72, 8), 'cloudy', 40, 12);
    case 'snow':
      return mk(diurnal(26, 5), 'snow', 85, 15);
  }
}

/**
 * Travel model: straight-line distance × a road factor, mode-specific speeds,
 * and a deterministic traffic layer (rush hours + the I-70 mountain corridor).
 */
export class DemoRoutingProvider implements RoutingProvider {
  readonly id = 'demo' as const;
  constructor(private trafficScenario: 'normal' | 'heavy' = 'normal') {}

  setTraffic(mode: 'normal' | 'heavy') {
    this.trafficScenario = mode;
  }

  async estimate(from: LatLng, to: LatLng, mode: Exclude<TransportMode, 'any'>, departAt: number): Promise<TravelEstimate | null> {
    const straight = haversineMiles(from, to);
    const miles = straight * (straight > 12 ? 1.18 : 1.32);
    const w = wallClock(departAt, DENVER_TZ);
    const h = w.minutes / 60;
    const weekday = w.weekday >= 1 && w.weekday <= 5;

    switch (mode) {
      case 'walk': {
        if (miles > 4) return null; // nobody is walking that
        return { mode, durationMin: Math.round((miles / 3) * 60 + 2), distanceMiles: round1(miles), trafficDelayMin: null, source: 'demo' };
      }
      case 'bike': {
        if (miles > 14) return null;
        return { mode, durationMin: Math.round((miles / 10.5) * 60 + 3), distanceMiles: round1(miles), trafficDelayMin: null, source: 'demo' };
      }
      case 'transit': {
        if (straight > 18) return null;
        const transfers = straight > 5 ? 1 : 0;
        return { mode, durationMin: Math.round((miles / 13) * 60 + 9 + transfers * 7), distanceMiles: round1(miles), trafficDelayMin: null, transfers, source: 'demo' };
      }
      case 'drive':
      case 'rideshare': {
        const speed = miles < 3 ? 17 : miles < 12 ? 24 : 42;
        let base = (miles / speed) * 60 + (miles < 3 ? 3 : 5);
        let factor = 1;
        if (weekday && ((h >= 7 && h < 9.25) || (h >= 15.75 && h < 18.5))) factor += 0.3;
        const westbound = to.lng < -105.15 && to.lng < from.lng;
        if (westbound && straight > 12) factor += weekday ? 0.15 : h >= 6 && h < 10 ? 0.5 : 0.2;
        if (this.trafficScenario === 'heavy') factor += 0.45;
        const duration = Math.round(base);
        const delay = Math.round(base * (factor - 1));
        if (mode === 'rideshare') base += 6;
        return {
          mode,
          durationMin: mode === 'rideshare' ? duration + 6 : duration,
          distanceMiles: round1(miles),
          trafficDelayMin: delay,
          source: 'demo',
        };
      }
    }
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
