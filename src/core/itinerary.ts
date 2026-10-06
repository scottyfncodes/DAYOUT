import type { DayQuery, Itinerary, ItineraryStop, Place, Recommendation, TravelEstimate, WeatherForecast } from './types';
import { assessAvailability, earliestVisitStart } from './hours';
import { judgeWeather, weatherAt, nextPrecipitation } from './weather';
import { formatTime } from './time';
import { BUFFER_MIN, effectiveWindow, routingMode } from './pipeline';
import { haversineMiles } from './geo';
import type { RoutingProvider } from '@/providers/types';

type Leg = (from: Place | null, to: Place) => Promise<TravelEstimate | null>;

export interface BuildOptions {
  /** keep the user's order instead of searching for the best valid sequence */
  keepOrder?: boolean;
}

/**
 * Lay the selected places out across the window, including travel, parking
 * friction, hours and buffer. Never produces an impossible plan silently:
 * stops that can't work are kept but flagged with `problems`.
 */
export async function buildItinerary(
  places: Place[],
  q: DayQuery,
  routing: RoutingProvider,
  weather: WeatherForecast | null,
  opts: BuildOptions = {},
): Promise<Itinerary> {
  const window = effectiveWindow(q);
  const mode = routingMode(q.transport);
  const cache = new Map<string, TravelEstimate | null>();
  const leg: Leg = async (from, to) => {
    const key = `${from?.id ?? 'origin'}>${to.id}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    const est = await routing.estimate(from ? from.location : q.origin.point, to.location, mode, window.start);
    cache.set(key, est);
    return est;
  };

  if (places.length === 0) return { stops: [], endsAt: window.start, valid: true, totalTravelMin: 0, notes: [] };

  const orders = opts.keepOrder || places.length > 6 ? [places] : candidateOrders(places, q);
  let best: Itinerary | null = null;
  for (const order of orders) {
    const it = await schedule(order, leg, weather, window);
    if (!best || better(it, best)) best = it;
    if (it.valid && orders.length > 1 && it.totalTravelMin <= bestTravelFloor(order, q)) break;
  }
  const result = best!;
  result.notes = notesFor(result, q, weather);
  return result;
}

function better(a: Itinerary, b: Itinerary): boolean {
  const aProblems = a.stops.reduce((n, s) => n + s.problems.length, 0);
  const bProblems = b.stops.reduce((n, s) => n + s.problems.length, 0);
  if (aProblems !== bProblems) return aProblems < bProblems;
  return a.totalTravelMin < b.totalTravelMin;
}

function bestTravelFloor(order: Place[], q: DayQuery): number {
  // crude lower bound: straight-line chain at 30 mph
  let miles = 0;
  let prev = q.origin.point;
  for (const p of order) {
    miles += haversineMiles(prev, p.location);
    prev = p.location;
  }
  return (miles / 30) * 60;
}

/**
 * Candidate sequences: the user's order, a nearest-neighbour chain, and (for
 * ≤5 stops) every permutation so hours constraints can be satisfied exactly.
 */
function candidateOrders(places: Place[], q: DayQuery): Place[][] {
  const orders: Place[][] = [places];
  // nearest neighbour from origin
  const remaining = [...places];
  const nn: Place[] = [];
  let cursor = q.origin.point;
  while (remaining.length) {
    remaining.sort((a, b) => haversineMiles(cursor, a.location) - haversineMiles(cursor, b.location));
    const next = remaining.shift()!;
    nn.push(next);
    cursor = next.location;
  }
  orders.push(nn);
  if (places.length <= 5) {
    for (const p of permutations(places)) orders.push(p);
  }
  // de-duplicate by id sequence
  const seen = new Set<string>();
  return orders.filter((o) => {
    const k = o.map((p) => p.id).join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i]!, ...p];
  }
}

async function schedule(
  order: Place[],
  leg: Leg,
  weather: WeatherForecast | null,
  window: { start: number; end: number },
): Promise<Itinerary> {
  const stops: ItineraryStop[] = [];
  let cursor = window.start;
  let prev: Place | null = null;
  let totalTravel = 0;
  let valid = true;

  for (const place of order) {
    const travel = await leg(prev, place);
    const friction = travel?.mode === 'drive' ? place.parking?.walkMin ?? 0 : 0;
    const travelMin = travel ? travel.durationMin + (travel.trafficDelayMin ?? 0) + friction : 0;
    totalTravel += travelMin;
    const arrive = cursor + travelMin * 60000;
    const problems: string[] = [];
    const warnings: string[] = [];
    if (!travel) problems.push("We couldn't find a route to this stop.");

    const dwell = place.duration.min;
    let start = earliestVisitStart(place, arrive, window.end, dwell);
    if (start === null) {
      // Keep the plan readable: schedule it at arrival but mark the problem.
      start = arrive;
      const a = assessAvailability(place, arrive, arrive + dwell * 60000);
      if (a.state === 'UNKNOWN') problems.push("Hours couldn't be verified.");
      else if (arrive + dwell * 60000 > window.end) problems.push("Doesn't fit before your day ends.");
      else problems.push(`${place.name} — ${a.reason.toLowerCase()}.`);
    } else if (start - arrive > 5 * 60000) {
      warnings.push(`Opens at ${formatTime(start, place.timezone)} — you'd wait ${Math.round((start - arrive) / 60000)} min.`);
    }

    const avail = assessAvailability(place, start, start + dwell * 60000);
    let end = start + place.duration.typical * 60000;
    if (avail.openUntil && end > avail.openUntil) end = avail.openUntil;
    if (end > window.end) end = window.end;
    if (end < start + dwell * 60000) end = start + dwell * 60000;

    const finalAvail = assessAvailability(place, start, end);
    if (finalAvail.state === 'OPEN_LIKELY') problems.push('Hours not verified for this date.');
    if (finalAvail.state === 'CLOSED' && problems.length === 0) problems.push(`${finalAvail.reason}.`);
    if (end > window.end) problems.push('Runs past the end of your day.');

    const w = weatherAt(weather, start);
    const wv = judgeWeather(place, w);
    if (wv.unsafe) problems.push(wv.note ?? 'Unsafe weather for this stop.');
    else if (wv.score < -0.3 && wv.note) warnings.push(wv.note + '.');

    if (problems.length) valid = false;
    stops.push({ place, travel, arrive, start, end, availability: finalAvail, weather: w, problems, warnings });
    cursor = end + BUFFER_MIN * 60000;
    prev = place;
  }
  return { stops, endsAt: stops.length ? stops[stops.length - 1]!.end : window.start, valid, totalTravelMin: Math.round(totalTravel), notes: [] };
}

