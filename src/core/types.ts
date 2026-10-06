/**
 * DayOut domain types. Pure data, no framework dependencies.
 *
 * Time is always an epoch millisecond number (an instant). Wall-clock values
 * (opening hours) are minutes since local midnight in the place's timezone.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type Interest =
  | 'food'
  | 'outdoors'
  | 'arts'
  | 'music'
  | 'sports'
  | 'coffee'
  | 'shopping'
  | 'history'
  | 'nightlife'
  | 'scenic'
  | 'weird'
  | 'family'
  | 'romantic'
  | 'active'
  | 'relaxed'
  | 'local'
  | 'tourist';

export const INTERESTS: Interest[] = [
  'food', 'outdoors', 'arts', 'music', 'sports', 'coffee', 'shopping', 'history',
  'nightlife', 'scenic', 'weird', 'family', 'romantic', 'active', 'relaxed', 'local', 'tourist',
];

/** 0 = free, 1 = $, 2 = $$, 3 = $$$, 4 = $$$$ */
export type PriceLevel = 0 | 1 | 2 | 3 | 4;

export type TransportMode = 'drive' | 'walk' | 'bike' | 'transit' | 'rideshare' | 'any';

export type Setting = 'indoor' | 'outdoor' | 'mixed';

export type Party = 'solo' | 'couple' | 'friends' | 'family';

export interface TimeWindow {
  /** epoch ms */
  start: number;
  /** epoch ms */
  end: number;
}

export interface Constraints {
  setting?: 'indoor' | 'outdoor';
  dogFriendly?: boolean;
  kidFriendly?: boolean;
  accessible?: boolean;
  noReservation?: boolean;
  easyParking?: boolean;
  avoidTraffic?: boolean;
  /** straight-line + routed distance cap from origin */
  maxDistanceMiles?: number;
}

/** "Make it better" adjustments. Each one changes the engine, not the copy. */
export interface Tuning {
  cheaper?: boolean;
  moreActive?: boolean;
  lessDriving?: boolean;
  moreLocal?: boolean;
  moreFood?: boolean;
  moreOutdoors?: boolean;
  lessTouristy?: boolean;
  addWeird?: boolean;
  noReservations?: boolean;
  /** hard cap on the window length in minutes (e.g. "we only have 2 hours") */
  maxMinutes?: number;
}

export interface Origin {
  label: string;
  point: LatLng;
  /** IANA timezone of the origin, e.g. America/Denver */
  timezone: string;
}

export interface DayQuery {
  origin: Origin;
  window: TimeWindow;
  party: Party;
  partySize: number;
  withKids: boolean;
  withDog: boolean;
  /** null = any budget */
  maxPrice: PriceLevel | null;
  interests: Interest[];
  transport: TransportMode;
  constraints: Constraints;
  tuning: Tuning;
}

/** Minutes since local midnight. `close` may exceed 1440 for hours that run past midnight. */
export interface HoursInterval {
  open: number;
  close: number;
}

/** Index 0 = Sunday … 6 = Saturday. Empty array = closed that day. */
export type WeeklyHours = HoursInterval[][];

export type HoursConfidence =
  /** Provider supplied date-specific hours (holidays and temporary changes already applied). */
  | 'verified'
  /** Only a weekly template is known. Might be stale; never enough for a primary recommendation. */
  | 'scheduled'
  /** No usable hours information. */
  | 'unknown';

export interface HoursData {
  confidence: HoursConfidence;
  /** ISO date (YYYY-MM-DD, place-local). Verified data covers visits up to and including this date. */
  verifiedThrough?: string;
  weekly: WeeklyHours;
  /** Date-specific overrides keyed by ISO date: holiday hours, early closes, one-off closures. */
  overrides?: Record<string, HoursInterval[] | 'closed'>;
  temporarilyClosed?: boolean;
  permanentlyClosed?: boolean;
  /** Seasonal operation: ISO month-day bounds, inclusive. Outside the season the place is closed. */
  season?: { from: string; to: string };
}

/**
 * Activity-level availability, distinct from the door being open:
 * a kitchen that closes before the bar, a last-entry cutoff, a show time.
 */
export interface ActivityWindow {
  label: string;
  kind: 'kitchen' | 'lastEntry' | 'event' | 'other';
  weekly: WeeklyHours;
  overrides?: Record<string, HoursInterval[] | 'closed'>;
  /** 'arrival' = must be available when you arrive; 'visit' = must cover the whole visit. */
  mustCover: 'arrival' | 'visit';
}

export type ParkingDifficulty = 'easy' | 'moderate' | 'hard';

export interface ParkingInfo {
  difficulty: ParkingDifficulty;
  /** e.g. "Free lot", "$15–25 garage" */
  cost: string;
  type: 'lot' | 'garage' | 'street' | 'none';
  /** walk from parking to the door */
  walkMin: number;
  reservationRequired?: boolean;
}

