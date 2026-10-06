import type { HoursData, HoursInterval, Interest, Place, PriceLevel, WeeklyHours } from '../../core/types';

/** Subset of the Places API (New) place resource we read. */
export interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  rating?: number;
  priceLevel?: string;
  businessStatus?: string;
  regularOpeningHours?: GoogleHours;
  currentOpeningHours?: GoogleHours;
  googleMapsUri?: string;
  websiteUri?: string;
  editorialSummary?: { text: string };
  allowsDogs?: boolean;
  goodForChildren?: boolean;
  reservable?: boolean;
  outdoorSeating?: boolean;
  accessibilityOptions?: { wheelchairAccessibleEntrance?: boolean };
}

export interface GoogleHours {
  openNow?: boolean;
  periods?: {
    open: { day: number; hour: number; minute: number; date?: { year: number; month: number; day: number } };
    close?: { day: number; hour: number; minute: number; date?: { year: number; month: number; day: number } };
  }[];
}

const TYPE_TO_INTERESTS: Record<string, Interest[]> = {
  restaurant: ['food'],
  cafe: ['coffee', 'relaxed'],
  coffee_shop: ['coffee', 'relaxed'],
  bakery: ['food', 'coffee'],
  bar: ['nightlife'],
  wine_bar: ['nightlife', 'romantic'],
  night_club: ['nightlife', 'music'],
  art_gallery: ['arts', 'relaxed'],
  museum: ['arts', 'history', 'tourist'],
  performing_arts_theater: ['arts', 'music'],
  park: ['outdoors', 'relaxed', 'family'],
  national_park: ['outdoors', 'scenic', 'active'],
  hiking_area: ['outdoors', 'active', 'scenic'],
  tourist_attraction: ['tourist', 'scenic'],
  historical_landmark: ['history', 'tourist'],
  zoo: ['family', 'outdoors'],
  aquarium: ['family'],
  amusement_park: ['family', 'active'],
  amusement_center: ['family', 'weird', 'active'],
  bowling_alley: ['active', 'sports', 'family'],
  shopping_mall: ['shopping'],
  book_store: ['shopping', 'relaxed'],
  market: ['local', 'food', 'shopping'],
  gym: ['active', 'sports'],
  sports_complex: ['sports', 'active'],
  stadium: ['sports'],
  spa: ['relaxed', 'romantic'],
  movie_theater: ['relaxed', 'family'],
  ice_cream_shop: ['food', 'family'],
  brewery: ['nightlife', 'local'],
  garden: ['outdoors', 'scenic', 'relaxed'],
  botanical_garden: ['outdoors', 'scenic', 'relaxed'],
  marina: ['outdoors', 'scenic'],
  beach: ['outdoors', 'relaxed'],
  visitor_center: ['tourist'],
  farm: ['family', 'local'],
  farmers_market: ['local', 'food'],
};

/** Google types to request per interest. Kept small so each search is a single request group. */
export const INTEREST_TO_TYPES: Record<Interest, string[]> = {
  food: ['restaurant', 'bakery', 'ice_cream_shop'],
  outdoors: ['park', 'hiking_area', 'botanical_garden', 'garden'],
  arts: ['art_gallery', 'museum', 'performing_arts_theater'],
  music: ['night_club', 'performing_arts_theater', 'bar'],
  sports: ['bowling_alley', 'sports_complex', 'gym', 'stadium'],
  coffee: ['cafe', 'coffee_shop', 'bakery'],
  shopping: ['shopping_mall', 'book_store', 'market'],
  history: ['historical_landmark', 'museum'],
  nightlife: ['bar', 'night_club', 'wine_bar', 'brewery'],
  scenic: ['tourist_attraction', 'park', 'hiking_area'],
  weird: ['amusement_center', 'tourist_attraction', 'museum'],
  family: ['zoo', 'aquarium', 'amusement_park', 'park', 'bowling_alley'],
  romantic: ['wine_bar', 'restaurant', 'spa', 'botanical_garden'],
  active: ['hiking_area', 'gym', 'bowling_alley', 'park'],
  relaxed: ['spa', 'cafe', 'park', 'book_store'],
  local: ['market', 'brewery', 'cafe', 'farmers_market'],
  tourist: ['tourist_attraction', 'museum', 'historical_landmark', 'zoo'],
};

const DEFAULT_TYPES = ['restaurant', 'cafe', 'park', 'museum', 'tourist_attraction', 'bar', 'art_gallery'];

export function typesForInterests(interests: Interest[]): string[][] {
  const set = new Set<string>();
  for (const i of interests) for (const t of INTEREST_TO_TYPES[i] ?? []) set.add(t);
  if (set.size === 0) for (const t of DEFAULT_TYPES) set.add(t);
  const all = [...set];
  const groups: string[][] = [];
  for (let i = 0; i < all.length; i += 10) groups.push(all.slice(i, i + 10));
  return groups.slice(0, 3);
}

const PRICE: Record<string, PriceLevel> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function isoDate(d: { year: number; month: number; day: number }): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

function dayOffset(a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}

