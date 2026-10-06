import type {
  DataStatus,
  DayQuery,
  ExclusionReason,
  FindResult,
  Place,
  Recommendation,
  TransportMode,
  TravelEstimate,
  WeatherForecast,
} from './types';
import { assessAvailability, earliestVisitStart } from './hours';
import { haversineMiles } from './geo';
import { judgeWeather, weatherAt } from './weather';
import { fitLabel, scoreCandidate } from './scoring';
import { headlineFor } from './copy';
import type { ProviderBundle } from '@/providers/types';

export const BUFFER_MIN = 10;
const MAX_RESULTS = 8;

export interface GateOutcome {
  ok: boolean;
  reason?: ExclusionReason;
  arrive?: number;
  leave?: number;
  travel?: TravelEstimate | null;
}

/** Resolve "any" / rideshare to a mode the routing provider understands. */
export function routingMode(mode: TransportMode): Exclude<TransportMode, 'any'> {
  if (mode === 'any') return 'drive';
  return mode;
}

/**
 * Hard eligibility gates. Everything here is a reason to EXCLUDE, never a
 * ranking nudge. Order matters only for the reason reported.
 */
export function applyConstraints(place: Place, q: DayQuery): ExclusionReason | null {
  const c = q.constraints;
  if (q.maxPrice !== null && place.priceLevel > q.maxPrice) return 'budget';
  if (q.tuning.cheaper && q.maxPrice !== null && place.priceLevel > Math.max(0, q.maxPrice - 1)) return 'budget';
  if (c.setting === 'indoor' && place.setting === 'outdoor') return 'constraint';
  if (c.setting === 'outdoor' && place.setting === 'indoor') return 'constraint';
  if ((c.dogFriendly || q.withDog) && place.attributes.dogFriendly !== true) return 'constraint';
  if ((c.kidFriendly || q.withKids) && place.attributes.kidFriendly === false) return 'constraint';
  if (c.accessible && place.attributes.accessible !== true) return 'constraint';
  if ((c.noReservation || q.tuning.noReservations) && place.attributes.reservationRequired) return 'constraint';
  if (c.easyParking && q.transport === 'drive' && place.parking?.difficulty !== 'easy') return 'constraint';
  return null;
}

export function effectiveWindow(q: DayQuery) {
  const { start } = q.window;
  let end = q.window.end;
  if (q.tuning.maxMinutes) end = Math.min(end, start + q.tuning.maxMinutes * 60000);
  return { start, end };
}

/**
 * Run the full decision pipeline for one candidate.
 * Returns the scheduled slot if the place is actually doable.
 */
export async function evaluateCandidate(
  place: Place,
  q: DayQuery,
  providers: ProviderBundle,
  weather: WeatherForecast | null,
  maxDistance: number,
): Promise<GateOutcome> {
  const window = effectiveWindow(q);
  const straight = haversineMiles(q.origin.point, place.location);
  if (straight > maxDistance) return { ok: false, reason: 'too_far' };

  const constraint = applyConstraints(place, q);
  if (constraint) return { ok: false, reason: constraint };

  if (place.hours.permanentlyClosed || place.hours.temporarilyClosed) return { ok: false, reason: 'closed' };
  if (place.hours.confidence === 'unknown') return { ok: false, reason: 'unknown_hours' };

  const mode = routingMode(q.transport);
  const travel = await providers.routing.estimate(q.origin.point, place.location, mode, window.start);
  if (!travel) return { ok: false, reason: 'no_route' };
  if (travel.distanceMiles > maxDistance * 1.6) return { ok: false, reason: 'too_far' };

  const friction = mode === 'drive' ? place.parking?.walkMin ?? 0 : 0;
  const travelMin = travel.durationMin + (travel.trafficDelayMin ?? 0) + friction;
  const earliestArrival = window.start + travelMin * 60000;
  const dwell = place.duration.min;

  if (earliestArrival + dwell * 60000 > window.end) {
    return { ok: false, reason: earliestArrival >= window.end ? 'too_far' : 'does_not_fit_window' };
  }

  // Find the first slot where the door AND the activity are available.
  const start = earliestVisitStart(place, earliestArrival, window.end, dwell);
  if (start === null) {
    // Explain why, using the arrival-time assessment.
    const a = assessAvailability(place, earliestArrival, earliestArrival + dwell * 60000);
    if (a.state === 'UNKNOWN') return { ok: false, reason: 'unknown_hours' };
    if (a.reason.startsWith('Opens at')) return { ok: false, reason: 'opens_too_late' };
    if (a.reason.startsWith('Closes at')) return { ok: false, reason: 'closes_during_visit' };
    if (a.reason.includes('closes') || a.reason.includes('Last entry')) return { ok: false, reason: 'activity_unavailable' };
    if (a.reason.startsWith('Closed')) return { ok: false, reason: 'closed' };
    return { ok: false, reason: 'closes_before_arrival' };
  }

  // Prefer the typical duration if it fits; the minimum is the floor we already proved.
  const availAtMin = assessAvailability(place, start, start + dwell * 60000);
  let leave = start + place.duration.typical * 60000;
  if (leave > window.end || (availAtMin.openUntil && leave > availAtMin.openUntil)) {
    leave = Math.min(window.end, availAtMin.openUntil ?? window.end);
  }
  if (leave - start < dwell * 60000) leave = start + dwell * 60000;

  const availability = assessAvailability(place, start, leave);
  if (availability.state === 'CLOSED') return { ok: false, reason: 'closes_during_visit' };
  if (availability.state === 'UNKNOWN') return { ok: false, reason: 'unknown_hours' };
  if (availability.state === 'OPEN_LIKELY') return { ok: false, reason: 'unverified_hours' };

  // Safety: unsafe weather for fully exposed activities is an exclusion.
  const w = weatherAt(weather, start);
  if (judgeWeather(place, w).unsafe) return { ok: false, reason: 'severe_weather' };

  return { ok: true, arrive: start, leave, travel };
}