function notesFor(it: Itinerary, q: DayQuery, weather: WeatherForecast | null): string[] {
  const notes: string[] = [];
  const tz = q.origin.timezone;
  const precip = nextPrecipitation(weather, q.window.start, q.window.end);
  const outdoorBefore = it.stops.filter((s) => s.place.setting !== 'indoor' && precip && s.end <= precip.time).length;
  if (precip && outdoorBefore > 0) {
    notes.push(`${precip.condition === 'snow' ? 'Snow' : 'Rain'} moves in around ${formatTime(precip.time, tz)} — outdoor stops are scheduled before it.`);
  }
  if (it.totalTravelMin > 0) notes.push(`${it.totalTravelMin} min of travel total, with ${BUFFER_MIN}-minute buffers between stops.`);
  if (it.stops.length && it.endsAt < q.window.end - 60 * 60000) {
    notes.push(`You'd be done by ${formatTime(it.endsAt, tz)} — room for one more.`);
  }
  return notes;
}

/* ------------------------------------------------------------------------- */
/* Rework                                                                     */
/* ------------------------------------------------------------------------- */

export interface ReworkSuggestion {
  stop: ItineraryStop;
  why: string;
  options: Recommendation[];
}

/**
 * Find stops that no longer work (closed, unsafe weather, hours changed) or
 * that are weather-compromised, and propose replacements from the pool that
 * share a category, fit the same slot and are nearby.
 */
export function reworkSuggestions(it: Itinerary, pool: Recommendation[], q: DayQuery): ReworkSuggestion[] {
  const inPlan = new Set(it.stops.map((s) => s.place.id));
  const out: ReworkSuggestion[] = [];
  for (const stop of it.stops) {
    const weatherIssue = stop.weather && judgeWeather(stop.place, stop.weather).score < -0.3;
    if (stop.problems.length === 0 && !weatherIssue) continue;
    const why = stop.problems[0] ?? `${stop.place.name} at ${formatTime(stop.start, q.origin.timezone)} isn't looking great: ${judgeWeather(stop.place, stop.weather).note?.toLowerCase()}.`;
    const options = replacementsFor(stop, pool, inPlan, q, Boolean(weatherIssue));
    out.push({ stop, why, options });
  }
  return out;
}

export function replacementsFor(
  stop: ItineraryStop,
  pool: Recommendation[],
  inPlan: Set<string>,
  q: DayQuery,
  preferIndoor: boolean,
): Recommendation[] {
  const cats = new Set(stop.place.categories);
  const dwell = stop.place.duration.min;
  const ranked = pool
    .filter((r) => !inPlan.has(r.place.id))
    .filter((r) => r.availability.state === 'OPEN_CONFIRMED')
    .filter((r) => !preferIndoor || r.place.setting !== 'outdoor')
    .filter((r) => {
      // Must be open for this slot, not just for the original search window.
      const a = assessAvailability(r.place, stop.start, stop.start + dwell * 60000);
      return a.state === 'OPEN_CONFIRMED';
    })
    .filter((r) => (q.maxPrice === null ? true : r.place.priceLevel <= q.maxPrice))
    .map((r) => ({
      r,
      overlap: r.place.categories.filter((c) => cats.has(c)).length,
      miles: haversineMiles(stop.place.location, r.place.location),
    }))
    .sort((a, b) => b.overlap - a.overlap || a.miles - b.miles || b.r.score - a.r.score);
  // Same-category swaps first; only fall back to anything-open when there are none.
  const sameKind = ranked.filter((x) => x.overlap > 0);
  return (sameKind.length ? sameKind : ranked).slice(0, 3).map((x) => x.r);
}