export function weeklyFromPeriods(periods: NonNullable<GoogleHours['periods']>): WeeklyHours {
  const weekly: WeeklyHours = Array.from({ length: 7 }, () => []);
  for (const p of periods) {
    if (!p.close) {
      // Always open (Google encodes 24/7 as a single open with no close).
      if (p.open.day === 0 && p.open.hour === 0 && p.open.minute === 0) {
        return Array.from({ length: 7 }, () => [{ open: 0, close: 1440 }]);
      }
      continue;
    }
    const open = p.open.hour * 60 + p.open.minute;
    let close = p.close.hour * 60 + p.close.minute;
    const dayDelta = (p.close.day - p.open.day + 7) % 7;
    close += dayDelta * 1440;
    if (close <= open) close += 1440;
    weekly[p.open.day]!.push({ open, close });
  }
  return weekly;
}

/**
 * currentOpeningHours carries dated periods for the next seven days with
 * holidays/special hours already applied. Build overrides keyed by date and
 * report the last date covered, so visits beyond it fall back to "scheduled".
 */
export function overridesFromCurrent(current: GoogleHours | undefined, todayIso: string): { overrides: Record<string, HoursInterval[] | 'closed'>; verifiedThrough?: string } {
  if (!current?.periods) return { overrides: {} };
  const byDate = new Map<string, HoursInterval[]>();
  let last = todayIso;
  for (const p of current.periods) {
    if (!p.open.date) continue;
    const key = isoDate(p.open.date);
    const open = p.open.hour * 60 + p.open.minute;
    let close: number;
    if (!p.close) close = 1440 * 7; // always open
    else {
      close = p.close.hour * 60 + p.close.minute;
      if (p.close.date) close += dayOffset(p.open.date, p.close.date) * 1440;
      else if (close <= open) close += 1440;
    }
    const list = byDate.get(key) ?? [];
    list.push({ open, close });
    byDate.set(key, list);
    if (key > last) last = key;
  }
  // Every date in the covered span without a period is a closed day.
  const overrides: Record<string, HoursInterval[] | 'closed'> = {};
  let cursor = todayIso;
  const guard = 10;
  for (let i = 0; i < guard && cursor <= last; i++) {
    overrides[cursor] = byDate.get(cursor) ?? 'closed';
    const [y, m, d] = cursor.split('-').map(Number) as [number, number, number];
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cursor = isoDate({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() });
  }
  return { overrides, verifiedThrough: byDate.size ? last : undefined };
}

export function hoursFromGoogle(g: GooglePlace, todayIso: string): HoursData {
  const status = g.businessStatus;
  const weekly = g.regularOpeningHours?.periods ? weeklyFromPeriods(g.regularOpeningHours.periods) : null;
  const { overrides, verifiedThrough } = overridesFromCurrent(g.currentOpeningHours, todayIso);
  const hasVerified = Boolean(verifiedThrough);
  return {
    confidence: hasVerified ? 'verified' : weekly ? 'scheduled' : 'unknown',
    verifiedThrough,
    weekly: weekly ?? Array.from({ length: 7 }, () => []),
    overrides,
    temporarilyClosed: status === 'CLOSED_TEMPORARILY',
    permanentlyClosed: status === 'CLOSED_PERMANENTLY',
  };
}

const OUTDOOR_TYPES = new Set(['park', 'hiking_area', 'national_park', 'garden', 'botanical_garden', 'beach', 'marina', 'zoo', 'amusement_park', 'farmers_market']);

export function placeFromGoogle(g: GooglePlace, timezone: string, todayIso: string): Place | null {
  if (!g.location || !g.displayName?.text) return null;
  const types = g.types ?? [];
  const cats = new Set<Interest>();
  for (const t of types) for (const i of TYPE_TO_INTERESTS[t] ?? []) cats.add(i);
  if (cats.size === 0) cats.add('local');
  const outdoor = types.some((t) => OUTDOOR_TYPES.has(t));
  const typical = outdoor ? 75 : types.includes('museum') ? 105 : types.includes('restaurant') ? 75 : types.includes('cafe') || types.includes('coffee_shop') ? 35 : 60;
  return {
    id: `g-${g.id}`,
    name: g.displayName.text,
    summary: g.editorialSummary?.text ?? humanizeType(g.primaryType ?? types[0] ?? 'place'),
    categories: [...cats],
    tags: types.slice(0, 4).map(humanizeType),
    location: { lat: g.location.latitude, lng: g.location.longitude },
    address: g.formattedAddress,
    timezone,
    setting: outdoor ? 'outdoor' : g.outdoorSeating ? 'mixed' : 'indoor',
    priceLevel: PRICE[g.priceLevel ?? ''] ?? (outdoor ? 0 : 2),
    duration: { min: Math.round(typical * 0.6), typical },
    hours: hoursFromGoogle(g, todayIso),
    attributes: {
      exposure: outdoor ? 'full' : g.outdoorSeating ? 'partial' : 'none',
      dogFriendly: g.allowsDogs,
      kidFriendly: g.goodForChildren,
      accessible: g.accessibilityOptions?.wheelchairAccessibleEntrance,
      reservationRecommended: g.reservable,
      transitFriendly: undefined,
      walkable: undefined,
    },
    parking: null, // never invented
    rating: g.rating,
    url: g.googleMapsUri ?? g.websiteUri,
    source: 'google',
  };
}

export function humanizeType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