/**
 * Discover → verify → gate → enrich → score → rank.
 */
export async function findMyDay(q: DayQuery, providers: ProviderBundle, status: DataStatus): Promise<FindResult> {
  const window = effectiveWindow(q);
  const baseDistance = q.constraints.maxDistanceMiles ?? defaultRadius(q.transport);

  const [places, weather] = await Promise.all([
    providers.places
      .search({ origin: q.origin, radiusMiles: baseDistance * 1.5, interests: q.interests, window })
      .catch(() => [] as Place[]),
    providers.weather.forecast(q.origin.point, window).catch(() => null),
  ]);
  if (!weather) status = { ...status, weather: 'unavailable' };
  if (providers.routing.prime && places.length) {
    await providers.routing.prime(q.origin.point, places.map((p) => p.location), routingMode(q.transport), window.start).catch(() => undefined);
  }

  let relaxed: string | undefined;
  let maxDistance = baseDistance;
  let picks: Recommendation[] = [];
  let excluded: Partial<Record<ExclusionReason, number>> = {};

  for (let attempt = 0; attempt < 2; attempt++) {
    excluded = {};
    picks = [];
    for (const place of places) {
      const outcome = await evaluateCandidate(place, q, providers, weather, maxDistance);
      if (!outcome.ok) {
        const r = outcome.reason ?? 'constraint';
        excluded[r] = (excluded[r] ?? 0) + 1;
        continue;
      }
      const availability = assessAvailability(place, outcome.arrive!, outcome.leave!);
      const w = weatherAt(weather, outcome.arrive!);
      const sc = scoreCandidate(place, q, outcome.travel ?? null, w, availability.openUntil, outcome.leave!);
      picks.push({
        place,
        availability,
        travel: outcome.travel ?? null,
        arrive: outcome.arrive!,
        leave: outcome.leave!,
        weather: w,
        score: sc.score,
        fit: fitLabel(sc.score),
        reasons: sc.reasons,
        cautions: sc.cautions,
      });
    }
    if (picks.length >= 3 || attempt === 1 || places.length === 0) break;
    // Loosen distance once, and say so. Never loosen the open-business gate.
    maxDistance = baseDistance + 5;
    relaxed = `We loosened your distance preference by 5 miles`;
  }
  if (relaxed && picks.length === 0) relaxed = undefined;
  if (relaxed) relaxed += ` and found ${picks.length} option${picks.length === 1 ? '' : 's'}.`;

  picks.sort((a, b) => b.score - a.score || a.arrive - b.arrive);
  const recommendations = diversify(picks).slice(0, MAX_RESULTS);

  return {
    recommendations,
    considered: places.length,
    excluded,
    relaxed,
    status,
    weather,
    headline: headlineFor(q, recommendations, weather),
  };
}

/** Keep the list varied: no more than 3 of one primary category in the top results. */
function diversify(list: Recommendation[]): Recommendation[] {
  const counts = new Map<string, number>();
  const out: Recommendation[] = [];
  const deferred: Recommendation[] = [];
  for (const r of list) {
    const key = r.place.categories[0] ?? 'other';
    const n = counts.get(key) ?? 0;
    if (n >= 3) deferred.push(r);
    else {
      counts.set(key, n + 1);
      out.push(r);
    }
  }
  return [...out, ...deferred];
}

export function defaultRadius(mode: TransportMode): number {
  switch (mode) {
    case 'walk':
      return 2;
    case 'bike':
      return 6;
    case 'transit':
      return 12;
    default:
      return 25;
  }
}

/** "More like this": same primary category, nearby, from an existing result set. */
export function moreLikeThis(target: Recommendation, pool: Recommendation[]): Recommendation[] {
  const cats = new Set(target.place.categories);
  return pool
    .filter((r) => r.place.id !== target.place.id)
    .map((r) => ({ r, overlap: r.place.categories.filter((c) => cats.has(c)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.r.score - a.r.score)
    .map((x) => x.r)
    .slice(0, 3);
}
