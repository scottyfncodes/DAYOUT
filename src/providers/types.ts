import type { LatLng, Place, TimeWindow, TransportMode, TravelEstimate, WeatherForecast, Interest, Origin } from '@/core/types';

export interface PlaceSearch {
  origin: Origin;
  radiusMiles: number;
  interests: Interest[];
  window: TimeWindow;
}

export interface PlacesProvider {
  readonly id: 'demo' | 'google';
  search(q: PlaceSearch): Promise<Place[]>;
  /** Re-fetch a single place (used when a saved plan is reopened). */
  refresh?(placeId: string): Promise<Place | null>;
}

export interface WeatherProvider {
  readonly id: 'demo' | 'open-meteo';
  forecast(point: LatLng, window: TimeWindow): Promise<WeatherForecast | null>;
}

export interface RoutingProvider {
  readonly id: 'demo' | 'osrm' | 'google';
  estimate(from: LatLng, to: LatLng, mode: Exclude<TransportMode, 'any'>, departAt: number): Promise<TravelEstimate | null>;
  /** Optional batch warm-up so a whole candidate set costs one network call. */
  prime?(from: LatLng, tos: LatLng[], mode: Exclude<TransportMode, 'any'>, departAt: number): Promise<void>;
}

export interface GeocodeResult {
  label: string;
  point: LatLng;
  timezone: string;
}

export interface GeocodeProvider {
  search(query: string): Promise<GeocodeResult[]>;
}

export interface ProviderBundle {
  places: PlacesProvider;
  weather: WeatherProvider;
  routing: RoutingProvider;
  mode: 'live' | 'demo';
}