export interface PlaceAttributes {
  dogFriendly?: boolean;
  kidFriendly?: boolean;
  accessible?: boolean;
  reservationRequired?: boolean;
  reservationRecommended?: boolean;
  transitFriendly?: boolean;
  walkable?: boolean;
  /** how exposed the activity is to weather */
  exposure: 'none' | 'partial' | 'full';
}

export interface Place {
  id: string;
  name: string;
  /** one-line "what is it" */
  summary: string;
  /** "why should I care" */
  pitch?: string;
  categories: Interest[];
  tags: string[];
  location: LatLng;
  address?: string;
  neighborhood?: string;
  timezone: string;
  setting: Setting;
  priceLevel: PriceLevel;
  costNote?: string;
  /** typical dwell time range in minutes */
  duration: { min: number; typical: number };
  hours: HoursData;
  activities?: ActivityWindow[];
  attributes: PlaceAttributes;
  /** null means unknown — never guessed */
  parking: ParkingInfo | null;
  rating?: number;
  url?: string;
  photo?: string;
  source: 'demo' | 'google';
}

export type AvailabilityState = 'OPEN_CONFIRMED' | 'OPEN_LIKELY' | 'UNKNOWN' | 'CLOSED';

export interface Availability {
  state: AvailabilityState;
  /** human-readable reason, e.g. "Closed Mondays", "Kitchen closes at 9 PM" */
  reason: string;
  /** epoch ms — when the covering open interval ends */
  openUntil?: number;
  /** epoch ms — next opening at or after the requested arrival, if any that day */
  opensAt?: number;
}

export interface TravelEstimate {
  mode: Exclude<TransportMode, 'any'>;
  durationMin: number;
  distanceMiles: number;
  /** null = traffic data unavailable (never guessed) */
  trafficDelayMin: number | null;
  transfers?: number;
  source: 'demo' | 'osrm' | 'google';
}

export type WeatherCondition = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm' | 'wind';

export interface WeatherSnapshot {
  /** epoch ms this snapshot applies to */
  time: number;
  tempF: number;
  condition: WeatherCondition;
  precipProb: number;
  windMph: number;
  severe: boolean;
}

export interface WeatherForecast {
  timezone: string;
  hourly: WeatherSnapshot[];
  /** epoch ms */
  sunrise?: number;
  sunset?: number;
  source: 'demo' | 'open-meteo';
  fetchedAt: number;
  label?: string;
}

export type ExclusionReason =
  | 'closed'
  | 'opens_too_late'
  | 'closes_before_arrival'
  | 'closes_during_visit'
  | 'activity_unavailable'
  | 'unverified_hours'
  | 'unknown_hours'
  | 'too_far'
  | 'does_not_fit_window'
  | 'budget'
  | 'constraint'
  | 'severe_weather'
  | 'no_route';

export interface Recommendation {
  place: Place;
  availability: Availability;
  travel: TravelEstimate | null;
  /** epoch ms — planned visit start */
  arrive: number;
  /** epoch ms — planned visit end */
  leave: number;
  weather: WeatherSnapshot | null;
  score: number;
  fit: 'Great fit' | 'Good fit' | 'Worth it';
  reasons: string[];
  cautions: string[];
}

export type DataSource = 'live' | 'demo' | 'unavailable';

export interface DataStatus {
  places: DataSource;
  weather: DataSource;
  routing: DataSource;
  traffic: DataSource;
  parking: DataSource;
}

export interface FindResult {
  recommendations: Recommendation[];
  considered: number;
  excluded: Partial<Record<ExclusionReason, number>>;
  /** set when the engine loosened a constraint to find anything */
  relaxed?: string;
  status: DataStatus;
  weather: WeatherForecast | null;
  headline: string;
}

export interface ItineraryStop {
  place: Place;
  travel: TravelEstimate | null;
  /** epoch ms — arrive at the door (after travel and any parking walk) */
  arrive: number;
  /** epoch ms — visit begins (arrive, or opening time if we have to wait) */
  start: number;
  /** epoch ms */
  end: number;
  availability: Availability;
  weather: WeatherSnapshot | null;
  /** problems that make this stop invalid right now */
  problems: string[];
  /** soft warnings that don't invalidate the stop */
  warnings: string[];
}

export interface Itinerary {
  stops: ItineraryStop[];
  /** epoch ms — when the last stop ends */
  endsAt: number;
  valid: boolean;
  totalTravelMin: number;
  /** itinerary-level notes, e.g. "Rain moves in at 2 PM — outdoor stops are scheduled before it." */
  notes: string[];
}

export interface SavedPlan {
  version: 1;
  id: string;
  title: string;
  createdAt: number;
  origin: Origin;
  window: TimeWindow;
  placeIds: string[];
  /** embedded so a share link can render without the recipient having the dataset */
  places: Place[];
  dataMode: 'live' | 'demo';
}
